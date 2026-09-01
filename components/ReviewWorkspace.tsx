"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewTable } from "./ReviewTable";
import { ChatPanel, type Turn } from "./ChatPanel";
import { LOW_CONFIDENCE, totals, type Schedule, type ScheduleRow } from "@/lib/schema";
import type { StreamState } from "@/lib/useAgentStream";

type DrawerId = "flags" | "docs" | "totals" | "log";
type CentreView = "preview" | "table";

/**
 * The review stage. The rendered schedule holds the centre; everything that
 * supports it — flags, sources, totals, the run log — waits in the left rail
 * until asked for. Only one drawer is open at a time, so the page never
 * competes with itself.
 */
export function ReviewWorkspace({
  state,
  schedule,
  turns,
  onSchedule,
  onSend,
  onRegenerate,
}: {
  state: StreamState;
  schedule: Schedule;
  turns: Turn[];
  onSchedule: (next: Schedule) => void;
  onSend: (instruction: string) => void;
  onRegenerate: () => void;
}) {
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [view, setView] = useState<CentreView>("preview");
  const [expanded, setExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);

  const sums = useMemo(() => totals(schedule.rows), [schedule.rows]);
  const flaggedRows = useMemo(
    () => schedule.rows.filter(isFlagged).map((r) => ({ row: r, fields: flaggedFields(r) })),
    [schedule.rows],
  );
  const flagCount = flaggedRows.length + schedule.warnings.length;

  // A run that produced no preview should not open on an empty frame.
  useEffect(() => {
    if (!state.hasPdf && view === "preview") setView("table");
  }, [state.hasPdf, view]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const toggle = useCallback((id: DrawerId) => {
    setDrawer((current) => (current === id ? null : id));
  }, []);

  // Blob URLs, so the preview and download work whether the run just happened,
  // was restored from this browser, or landed on a different serverless instance.
  const previewSrc = state.urls.pdf
    ? `${state.urls.pdf}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`
    : null;
  const xlsxHref = state.urls.xlsx;

  return (
    <div className={`ws${drawer ? " ws--drawer" : ""}${chatOpen ? " ws--chat" : ""}`}>
      {/* ── Left rail ─────────────────────────────────────────────────── */}
      <nav className="rail2" aria-label="Schedule details">
        <RailButton
          id="flags"
          label="Review"
          count={flagCount}
          tone={flagCount > 0 ? "flag" : "good"}
          active={drawer === "flags"}
          onClick={toggle}
        />
        <RailButton id="docs" label="Sources" count={state.sources.length} active={drawer === "docs"} onClick={toggle} />
        <RailButton id="totals" label="Totals" active={drawer === "totals"} onClick={toggle} />
        <RailButton id="log" label="Run log" count={state.lines.length} active={drawer === "log"} onClick={toggle} />
      </nav>

      {/* ── Drawer ────────────────────────────────────────────────────── */}
      {drawer && (
        <aside className="drawer" aria-label={DRAWER_TITLES[drawer]}>
          <div className="drawer__head">
            <span>{DRAWER_TITLES[drawer]}</span>
            <button type="button" className="iconbtn" onClick={() => setDrawer(null)} aria-label="Close panel">
              ✕
            </button>
          </div>

          <div className="drawer__body">
            {drawer === "flags" && (
              <>
                {flagCount === 0 && (
                  <p className="empty">Nothing flagged — every field was read with high confidence.</p>
                )}
                {schedule.warnings.map((w) => (
                  <div className="note" key={w}>
                    <span className="badge badge--flag">Note</span>
                    <p>{w}</p>
                  </div>
                ))}
                {flaggedRows.map(({ row, fields }) => (
                  <div className="note" key={row.sn}>
                    <span className="badge badge--flag">Row {row.sn}</span>
                    <p>
                      <strong>{row.beneficiary.value || "Unnamed beneficiary"}</strong> — check {fields.join(", ")}.
                    </p>
                    <button
                      type="button"
                      className="suggest"
                      onClick={() => {
                        setView("table");
                        setDrawer(null);
                      }}
                    >
                      Open in table
                    </button>
                  </div>
                ))}
              </>
            )}

            {drawer === "docs" && (
              <>
                {state.sources.map((d) => (
                  <div className="doc" key={d.name}>
                    <span className="doc__glyph" aria-hidden>
                      {d.kind === "pdf" ? "PDF" : d.kind === "image" ? "IMG" : "TXT"}
                    </span>
                    <span>
                      <span className="doc__name">{d.name}</span>
                      <span className="doc__meta">
                        {size(d.bytes)}
                        {d.pages ? ` · ${d.pages}p` : ""}
                        {d.via ? ` · ${d.via}` : ""}
                      </span>
                    </span>
                  </div>
                ))}
                {state.skipped.map((s) => (
                  <div className="doc doc--skipped" key={s.name}>
                    <span className="doc__glyph" aria-hidden>
                      —
                    </span>
                    <span>
                      <span className="doc__name">{s.name}</span>
                      <span className="doc__meta">{s.reason}</span>
                    </span>
                  </div>
                ))}
              </>
            )}

            {drawer === "totals" && (
              <dl style={{ margin: 0, padding: "var(--space-md)" }}>
                <div className="stat">
                  <dt>Gross</dt>
                  <dd>{money(sums.gross)}</dd>
                </div>
                <div className="stat">
                  <dt>VAT</dt>
                  <dd>{money(sums.vat)}</dd>
                </div>
                <div className="stat">
                  <dt>WHT</dt>
                  <dd>{money(sums.wht)}</dd>
                </div>
                <div className="stat stat--total">
                  <dt>Net payable</dt>
                  <dd>{money(sums.net)}</dd>
                </div>
                <div className="stat" style={{ marginTop: "var(--space-md)" }}>
                  <dt>Transactions</dt>
                  <dd>{schedule.rows.length}</dd>
                </div>
                <div className="stat">
                  <dt>Currency</dt>
                  <dd>{schedule.meta.currency}</dd>
                </div>
              </dl>
            )}

            {drawer === "log" && (
              <div className="console" style={{ border: 0, borderRadius: 0, maxHeight: "none" }}>
                {state.lines.map((l) => (
                  <div className="line" key={l.id} data-tone={l.tone}>
                    <span className="line__gutter">{l.gutter}</span>
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ── Centre stage ──────────────────────────────────────────────── */}
      <section className="stage" aria-label="Schedule">
        <header className="stage__bar">
          <div className="seg" role="tablist" aria-label="View">
            <button
              type="button"
              role="tab"
              aria-selected={view === "preview"}
              className="seg__btn"
              disabled={!state.hasPdf}
              onClick={() => setView("preview")}
            >
              Schedule
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "table"}
              className="seg__btn"
              onClick={() => setView("table")}
            >
              Edit rows
            </button>
          </div>

          <div className="stage__meta">
            {state.dirty ? (
              <span className="badge badge--flag">Edits not in the workbook</span>
            ) : flagCount > 0 ? (
              <button type="button" className="badge badge--flag" onClick={() => toggle("flags")}>
                {flagCount} to review
              </button>
            ) : (
              <span className="badge badge--good">All clear</span>
            )}
          </div>

          <div className="stage__actions">
            {state.dirty && (
              <button
                type="button"
                className="btn btn--sm"
                disabled={state.running}
                data-state={state.running ? "loading" : undefined}
                onClick={onRegenerate}
              >
                {state.running && <span className="spinner" aria-hidden />}
                Rebuild
              </button>
            )}
            {!state.dirty && xlsxHref && (
              <a className="btn btn--sm" href={xlsxHref} download="firs-wht-vat-schedule.xlsx">
                Download .xlsx
              </a>
            )}
            {view === "preview" && previewSrc && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setExpanded(true)}
                aria-label="Expand schedule to full screen"
              >
                Expand
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              aria-expanded={chatOpen}
              onClick={() => setChatOpen((v) => !v)}
            >
              {chatOpen ? "Hide assistant" : "Ask AI"}
            </button>
          </div>
        </header>

        <div className="stage__body">
          {view === "preview" ? (
            previewSrc ? (
              <iframe key={previewSrc} className="paper" src={previewSrc} title="Rendered schedule" />
            ) : (
              <p className="empty">
                No rendered schedule for this run — switch to <strong>Edit rows</strong> to see the data.
              </p>
            )
          ) : (
            <div className="sheet sheet--flush">
              <ReviewTable schedule={schedule} onChange={onSchedule} disabled={state.running} />
            </div>
          )}
        </div>
      </section>

      {/* ── Right · assistant ─────────────────────────────────────────── */}
      {chatOpen && (
        <aside className="assist" aria-label="Assistant">
          {state.summary && (
            <div className="notice notice--good" role="status">
              <span>{state.summary}</span>
            </div>
          )}
          {state.error && (
            <div className="notice notice--warn" role="alert">
              <span>{state.error}</span>
            </div>
          )}
          <ChatPanel turns={turns} busy={state.running} onSend={onSend} />
        </aside>
      )}

      {/* ── Expanded preview ──────────────────────────────────────────── */}
      {expanded && previewSrc && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label="Schedule, full screen">
          <div className="lightbox__bar">
            <span className="lightbox__title">
              {schedule.meta.taxpayerName.value || "Schedule"} · {schedule.meta.period.value || "period unstated"}
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setExpanded(false)}>
              Close
            </button>
          </div>
          <iframe className="paper paper--full" src={previewSrc} title="Rendered schedule, full screen" />
        </div>
      )}
    </div>
  );
}

const DRAWER_TITLES: Record<DrawerId, string> = {
  flags: "Needs your review",
  docs: "Source documents",
  totals: "Totals",
  log: "Run log",
};

function RailButton({
  id,
  label,
  count,
  tone,
  active,
  onClick,
}: {
  id: DrawerId;
  label: string;
  count?: number;
  tone?: "flag" | "good";
  active: boolean;
  onClick: (id: DrawerId) => void;
}) {
  return (
    <button
      type="button"
      className="rail2__btn"
      data-active={active ? "true" : undefined}
      aria-expanded={active}
      onClick={() => onClick(id)}
    >
      <span className="rail2__label">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`rail2__count${tone === "flag" ? " rail2__count--flag" : ""}`}>{count}</span>
      )}
    </button>
  );
}

function isFlagged(row: ScheduleRow): boolean {
  return flaggedFields(row).length > 0;
}

function flaggedFields(row: ScheduleRow): string[] {
  const labels: [keyof ScheduleRow, string][] = [
    ["date", "date"],
    ["beneficiary", "beneficiary"],
    ["tin", "TIN"],
    ["address", "address"],
    ["invoiceNo", "invoice no."],
    ["description", "nature"],
    ["grossAmount", "gross"],
    ["vatRate", "VAT rate"],
    ["whtRate", "WHT rate"],
  ];
  return labels
    .filter(([key]) => {
      const cell = row[key] as { confidence?: number } | undefined;
      return typeof cell?.confidence === "number" && cell.confidence < LOW_CONFIDENCE;
    })
    .map(([, label]) => label);
}

function money(n: number) {
  return n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function size(n: number) {
  return n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
