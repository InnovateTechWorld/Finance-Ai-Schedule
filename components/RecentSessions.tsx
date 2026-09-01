"use client";

import { useEffect, useState } from "react";
import { clearSessions, deleteSession, listSessions, type SavedSession } from "@/lib/persist";

/**
 * Saved runs from this browser. Read on mount rather than during render —
 * localStorage is unavailable on the server and would break hydration.
 */
export function RecentSessions({
  onOpen,
  busy,
}: {
  onOpen: (id: string) => void;
  busy: boolean;
}) {
  const [sessions, setSessions] = useState<SavedSession[] | null>(null);

  useEffect(() => {
    setSessions(listSessions());
  }, []);

  if (!sessions || sessions.length === 0) return null;

  return (
    <section className="recent">
      <div className="recent__head">
        <span className="recent__title">Saved on this device</span>
        <button
          type="button"
          className="suggest"
          disabled={busy}
          onClick={() => {
            clearSessions();
            setSessions([]);
          }}
        >
          Clear all
        </button>
      </div>

      <div className="recent__list">
        {sessions.map((s) => (
          <div key={s.id} style={{ display: "flex" }}>
            <button
              type="button"
              className="recent__row"
              disabled={busy}
              onClick={() => onOpen(s.id)}
            >
              <span className="recent__name">{s.title}</span>
              <span className="recent__meta">
                {s.rows} row{s.rows === 1 ? "" : "s"}
                {s.flagged > 0 ? ` · ${s.flagged} flagged` : ""} · {when(s.savedAt)}
              </span>
            </button>
            <button
              type="button"
              className="iconbtn"
              style={{ borderBottom: "var(--rule-card) solid var(--color-rule)" }}
              disabled={busy}
              aria-label={`Delete ${s.title}`}
              onClick={() => {
                deleteSession(s.id);
                setSessions(listSessions());
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

function when(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(ts).toLocaleDateString();
}
