import { sseStream } from "@/lib/events";
import { normaliseSchedule } from "@/lib/schema";
import { create, get } from "@/lib/store";
import { generateArtifacts } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Rebuilds the workbook from edits the preparer made in the table. */
export async function POST(req: Request) {
  let body: { sessionId?: string; schedule?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Malformed request." }, 400);
  }

  // The workbook is written from the schedule the client sends, so a missing
  // server session is recoverable — mint a fresh one and carry on.
  const session = get(body.sessionId) ?? create();

  const schedule = normaliseSchedule(body.schedule);
  if (schedule.rows.length === 0) {
    return json({ error: "There is nothing to write — the schedule is empty." }, 400);
  }

  return sseStream(async (emit) => {
    await generateArtifacts(session, schedule, emit);
    emit({ type: "summary", text: "Rebuilt the workbook from your edits." });
    emit({ type: "stage", stage: "done", label: "Updated" });
  });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
