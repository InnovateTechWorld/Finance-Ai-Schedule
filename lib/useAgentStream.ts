"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  base64ToBytes,
  listSessions,
  loadArtifact,
  loadSession,
  saveArtifact,
  saveSession,
  titleFor,
  type SavedSession,
} from "./persist";
import { LOW_CONFIDENCE } from "./schema";
import type { AgentEvent, Stage } from "./events";
import type { Schedule } from "./schema";
import type { SourceDoc } from "./store";

export const STEPS: { stage: Stage; label: string }[] = [
  { stage: "read", label: "Reading your documents" },
  { stage: "extract", label: "Matching invoices to payments" },
  { stage: "compute", label: "Applying WHT and VAT rates" },
  { stage: "build", label: "Writing the FIRS workbook" },
  { stage: "preview", label: "Rendering a preview" },
];

export interface LogLine {
  id: number;
  gutter: string;
  text: string;
  tone: "info" | "warn" | "bad" | "tool";
}

export interface StreamState {
  running: boolean;
  sessionId?: string;
  stage?: Stage;
  reached: Stage[];
  failedAt?: Stage;
  lines: LogLine[];
  sources: SourceDoc[];
  skipped: { name: string; reason: string }[];
  schedule?: Schedule;
  hasXlsx: boolean;
  hasPdf: boolean;
  summary?: string;
  error?: string;
  /** Bumped on every artifact refresh so cached previews are re-fetched. */
  rev: number;
  /** True when the on-screen table has edits the workbook does not yet carry. */
  dirty: boolean;
  /** Object URLs for the artifacts, held client-side so nothing depends on the
   *  server still remembering this session. */
  urls: { xlsx?: string; pdf?: string };
  /** Set when a session was rehydrated from this browser rather than just run. */
  restored: boolean;
}

const EMPTY: StreamState = {
  running: false,
  reached: [],
  lines: [],
  sources: [],
  skipped: [],
  hasXlsx: false,
  hasPdf: false,
  rev: 0,
  dirty: false,
  urls: {},
  restored: false,
};

/**
 * Reads the SSE pipeline and folds it into render state. Deliberately keeps
 * every log line — the point of the screen is that you can see what happened.
 */
export function useAgentStream() {
  const [state, setState] = useState<StreamState>(EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  /** Last run's outcome, so callers can react without reading stale state. */
  const outcomeRef = useRef<{ summary?: string; error?: string }>({});

  const push = useCallback((gutter: string, text: string, tone: LogLine["tone"] = "info") => {
    setState((s) => ({ ...s, lines: [...s.lines, { id: ++idRef.current, gutter, text, tone }] }));
  }, []);

  const apply = useCallback(
    (e: AgentEvent) => {
      switch (e.type) {
        case "session":
          setState((s) => ({ ...s, sessionId: e.sessionId }));
          break;
        case "stage":
          setState((s) => ({
            ...s,
            stage: e.stage,
            reached: s.reached.includes(e.stage) ? s.reached : [...s.reached, e.stage],
          }));
          if (e.stage !== "done") push("stage", e.label, "tool");
          break;
        case "log":
          push("·", e.text, e.tone === "warn" ? "warn" : "info");
          break;
        case "tool":
          push(
            e.status === "fail" ? "failed" : e.status === "ok" ? "done" : "call",
            `${e.name} — ${e.detail}`,
            e.status === "fail" ? "bad" : "tool",
          );
          break;
        case "sources":
          setState((s) => ({ ...s, sources: e.sources, skipped: e.skipped }));
          break;
        case "schedule":
          setState((s) => ({ ...s, schedule: e.schedule }));
          break;
        case "artifact": {
          const bytes = base64ToBytes(e.data);
          const url = URL.createObjectURL(new Blob([bytes], { type: e.mime }));
          setState((s) => {
            // Revoking the previous URL keeps a long demo from leaking blobs.
            const previous = s.urls[e.kind];
            if (previous) URL.revokeObjectURL(previous);
            if (s.sessionId) void saveArtifact(s.sessionId, e.kind, { name: e.name, mime: e.mime, bytes });
            return { ...s, urls: { ...s.urls, [e.kind]: url } };
          });
          break;
        }
        case "artifacts":
          setState((s) => ({
            ...s,
            hasXlsx: e.xlsx,
            hasPdf: e.pdf,
            rev: s.rev + 1,
            dirty: false,
            urls: e.pdf ? s.urls : { ...s.urls, pdf: undefined },
          }));
          break;
        case "summary":
          outcomeRef.current.summary = e.text;
          setState((s) => ({ ...s, summary: e.text }));
          push("ai", e.text, "info");
          break;
        case "error":
          outcomeRef.current.error = e.message;
          push("error", e.message, "bad");
          setState((s) => ({
            ...s,
            error: e.message,
            failedAt: e.fatal ? s.stage : s.failedAt,
          }));
          break;
        case "done":
          setState((s) => ({ ...s, running: false }));
          break;
      }
    },
    [push],
  );

  const run = useCallback(
    async (input: {
      url: string;
      body: BodyInit;
      headers?: HeadersInit;
      reset?: boolean;
    }): Promise<{ summary?: string; error?: string }> => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      outcomeRef.current = {};

      setState((s) =>
        input.reset
          ? { ...EMPTY, running: true }
          : { ...s, running: true, error: undefined, summary: undefined, failedAt: undefined },
      );

      let res: Response;
      try {
        res = await fetch(input.url, {
          method: "POST",
          body: input.body,
          headers: input.headers,
          signal: ac.signal,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return {};
        const error = "Lost the connection to the server.";
        setState((s) => ({ ...s, running: false, error }));
        return { error };
      }

      if (!res.ok || !res.body) {
        let message = `Request failed (${res.status}).`;
        try {
          const j = await res.json();
          if (j?.error) message = j.error;
        } catch {
          /* non-JSON error body */
        }
        setState((s) => ({ ...s, running: false, error: message }));
        return { error: message };
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const payload = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("");
            if (!payload) continue;
            try {
              apply(JSON.parse(payload) as AgentEvent);
            } catch {
              /* a partial frame we can safely ignore */
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setState((s) => ({ ...s, error: "The stream was interrupted." }));
        }
      } finally {
        setState((s) => ({ ...s, running: false }));
      }
      return outcomeRef.current;
    },
    [apply],
  );

  const process = useCallback(
    (files: File[]) => {
      const form = new FormData();
      for (const f of files) form.append("files", f);
      return run({ url: "/api/process", body: form, reset: true });
    },
    [run],
  );

  const revise = useCallback(
    (sessionId: string, instruction: string, schedule?: Schedule) =>
      run({
        url: "/api/revise",
        // The schedule rides along so a restored session still works after the
        // server has forgotten it.
        body: JSON.stringify({ sessionId, instruction, schedule }),
        headers: { "content-type": "application/json" },
      }),
    [run],
  );

  const regenerate = useCallback(
    (sessionId: string, schedule: Schedule) =>
      run({
        url: "/api/regenerate",
        body: JSON.stringify({ sessionId, schedule }),
        headers: { "content-type": "application/json" },
      }),
    [run],
  );

  const setSchedule = useCallback((schedule: Schedule) => {
    // Local edits invalidate the workbook on disk until it is rebuilt.
    setState((s) => ({ ...s, schedule, dirty: true }));
  }, []);

  const restore = useCallback(async (id: string) => {
    const saved = loadSession(id);
    if (!saved) return false;

    const [xlsx, pdf] = await Promise.all([loadArtifact(id, "xlsx"), loadArtifact(id, "pdf")]);
    const urls: { xlsx?: string; pdf?: string } = {};
    if (xlsx) urls.xlsx = URL.createObjectURL(new Blob([xlsx.bytes], { type: xlsx.mime }));
    if (pdf) urls.pdf = URL.createObjectURL(new Blob([pdf.bytes], { type: pdf.mime }));

    setState({
      ...EMPTY,
      sessionId: saved.id,
      schedule: saved.schedule,
      sources: saved.sources,
      skipped: saved.skipped,
      lines: saved.lines,
      // The saved flags are claims about bytes; the URLs are the evidence.
      hasXlsx: Boolean(urls.xlsx),
      hasPdf: Boolean(urls.pdf),
      urls,
      stage: "done",
      reached: ["read", "extract", "compute", "build", "preview", "done"],
      restored: true,
      rev: 1,
    });
    // Keep the id counter ahead of the restored log so React keys stay unique.
    idRef.current = Math.max(idRef.current, ...saved.lines.map((l) => l.id), 0);
    return true;
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => {
      for (const url of Object.values(s.urls)) if (url) URL.revokeObjectURL(url);
      return EMPTY;
    });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((s) => ({ ...s, running: false }));
  }, []);

  // Autosave whenever the schedule settles. Runs after the stream closes so a
  // half-extracted schedule is never what you come back to.
  useEffect(() => {
    if (state.running || !state.schedule || !state.sessionId) return;
    const schedule = state.schedule;
    saveSession({
      id: state.sessionId,
      savedAt: Date.now(),
      title: titleFor(schedule),
      rows: schedule.rows.length,
      flagged: schedule.rows.filter((r) =>
        Object.values(r).some(
          (c) => c && typeof c === "object" && "confidence" in c && (c as { confidence: number }).confidence < LOW_CONFIDENCE,
        ),
      ).length,
      schedule,
      sources: state.sources,
      skipped: state.skipped,
      lines: state.lines.slice(-60),
      hasXlsx: state.hasXlsx,
      hasPdf: state.hasPdf,
    });
  }, [state.running, state.schedule, state.sessionId, state.sources, state.skipped, state.lines, state.hasXlsx, state.hasPdf]);

  return { state, process, revise, regenerate, restore, reset, cancel, setSchedule, listSessions };
}
