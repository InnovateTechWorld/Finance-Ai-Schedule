"use client";

import type { LogLine } from "./useAgentStream";
import type { Schedule } from "./schema";
import type { SourceDoc } from "./store";

/**
 * Demo persistence. Two stores, because they have different size profiles:
 *
 *   localStorage — the schedule, sources and log. Small, synchronous, and the
 *                  only thing needed to render the review screen.
 *   IndexedDB    — the .xlsx and .pdf bytes. A rendered PDF is easily 300 KB,
 *                  which would blow the ~5 MB localStorage budget after two runs.
 *
 * Every operation is best-effort. Private browsing, disabled site data, a full
 * quota and a corrupted entry all degrade to "no saved sessions" rather than
 * taking the page down with them.
 */

const KEY = "firs.sessions.v1";
const MAX_SESSIONS = 5;
const MAX_JSON_BYTES = 1_500_000;
const DB_NAME = "firs-artifacts";
const STORE = "files";

export interface SavedSession {
  id: string;
  savedAt: number;
  title: string;
  rows: number;
  flagged: number;
  schedule: Schedule;
  sources: SourceDoc[];
  skipped: { name: string; reason: string }[];
  lines: LogLine[];
  hasXlsx: boolean;
  hasPdf: boolean;
}

export interface StoredArtifact {
  name: string;
  mime: string;
  bytes: ArrayBuffer;
}

/* ── localStorage half ─────────────────────────────────────────────────── */

function readAll(): SavedSession[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return []; // storage blocked entirely
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A shape change between demo builds must not brick the list.
    return parsed.filter(
      (s: unknown): s is SavedSession =>
        !!s &&
        typeof s === "object" &&
        typeof (s as SavedSession).id === "string" &&
        Array.isArray((s as SavedSession).schedule?.rows),
    );
  } catch {
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* nothing more we can do */
    }
    return [];
  }
}

export function listSessions(): SavedSession[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function loadSession(id: string): SavedSession | undefined {
  return readAll().find((s) => s.id === id);
}

export function saveSession(session: SavedSession): boolean {
  if (typeof window === "undefined") return false;

  const others = readAll().filter((s) => s.id !== session.id);
  let queue = [session, ...others].slice(0, MAX_SESSIONS);

  for (;;) {
    let payload = JSON.stringify(queue);

    // A hundred-row schedule with long addresses can get big. Trim the log
    // first — it is the least valuable thing to come back to.
    if (payload.length > MAX_JSON_BYTES && queue[0].lines.length > 30) {
      queue = [{ ...queue[0], lines: queue[0].lines.slice(-30) }, ...queue.slice(1)];
      payload = JSON.stringify(queue);
    }

    try {
      window.localStorage.setItem(KEY, payload);
      return true;
    } catch {
      // Quota, most likely. Drop the oldest session and try again; if this one
      // alone will not fit, give up quietly rather than looping.
      if (queue.length <= 1) return false;
      queue = queue.slice(0, queue.length - 1);
    }
  }
}

export function deleteSession(id: string): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(readAll().filter((s) => s.id !== id)));
  } catch {
    /* best effort */
  }
  void deleteArtifacts(id);
}

export function clearSessions(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* best effort */
  }
  void withDb((db) => db.transaction(STORE, "readwrite").objectStore(STORE).clear());
}

/* ── IndexedDB half ────────────────────────────────────────────────────── */

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) return resolve(null);
    let req: IDBOpenDBRequest;
    try {
      req = window.indexedDB.open(DB_NAME, 1);
    } catch {
      return resolve(null);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function withDb<T>(fn: (db: IDBDatabase) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  try {
    const request = fn(db);
    if (!request) return undefined;
    return await new Promise<T | undefined>((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  } finally {
    db.close();
  }
}

const artifactKey = (sessionId: string, kind: "xlsx" | "pdf") => `${sessionId}:${kind}`;

export async function saveArtifact(
  sessionId: string,
  kind: "xlsx" | "pdf",
  artifact: StoredArtifact,
): Promise<void> {
  await withDb((db) =>
    db.transaction(STORE, "readwrite").objectStore(STORE).put(artifact, artifactKey(sessionId, kind)),
  );
}

export async function loadArtifact(
  sessionId: string,
  kind: "xlsx" | "pdf",
): Promise<StoredArtifact | undefined> {
  const value = await withDb<StoredArtifact>((db) =>
    db.transaction(STORE, "readonly").objectStore(STORE).get(artifactKey(sessionId, kind)),
  );
  return value && value.bytes ? value : undefined;
}

async function deleteArtifacts(sessionId: string): Promise<void> {
  for (const kind of ["xlsx", "pdf"] as const) {
    await withDb((db) =>
      db.transaction(STORE, "readwrite").objectStore(STORE).delete(artifactKey(sessionId, kind)),
    );
  }
}

/* ── helpers ───────────────────────────────────────────────────────────── */

export function base64ToBytes(data: string): ArrayBuffer {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

export function titleFor(schedule: Schedule): string {
  const name = schedule.meta.taxpayerName.value?.trim();
  const period = schedule.meta.period.value?.trim();
  if (name && name !== "—" && period && period !== "—") return `${name} · ${period}`;
  if (name && name !== "—") return name;
  if (period && period !== "—") return period;
  return "Untitled schedule";
}
