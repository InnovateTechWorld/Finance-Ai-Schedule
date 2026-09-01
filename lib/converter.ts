/**
 * File Converter client. One job: bytes in, converted bytes out.
 * Failures are non-fatal to the pipeline — the caller decides what to do
 * without a preview.
 */

export class ConverterDisabled extends Error {}

const DEFAULT_URL = "https://sandbox.wekoya.tech";

function config() {
  const key = process.env.FILE_CONVERT_API_KEY?.trim();
  if (!key) throw new ConverterDisabled("File conversion is not configured (FILE_CONVERT_API_KEY unset).");
  return {
    url: (process.env.FILE_CONVERT_API_URL?.trim() || DEFAULT_URL).replace(/\/$/, ""),
    key,
    maxBytes: Number(process.env.FILE_CONVERT_MAX_BYTES) || 52_428_800,
    timeoutMs: Number(process.env.FILE_CONVERT_TIMEOUT_MS) || 60_000,
  };
}

export function converterConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

export async function convert(
  file: { name: string; bytes: Buffer; type?: string },
  to: string,
): Promise<Buffer> {
  const { url, key, maxBytes, timeoutMs } = config();
  if (file.bytes.byteLength > maxBytes) {
    throw new Error(`${file.name} is ${mb(file.bytes.byteLength)} — over the ${mb(maxBytes)} conversion limit.`);
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(file.bytes)], { type: file.type || "application/octet-stream" }),
    file.name,
  );
  form.append("to", to.toLowerCase().replace(/^\./, ""));

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${url}/convert`, {
      method: "POST",
      headers: { "x-api-key": key },
      body: form,
      signal: ac.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Converting ${file.name} timed out.`);
    throw new Error(`Converter unreachable: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // The service returns { error } — surface it verbatim, it is written for humans.
    const body = await res.text();
    let message = body.slice(0, 300);
    try {
      const parsed = JSON.parse(body);
      if (parsed?.error) message = String(parsed.error);
    } catch {
      /* not JSON — use the raw text */
    }
    throw new Error(message || `Conversion failed (${res.status}).`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  // Guard the documented ambiguity: a JSON error body served with a 200.
  if (buf.byteLength < 2048 && looksLikeJsonError(buf)) {
    throw new Error(JSON.parse(buf.toString("utf8")).error ?? "Conversion failed.");
  }
  if (buf.byteLength === 0) throw new Error(`Converter returned an empty file for ${file.name}.`);
  return buf;
}

function looksLikeJsonError(buf: Buffer): boolean {
  const head = buf.subarray(0, 64).toString("utf8").trimStart();
  if (!head.startsWith("{")) return false;
  try {
    return typeof JSON.parse(buf.toString("utf8"))?.error === "string";
  } catch {
    return false;
  }
}

function mb(n: number) {
  return `${(n / 1_048_576).toFixed(1)} MB`;
}
