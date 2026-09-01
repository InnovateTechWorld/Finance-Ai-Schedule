/* Domain types for the FIRS withholding-tax / VAT schedule. */

export const FIRS_COLUMNS = [
  { key: "sn", label: "S/N", width: 6, kind: "int" },
  { key: "date", label: "Date", width: 12, kind: "date" },
  { key: "beneficiary", label: "Name of Beneficiary", width: 34, kind: "text" },
  { key: "tin", label: "TIN", width: 16, kind: "text" },
  { key: "address", label: "Address", width: 30, kind: "text" },
  { key: "invoiceNo", label: "Invoice No.", width: 16, kind: "text" },
  { key: "description", label: "Nature of Transaction", width: 32, kind: "text" },
  { key: "grossAmount", label: "Gross Amount (₦)", width: 16, kind: "money" },
  { key: "vatRate", label: "VAT %", width: 9, kind: "rate" },
  { key: "vatAmount", label: "VAT (₦)", width: 15, kind: "money" },
  { key: "whtRate", label: "WHT %", width: 9, kind: "rate" },
  { key: "whtAmount", label: "WHT (₦)", width: 15, kind: "money" },
  { key: "netPayable", label: "Net Payable (₦)", width: 16, kind: "money" },
] as const;

export type ColumnKey = (typeof FIRS_COLUMNS)[number]["key"];

/** Every cell carries its own confidence so the review table can flag it. */
export type Cell<T> = { value: T; confidence: number; note?: string };

export interface ScheduleRow {
  sn: number;
  date: Cell<string>;
  beneficiary: Cell<string>;
  tin: Cell<string>;
  address: Cell<string>;
  invoiceNo: Cell<string>;
  description: Cell<string>;
  grossAmount: Cell<number>;
  vatRate: Cell<number>;
  vatAmount: Cell<number>;
  whtRate: Cell<number>;
  whtAmount: Cell<number>;
  netPayable: Cell<number>;
  sourceFile?: string;
}

export interface ScheduleMeta {
  taxpayerName: Cell<string>;
  taxpayerTin: Cell<string>;
  period: Cell<string>;
  currency: string;
  preparedBy: string;
}

export interface Schedule {
  meta: ScheduleMeta;
  rows: ScheduleRow[];
  /** Anything the model could not reconcile — surfaced verbatim in the UI. */
  warnings: string[];
}

export const LOW_CONFIDENCE = 0.75;

export function isFlagged(row: ScheduleRow): boolean {
  return cellsOf(row).some((c) => c.confidence < LOW_CONFIDENCE);
}

export function cellsOf(row: ScheduleRow): Cell<unknown>[] {
  return FIRS_COLUMNS.filter((c) => c.key !== "sn").map(
    (c) => (row as unknown as Record<string, Cell<unknown>>)[c.key],
  ).filter(Boolean);
}

export function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[₦,\s]/g, "").replace(/[()]/g, "-");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function cell<T>(raw: unknown, fallback: T): Cell<T> {
  if (raw && typeof raw === "object" && "value" in (raw as object)) {
    const r = raw as { value: unknown; confidence?: unknown; note?: unknown };
    const conf = typeof r.confidence === "number" ? Math.min(1, Math.max(0, r.confidence)) : 0.5;
    const value =
      typeof fallback === "number"
        ? (num(r.value, fallback as number) as unknown as T)
        : ((r.value ?? fallback) as T);
    return { value, confidence: conf, note: typeof r.note === "string" ? r.note : undefined };
  }
  const value =
    typeof fallback === "number" ? (num(raw, fallback as number) as unknown as T) : ((raw ?? fallback) as T);
  return { value, confidence: raw == null || raw === "" ? 0.3 : 0.6 };
}

/**
 * The model is asked for this exact shape, but a model is not a parser.
 * Everything downstream (xlsx writer, table, chat) reads normalised data only.
 */
export function normaliseSchedule(raw: unknown): Schedule {
  const r = (raw ?? {}) as Record<string, any>;
  const rawRows: any[] = Array.isArray(r.rows) ? r.rows : [];

  const rows: ScheduleRow[] = rawRows.slice(0, 500).map((x, i) => {
    const gross = cell<number>(x?.grossAmount, 0);
    const vatRate = cell<number>(x?.vatRate, 0);
    const whtRate = cell<number>(x?.whtRate, 0);

    // Derive any money the model left blank rather than shipping a hole.
    const vatAmount = cell<number>(x?.vatAmount, round2((gross.value * vatRate.value) / 100));
    const whtAmount = cell<number>(x?.whtAmount, round2((gross.value * whtRate.value) / 100));
    const netPayable = cell<number>(
      x?.netPayable,
      round2(gross.value + vatAmount.value - whtAmount.value),
    );

    return {
      sn: i + 1,
      date: cell<string>(x?.date, ""),
      beneficiary: cell<string>(x?.beneficiary, ""),
      tin: cell<string>(x?.tin, ""),
      address: cell<string>(x?.address, ""),
      invoiceNo: cell<string>(x?.invoiceNo, ""),
      description: cell<string>(x?.description, ""),
      grossAmount: gross,
      vatRate,
      vatAmount,
      whtRate,
      whtAmount,
      netPayable,
      sourceFile: typeof x?.sourceFile === "string" ? x.sourceFile : undefined,
    };
  });

  return {
    meta: {
      taxpayerName: cell<string>(r.meta?.taxpayerName, "—"),
      taxpayerTin: cell<string>(r.meta?.taxpayerTin, "—"),
      period: cell<string>(r.meta?.period, "—"),
      currency: typeof r.meta?.currency === "string" ? r.meta.currency : "NGN",
      preparedBy: "Generated for review",
    },
    rows,
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((w: unknown) => typeof w === "string").slice(0, 20) : [],
  };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Recompute derived money after a user edit so totals never drift. */
export function recalcRow(row: ScheduleRow): ScheduleRow {
  const vatAmount = round2((row.grossAmount.value * row.vatRate.value) / 100);
  const whtAmount = round2((row.grossAmount.value * row.whtRate.value) / 100);
  return {
    ...row,
    vatAmount: { ...row.vatAmount, value: vatAmount },
    whtAmount: { ...row.whtAmount, value: whtAmount },
    netPayable: { ...row.netPayable, value: round2(row.grossAmount.value + vatAmount - whtAmount) },
  };
}

export function totals(rows: ScheduleRow[]) {
  const sum = (f: (r: ScheduleRow) => number) => round2(rows.reduce((a, r) => a + f(r), 0));
  return {
    gross: sum((r) => r.grossAmount.value),
    vat: sum((r) => r.vatAmount.value),
    wht: sum((r) => r.whtAmount.value),
    net: sum((r) => r.netPayable.value),
  };
}
