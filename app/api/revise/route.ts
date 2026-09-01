import { sseStream } from "@/lib/events";
import { ask, extractJson, modelRoute } from "@/lib/llm";
import { REVISE_SYSTEM } from "@/lib/prompts";
import { normaliseSchedule } from "@/lib/schema";
import { create, get } from "@/lib/store";
import { generateArtifacts } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  let body: { sessionId?: string; instruction?: string; schedule?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  const instruction = (body.instruction ?? "").trim();
  if (!instruction) return json({ error: "Type what you would like changed." }, 400);
  if (instruction.length > 2000) {
    return json({ error: "That instruction is very long — try one change at a time." }, 400);
  }

  // A restored session (or a serverless instance that never saw this run) has
  // no server-side state. The client carries the schedule, so accept it.
  const existing = get(body.sessionId);
  const fallback = body.schedule ? normaliseSchedule(body.schedule) : undefined;
  const current = existing?.schedule ?? fallback;
  if (!current || current.rows.length === 0) {
    return json({ error: "This session is no longer available. Re-upload your documents to start again." }, 410);
  }
  const session = existing ?? create();
  if (modelRoute() === "none") return json({ error: "No model credentials configured." }, 503);

  return sseStream(async (emit) => {
    emit({ type: "stage", stage: "extract", label: "Applying your change" });
    emit({ type: "tool", name: "model", detail: "reading your instruction", status: "start" });

    let raw: string;
    try {
      raw = await ask({
        system: REVISE_SYSTEM,
        blocks: [
          { type: "text", text: `Current schedule:\n${JSON.stringify(current)}` },
          { type: "text", text: `Instruction:\n${instruction}` },
        ],
      });
    } catch (e) {
      emit({ type: "tool", name: "model", detail: (e as Error).message, status: "fail" });
      emit({ type: "error", message: (e as Error).message, fatal: true });
      return;
    }

    let parsed: { summary?: unknown };
    try {
      parsed = extractJson(raw) as { summary?: unknown };
    } catch (e) {
      emit({ type: "tool", name: "model", detail: "unparseable response", status: "fail" });
      emit({ type: "error", message: (e as Error).message, fatal: true });
      return;
    }

    const updated = normaliseSchedule(parsed);
    if (updated.rows.length === 0) {
      emit({
        type: "error",
        message: "That change would have emptied the schedule, so nothing was applied.",
        fatal: true,
      });
      return;
    }

    emit({ type: "tool", name: "model", detail: `${updated.rows.length} rows`, status: "ok" });
    emit({
      type: "summary",
      text:
        typeof parsed.summary === "string" && parsed.summary.trim()
          ? parsed.summary.trim()
          : "Applied your change and regenerated the workbook.",
    });

    await generateArtifacts(session, updated, emit);
    emit({ type: "stage", stage: "done", label: "Updated" });
  });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
