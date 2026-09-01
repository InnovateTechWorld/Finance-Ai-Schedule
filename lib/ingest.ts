/**
 * Turns whatever the user dropped into content blocks the model can read.
 *
 * Native to the model:  PDF, PNG, JPEG, GIF, WebP, plain text/CSV.
 * Everything else (DOCX, XLSX, PPTX, ODT, RTF, HEIC, TIFF, …) is routed
 * through the converter service first. If conversion is unavailable, the file
 * is skipped with a readable reason rather than failing the whole run.
 */
import { convert, converterConfigured } from "./converter";
import type { Block } from "./llm";
import { HOSTED, MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES, mb } from "./limits";

export { MAX_FILES, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from "./limits";
/** The model's own per-request ceiling; PDFs and images are the bulk of it. */
export const MAX_MODEL_BYTES = 28 * 1024 * 1024;

const IMAGE_MEDIA: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const TEXTUAL = new Set(["txt", "csv", "tsv", "md", "json", "log"]);
/** Office + image formats the converter can normalise for us. */
const CONVERT_TO_PDF = new Set(["docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf", "html", "htm", "pages", "numbers"]);
const CONVERT_TO_PNG = new Set(["heic", "heif", "tif", "tiff", "bmp", "svg", "avif"]);

export interface IncomingFile {
  name: string;
  bytes: Buffer;
  type: string;
}

export interface PreparedFile {
  name: string;
  kind: "pdf" | "image" | "text";
  blocks: Block[];
  bytes: number;
  /** Set when the file went through the converter on its way in. */
  via?: string;
  pages?: number;
}

export interface IngestResult {
  prepared: PreparedFile[];
  skipped: { name: string; reason: string }[];
  notes: string[];
}

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function validateBatch(files: IncomingFile[]): string | null {
  if (files.length === 0) return "No files received. Drop in at least one statement or invoice.";
  if (files.length > MAX_FILES) return `${files.length} files — the limit is ${MAX_FILES} per run.`;
  const total = files.reduce((a, f) => a + f.bytes.byteLength, 0);
  if (total > MAX_TOTAL_BYTES) {
    return HOSTED
      ? `That batch is ${mb(total)}. This deployment accepts ${mb(MAX_TOTAL_BYTES)} per run — the hosting platform rejects larger uploads before they reach the app.`
      : `That batch is ${mb(total)}. Keep a run under ${mb(MAX_TOTAL_BYTES)}.`;
  }
  const empty = files.find((f) => f.bytes.byteLength === 0);
  if (empty) return `${empty.name} is empty — re-export it and try again.`;
  return null;
}

export async function prepare(
  files: IncomingFile[],
  onStep?: (message: string) => void,
): Promise<IngestResult> {
  const prepared: PreparedFile[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const notes: string[] = [];

  for (const file of files) {
    try {
      if (file.bytes.byteLength > MAX_FILE_BYTES) {
        skipped.push({ name: file.name, reason: `${mb(file.bytes.byteLength)} — over the ${mb(MAX_FILE_BYTES)} per-file limit.` });
        continue;
      }
      const ext = extOf(file.name) || sniff(file.bytes);
      const p = await prepareOne(file, ext, onStep, notes);
      if (p) prepared.push(p);
      else skipped.push({ name: file.name, reason: `Unsupported format (.${ext || "unknown"}).` });
    } catch (e) {
      skipped.push({ name: file.name, reason: (e as Error).message });
    }
  }

  // Keep the request under the model's ceiling, dropping the largest first so
  // small invoices don't get evicted by one enormous scan.
  let budget = MAX_MODEL_BYTES;
  const ordered = [...prepared].sort((a, b) => a.bytes - b.bytes);
  const kept = new Set<PreparedFile>();
  for (const p of ordered) {
    if (p.bytes <= budget) {
      budget -= p.bytes;
      kept.add(p);
    } else {
      skipped.push({ name: p.name, reason: "Dropped — the batch exceeded what one model request can carry." });
    }
  }

  return { prepared: prepared.filter((p) => kept.has(p)), skipped, notes };
}

async function prepareOne(
  file: IncomingFile,
  ext: string,
  onStep: ((m: string) => void) | undefined,
  notes: string[],
): Promise<PreparedFile | null> {
  if (ext === "pdf") return pdfBlock(file.name, file.bytes, notes);

  if (IMAGE_MEDIA[ext]) {
    return {
      name: file.name,
      kind: "image",
      bytes: file.bytes.byteLength,
      blocks: [
        { type: "text", text: `--- ${file.name} (image) ---` },
        { type: "image", source: { type: "base64", media_type: IMAGE_MEDIA[ext], data: file.bytes.toString("base64") } },
      ],
    };
  }

  if (TEXTUAL.has(ext)) {
    const text = file.bytes.toString("utf8").slice(0, 200_000);
    return {
      name: file.name,
      kind: "text",
      bytes: Buffer.byteLength(text),
      blocks: [{ type: "text", text: `--- ${file.name} ---\n${text}` }],
    };
  }

  const target = CONVERT_TO_PDF.has(ext) ? "pdf" : CONVERT_TO_PNG.has(ext) ? "png" : null;
  if (!target) return null;

  if (!converterConfigured()) {
    throw new Error(`.${ext} needs the converter service, which is not configured.`);
  }
  onStep?.(`Converting ${file.name} → ${target}`);
  const out = await convert(file, target);

  if (target === "pdf") {
    const p = pdfBlock(file.name, out, notes);
    return { ...p, via: `${ext} → pdf`, bytes: out.byteLength };
  }
  return {
    name: file.name,
    kind: "image",
    via: `${ext} → png`,
    bytes: out.byteLength,
    blocks: [
      { type: "text", text: `--- ${file.name} (converted from .${ext}) ---` },
      { type: "image", source: { type: "base64", media_type: "image/png", data: out.toString("base64") } },
    ],
  };
}

function pdfBlock(name: string, bytes: Buffer, notes: string[]): PreparedFile {
  const pages = countPdfPages(bytes);
  if (pages > 100) {
    notes.push(`${name} has roughly ${pages} pages — reading it may be slow, and very long statements can be truncated.`);
  }
  return {
    name,
    kind: "pdf",
    pages,
    bytes: bytes.byteLength,
    blocks: [
      { type: "text", text: `--- ${name} (PDF, ~${pages} page${pages === 1 ? "" : "s"}) ---` },
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } },
    ],
  };
}

/** Cheap structural count — good enough to warn on, never used as truth. */
function countPdfPages(buf: Buffer): number {
  const s = buf.toString("latin1");
  const byCount = s.match(/\/Count\s+(\d+)/g);
  if (byCount?.length) {
    const max = Math.max(...byCount.map((m) => Number(m.replace(/\D/g, "")) || 0));
    if (max > 0) return max;
  }
  return Math.max(1, (s.match(/\/Type\s*\/Page[^s]/g) || []).length);
}

/** Fallback when a browser hands us a file with no extension. */
function sniff(buf: Buffer): string {
  const head = buf.subarray(0, 8);
  if (head.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (head[0] === 0x89 && head[1] === 0x50) return "png";
  if (head[0] === 0xff && head[1] === 0xd8) return "jpg";
  if (head.subarray(0, 2).toString("latin1") === "PK") return "docx"; // zip container — let the converter decide
  return "";
}

