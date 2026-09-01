"use client";

import { useEffect, useRef } from "react";
import { STEPS, type StreamState } from "@/lib/useAgentStream";

/** The live console. Progress on the left, what actually happened on the right. */
export function RunStream({ state, onCancel }: { state: StreamState; onCancel: () => void }) {
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.lines.length]);

  const currentIndex = STEPS.findIndex((s) => s.stage === state.stage);

  return (
    <section className="run">
      <div className="rail">
        {STEPS.map((step, i) => {
          const reached = state.reached.includes(step.stage);
          const failed = state.failedAt === step.stage;
          const active = state.running && state.stage === step.stage;
          const done = !failed && reached && (currentIndex > i || !state.running);
          return (
            <div
              className="step"
              key={step.stage}
              data-state={failed ? "fail" : active ? "active" : done ? "done" : "idle"}
            >
              <span className="step__dot" aria-hidden />
              <span>{step.label}</span>
            </div>
          );
        })}
        {state.running && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel} style={{ marginTop: "1rem" }}>
            Stop
          </button>
        )}
      </div>

      <div>
        {state.running && (
          <div className="ledger" role="img" aria-label="Reading your documents">
            <div className="ledger__rows" aria-hidden>
              <span className="ledger__bar" />
              <span className="ledger__bar" />
              <span className="ledger__bar" />
              <span className="ledger__bar" />
              <span className="ledger__bar" />
            </div>
            <div className="ledger__caption" aria-hidden>
              <span>{STEPS.find((s) => s.stage === state.stage)?.label ?? "Working"}</span>
              <span>{state.sources.length || ""}</span>
            </div>
          </div>
        )}
        <div className="console" ref={consoleRef} aria-live="polite" aria-label="Processing log">
          {state.lines.length === 0 && <p className="empty">Waiting for the first event…</p>}
          {state.lines.map((line) => (
            <div className="line" key={line.id} data-tone={line.tone}>
              <span className="line__gutter">{line.gutter}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
