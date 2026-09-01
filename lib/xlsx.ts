/**
 * Builds the Python that runs inside the sandbox. The schedule is injected as
 * a JSON literal (json.dumps output is valid Python for our value types), so
 * the script itself never string-concatenates user data.
 */
import { FIRS_COLUMNS, type Schedule, LOW_CONFIDENCE } from "./schema";

export const OUTPUT_NAME = "firs-wht-vat-schedule.xlsx";

export function buildXlsxScript(schedule: Schedule): string {
  const payload = JSON.stringify({
    meta: {
      taxpayerName: schedule.meta.taxpayerName.value,
      taxpayerTin: schedule.meta.taxpayerTin.value,
      period: schedule.meta.period.value,
      currency: schedule.meta.currency,
    },
    columns: FIRS_COLUMNS.map((c) => ({ key: c.key, label: c.label, width: c.width, kind: c.kind })),
    rows: schedule.rows.map((r) => {
      const out: Record<string, unknown> = { sn: r.sn };
      for (const c of FIRS_COLUMNS) {
        if (c.key === "sn") continue;
        const cell = (r as any)[c.key];
        out[c.key] = cell?.value ?? "";
        out[`${c.key}__conf`] = cell?.confidence ?? 0;
      }
      return out;
    }),
    warnings: schedule.warnings,
    lowConfidence: LOW_CONFIDENCE,
  });

  return `
import json, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

DATA = json.loads(r'''${payload.replace(/'/g, "\u0027")}''')
cols = DATA["columns"]
rows = DATA["rows"]
meta = DATA["meta"]
low  = DATA["lowConfidence"]

wb = Workbook()
ws = wb.active
ws.title = "WHT-VAT Schedule"

ink   = "FF1A1A1A"
rule  = "FFD9D9D9"
head  = "FFF2F2F2"
flag  = "FFFDF3DC"

thin = Side(style="thin", color=rule)
box  = Border(left=thin, right=thin, top=thin, bottom=thin)
money_fmt = '#,##0.00'
rate_fmt  = '0.00"%"'

# ---- header block -------------------------------------------------------
ws.merge_cells("A1:G1")
ws.merge_cells("A2:G2")
ws["A1"] = "SCHEDULE OF WITHHOLDING TAX AND VALUE ADDED TAX"
ws["A1"].font = Font(size=13, bold=True, color=ink)
ws["A2"] = "Federal Inland Revenue Service"
ws["A2"].font = Font(size=10, color="FF6B6B6B")

info = [
    ("Taxpayer", meta.get("taxpayerName") or "—"),
    ("TIN", meta.get("taxpayerTin") or "—"),
    ("Period", meta.get("period") or "—"),
    ("Currency", meta.get("currency") or "NGN"),
    ("Prepared", datetime.date.today().isoformat()),
]
# Column A is only wide enough for "S/N", so the info block spans cells
# rather than relying on column width it cannot have.
r = 4
for label, value in info:
    ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=2)
    ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=6)
    lc = ws.cell(row=r, column=1, value=label)
    lc.font = Font(bold=True, size=9, color="FF6B6B6B")
    lc.alignment = Alignment(horizontal="left", vertical="center")
    vc = ws.cell(row=r, column=3, value=value)
    vc.font = Font(size=10, color=ink)
    vc.alignment = Alignment(horizontal="left", vertical="center")
    r += 1

HEAD_ROW = r + 1

# ---- column headers -----------------------------------------------------
for i, c in enumerate(cols, start=1):
    cell = ws.cell(row=HEAD_ROW, column=i, value=c["label"])
    cell.font = Font(bold=True, size=9, color=ink)
    cell.fill = PatternFill("solid", fgColor=head)
    cell.alignment = Alignment(vertical="center", wrap_text=True)
    cell.border = box
    ws.column_dimensions[get_column_letter(i)].width = c["width"]
ws.row_dimensions[HEAD_ROW].height = 28

# ---- body ---------------------------------------------------------------
first = HEAD_ROW + 1
for n, row in enumerate(rows):
    excel_row = first + n
    for i, c in enumerate(cols, start=1):
        key = c["key"]
        cell = ws.cell(row=excel_row, column=i, value=row.get(key))
        cell.border = box
        cell.font = Font(size=10, color=ink)
        if c["kind"] == "money":
            cell.number_format = money_fmt
        elif c["kind"] == "rate":
            cell.number_format = rate_fmt
        elif c["kind"] in ("text", "date"):
            cell.alignment = Alignment(vertical="top", wrap_text=(c["kind"] == "text"))
        conf = row.get(key + "__conf")
        if conf is not None and conf < low:
            cell.fill = PatternFill("solid", fgColor=flag)

# Live formulas, not frozen numbers — the preparer can edit gross in Excel
# and watch VAT / WHT / net follow.
for n in range(len(rows)):
    excel_row = first + n
    ws.cell(row=excel_row, column=10).value = "=ROUND(H%d*I%d/100,2)" % (excel_row, excel_row)
    ws.cell(row=excel_row, column=12).value = "=ROUND(H%d*K%d/100,2)" % (excel_row, excel_row)
    ws.cell(row=excel_row, column=13).value = "=ROUND(H%d+J%d-L%d,2)" % (excel_row, excel_row, excel_row)
    for col in (10, 12, 13):
        ws.cell(row=excel_row, column=col).number_format = money_fmt
        ws.cell(row=excel_row, column=col).border = box

# ---- totals -------------------------------------------------------------
total_row = first + len(rows)
if len(rows):
    ws.cell(row=total_row, column=7, value="TOTAL").font = Font(bold=True, size=10, color=ink)
    for col in (8, 10, 12, 13):
        letter = get_column_letter(col)
        c = ws.cell(row=total_row, column=col,
                    value="=SUM(%s%d:%s%d)" % (letter, first, letter, total_row - 1))
        c.font = Font(bold=True, size=10, color=ink)
        c.number_format = money_fmt
        c.border = Border(top=Side(style="medium", color=ink), bottom=thin, left=thin, right=thin)

ws.freeze_panes = ws.cell(row=first, column=1)
ws.auto_filter.ref = "A%d:%s%d" % (HEAD_ROW, get_column_letter(len(cols)), max(first, total_row - 1))
ws.sheet_view.showGridLines = False

# ---- review notes sheet -------------------------------------------------
notes = wb.create_sheet("Review notes")
notes["A1"] = "Items flagged for review"
notes["A1"].font = Font(bold=True, size=12, color=ink)
notes.column_dimensions["A"].width = 12
notes.column_dimensions["B"].width = 100
nr = 3
for w in DATA["warnings"]:
    notes.cell(row=nr, column=1, value="Warning").font = Font(bold=True, size=9, color="FF8A6D1F")
    notes.cell(row=nr, column=2, value=w).alignment = Alignment(wrap_text=True, vertical="top")
    nr += 1
for row in rows:
    flags = [c["label"] for c in cols
             if c["key"] != "sn" and (row.get(c["key"] + "__conf") or 0) < low]
    if flags:
        notes.cell(row=nr, column=1, value="Row %s" % row.get("sn")).font = Font(bold=True, size=9, color=ink)
        notes.cell(row=nr, column=2,
                   value="Low confidence: " + ", ".join(flags)).alignment = Alignment(wrap_text=True)
        nr += 1
if nr == 3:
    notes["A3"] = "Nothing flagged — every field was read with high confidence."

out = "/mnt/data/${OUTPUT_NAME}"
wb.save(out)
print(json.dumps({"ok": True, "path": out, "rows": len(rows)}))
`.trim();
}
