/**
 * Code Sandbox client (librecodeinterpreter contract).
 *
 * AGENT_V2_CODE_BASEURL embeds the API key as the URL username; it is stripped
 * out and re-sent as HTTP Basic (username = key, password = empty).
 * No key ⇒ the tool is unconfigured and every call throws ServiceDisabled.
 */

export class ServiceDisabled extends Error {}
export class SessionExpired extends Error {}

const HTTP_TIMEOUT_MS = 30_000;

interface SandboxConfig {
  base: string;
  authHeader: string;
}

function config(): SandboxConfig {
  const raw = process.env.AGENT_V2_CODE_BASEURL?.trim();
  if (!raw) throw new ServiceDisabled("Code sandbox is not configured (AGENT_V2_CODE_BASEURL unset).");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ServiceDisabled("AGENT_V2_CODE_BASEURL is not a valid URL.");
  }
  const key = decodeURIComponent(url.username || "");
  if (!key || key.startsWith("<")) {
    throw new ServiceDisabled("Code sandbox is not configured — no API key in AGENT_V2_CODE_BASEURL.");
  }
  url.username = "";
  url.password = "";
  return {
    base: url.origin,
    authHeader: "Basic " + Buffer.from(`${key}:`).toString("base64"),
  };
}

export function sandboxConfigured(): boolean {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const { base, authHeader } = config();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = new Headers(init.headers);
    headers.set("Authorization", authHeader);
    return await fetch(base + path, { ...init, headers, signal: ac.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("Sandbox timed out after 30s.");
    throw new Error(`Sandbox unreachable: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

export interface ExecResult {
  session_id: string;
  stdout: string;
  stderr: string;
  files: { id: string; name: string }[];
}

async function execOnce(code: string, sessionId?: string): Promise<ExecResult> {
  const res = await call("/exec", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, lang: "py", session_id: sessionId }),
  });
  if (res.status === 404 || res.status === 410) throw new SessionExpired("Sandbox session expired.");
  if (!res.ok) throw new Error(`Sandbox /exec failed (${res.status}): ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as Partial<ExecResult>;
  return {
    session_id: json.session_id ?? sessionId ?? "",
    stdout: json.stdout ?? "",
    stderr: json.stderr ?? "",
    files: Array.isArray(json.files) ? json.files : [],
  };
}

/** Runs code, transparently retrying once on a fresh session if the old one died. */
export async function exec(code: string, sessionId?: string): Promise<ExecResult> {
  try {
    return await execOnce(code, sessionId);
  } catch (e) {
    if (e instanceof SessionExpired && sessionId) return await execOnce(code, undefined);
    throw e;
  }
}

export async function upload(files: { name: string; bytes: Buffer; type: string }[], sessionId?: string) {
  const form = new FormData();
  for (const f of files) {
    form.append("files", new Blob([new Uint8Array(f.bytes)], { type: f.type || "application/octet-stream" }), f.name);
  }
  if (sessionId) form.append("session_id", sessionId);
  const res = await call("/upload", { method: "POST", body: form });
  if (!res.ok) throw new Error(`Sandbox /upload failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json().catch(() => ({}))) as { session_id?: string };
  return json.session_id ?? sessionId;
}

export async function download(sessionId: string, fileId: string): Promise<Buffer> {
  const res = await call(`/download/${encodeURIComponent(sessionId)}/${encodeURIComponent(fileId)}`, {
    method: "GET",
  });
  if (res.status === 404 || res.status === 410) throw new SessionExpired("File or session no longer available.");
  if (!res.ok) throw new Error(`Sandbox /download failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
