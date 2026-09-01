/**
 * In-memory demo state. One presenter, one laptop, one session — no DB.
 * Survives module reload in dev via globalThis; entries expire after an hour.
 */
import type { Schedule } from "./schema";

export interface SourceDoc {
  name: string;
  kind: "pdf" | "image" | "text";
  bytes: number;
  via?: string;
  pages?: number;
}

export interface Session {
  id: string;
  sandboxSession?: string;
  schedule?: Schedule;
  sources: SourceDoc[];
  skipped: { name: string; reason: string }[];
  xlsx?: Buffer;
  pdf?: Buffer;
  updatedAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const g = globalThis as unknown as { __firsStore?: Map<string, Session> };
const store: Map<string, Session> = (g.__firsStore ??= new Map());

export function newId(): string {
  return "s_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function get(id: string | undefined | null): Session | undefined {
  if (!id) return undefined;
  sweep();
  return store.get(id);
}

export function put(session: Session): Session {
  session.updatedAt = Date.now();
  store.set(session.id, session);
  sweep();
  return session;
}

export function create(): Session {
  return put({ id: newId(), sources: [], skipped: [], updatedAt: Date.now() });
}

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, s] of store) if (s.updatedAt < cutoff) store.delete(id);
}
