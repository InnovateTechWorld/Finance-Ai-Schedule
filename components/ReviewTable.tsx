"use client";

import { useMemo } from "react";
import {
  FIRS_COLUMNS,
  LOW_CONFIDENCE,
  num,
  recalcRow,
  totals,
  type Cell,
  type Schedule,
  type ScheduleRow,
} from "@/lib/schema";

/**
 * The showpiece. Every cell is editable; low-confidence cells are amber, which
 * is the trust-building beat — the tool says what it is unsure about.
 */
export function ReviewTable({
  schedule,
  onChange,
  disabled,
}: {
  schedule: Schedule;
  onChange: (next: Schedule) => void;
  disabled: boolean;
}) {
  const sums = useMemo(() => totals(schedule.rows), [schedule.rows]);
  const flagged = useMemo(
    () => schedule.rows.filter((r) => cells(r).some((c) => c.confidence < LOW_CONFIDENCE)).length,
    [schedule.rows],
  );

  const edit = (index: number, key: string, raw: string) => {
    const column = FIRS_COLUMNS.find((c) => c.key === key);
    const rows = schedule.rows.map((row, i) => {
      if (i !== index) return row;
      const cell = (row as unknown as Record<string, Cell<unknown>>)[key];
      const value = column?.kind === "money" || column?.kind === "rate" ? num(raw, 0) : raw;
      // A field the preparer typed is certain by definition.
      const next = { ...row, [key]: { ...cell, value, confidence: 1 } } as ScheduleRow;
      return column?.kind === "money" || column?.kind === "rate" ? recalcRow(next) : next;
    });
    onChange({ ...schedule, rows });
  };

  return (
    <>
      <div className="sheet__head">
        <div>
          <p className="sheet__title">
            {schedule.meta.taxpayerName.value || "Schedule"} · {schedule.meta.period.value || "period unstated"}
          </p>
          <p className="sheet__sub">
            {schedule.rows.length} transaction{schedule.rows.length === 1 ? "" : "s"} ·{" "}
            {flagged > 0 ? `${flagged} need${flagged === 1 ? "s" : ""} your eye` : "nothing flagged"} · edits
            recalculate VAT, WHT and net
          </p>
        </div>
        <span className={flagged > 0 ? "badge badge--flag" : "badge badge--good"}>
          {flagged > 0 ? `${flagged} to review` : "All clear"}
        </span>
      </div>

      <div className="scroller">
        <table>
          <caption className="sr">
            FIRS withholding tax and VAT schedule. Amber cells were read with low confidence.
          </caption>
          <thead>
            <tr>
              {FIRS_COLUMNS.map((c) => (
                <th key={c.key} scope="col">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {schedule.rows.map((row, i) => (
              <tr key={i}>
                {FIRS_COLUMNS.map((c) => {
                  if (c.key === "sn") {
                    return (
                      <td className="sn" key={c.key}>
                        {row.sn}
                      </td>
                    );
                  }
                  const cell = (row as unknown as Record<string, Cell<unknown>>)[c.key];
                  const low = cell.confidence < LOW_CONFIDENCE;
                  const numeric = c.kind === "money" || c.kind === "rate";
                  const derived = c.key === "vatAmount" || c.key === "whtAmount" || c.key === "netPayable";
                  return (
                    <td key={c.key} data-flagged={low ? "true" : undefined}>
                      <input
                        className={`cell${numeric ? " cell--num" : ""}${derived ? " cell--derived" : ""}`}
                        style={{ minWidth: `${Math.max(6, c.width * 0.62)}ch` }}
                        value={format(cell.value, c.kind)}
                        disabled={disabled}
                        inputMode={numeric ? "decimal" : undefined}
                        aria-label={`${c.label}, row ${row.sn}${low ? " — low confidence, please check" : ""}`}
                        title={
                          low
                            ? `${Math.round(cell.confidence * 100)}% confident${cell.note ? ` — ${cell.note}` : ""}`
                            : undefined
                        }
                        onChange={(e) => edit(i, c.key, e.target.value)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7}>Total</td>
              <td>{money(sums.gross)}</td>
              <td />
              <td>{money(sums.vat)}</td>
              <td />
              <td>{money(sums.wht)}</td>
              <td>{money(sums.net)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

function cells(row: ScheduleRow): Cell<unknown>[] {
  return FIRS_COLUMNS.filter((c) => c.key !== "sn")
    .map((c) => (row as unknown as Record<string, Cell<unknown>>)[c.key])
    .filter(Boolean);
}

function format(value: unknown, kind: string): string {
  if (value == null) return "";
  if (typeof value === "number") return kind === "rate" ? String(value) : value.toFixed(2);
  return String(value);
}

function money(n: number): string {
  return n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
