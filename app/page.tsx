"use client";

import { useCallback, useRef, useState } from "react";
import { Dropzone } from "@/components/Dropzone";
import { RunStream } from "@/components/RunStream";
import { type Turn } from "@/components/ChatPanel";
import { ReviewWorkspace } from "@/components/ReviewWorkspace";
import { RecentSessions } from "@/components/RecentSessions";
import { useAgentStream } from "@/lib/useAgentStream";

export default function Page() {
  const { state, process, revise, regenerate, restore, reset, cancel, setSchedule } = useAgentStream();
  const [turns, setTurns] = useState<Turn[]>([]);
  const turnId = useRef(0);

  const started = state.running || state.lines.length > 0 || Boolean(state.schedule);
  const reviewing = Boolean(state.schedule);

  const send = useCallback(
    (instruction: string) => {
      if (!state.sessionId) return;
      setTurns((t) => [...t, { id: ++turnId.current, who: "you", text: instruction }]);
      void revise(state.sessionId, instruction, state.schedule).then(({ summary, error }) => {
        setTurns((t) => [
          ...t,
          {
            id: ++turnId.current,
            who: "assistant",
            text: error ?? summary ?? "Applied — the schedule is updated.",
          },
        ]);
      });
    },
    [revise, state.sessionId, state.schedule],
  );

  const startOver = () => {
    setTurns([]);
    reset();
  };

  return (
    <div className="shell">
      <header className="nav">
        <div className="nav__mark">
          Schedule <span>· FIRS WHT &amp; VAT</span>
        </div>
        <div className="nav__meta">
          {state.sessionId && <span data-optional>session {state.sessionId.slice(2, 8)}</span>}
          {started && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={startOver} disabled={state.running}>
              Start over
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {!started && (
          <>
            <Dropzone onRun={process} busy={state.running} />
            <div style={{ maxWidth: 940, margin: "0 auto" }}>
              <RecentSessions busy={state.running} onOpen={(id) => void restore(id)} />
            </div>
          </>
        )}

        {started && !reviewing && (
          <>
            {state.error && (
              <div className="notice notice--bad" role="alert">
                <span>{state.error}</span>
              </div>
            )}
            <RunStream state={state} onCancel={cancel} />
            {!state.running && state.error && (
              <div className="actions">
                <button type="button" className="btn" onClick={startOver}>
                  Try different documents
                </button>
              </div>
            )}
          </>
        )}

        {reviewing && state.schedule && (
          <ReviewWorkspace
            state={state}
            schedule={state.schedule}
            turns={turns}
            onSchedule={setSchedule}
            onSend={send}
            onRegenerate={() => {
              if (state.sessionId && state.schedule) void regenerate(state.sessionId, state.schedule);
            }}
          />
        )}
      </main>

      <footer className="foot">
        <strong>Schedule</strong>
        <span>FIRS withholding tax &amp; VAT preparation</span>
        <span>Review every flagged line before filing.</span>
      </footer>
    </div>
  );
}

function money(n: number) {
  return n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function size(n: number) {
  return n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
