// Persistence of the sync sidecar: ONE localStorage key, "ll:v1:sync".
//
// The key lives under the app's "ll:v1:" prefix on purpose: "Clear all data" removes it together
// with everything else. All tabs of the browser share it, so callers must re-read it at the start
// of every synchronous critical section and write it back before yielding; nothing here hands out
// a copy that may be kept across an `await`. (The parse cache below is keyed by the raw string, so
// it can never serve a value that differs from what localStorage holds right now.)
import { emptyDoc, isSafeKey, validateDoc } from "./doc";
import type { LocalView } from "./view";
import type { Sidecar, SyncLink } from "./cycle";

export const SIDECAR_KEY = "ll:v1:sync";

const USER_ID_SHAPE = /^u_[A-Za-z0-9_-]{1,80}$/;

type Dict = { [k: string]: unknown };

function isDict(x: unknown): x is Dict {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  try {
    crypto.getRandomValues(buf);
  } catch {
    for (let i = 0; i < bytes; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (const b of buf) out += b.toString(16).padStart(2, "0");
  return out;
}

export function randomId(prefix: string): string {
  return prefix + randomHex(12);
}

export function newSidecar(barrier: string | null = null): Sidecar {
  return {
    v: 1,
    deviceId: randomId("d_"),
    link: null,
    doc: emptyDoc(),
    seen: null,
    dirty: false,
    lessonsResetPending: false,
    lastSyncedAt: null,
    serverOffset: null,
    barrier,
  };
}

function parseLink(x: unknown): SyncLink | null | undefined {
  if (x === null) return null;
  if (!isDict(x)) return undefined;
  const { userId, name, gen, version } = x;
  if (typeof userId !== "string" || !USER_ID_SHAPE.test(userId)) return undefined;
  if (typeof name !== "string") return undefined;
  if (gen !== null && (typeof gen !== "string" || gen.length === 0 || gen.length > 64)) return undefined;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) return undefined;
  return {
    userId,
    name,
    gen: gen as string | null,
    version,
    firstSyncDone: x.firstSyncDone === true,
    clockChecked: x.clockChecked === true,
  };
}

function parseSeen(x: unknown): LocalView | null {
  if (!isDict(x) || !isDict(x.settings) || !isDict(x.learn) || !isDict(x.lessons)) return null;
  return x as unknown as LocalView;
}

/** A sidecar from its stored JSON text, or null if the text is not a usable sidecar. */
export function parseSidecar(raw: string): Sidecar | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isDict(parsed) || parsed.v !== 1) return null;
  if (!isSafeKey(parsed.deviceId)) return null;
  const link = parseLink(parsed.link);
  if (link === undefined) return null;
  // The replica's timestamps may legitimately be in the future (a wrong device clock is dealt
  // with when syncing), so no future limit here.
  const checked = validateDoc(parsed.doc, { now: 0, maxFutureMs: Number.MAX_SAFE_INTEGER });
  const serverOffset = parsed.serverOffset;
  const lastSyncedAt = parsed.lastSyncedAt;
  const common = {
    v: 1 as const,
    deviceId: parsed.deviceId,
    link,
    lastSyncedAt: typeof lastSyncedAt === "number" && Number.isFinite(lastSyncedAt) ? lastSyncedAt : null,
    serverOffset: typeof serverOffset === "number" && Number.isFinite(serverOffset) ? serverOffset : null,
    barrier: typeof parsed.barrier === "string" ? parsed.barrier : null,
  };
  if (checked.ok === false) {
    // A broken replica is rebuilt from the stores: with `seen = null` the next absorb records
    // everything the stores hold (with the legacy stamp). Marked dirty so that it is pushed.
    return { ...common, doc: emptyDoc(), seen: null, dirty: true, lessonsResetPending: false };
  }
  return {
    ...common,
    doc: checked.doc,
    seen: parseSeen(parsed.seen),
    dirty: parsed.dirty === true,
    lessonsResetPending: parsed.lessonsResetPending === true,
  };
}

let cache: { raw: string; value: Sidecar } | null = null;

export type SidecarRead = { ok: true; sidecar: Sidecar | null } | { ok: false };

/** The sidecar as localStorage holds it NOW. `ok: false` = localStorage itself is unusable. */
export function readSidecar(): SidecarRead {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SIDECAR_KEY);
  } catch {
    return { ok: false };
  }
  if (raw === null) return { ok: true, sidecar: null };
  if (cache !== null && cache.raw === raw) return { ok: true, sidecar: cache.value };
  const value = parseSidecar(raw);
  if (value !== null) cache = { raw, value };
  return { ok: true, sidecar: value };
}

/** False if the write failed (quota, private mode); the caller must then not act on `sc`. */
export function writeSidecar(sc: Sidecar): boolean {
  try {
    const raw = JSON.stringify(sc);
    window.localStorage.setItem(SIDECAR_KEY, raw);
    cache = { raw, value: sc };
    return true;
  } catch {
    return false;
  }
}

/** The raw stored text, for the debug hook. */
export function rawSidecar(): string | null {
  try {
    return window.localStorage.getItem(SIDECAR_KEY);
  } catch {
    return null;
  }
}
