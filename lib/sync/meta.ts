// Persistence of the sync sidecar: ONE localStorage key, "ll:v1:sync".
//
// The key lives under the app's "ll:v1:" prefix on purpose: "Clear all data" removes it together
// with everything else. All tabs of the browser share it, so callers must re-read it at the start
// of every synchronous critical section and write it back before yielding; nothing here hands out
// a copy that may be kept across an `await`. (The parse cache below is keyed by the raw string, so
// it can never serve a value that differs from what localStorage holds right now.)
//
// Tabs of DIFFERENT builds can share the key for a while (a deploy while a tab is open). An older
// build must not destroy what a newer one wrote: a sidecar with a higher `v`, or a replica with a
// higher schema, is reported as "newer" and left alone (the engine pauses sync in that tab until
// it is reloaded). Unknown extra fields of a sidecar this build CAN read are carried along and
// written back.
//
// Relative imports carry the .ts extension so that scripts/sync-engine-sim.mjs can load this file
// directly; `window` is only touched inside the functions that read or write storage.
import { DOC_SCHEMA, emptyDoc, isSafeKey, validateDoc } from "./doc.ts";
import type { LocalView } from "./view.ts";
import { rebuildSidecar } from "./cycle.ts";
import type { Sidecar, SyncLink } from "./cycle.ts";

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

export function newDeviceId(): string {
  return randomId("d_");
}

export function newSidecar(barrier: string | null = null): Sidecar {
  return {
    v: 1,
    deviceId: newDeviceId(),
    link: null,
    orphanOf: null,
    doc: emptyDoc(),
    seen: null,
    dirty: false,
    lessonsResetPending: false,
    lastSyncedAt: null,
    serverOffset: null,
    barrier,
    applying: null,
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

function parseOwner(x: unknown): { userId: string; name: string } | null {
  if (!isDict(x) || typeof x.userId !== "string" || !USER_ID_SHAPE.test(x.userId)) return null;
  return { userId: x.userId, name: typeof x.name === "string" ? x.name : "" };
}

function parseSeen(x: unknown): LocalView | null {
  if (!isDict(x) || !isDict(x.settings) || !isDict(x.learn) || !isDict(x.lessons)) return null;
  return x as unknown as LocalView;
}

const KNOWN_FIELDS = new Set([
  "v",
  "deviceId",
  "link",
  "orphanOf",
  "doc",
  "seen",
  "dirty",
  "lessonsResetPending",
  "lastSyncedAt",
  "serverOffset",
  "barrier",
  "applying",
  "extra",
]);

export type ParsedSidecar =
  | { kind: "ok"; sidecar: Sidecar }
  /** Not a sidecar at all (bad JSON, wrong shape): starting over is right. */
  | { kind: "unusable" }
  /** Written by a newer build than this one: must be left exactly as it is. */
  | { kind: "newer" };

/**
 * A sidecar from its stored JSON text. `freshDeviceId` is used if the replica inside cannot be
 * read and has to be rebuilt (see rebuildSidecar).
 */
export function parseSidecar(raw: string, freshDeviceId: string = newDeviceId()): ParsedSidecar {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "unusable" };
  }
  if (!isDict(parsed)) return { kind: "unusable" };
  if (typeof parsed.v === "number" && parsed.v > 1) return { kind: "newer" };
  if (parsed.v !== 1) return { kind: "unusable" };
  if (isDict(parsed.doc) && typeof parsed.doc.schema === "number" && parsed.doc.schema > DOC_SCHEMA) return { kind: "newer" };
  if (!isSafeKey(parsed.deviceId)) return { kind: "unusable" };
  const link = parseLink(parsed.link);
  if (link === undefined) return { kind: "unusable" };
  let extra: Dict | undefined;
  for (const k of Object.keys(parsed)) {
    if (KNOWN_FIELDS.has(k) || !isSafeKey(k)) continue;
    if (extra === undefined) extra = {};
    extra[k] = parsed[k];
  }
  // The replica's timestamps may legitimately be in the future (a wrong device clock is dealt with
  // when syncing), so no future limit here; and it may hold more entries than can sync (see
  // fitForPush), so no count limits either. A replica must never fail to load for being too big.
  const checked = validateDoc(parsed.doc, { now: 0, maxFutureMs: Number.MAX_SAFE_INTEGER, anyCount: true });
  const serverOffset = parsed.serverOffset;
  const lastSyncedAt = parsed.lastSyncedAt;
  const sidecar: Sidecar = {
    v: 1,
    deviceId: parsed.deviceId,
    link,
    orphanOf: link === null ? parseOwner(parsed.orphanOf) : null,
    doc: checked.ok ? checked.doc : emptyDoc(),
    seen: parseSeen(parsed.seen),
    dirty: parsed.dirty === true,
    lessonsResetPending: parsed.lessonsResetPending === true,
    lastSyncedAt: typeof lastSyncedAt === "number" && Number.isFinite(lastSyncedAt) ? lastSyncedAt : null,
    serverOffset: typeof serverOffset === "number" && Number.isFinite(serverOffset) ? serverOffset : null,
    barrier: typeof parsed.barrier === "string" ? parsed.barrier : null,
    applying: parsed.applying === "merge" || parsed.applying === "replace" ? parsed.applying : null,
  };
  if (extra !== undefined) sidecar.extra = extra;
  return { kind: "ok", sidecar: checked.ok ? sidecar : rebuildSidecar(sidecar, freshDeviceId) };
}

let cache: { raw: string; value: Sidecar } | null = null;

export type SidecarRead =
  /** `sidecar: null` = nothing usable is stored; `newer` = and what is stored must not be overwritten. */
  { ok: true; sidecar: Sidecar | null; newer: boolean } | { ok: false };

/** The sidecar as localStorage holds it NOW. `ok: false` = localStorage itself is unusable. */
export function readSidecar(): SidecarRead {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SIDECAR_KEY);
  } catch {
    return { ok: false };
  }
  if (raw === null) return { ok: true, sidecar: null, newer: false };
  if (cache !== null && cache.raw === raw) return { ok: true, sidecar: cache.value, newer: false };
  const parsed = parseSidecar(raw);
  if (parsed.kind !== "ok") return { ok: true, sidecar: null, newer: parsed.kind === "newer" };
  cache = { raw, value: parsed.sidecar };
  return { ok: true, sidecar: parsed.sidecar, newer: false };
}

/** The JSON text a sidecar is stored as (unknown fields first, so that known ones always win). */
export function serializeSidecar(sc: Sidecar): string {
  const { extra, ...known } = sc;
  return JSON.stringify(extra === undefined ? known : { ...extra, ...known });
}

/** False if the write failed (quota, private mode); the caller must then not act on `sc`. */
export function writeSidecar(sc: Sidecar): boolean {
  try {
    const raw = serializeSidecar(sc);
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
