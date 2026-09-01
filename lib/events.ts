/** Server-sent events, typed on both ends. */
import type { Schedule } from "./schema";
import type { SourceDoc } from "./store";

export type Stage = "read" | "extract" | "compute" | "build" | "preview" | "done";

export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "stage"; stage: Stage; label: string }
  | { type: "log"; text: string; tone?: "info" | "warn" }
  | { type: "tool"; name: string; detail: string; status: "start" | "ok" | "fail" }
  | { type: "sources"; sources: SourceDoc[]; skipped: { name: string; reason: string }[] }
  | { type: "schedule"; schedule: Schedule }
  | { type: "artifacts"; xlsx: boolean; pdf: boolean }
  /** Bytes travel with the stream so nothing depends on server-side session
   *  state surviving to the next request — which, on serverless, it may not. */
  | { type: "artifact"; kind: "xlsx" | "pdf"; name: string; mime: string; data: string }
  | { type: "summary"; text: string }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "done" };

export function sseStream(
  run: (emit: (e: AgentEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true; // client hung up mid-run
        }
      };
      try {
        await run(emit);
      } catch (e) {
        emit({ type: "error", message: (e as Error).message || "Something failed.", fatal: true });
      } finally {
        emit({ type: "done" });
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
