"use client";

import { useEffect, useRef, useState } from "react";

export interface Turn {
  id: number;
  who: "you" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "WHT on row 3 should be 5%, not 10%",
  "Drop any row under ₦50,000",
  "The period is Q1 2025",
];

export function ChatPanel({
  turns,
  busy,
  onSend,
}: {
  turns: Turn[];
  busy: boolean;
  onSend: (instruction: string) => void;
}) {
  const [value, setValue] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, busy]);

  const submit = (text: string) => {
    const instruction = text.trim();
    if (!instruction || busy) return;
    setValue("");
    onSend(instruction);
  };

  return (
    <section className="chat">
      <div className="panel__head">
        <span>Ask for a change</span>
        <span>{busy ? "working…" : "the workbook regenerates"}</span>
      </div>

      {turns.length > 0 && (
        <div className="chat__log" ref={logRef} aria-live="polite">
          {turns.map((t) => (
            <p className={`turn${t.who === "assistant" ? " turn--ai" : ""}`} key={t.id}>
              <span className="turn__who">{t.who === "you" ? "You" : "Assistant"}</span>
              {t.text}
            </p>
          ))}
          {busy && (
            <p className="turn turn--ai">
              <span className="turn__who">Assistant</span>
              <span className="spinner" aria-hidden style={{ display: "inline-block", verticalAlign: "-1px" }} />{" "}
              Applying your change…
            </p>
          )}
        </div>
      )}

      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
      >
        <input
          className="input"
          placeholder="e.g. the WHT rate on the Adeyemi invoice should be 5%"
          value={value}
          disabled={busy}
          maxLength={2000}
          aria-label="Describe the change you want"
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="submit"
          className="btn"
          disabled={busy || value.trim().length === 0}
          data-state={busy ? "loading" : undefined}
        >
          {busy && <span className="spinner" aria-hidden />}
          Apply
        </button>
      </form>

      {turns.length === 0 && (
        <div className="suggests">
          {SUGGESTIONS.map((s) => (
            <button type="button" className="suggest" key={s} disabled={busy} onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
