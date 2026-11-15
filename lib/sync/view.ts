// Mapping between the app's local stores ("the view") and the synced document (doc.ts).
//
// The stores hold plain values: a Settings object, the learn prefs, lesson progress. The document
// holds what merging needs on top of that: a timestamp per value, tombstones for deleted layouts and
// a per-device attempt counter. The stores know nothing about any of it. Instead the sync client
// keeps two things next to the stores:
//
//   replica   its SyncDoc
//   seen      a snapshot of the view as it was right after the last absorb / project
//
// and moves data with the two functions below:
//
//   absorbView   stores -> doc   Whatever differs between `view` and `seen` is a local edit made by
//                                the user since the snapshot; it is stamped into the replica.
//   projectDoc   doc -> stores   The view the stores should hold for a given document.
//
// The client's cycle is always: absorb local edits, merge remote state (mergeDocs), project, write
// the stores, take a new `seen`. IMPORTANT for the caller: take the new `seen` from what the stores
// ACTUALLY hold after writing (re-read them), not from projectDoc's return value. A store may refuse
// or normalise a value it does not understand (an older app version, a clamped number); if `seen`
// kept the projected value, that normalisation would look like a user edit on the next absorb and be
// stamped over the newer remote value.
//
// Like doc.ts this file is pure and generic: no clock, no storage, no imports from the app. Which
// fields exist, which are device-local and which travel together comes in as `ViewConfig`; unknown
// fields and keys are passed through. Nothing here mutates its arguments.

import {
  DOC_SCHEMA,
  LIMITS,
  canonical,
  cleanJson,
  getOwn,
  isSafeKey,
  isTombstone,
  mergeLayoutItem,
  mergeRegister,
  setOwn,
  utf8Length,
} from "./doc.ts";
import type { Json, LayoutItem, LessonEntry, Register, SyncDoc } from "./doc.ts";

export interface ViewLessonEntry {
  stars: number;
  bestWpm: number;
  bestAccuracy: number;
  completedAt: number | null;
  attempts: number;
  lastAt: number;
}

export interface LocalView {
  /** The whole Settings object INCLUDING the custom layouts (array of opaque objects with string `id`). */
  settings: { [k: string]: Json };
  learn: { [k: string]: Json };
  lessons: { [layoutId: string]: { [lessonId: string]: ViewLessonEntry } };
}

export interface ViewConfig {
  /** Settings fields that never sync, e.g. ["emulateLayout", "showHands", "fontSize"]. */
  deviceLocal: string[];
  /**
   * Settings fields that travel together as ONE register, e.g. [["testMode", "testAmount"]].
   * Register key = the fields joined with "+", v = { field: value, ... }. Use this for fields that
   * are only meaningful as a combination: with separate registers, "words / 50" on one device and
   * "time / 15" on another could merge into "time / 50".
   */
  groups: string[][];
  /** Name of the settings field that holds the custom layouts array, "customLayouts". */
  layoutsField: string;
  settingsDefaults: { [k: string]: Json };
  learnDefaults: { [k: string]: Json };
}

type Dict<T> = { [k: string]: T };

/**
 * Timestamp given to everything created by the FIRST absorb on a device (`seen === null`). The real
 * age of values that predate sync is unknown, so they get the lowest meaningful timestamp: any value
 * with a real timestamp beats them (on first sign-in the account's settings win over whatever the
 * device happened to hold), while values the account does not have yet are still uploaded.
 */
const LEGACY_T = 1;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function asDict(x: unknown): Dict<unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Dict<unknown>) : {};
}

function copyDict<T>(src: Dict<T> | null | undefined): Dict<T> {
  const out: Dict<T> = {};
  if (src) for (const k of Object.keys(src)) setOwn(out, k, src[k]);
  return out;
}

function cloneJson(v: Json): Json {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(cloneJson);
  const out: Dict<Json> = {};
  for (const k of Object.keys(v)) setOwn(out, k, cloneJson(v[k]));
  return out;
}

/** Integer timestamp >= 0 from anything (non-finite / negative -> 0). */
function toTime(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) return 0;
  return Math.min(Math.floor(x), Number.MAX_SAFE_INTEGER);
}

function toRange(x: unknown, max: number): number {
  if (typeof x !== "number" || !Number.isFinite(x) || x <= 0) return 0;
  return x > max ? max : x;
}

interface Clean {
  v: Json;
  /** canonical(v) */
  c: string;
}

/**
 * A view value as it may enter the document: a normalised deep copy plus its canonical string, or
 * null if the value is undefined, not JSON, too deep or larger than `maxBytes`. Those are exactly
 * the things validateDoc would reject, and one rejected value would block the whole document, so
 * such values are left out of sync instead (they stay device-local).
 */
function clean(value: unknown, maxBytes: number): Clean | null {
  if (value === undefined) return null;
  const r = cleanJson(value, LIMITS.depth);
  if (!r.ok) return null;
  const c = canonical(r.v);
  if (utf8Length(c) > maxBytes) return null;
  return { v: r.v, c };
}

/** Id of a view layout element, or null if the element cannot be addressed in the document. */
function layoutIdOf(el: unknown): string | null {
  if (typeof el !== "object" || el === null || Array.isArray(el)) return null;
  const id = getOwn(el as Dict<unknown>, "id");
  return isSafeKey(id) ? id : null;
}

/**
 * Index of a view's layouts array by id (first occurrence wins). The value is the cleaned layout, or
 * null for a layout that EXISTS but cannot be synced (not JSON / too large): such a layout must
 * neither be uploaded nor be mistaken for a deletion.
 */
function indexLayouts(arr: unknown): Map<string, Clean | null> {
  const out = new Map<string, Clean | null>();
  if (!Array.isArray(arr)) return out;
  for (const el of arr) {
    const id = layoutIdOf(el);
    if (id === null || out.has(id)) continue;
    out.set(id, clean(el, LIMITS.layoutBytes));
  }
  return out;
}

/** A view lesson entry with every number forced into the range validateDoc accepts. */
function sanitizeLesson(x: unknown): ViewLessonEntry | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const e = x as Dict<unknown>;
  const completedAt = e.completedAt;
  return {
    stars: Math.floor(toRange(e.stars, 3)),
    bestWpm: toRange(e.bestWpm, LIMITS.maxWpm),
    bestAccuracy: toRange(e.bestAccuracy, LIMITS.maxAccuracy),
    completedAt: typeof completedAt === "number" && Number.isFinite(completedAt) ? toTime(completedAt) : null,
    attempts: Math.floor(toRange(e.attempts, Number.MAX_SAFE_INTEGER)),
    lastAt: toTime(e.lastAt),
  };
}

function sameLesson(a: ViewLessonEntry, b: ViewLessonEntry): boolean {
  return (
    a.stars === b.stars &&
    a.bestWpm === b.bestWpm &&
    a.bestAccuracy === b.bestAccuracy &&
    a.completedAt === b.completedAt &&
    a.attempts === b.attempts &&
    a.lastAt === b.lastAt
  );
}

function groupKey(group: string[]): string {
  return group.join("+");
}

/** Members of a group that can actually sync (device-local fields and the layouts field never do). */
function groupMembers(group: string[], config: ViewConfig): string[] {
  return group.filter((m) => isSafeKey(m) && m !== config.layoutsField && config.deviceLocal.indexOf(m) < 0);
}

// ---------------------------------------------------------------------------------------------
// emptyView
// ---------------------------------------------------------------------------------------------

/** The view of a device that has never been used: defaults, no layouts, no lessons. */
export function emptyView(config: ViewConfig): LocalView {
  const settings = cloneJson(config.settingsDefaults) as Dict<Json>;
  setOwn(settings, config.layoutsField, []);
  return { settings, learn: cloneJson(config.learnDefaults) as Dict<Json>, lessons: {} };
}

// ---------------------------------------------------------------------------------------------
// absorbView: local edits -> document
// ---------------------------------------------------------------------------------------------

/**
 * Returns `doc` plus the local edits, where "local edit" = whatever differs between `view` and
 * `seen`. Never mutates its arguments, never throws on odd view contents (those are skipped), and
 * returns a document equal to `doc` when `view` equals `seen`.
 *
 * The result always INCLUDES the input (`includesDoc(result, doc)`): every write is either a
 * strictly newer timestamp, a join, or a higher lessons epoch. So absorbing can never lose state
 * that was merged in from other devices.
 *
 * Stamps: a changed value gets `t = max(now, prevT + 1)` where `prevT` is the timestamp of the value
 * it replaces in the replica. The `+ 1` makes the local edit beat the value this device had seen
 * even if the device's clock is behind the device that wrote it.
 *
 * `seen === null` means "first time tracking on this device": the view is compared against
 * `emptyView(config)` and what differs is written with the legacy stamp (see LEGACY_T), and only
 * where it wins the normal merge against what the replica already holds.
 *
 * `ctx.lessonsReset`: the user reset lesson progress since `seen`. Bumps the lessons epoch (which
 * discards every device's results on merge) and then records whatever `view.lessons` holds now.
 *
 * `ctx.deviceId` must be a stable, per-device key (1..80 chars). If it is not a valid key, bests are
 * still recorded but attempts are not counted.
 */
export function absorbView(
  doc: SyncDoc,
  seen: LocalView | null,
  view: LocalView,
  ctx: { now: number; deviceId: string; config: ViewConfig; lessonsReset?: boolean },
): SyncDoc {
  const config = ctx.config;
  const legacy = seen === null;
  const base: LocalView = seen === null ? emptyView(config) : seen;
  const now = toTime(ctx.now);
  const layoutsField = config.layoutsField;

  const stamp = (prevT: number) => Math.max(now, prevT + 1);

  // One register write. Normal case: strictly newer than what the replica holds, so it wins there
  // and on every replica that has seen nothing newer. Legacy case: a candidate with t = 1 that goes
  // through the ordinary register join, so it can only fill a gap, never replace a real value.
  const writeRegister = (map: Dict<Register>, key: string, v: Json) => {
    const prev = getOwn(map, key);
    if (legacy) {
      const candidate: Register = { t: LEGACY_T, v };
      setOwn(map, key, prev === undefined ? candidate : mergeRegister(prev, candidate));
    } else {
      setOwn(map, key, { t: stamp(prev === undefined ? 0 : prev.t), v });
    }
  };

  // Plain per-field registers: every key of `cur` or `old` not in `excluded` whose value changed.
  const absorbFields = (map: Dict<Register>, cur: Dict<unknown>, old: Dict<unknown>, excluded: Set<string>) => {
    const keys = new Set<string>(Object.keys(cur));
    for (const k of Object.keys(old)) keys.add(k);
    for (const k of keys) {
      if (excluded.has(k) || !isSafeKey(k)) continue;
      // A key missing from the view is "no information" (a store that dropped a field it does not
      // know), not an edit; so is a value that cannot be represented.
      const c = clean(getOwn(cur, k), LIMITS.registerBytes);
      if (c === null) continue;
      const o = clean(getOwn(old, k), LIMITS.registerBytes);
      if (o !== null && o.c === c.c) continue;
      writeRegister(map, k, c.v);
    }
  };

  // --- settings -------------------------------------------------------------------------------
  const viewSettings = asDict(view.settings);
  const seenSettings = asDict(base.settings);
  const settings = copyDict(doc.settings);

  const excluded = new Set<string>([layoutsField]);
  for (const f of config.deviceLocal) excluded.add(f);
  for (const g of config.groups) for (const f of g) excluded.add(f);
  absorbFields(settings, viewSettings, seenSettings, excluded);

  // Groups: if ANY member changed, the whole combination is rewritten as one register, so that the
  // combination is what wins or loses a merge, never half of it.
  for (const group of config.groups) {
    const key = groupKey(group);
    if (!isSafeKey(key)) continue;
    const value: Dict<Json> = {};
    let changed = false;
    let any = false;
    for (const m of groupMembers(group, config)) {
      const c = clean(getOwn(viewSettings, m), LIMITS.registerBytes);
      if (c === null) continue;
      setOwn(value, m, c.v);
      any = true;
      const o = clean(getOwn(seenSettings, m), LIMITS.registerBytes);
      if (o === null || o.c !== c.c) changed = true;
    }
    if (!any || !changed || utf8Length(canonical(value)) > LIMITS.registerBytes) continue;
    writeRegister(settings, key, value);
  }

  // --- learn prefs: per-field registers, no exclusions ----------------------------------------
  const learn = copyDict(doc.learn);
  absorbFields(learn, asDict(view.learn), asDict(base.learn), new Set<string>());

  // --- custom layouts -------------------------------------------------------------------------
  const layouts = copyDict(doc.layouts);
  const viewLayoutsRaw = getOwn(viewSettings, layoutsField);
  // No array in the view = no information about layouts (not "everything was deleted").
  if (Array.isArray(viewLayoutsRaw)) {
    const cur = indexLayouts(viewLayoutsRaw);
    const old = indexLayouts(getOwn(seenSettings, layoutsField));
    // Added or edited: a live item. (A layout that exists but cannot be synced is left alone.)
    for (const [id, c] of cur) {
      if (c === null) continue;
      const o = old.get(id);
      if (o && o.c === c.c) continue;
      const prev = getOwn(layouts, id);
      const v = c.v as Dict<Json>;
      if (legacy) {
        const candidate: LayoutItem = { t: LEGACY_T, v };
        setOwn(layouts, id, prev === undefined ? candidate : mergeLayoutItem(prev, candidate));
      } else {
        setOwn(layouts, id, { t: stamp(prev === undefined ? 0 : prev.t), v });
      }
    }
    // Was in the snapshot, is gone now: the user deleted it -> tombstone. Only ids the view had
    // actually SHOWN are deleted; a layout that is in the replica but never reached this view (it
    // was merged in and not projected yet) is in neither `cur` nor `old` and stays untouched.
    for (const id of old.keys()) {
      if (cur.has(id)) continue;
      const prev = getOwn(layouts, id);
      setOwn(layouts, id, { t: stamp(prev === undefined ? 0 : prev.t), del: true });
    }
  }

  // --- lessons --------------------------------------------------------------------------------
  let epoch = doc.lessons.epoch;
  let by: SyncDoc["lessons"]["by"] = copyDict(doc.lessons.by);
  let seenLessons = asDict(base.lessons);
  if (ctx.lessonsReset) {
    // A higher epoch wins wholesale on merge: this is what erases the results on other devices.
    // `+ 1` for the same reason as in stamp(): it must beat the epoch this device had seen.
    epoch = Math.max(now, epoch + 1);
    by = {};
    seenLessons = {};
  }
  const deviceId = isSafeKey(ctx.deviceId) ? ctx.deviceId : null;
  const viewLessons = asDict(view.lessons);
  for (const layoutId of Object.keys(viewLessons)) {
    if (!isSafeKey(layoutId)) continue;
    const curLessons = asDict(viewLessons[layoutId]);
    const oldLessons = asDict(getOwn(seenLessons, layoutId));
    let target: Dict<LessonEntry> | null = null;
    for (const lessonId of Object.keys(curLessons)) {
      if (!isSafeKey(lessonId)) continue;
      const cur = sanitizeLesson(curLessons[lessonId]);
      if (cur === null) continue;
      const old = sanitizeLesson(getOwn(oldLessons, lessonId));
      if (old !== null && sameLesson(cur, old)) continue;
      if (target === null) target = copyDict(getOwn(by, layoutId));
      const prev = getOwn(target, lessonId);
      // Same join as mergeLessonEntry (max / max / max / min non-null / max), so the entry can only
      // grow; a view that shows LESS than the replica (stale storage) changes nothing.
      const att = copyDict(prev ? prev.att : undefined);
      // The view only has a total. What this device contributed since the snapshot is the
      // difference, and it is added to THIS device's counter only (see mergeLessonEntry for why
      // per-device counters are what makes attempts mergeable without double counting).
      const delta = Math.max(0, cur.attempts - (old === null ? 0 : old.attempts));
      if (delta > 0 && deviceId !== null) {
        setOwn(att, deviceId, Math.min(LIMITS.maxAttempts, (getOwn(att, deviceId) || 0) + delta));
      }
      const prevCompleted = prev ? prev.completedAt : null;
      setOwn(target, lessonId, {
        stars: Math.max(prev ? prev.stars : 0, cur.stars) as 0 | 1 | 2 | 3,
        bestWpm: Math.max(prev ? prev.bestWpm : 0, cur.bestWpm),
        bestAccuracy: Math.max(prev ? prev.bestAccuracy : 0, cur.bestAccuracy),
        completedAt:
          prevCompleted === null
            ? cur.completedAt
            : cur.completedAt === null
              ? prevCompleted
              : Math.min(prevCompleted, cur.completedAt),
        lastAt: Math.max(prev ? prev.lastAt : 0, cur.lastAt),
        att,
      });
    }
    if (target !== null) setOwn(by, layoutId, target);
  }
  // Entries that are in `seen` but missing from the view are deliberately ignored: without an
  // explicit lessonsReset, a vanished entry is lost storage, not a wish to delete progress.

  return { schema: DOC_SCHEMA, settings, learn, layouts, lessons: { epoch, by } };
}

// ---------------------------------------------------------------------------------------------
// projectDoc: document -> view
// ---------------------------------------------------------------------------------------------

/**
 * The view the stores should hold for `doc`, given the view they hold now (`base`).
 *
 *   settings   base, overridden by the doc's registers. Device-local fields always keep the base
 *              value; fields the doc does not mention keep the base value.
 *   layouts    the doc's live layouts. Ids already in base keep their relative order (the order of
 *              the list is a device-local matter and does not sync), new ones follow sorted by
 *              (t, id). Unknown fields of a layout are preserved; `id` is forced to the map key.
 *   learn      base, overridden by the doc's registers.
 *   lessons    REPLACED by the doc's lessons (attempts = sum of the per-device counters). Callers
 *              absorb before they project, so everything local is already in the doc.
 *
 * Deterministic: equal documents and equal bases give equal views. Returns fresh objects; nothing
 * in the result aliases the document.
 */
export function projectDoc(doc: SyncDoc, base: LocalView, config: ViewConfig): LocalView {
  const layoutsField = config.layoutsField;
  const deviceLocal = new Set<string>(config.deviceLocal);

  const groups = new Map<string, string[]>();
  const grouped = new Set<string>();
  for (const g of config.groups) {
    groups.set(groupKey(g), groupMembers(g, config));
    for (const f of g) grouped.add(f);
  }

  // --- settings -------------------------------------------------------------------------------
  const settings = copyDict(asDict(base.settings)) as Dict<Json>;
  // Sorted, so that the result does not depend on the key order of the document object.
  for (const key of Object.keys(doc.settings).sort()) {
    if (deviceLocal.has(key) || key === layoutsField) continue;
    const v = doc.settings[key].v;
    const members = groups.get(key);
    if (members !== undefined) {
      // A group register only assigns fields that are members of the group under THIS config; any
      // other field inside it (written by a different app version) is ignored.
      if (v === null || typeof v !== "object" || Array.isArray(v)) continue;
      for (const m of members) {
        const mv = getOwn(v, m);
        if (mv !== undefined) setOwn(settings, m, cloneJson(mv));
      }
      continue;
    }
    // A stand-alone register for a field that this config syncs as part of a group is ignored:
    // absorbView never writes one, and honouring it would let half a combination through.
    if (grouped.has(key)) continue;
    setOwn(settings, key, cloneJson(v));
  }

  // --- layouts --------------------------------------------------------------------------------
  const out: Json[] = [];
  const placed = new Set<string>();
  const live = (id: string): Json | null => {
    const item = getOwn(doc.layouts, id);
    if (item === undefined || isTombstone(item)) return null;
    const v = cloneJson(item.v) as Dict<Json>;
    setOwn(v, "id", id);
    return v;
  };
  const baseLayouts = getOwn(settings, layoutsField);
  if (Array.isArray(baseLayouts)) {
    for (const el of baseLayouts) {
      const id = layoutIdOf(el);
      if (id === null) {
        // Not addressable in the document; absorbView ignores it, so it is not ours to remove.
        out.push(el);
        continue;
      }
      if (placed.has(id)) continue;
      const v = live(id);
      if (v !== null) {
        placed.add(id);
        out.push(v);
      } else if (getOwn(doc.layouts, id) === undefined && clean(el, LIMITS.layoutBytes) === null) {
        // Exists locally, cannot be synced (too large / not JSON) and the doc knows nothing about
        // it: it stays as a device-local layout instead of silently disappearing.
        placed.add(id);
        out.push(el);
      }
      // Otherwise: tombstoned, or unknown to the doc (its tombstone expired) -> dropped.
    }
  }
  const fresh: { id: string; t: number }[] = [];
  for (const id of Object.keys(doc.layouts)) {
    if (!placed.has(id) && !isTombstone(doc.layouts[id])) fresh.push({ id, t: doc.layouts[id].t });
  }
  fresh.sort((a, b) => (a.t !== b.t ? a.t - b.t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of fresh) out.push(live(f.id) as Json);
  setOwn(settings, layoutsField, out);

  // --- learn ----------------------------------------------------------------------------------
  const learn = copyDict(asDict(base.learn)) as Dict<Json>;
  for (const key of Object.keys(doc.learn)) setOwn(learn, key, cloneJson(doc.learn[key].v));

  // --- lessons --------------------------------------------------------------------------------
  const lessons: LocalView["lessons"] = {};
  for (const layoutId of Object.keys(doc.lessons.by)) {
    const src = doc.lessons.by[layoutId];
    const ids = Object.keys(src);
    if (ids.length === 0) continue;
    const dst: Dict<ViewLessonEntry> = {};
    for (const lessonId of ids) {
      const e = src[lessonId];
      let attempts = 0;
      for (const d of Object.keys(e.att)) attempts += e.att[d];
      setOwn(dst, lessonId, {
        stars: e.stars,
        bestWpm: e.bestWpm,
        bestAccuracy: e.bestAccuracy,
        completedAt: e.completedAt,
        attempts,
        lastAt: e.lastAt,
      });
    }
    setOwn(lessons, layoutId, dst);
  }

  return { settings, learn, lessons };
}
