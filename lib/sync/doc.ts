// The synced document: a state-based CRDT (a join-semilattice).
//
// Every device keeps a full replica of one `SyncDoc`; so does the server. Replicas exchange WHOLE
// documents and combine them with `mergeDocs`. Because `mergeDocs` is
//
//   commutative   merge(a, b) = merge(b, a)                       order of arrival does not matter
//   associative   merge(merge(a, b), c) = merge(a, merge(b, c))   grouping / relaying does not matter
//   idempotent    merge(a, a) = a                                 re-delivery does not matter
//
// any set of replicas that have (transitively) seen the same documents hold the same document, no
// matter how often, in which order or through whom they synced. `scripts/sync-property.mjs` checks
// these laws on thousands of random documents.
//
// Why the laws hold: the document is a product of independent parts, each of which is a semilattice,
// and a product of semilattices merged part by part is a semilattice.
//
//   settings / learn   map key -> last-writer-wins register. Registers are TOTALLY ordered by
//                      (t, canonical(v)); merge = the greater one. "max" over a total order is
//                      commutative, associative and idempotent.
//   layouts            map id -> item, totally ordered by (t, tombstone > live, canonical(v));
//                      merge = max again. Deletion is a tombstone so that it can win a merge.
//   lessons            the lexicographic product (epoch, by): the higher epoch wins wholesale, equal
//                      epochs join `by` entry by entry with max / min / per-device max. A
//                      lexicographic product of a total order (epoch) with a semilattice (by) is a
//                      semilattice.
//   maps               a key present on one side only is kept (union of keys, join per key).
//
// This file is PURE: no clock, no randomness, no storage, no imports. `now` is always a parameter.
// It is imported by the Next.js app, by the API route and (via Node's type stripping) directly by
// scripts/sync-property.mjs, so it must only use erasable TypeScript syntax.
//
// Documents are IMMUTABLE VALUES. No function here mutates its arguments, and results may share
// sub-objects with the arguments (structural sharing). Never mutate a document in place.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** Last-writer-wins register: `v` written at time `t` (epoch ms; 1 = "legacy, real age unknown"). */
export interface Register {
  t: number;
  v: Json;
}

/** A custom layout: live (an opaque object, unknown fields preserved) or a deletion tombstone. */
export type LayoutItem = { t: number; v: { [k: string]: Json } } | { t: number; del: true };

export interface LessonEntry {
  stars: 0 | 1 | 2 | 3;
  bestWpm: number;
  bestAccuracy: number;
  /** Earliest passing run (epoch ms), null if never passed. */
  completedAt: number | null;
  /** Latest attempt (epoch ms). */
  lastAt: number;
  /** Grow-only counter per device; the number of attempts is the sum of all values. */
  att: { [deviceId: string]: number };
}

export interface SyncDoc {
  schema: 1;
  /** key = a setting field name, or a group key (see view.ts). */
  settings: { [key: string]: Register };
  learn: { [key: string]: Register };
  layouts: { [id: string]: LayoutItem };
  lessons: { epoch: number; by: { [layoutId: string]: { [lessonId: string]: LessonEntry } } };
}

export const DOC_SCHEMA = 1 as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The server forgets layout tombstones older than this. */
export const TOMBSTONE_TTL_MS = 180 * DAY_MS;
/**
 * Clients prune one day EARLIER than the server. If both used the same TTL, a client whose clock is
 * slightly behind would still hold a tombstone the server has just dropped, conclude "I have
 * something the server lacks" (`includesDoc` false) and re-upload it on every sync. Pruning earlier
 * means the client always lets go first.
 */
export const CLIENT_TOMBSTONE_TTL_MS = 179 * DAY_MS;

export const LIMITS = {
  /** Max length of any object key (register keys, ids, device ids, keys inside opaque values). */
  keyLen: 80,
  /** Max registers per section (settings, learn). */
  registers: 64,
  /** Max UTF-8 bytes of canonical(register.v). */
  registerBytes: 2048,
  /** Max container nesting of any opaque value (a scalar is depth 0, `{}` / `[]` is depth 1). */
  depth: 8,
  /** Max layout items, tombstones included. */
  layouts: 200,
  /** Max UTF-8 bytes of canonical(layout.v). */
  layoutBytes: 64_000,
  lessonLayouts: 300,
  lessonsPerLayout: 500,
  /** Max device ids in one lesson entry's `att`. */
  devices: 64,
  maxWpm: 1000,
  /** Accuracy is stored as a percentage (0..100) by lib/typing/engine.ts; 0..1 fits as well. */
  maxAccuracy: 100,
  /** Max value of one device's attempt counter. */
  maxAttempts: 1_000_000,
  /** Max serialized size of a whole document. NOT enforced by validateDoc; the API enforces it. */
  docBytes: 256 * 1024,
} as const;

// ---------------------------------------------------------------------------------------------
// Prototype-safe map access
//
// Maps in a document are plain objects keyed by user-influenced strings. Reading `map[k]` for a key
// the map does not own would find `Object.prototype` members ("constructor", "toString", ...), and
// writing `map["__proto__"] = x` would replace the map's prototype instead of adding a key. All map
// access below therefore goes through these two helpers.
// ---------------------------------------------------------------------------------------------

const hasOwn = Object.prototype.hasOwnProperty;

/** `map[key]` if `map` OWNS that key, else undefined. */
export function getOwn<T>(map: { [k: string]: T } | null | undefined, key: string): T | undefined {
  return map != null && hasOwn.call(map, key) ? map[key] : undefined;
}

/** `map[key] = value` as an own, enumerable data property, even for "__proto__". */
export function setOwn<T>(map: { [k: string]: T }, key: string, value: T): void {
  if (key === "__proto__") {
    Object.defineProperty(map, key, { value, writable: true, enumerable: true, configurable: true });
  } else {
    map[key] = value;
  }
}

/** Keys that may appear in a document: 1..LIMITS.keyLen chars and not a prototype-related name. */
export function isSafeKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    key.length >= 1 &&
    key.length <= LIMITS.keyLen &&
    key !== "__proto__" &&
    key !== "constructor" &&
    key !== "prototype"
  );
}

function isPlainObject(x: unknown): x is { [k: string]: unknown } {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

export function isTombstone(item: LayoutItem): item is { t: number; del: true } {
  return (item as { del?: unknown }).del === true;
}

// ---------------------------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------------------------

/**
 * Deterministic JSON: object keys sorted (by UTF-16 code unit, recursively), no whitespace.
 * Two Json values are structurally equal iff their canonical strings are equal, so the string
 * doubles as an equality test and as an arbitrary-but-total order for tie-breaks.
 * Like JSON.stringify, non-JSON leaves (undefined, NaN, functions) print as `null` inside arrays and
 * are omitted inside objects; validated documents never contain any.
 */
export function canonical(value: Json): string {
  if (value === null || typeof value !== "object") {
    const s = JSON.stringify(value);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out += ",";
      out += canonical(value[i]);
    }
    return out + "]";
  }
  const keys = Object.keys(value).sort();
  let out = "{";
  let first = true;
  for (const k of keys) {
    const v = value[k];
    if (v === undefined || typeof v === "function" || typeof v === "symbol") continue;
    if (!first) out += ",";
    first = false;
    out += JSON.stringify(k) + ":" + canonical(v);
  }
  return out + "}";
}

/** UTF-8 byte length of a string, without TextEncoder / Buffer (keeps this file environment-free). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4; // surrogate pair = one 4-byte code point
      i++;
    } else n += 3;
  }
  return n;
}

export function emptyDoc(): SyncDoc {
  return { schema: DOC_SCHEMA, settings: {}, learn: {}, layouts: {}, lessons: { epoch: 0, by: {} } };
}

/** Structural equality (key order is irrelevant). */
export function docsEqual(a: SyncDoc, b: SyncDoc): boolean {
  return canonical(a as unknown as Json) === canonical(b as unknown as Json);
}

// ---------------------------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------------------------

/**
 * Join of two registers = the greater one in the total order (t, canonical(v)).
 *
 * Higher `t` wins: that is "last writer wins". On equal `t` the lexicographically greater canonical
 * value wins. Which value that is has no meaning; what matters is that it is decided by the two
 * VALUES and not by which argument came first, so a.join(b) and b.join(a) pick the same one
 * (commutative). Being the maximum of a total order it is also associative and idempotent. Equal t
 * and equal canonical(v) means the registers are equal, so returning either is the same.
 */
export function mergeRegister(a: Register, b: Register): Register {
  if (a.t !== b.t) return a.t > b.t ? a : b;
  return canonical(a.v) >= canonical(b.v) ? a : b;
}

/**
 * Join of two layout items = the greater one in the total order (t, tombstone > live, canonical(v)).
 *
 * Higher `t` wins (a later edit beats an earlier delete and vice versa). On equal `t` a tombstone
 * beats a live item: a tie must be broken somehow and "delete wins" is the side that cannot
 * resurrect data the user removed. Two live items with equal `t` fall back to the canonical order,
 * two tombstones with equal `t` are equal. Again a maximum over a total order, hence commutative,
 * associative and idempotent.
 */
export function mergeLayoutItem(a: LayoutItem, b: LayoutItem): LayoutItem {
  if (a.t !== b.t) return a.t > b.t ? a : b;
  const aDel = isTombstone(a);
  const bDel = isTombstone(b);
  if (aDel || bDel) return aDel ? a : b;
  const av = (a as { v: Json }).v;
  const bv = (b as { v: Json }).v;
  return canonical(av) >= canonical(bv) ? a : b;
}

/**
 * Join of two results for the same lesson. Every field is merged with an operation that is itself
 * commutative, associative and idempotent, so the record as a whole is too:
 *
 *   stars, bestWpm, bestAccuracy   max   (a best can only improve)
 *   lastAt                         max   (the latest attempt anywhere)
 *   completedAt                    min over the non-null ones; null only if both are null
 *                                        (null acts as +infinity: "never" is later than any date)
 *   att                            per-device max. Each device only ever increases ITS OWN counter,
 *                                        so the max is that device's latest count; summing the
 *                                        per-device maxima counts every attempt exactly once however
 *                                        often the entry is merged (a plain sum would double count).
 */
export function mergeLessonEntry(a: LessonEntry, b: LessonEntry): LessonEntry {
  const att: { [deviceId: string]: number } = {};
  for (const d of Object.keys(a.att)) setOwn(att, d, a.att[d]);
  for (const d of Object.keys(b.att)) {
    const prev = getOwn(att, d);
    setOwn(att, d, prev === undefined ? b.att[d] : Math.max(prev, b.att[d]));
  }
  return {
    stars: Math.max(a.stars, b.stars) as 0 | 1 | 2 | 3,
    bestWpm: Math.max(a.bestWpm, b.bestWpm),
    bestAccuracy: Math.max(a.bestAccuracy, b.bestAccuracy),
    completedAt:
      a.completedAt === null ? b.completedAt : b.completedAt === null ? a.completedAt : Math.min(a.completedAt, b.completedAt),
    lastAt: Math.max(a.lastAt, b.lastAt),
    att,
  };
}

/**
 * Key-wise join of two maps: a key on one side only is kept as is, a key on both sides is joined.
 * If `join` is a semilattice join then so is this (it is the pointwise join, with "absent" as the
 * bottom element). Builds a fresh map; values may be shared with the inputs.
 */
function mergeMaps<T>(
  a: { [k: string]: T } | undefined,
  b: { [k: string]: T } | undefined,
  join: (x: T, y: T) => T,
): { [k: string]: T } {
  const out: { [k: string]: T } = {};
  if (a) for (const k of Object.keys(a)) setOwn(out, k, a[k]);
  if (b) {
    for (const k of Object.keys(b)) {
      const prev = getOwn(out, k);
      setOwn(out, k, prev === undefined ? b[k] : join(prev, b[k]));
    }
  }
  return out;
}

const mergeLessonMaps = (x: { [id: string]: LessonEntry }, y: { [id: string]: LessonEntry }) =>
  mergeMaps(x, y, mergeLessonEntry);

/**
 * Lessons are the lexicographic product (epoch, by).
 *
 * "Reset progress" cannot be expressed with max/min joins (they only ever grow), so a reset bumps
 * `epoch` and starts over with an empty `by`. The side with the higher epoch wins WHOLESALE and the
 * other side's `by` is discarded; that is how a reset reaches devices that still hold old results.
 * With equal epochs both sides are in the same "generation" and are joined entry by entry.
 *
 * Commutative: the comparison of epochs is symmetric and the join is commutative.
 * Associative: among three docs only those with the maximal epoch contribute, and they are joined.
 * Idempotent: equal epochs -> join(by, by) = by.
 */
function mergeLessons(a: SyncDoc["lessons"] | undefined, b: SyncDoc["lessons"] | undefined): SyncDoc["lessons"] {
  const ea = a ? a.epoch : 0;
  const eb = b ? b.epoch : 0;
  if (ea > eb) return { epoch: ea, by: mergeMaps(a!.by, undefined, mergeLessonMaps) };
  if (eb > ea) return { epoch: eb, by: mergeMaps(b!.by, undefined, mergeLessonMaps) };
  return { epoch: ea, by: mergeMaps(a ? a.by : undefined, b ? b.by : undefined, mergeLessonMaps) };
}

/**
 * The join of two documents. Never mutates its inputs. Commutative, associative and idempotent (see
 * the top of this file), therefore safe to apply in any order, any number of times.
 */
export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  return {
    schema: DOC_SCHEMA,
    settings: mergeMaps(a.settings, b.settings, mergeRegister),
    learn: mergeMaps(a.learn, b.learn, mergeRegister),
    layouts: mergeMaps(a.layouts, b.layouts, mergeLayoutItem),
    lessons: mergeLessons(a.lessons, b.lessons),
  };
}

/**
 * True iff `b` adds nothing to `a`, i.e. merge(a, b) = a (in lattice terms: b <= a).
 * `!includesDoc(serverDoc, localDoc)` means "I have something the server lacks, push".
 */
export function includesDoc(a: SyncDoc, b: SyncDoc): boolean {
  return docsEqual(mergeDocs(a, b), a);
}

// ---------------------------------------------------------------------------------------------
// Maintenance: prune and clamp. NEITHER is a lattice operation, see the caveats on each.
// ---------------------------------------------------------------------------------------------

/**
 * Drops layout tombstones with `t < now - ttlMs`. Nothing else changes.
 *
 * Caveat (inherent to expiring tombstones): pruning forgets a deletion. A replica that was offline
 * for longer than the TTL and still holds the live layout will bring it back on its next sync,
 * because nobody remembers that it was deleted. Within the TTL deletes never resurrect.
 */
export function pruneDoc(doc: SyncDoc, now: number, ttlMs: number): SyncDoc {
  const cutoff = now - ttlMs;
  const layouts: SyncDoc["layouts"] = {};
  for (const id of Object.keys(doc.layouts)) {
    const item = doc.layouts[id];
    if (isTombstone(item) && item.t < cutoff) continue;
    setOwn(layouts, id, item);
  }
  return { schema: DOC_SCHEMA, settings: doc.settings, learn: doc.learn, layouts, lessons: doc.lessons };
}

/**
 * Copy of `doc` in which every timestamp greater than `maxT` is lowered to `maxT`: `t` of registers
 * and layout items, `lessons.epoch`, `completedAt`, `lastAt`.
 *
 * For a client that discovers its clock was ahead: the server REJECTS future timestamps instead of
 * clamping them, so the client clamps before its first push. Caveat: clamping can turn "newer" into
 * "equal" (ties are then broken by canonical value / tombstone-wins), so it does not commute with
 * merge. Use it only on state that has not been pushed yet.
 */
export function clampDocTimes(doc: SyncDoc, maxT: number): SyncDoc {
  const clamp = (t: number) => (t > maxT ? maxT : t);
  const registers = (src: { [k: string]: Register }) => {
    const out: { [k: string]: Register } = {};
    for (const k of Object.keys(src)) setOwn(out, k, { t: clamp(src[k].t), v: src[k].v });
    return out;
  };
  const layouts: SyncDoc["layouts"] = {};
  for (const id of Object.keys(doc.layouts)) {
    const item = doc.layouts[id];
    setOwn(layouts, id, isTombstone(item) ? { t: clamp(item.t), del: true as const } : { t: clamp(item.t), v: item.v });
  }
  const by: SyncDoc["lessons"]["by"] = {};
  for (const layoutId of Object.keys(doc.lessons.by)) {
    const src = doc.lessons.by[layoutId];
    const dst: { [lessonId: string]: LessonEntry } = {};
    for (const lessonId of Object.keys(src)) {
      const e = src[lessonId];
      setOwn(dst, lessonId, {
        stars: e.stars,
        bestWpm: e.bestWpm,
        bestAccuracy: e.bestAccuracy,
        completedAt: e.completedAt === null ? null : clamp(e.completedAt),
        lastAt: clamp(e.lastAt),
        att: e.att,
      });
    }
    setOwn(by, layoutId, dst);
  }
  return {
    schema: DOC_SCHEMA,
    settings: registers(doc.settings),
    learn: registers(doc.learn),
    layouts,
    lessons: { epoch: clamp(doc.lessons.epoch), by },
  };
}

// ---------------------------------------------------------------------------------------------
// Validation of untrusted input
// ---------------------------------------------------------------------------------------------

/** Internal control flow for validation; never escapes this module. Carries a fixed string only. */
class Reject {
  msg: string;
  constructor(msg: string) {
    this.msg = msg;
  }
}

function fail(msg: string): never {
  throw new Reject(msg);
}

/** Runs `fn`, prefixing any rejection with the section name ("layouts: too many"). */
function section<T>(name: string, fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof Reject) throw new Reject(name + ": " + e.msg);
    throw e;
  }
}

/**
 * Deep copy of `x` as Json, or a rejection. `depthLeft` is the number of container levels still
 * allowed, which also bounds the recursion. Output objects are built with setOwn after isSafeKey, so
 * no input key can reach a prototype. -0 is normalised to 0 (canonical() prints both as "0").
 */
function cleanValue(x: unknown, depthLeft: number): Json {
  if (x === null) return null;
  const type = typeof x;
  if (type === "boolean" || type === "string") return x as boolean | string;
  if (type === "number") {
    if (!Number.isFinite(x)) fail("number not finite");
    return x === 0 ? 0 : (x as number);
  }
  if (type !== "object") fail("not json");
  if (depthLeft <= 0) fail("too deep");
  if (Array.isArray(x)) {
    const out: Json[] = [];
    for (let i = 0; i < x.length; i++) out.push(cleanValue(x[i], depthLeft - 1));
    return out;
  }
  if (!isPlainObject(x)) fail("not json");
  const out: { [k: string]: Json } = {};
  for (const k of Object.keys(x as object)) {
    if (!isSafeKey(k)) fail("bad key");
    setOwn(out, k, cleanValue((x as { [k: string]: unknown })[k], depthLeft - 1));
  }
  return out;
}

/**
 * Total (never throws) version of the opaque-value check, for callers outside this file: returns a
 * normalised deep copy of `value` if it is Json with safe keys and at most `maxDepth` container
 * levels. view.ts uses it so that it never puts something into a document that validateDoc rejects.
 */
export function cleanJson(value: unknown, maxDepth: number = LIMITS.depth): { ok: true; v: Json } | { ok: false } {
  try {
    return { ok: true, v: cleanValue(value, maxDepth) };
  } catch {
    return { ok: false };
  }
}

function checkKey(k: string): string {
  if (!isSafeKey(k)) fail("bad key");
  return k;
}

/** Timestamps: safe integers >= 0 (so `t + 1` is exact) and not beyond the allowed future. */
function checkTime(x: unknown, maxT: number): number {
  if (typeof x !== "number" || !Number.isSafeInteger(x) || x < 0) fail("bad timestamp");
  if (!((x as number) <= maxT)) fail("timestamp in future");
  return x === 0 ? 0 : (x as number);
}

function checkNumber(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max) fail("bad " + what);
  return x === 0 ? 0 : (x as number);
}

function checkMap(x: unknown, maxEntries: number): { [k: string]: unknown } {
  if (!isPlainObject(x)) fail("not an object");
  if (Object.keys(x as object).length > maxEntries) fail("too many");
  return x as { [k: string]: unknown };
}

function validateRegisters(input: unknown, maxT: number): { [k: string]: Register } {
  const out: { [k: string]: Register } = {};
  if (input === undefined) return out;
  const map = checkMap(input, LIMITS.registers);
  for (const k of Object.keys(map)) {
    checkKey(k);
    const r = map[k];
    if (!isPlainObject(r)) fail("bad register");
    if (!hasOwn.call(r, "v")) fail("missing value");
    const t = checkTime(r.t, maxT);
    const v = cleanValue(r.v, LIMITS.depth);
    if (utf8Length(canonical(v)) > LIMITS.registerBytes) fail("value too large");
    setOwn(out, k, { t, v });
  }
  return out;
}

function validateLayouts(input: unknown, maxT: number): SyncDoc["layouts"] {
  const out: SyncDoc["layouts"] = {};
  if (input === undefined) return out;
  const map = checkMap(input, LIMITS.layouts);
  for (const id of Object.keys(map)) {
    checkKey(id);
    const item = map[id];
    if (!isPlainObject(item)) fail("bad item");
    const hasDel = hasOwn.call(item, "del");
    const hasV = hasOwn.call(item, "v");
    if (hasDel && hasV) fail("both v and del");
    const t = checkTime(item.t, maxT);
    if (hasDel) {
      if (item.del !== true) fail("bad del");
      setOwn(out, id, { t, del: true as const });
      continue;
    }
    if (!hasV || !isPlainObject(item.v)) fail("bad value");
    const v = cleanValue(item.v, LIMITS.depth) as { [k: string]: Json };
    // The map key is the identity. A value claiming another id would make two replicas disagree
    // about which layout this is.
    if (hasOwn.call(v, "id") && v.id !== id) fail("id mismatch");
    if (utf8Length(canonical(v)) > LIMITS.layoutBytes) fail("value too large");
    setOwn(out, id, { t, v });
  }
  return out;
}

function validateLessonEntry(input: unknown, maxT: number): LessonEntry {
  if (!isPlainObject(input)) fail("bad entry");
  const e = input as { [k: string]: unknown };
  if (e.stars !== 0 && e.stars !== 1 && e.stars !== 2 && e.stars !== 3) fail("bad stars");
  const attIn = checkMap(e.att, LIMITS.devices);
  const att: { [deviceId: string]: number } = {};
  for (const d of Object.keys(attIn)) {
    checkKey(d);
    const n = attIn[d];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > LIMITS.maxAttempts) fail("bad attempts");
    setOwn(att, d, n === 0 ? 0 : (n as number));
  }
  // Unknown fields are dropped: only the six known ones are copied.
  return {
    stars: e.stars as 0 | 1 | 2 | 3,
    bestWpm: checkNumber(e.bestWpm, 0, LIMITS.maxWpm, "wpm"),
    bestAccuracy: checkNumber(e.bestAccuracy, 0, LIMITS.maxAccuracy, "accuracy"),
    completedAt: e.completedAt === null ? null : checkTime(e.completedAt, maxT),
    lastAt: checkTime(e.lastAt, maxT),
    att,
  };
}

function validateLessons(input: unknown, maxT: number): SyncDoc["lessons"] {
  if (input === undefined) return { epoch: 0, by: {} };
  if (!isPlainObject(input)) fail("not an object");
  const epoch = checkTime(input.epoch, maxT);
  const by: SyncDoc["lessons"]["by"] = {};
  const layoutsIn = checkMap(input.by, LIMITS.lessonLayouts);
  for (const layoutId of Object.keys(layoutsIn)) {
    checkKey(layoutId);
    const lessonsIn = checkMap(layoutsIn[layoutId], LIMITS.lessonsPerLayout);
    const lessons: { [lessonId: string]: LessonEntry } = {};
    for (const lessonId of Object.keys(lessonsIn)) {
      checkKey(lessonId);
      setOwn(lessons, lessonId, validateLessonEntry(lessonsIn[lessonId], maxT));
    }
    setOwn(by, layoutId, lessons);
  }
  return { epoch, by };
}

/**
 * Strict structural validation of UNTRUSTED input (a request body, a row read back from storage).
 *
 * On success returns a freshly built, normalised copy; the input object is never returned and
 * nothing in the result aliases it. Unknown top-level keys, unknown register / item fields and
 * unknown lesson-entry fields are dropped; unknown fields INSIDE a layout value or a register value
 * are preserved (those are opaque). Missing top-level sections default to empty.
 *
 * Timestamps later than `opts.now + opts.maxFutureMs` are REJECTED, not clamped: a far-future `t`
 * would win every last-writer-wins comparison forever.
 *
 * Total: never throws, whatever the input. `error` is a fixed machine-readable string such as
 * "layouts: too many"; it never contains user content.
 */
export function validateDoc(
  input: unknown,
  opts: { now: number; maxFutureMs: number },
): { ok: true; doc: SyncDoc } | { ok: false; error: string } {
  try {
    const maxT = opts.now + opts.maxFutureMs;
    if (!isPlainObject(input)) return { ok: false, error: "not an object" };
    if (getOwn(input, "schema") !== DOC_SCHEMA) return { ok: false, error: "unsupported schema" };
    const doc: SyncDoc = {
      schema: DOC_SCHEMA,
      settings: section("settings", () => validateRegisters(getOwn(input, "settings"), maxT)),
      learn: section("learn", () => validateRegisters(getOwn(input, "learn"), maxT)),
      layouts: section("layouts", () => validateLayouts(getOwn(input, "layouts"), maxT)),
      lessons: section("lessons", () => validateLessons(getOwn(input, "lessons"), maxT)),
    };
    return { ok: true, doc };
  } catch (e) {
    // Reject carries one of the fixed strings above. Anything else (a throwing getter or proxy on
    // non-JSON input, a stack overflow) is reported without detail.
    return { ok: false, error: e instanceof Reject ? e.msg : "invalid" };
  }
}
