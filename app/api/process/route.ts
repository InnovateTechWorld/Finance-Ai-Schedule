import { sseStream } from "@/lib/events";
import { prepare, validateBatch, type IncomingFile } from "@/lib/ingest";
import { ask, extractJson, modelRoute } from "@/lib/llm";
import { EXTRACT_SYSTEM } from "@/lib/prompts";
import { normaliseSchedule } from "@/lib/schema";
import { create, put, type SourceDoc } from "@/lib/store";
import { upload as sandboxUpload, sandboxConfigured } from "@/lib/sandbox";
import { generateArtifacts } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const files: IncomingFile[] = [];
  try {
    const form = await req.formData();
    for (const entry of form.getAll("files")) {
      if (entry instanceof File) {
        files.push({
          name: entry.name || "untitled",
          bytes: Buffer.from(await entry.arrayBuffer()),
          type: entry.type,
        });
      }
    }
  } catch {
    return json({ error: "Could not read the upload — the request may have been too large." }, 413);
  }

  const invalid = validateBatch(files);
  if (invalid) return json({ error: invalid }, 400);
  if (modelRoute() === "none") {
    return json(
      { error: "No model credentials configured. Set AWS_BEARER_TOKEN_BEDROCK or ANTHROPIC_API_KEY." },
      503,
    );
  }

  return sseStream(async (emit) => {
    const session = create();
    emit({ type: "session", sessionId: session.id });

    // ── 1. Read ───────────────────────────────────────────────────────────
    emit({ type: "stage", stage: "read", label: "Reading your documents" });
    for (const f of files) emit({ type: "log", text: `${f.name} · ${size(f.bytes.byteLength)}` });

    const { prepared, skipped, notes } = await prepare(files, (m) =>
      emit({ type: "tool", name: "convert_file", detail: m, status: "start" }),
    );
    for (const p of prepared) {
      if (p.via) emit({ type: "tool", name: "convert_file", detail: `${p.name} · ${p.via}`, status: "ok" });
    }
    for (const s of skipped) emit({ type: "log", text: `Skipped ${s.name} — ${s.reason}`, tone: "warn" });
    for (const n of notes) emit({ type: "log", text: n, tone: "warn" });

    if (prepared.length === 0) {
      emit({
        type: "error",
        message:
          "None of those files could be read. PDFs, images, Office documents, CSV and plain text all work.",
        fatal: true,
      });
      return;
    }

    const sources: SourceDoc[] = prepared.map((p) => ({
      name: p.name,
      kind: p.kind,
      bytes: p.bytes,
      via: p.via,
      pages: p.pages,
    }));
    session.sources = sources;
    session.skipped = skipped;
    put(session);
    emit({ type: "sources", sources, skipped });

    // Seed the sandbox with the originals so follow-up code can reach them.
    if (sandboxConfigured()) {
      try {
        session.sandboxSession = await sandboxUpload(files.slice(0, 10), session.sandboxSession);
        put(session);
      } catch (e) {
        emit({ type: "log", text: `Sandbox seeding skipped: ${(e as Error).message}`, tone: "warn" });
      }
    }

    // ── 2. Extract ────────────────────────────────────────────────────────
    emit({ type: "stage", stage: "extract", label: "Matching invoices to payments" });
    emit({
      type: "tool",
      name: "model",
      detail: `${prepared.length} document${prepared.length === 1 ? "" : "s"}`,
      status: "start",
    });

    let raw: string;
    try {
      raw = await ask({
        system: EXTRACT_SYSTEM,
        blocks: [
          ...prepared.flatMap((p) => p.blocks),
          { type: "text", text: "Build the FIRS WHT/VAT schedule from the documents above. JSON only." },
        ],
      });
    } catch (e) {
      emit({ type: "tool", name: "model", detail: (e as Error).message, status: "fail" });
      emit({ type: "error", message: (e as Error).message, fatal: true });
      return;
    }

    let schedule;
    try {
      schedule = normaliseSchedule(extractJson(raw));
    } catch (e) {
      emit({ type: "tool", name: "model", detail: "unparseable response", status: "fail" });
      emit({ type: "error", message: (e as Error).message, fatal: true });
      return;
    }
    emit({ type: "tool", name: "model", detail: `${schedule.rows.length} rows extracted`, status: "ok" });

    if (schedule.rows.length === 0) {
      emit({
        type: "error",
        message:
          "No taxable transactions were found in those documents. Check you uploaded the statement and invoices.",
        fatal: true,
      });
      return;
    }

    // ── 3. Compute ────────────────────────────────────────────────────────
    emit({ type: "stage", stage: "compute", label: "Applying WHT and VAT rates" });
    for (const w of schedule.warnings) emit({ type: "log", text: w, tone: "warn" });

    // ── 4 / 5. Build the workbook, then render a preview ───────────────────
    await generateArtifacts(session, schedule, emit);
    emit({ type: "stage", stage: "done", label: "Ready for review" });
  });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function size(n: number) {
  return n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
