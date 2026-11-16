// The decision logic of the client sync engine, as PURE functions over values.
//
// lib/sync/engine.ts does the impure part (localStorage, fetch, timers, the account store) and
// calls into this file for every state transition, so the transitions can be simulated without a
// browser (scripts/sync-engine-sim.mjs imports this file through Node's type stripping; therefore:
// erasable TypeScript only, relative imports with the .ts extension, no app imports).
//
// The "sidecar" is everything the engine persists next to the app's own stores:
//
//   doc    this device's replica of the synced document
//   seen   the view of the stores as of the last absorb / project (see view.ts)
//   link   which account the replica belongs to (null = not linked: anonymous or orphaned data)
//
// Nothing here mutates its arguments; a function that changes nothing returns the SAME object.
//
// FIRST CONTACT. A replica that is linked to an account but has not exchanged anything with it yet
// (`link.clockChecked === false`) holds data whose timestamps, lessons epoch and attempt counts
// were produced without the account: on an anonymous device, under another account, or by a
// rebuild after lost storage. None of it is comparable with the account's document as it stands.
// The first `integrateRemote` after linking therefore does three things exactly once (and only
// there, because none of them is a lattice operation):
//
//   - timestamps  stamps ahead of the server's clock are demoted to "age unknown" (adoptDocTimes);
//   - epoch       the replica ADOPTS the account's lessons epoch and the results are joined, so
//                 linking is always a union of progress, never a reset in either direction;
//   - attempts    totals of unknown origin (see UNATTRIBUTED in view.ts) are credited to this
//                 device only as far as they exceed what the merged document already accounts for
//                 (creditAttempts), so re-downloaded history is not counted twice.

import {
  CLIENT_TOMBSTONE_TTL_MS,
  LIMITS,
  adoptDocTimes,
  canonical,
  docsEqual,
  emptyDoc,
  getOwn,
  includesDoc,
  isSafeKey,
  isTombstone,
  mergeDocs,
  pruneDoc,
  setOwn,
} from "./doc.ts";
import type { Json, LessonEntry, SyncDoc } from "./doc.ts";
import { absorbView, creditAttempts, emptyView, projectDoc, stripUnattributed } from "./view.ts";
import type { LocalView, ViewConfig } from "./view.ts";

export interface SyncLink {
  userId: string;
  /** Display name of the account at link time (shown by the "different account" dialog). */
  name: string;
  /** Generation of the server row this replica last synced with; null = never synced with it. */
  gen: string | null;
  /** Version of the server row as of the last response that was applied. */
  version: number;
  /** A cycle has completed since linking (the "first-sync" event has been emitted). */
  firstSyncDone: boolean;
  /** FIRST CONTACT (see the top of this file) has happened since linking. */
  clockChecked: boolean;
}

export interface Sidecar {
  v: 1;
  deviceId: string;
  link: SyncLink | null;
  doc: SyncDoc;
  seen: LocalView | null;
  /** The replica holds something the linked account's server copy is not known to include. */
  dirty: boolean;
  /** "Reset lesson progress" was used since the last absorb (see absorbLocal). */
  lessonsResetPending: boolean;
  lastSyncedAt: number | null;
  /** serverTime - Date.now(), learned from responses; null = never talked to the server. */
  serverOffset: number | null;
  /**
   * Stamp of the browser session (see lib/auth/client.ts) that was ENDED for this data: by "Clear
   * all data", by deleting the account's data, or because it was deleted elsewhere. A tab that
   * still believes in exactly that session must not link the data to the account again (it would
   * re-download what was cleared / re-upload what was deleted); it signs out instead. A later
   * sign-in has a different stamp and links normally.
   */
  barrier: string | null;
  /**
   * The account this UNLINKED data last belonged to (set by unlinkSidecar, cleared by linking).
   * When the same user signs in again the data joins that account without a question; for any
   * other user it is "another account's data" and goes through the mismatch choice. null with
   * `link === null` = data that never belonged to an account, which joins whoever signs in.
   */
  orphanOf?: { userId: string; name: string } | null;
  /**
   * Write-ahead marker: set (and saved) BEFORE the stores are brought to the projection of `doc`,
   * cleared by the save that records the new `seen`. A sidecar found with the marker set means the
   * tab that wrote it died, or could not save, in between: the stores may hold any mixture of old
   * and projected values and `seen` is the view from BEFORE the projection. Absorbing in that
   * state would take projected remote values for local edits; `redoApply` finishes the job.
   *   "merge"    stores := projectDoc(doc, stores)
   *   "replace"  stores := projectDoc(doc, empty view)   ("use the account's data")
   */
  applying?: "merge" | "replace" | null;
  /** Top-level fields of the stored sidecar this build does not know; written back unchanged. */
  extra?: { [k: string]: unknown };
}

/** What the server said: the body of a 200 (GET or PUT) or of a 409. */
export interface RemoteState {
  doc: SyncDoc | null;
  version: number;
  gen: string | null;
  serverTime: number;
}

/**
 * At first contact a stamp may be this far ahead of the server's clock and still count as "now"
 * (the request took time, clocks jitter). Anything later is of unverifiable age, see adoptDocTimes.
 */
export const FIRST_CONTACT_TOLERANCE_MS = 2 * 60 * 1000;

export function sameView(a: LocalView, b: LocalView): boolean {
  return canonical(a as unknown as Json) === canonical(b as unknown as Json);
}

/** The replica has exchanged data with the account it is linked to. */
export function hasMetAccount(sc: Sidecar): boolean {
  return sc.link !== null && sc.link.clockChecked;
}

/** The account the local data belongs to or last belonged to; null = never belonged to one. */
export function localOwner(sc: Sidecar): { userId: string; name: string } | null {
  if (sc.link !== null) return { userId: sc.link.userId, name: sc.link.name };
  return sc.orphanOf ?? null;
}

function withLessons(doc: SyncDoc, lessons: SyncDoc["lessons"]): SyncDoc {
  return { schema: doc.schema, settings: doc.settings, learn: doc.learn, layouts: doc.layouts, lessons };
}

/**
 * Stamps the local edits (the difference between `view` and `sc.seen`) into the replica.
 * Returns `sc` itself when there is nothing to absorb.
 *
 * `known` is `view` minus everything the stores could not vouch for (see readStores in local.ts): a
 * store whose localStorage key is missing or unreadable answers with defaults, and those defaults
 * are NOT edits. Only `known` is absorbed; `seen` becomes the whole `view`.
 *
 * LESSON RESET (`lessonsResetPending`). There are two kinds and the difference matters:
 *
 *   account reset   Only for a replica that has met its account (and the engine only sets the flag
 *                   while signed in to it). Bumps the lessons epoch, which erases the results in the
 *                   account and, through merge, on every device of it. Documented consequence:
 *                   results another device records before it LEARNS of the reset (it was offline)
 *                   belong to the old epoch and are discarded when it syncs. That is inherent: a
 *                   reset that late results could undo would not be a reset.
 *   local reset     In every other situation (anonymous, signed out, not yet met): only this
 *                   replica is emptied, the epoch stays. An epoch stamped by a device that is not
 *                   talking to the account would otherwise erase the account's progress whenever
 *                   the device signs in later, including lessons done after the "reset". The
 *                   meaning of a local reset is "empty this browser": if the device is or becomes
 *                   linked, the account's lessons come back with the next sync. The engine uses
 *                   resetLessonsLocal for it (which also renews the device id, see there); the
 *                   branch below only covers a flag that was set before the link went away.
 */
export function absorbLocal(sc: Sidecar, view: LocalView, now: number, config: ViewConfig, known: LocalView = view): Sidecar {
  let doc = sc.doc;
  let seen = sc.seen;
  const met = hasMetAccount(sc);
  let epochReset = false;
  if (sc.lessonsResetPending) {
    if (met) {
      epochReset = true;
    } else {
      doc = withLessons(doc, { epoch: doc.lessons.epoch, by: {} });
      if (seen !== null) seen = { settings: seen.settings, learn: seen.learn, lessons: {} };
    }
  }
  if (!sc.lessonsResetPending && seen !== null && sameView(seen, view)) return sc;
  const absorbed = absorbView(doc, seen, known, {
    now,
    deviceId: sc.deviceId,
    config,
    lessonsReset: epochReset,
    // Before the first contact the replica cannot tell its own attempts from downloaded history.
    legacyAttempts: met ? "credit" : "defer",
  });
  const changed = !docsEqual(absorbed, sc.doc);
  return {
    ...sc,
    // Pruned here as well, so that the tombstones of a device that never signs in do not pile up.
    doc: changed ? pruneDoc(absorbed, now, CLIENT_TOMBSTONE_TTL_MS) : sc.doc,
    seen: view,
    dirty: sc.dirty || changed,
    lessonsResetPending: false,
  };
}

/**
 * The tracking step: absorb, and if the stores had gaps (see StoreRead in local.ts), the view that
 * puts the replica's values back into them. A store that lost its localStorage key shows defaults;
 * the replica still knows what the user had, so it is restored instead of the loss being synced as
 * "the user reset everything and deleted every layout". The same goes for lesson progress, which
 * was always treated this way ("vanished = lost storage, not a reset").
 *
 * `restore` is null when nothing needs writing. Otherwise the caller writes it to the stores and
 * takes `sidecar.seen` from the stores afterwards, as after any projection.
 */
export function trackLocal(
  sc: Sidecar,
  read: { view: LocalView; known: LocalView; gaps: boolean },
  now: number,
  config: ViewConfig,
): { sidecar: Sidecar; restore: LocalView | null } {
  const sidecar = absorbLocal(sc, read.view, now, config, read.known);
  if (!read.gaps) return { sidecar, restore: null };
  const target = projectDoc(sidecar.doc, read.view, config);
  return { sidecar, restore: sameView(target, read.view) ? null : target };
}

/**
 * "Reset progress" as a LOCAL reset (see absorbLocal): the replica's lesson results and the
 * snapshot's are emptied, the epoch is untouched.
 *
 * If the data ever belonged to an account, the device continues under `freshDeviceId`. Its attempt
 * counters start again from zero here, but copies of the old counters live on in the account, and a
 * counter that restarts under the same id would lose every new attempt to the old, higher value
 * when the two are merged (per-device max).
 */
export function resetLessonsLocal(sc: Sidecar, freshDeviceId: string): Sidecar {
  return {
    ...sc,
    deviceId: localOwner(sc) !== null ? freshDeviceId : sc.deviceId,
    doc: withLessons(sc.doc, { epoch: sc.doc.lessons.epoch, by: {} }),
    seen: sc.seen === null ? null : { settings: sc.seen.settings, learn: sc.seen.learn, lessons: {} },
    lessonsResetPending: false,
  };
}

/**
 * The account's data was erased from another device: this replica last synced with generation
 * `link.gen` of the server row, and that row is gone or has been re-created since.
 */
export function isRemoteDeleted(link: SyncLink, remote: RemoteState): boolean {
  return typeof link.gen === "string" && remote.gen !== link.gen;
}

/**
 * Removes attempt counters until no lesson entry has more than LIMITS.devices of them. Only
 * counters the server does not have are removed (the server's own are within the limit), so the
 * attempts of this device for that lesson are simply not counted; see addAttempts in view.ts.
 */
function capDevices(doc: SyncDoc, remote: SyncDoc): SyncDoc {
  let by: SyncDoc["lessons"]["by"] | null = null;
  for (const layoutId of Object.keys(doc.lessons.by)) {
    const entries = doc.lessons.by[layoutId];
    let target: { [lessonId: string]: LessonEntry } | null = null;
    for (const lessonId of Object.keys(entries)) {
      const entry = entries[lessonId];
      const ids = Object.keys(entry.att);
      if (ids.length <= LIMITS.devices) continue;
      const theirs = getOwn(getOwn(remote.lessons.by, layoutId), lessonId);
      const att: { [deviceId: string]: number } = {};
      for (const d of ids) setOwn(att, d, entry.att[d]);
      const extra = ids.filter((d) => theirs === undefined || getOwn(theirs.att, d) === undefined).sort();
      for (let n = ids.length; n > LIMITS.devices && extra.length > 0; n--) delete att[extra.pop() as string];
      if (target === null) {
        target = {};
        for (const id of Object.keys(entries)) setOwn(target, id, entries[id]);
      }
      setOwn(target, lessonId, { ...entry, att });
    }
    if (target !== null) {
      if (by === null) {
        by = {};
        for (const id of Object.keys(doc.lessons.by)) setOwn(by, id, doc.lessons.by[id]);
      }
      setOwn(by, layoutId, target);
    }
  }
  return by === null ? doc : withLessons(doc, { epoch: doc.lessons.epoch, by });
}

/**
 * The document to upload for replica `merged`, given the server's document `remote`.
 *
 * Normally `merged` itself. If `merged` holds more layout items than the server accepts (after
 * pruneDoc that means: more LIVE layouts than LIMITS.layouts), the upload keeps every id the
 * server already has and fills the remaining slots with the newest of the others (by `t`, then
 * id). The rest stays in the replica and in this device's stores, device-local, and the engine
 * tells the user. Uploading everything instead would be rejected as a whole and block all sync.
 */
export function fitForPush(merged: SyncDoc, remote: SyncDoc): SyncDoc {
  const ids = Object.keys(merged.layouts);
  if (ids.length <= LIMITS.layouts) return merged;
  const layouts: SyncDoc["layouts"] = {};
  let count = 0;
  const rest: { id: string; t: number; live: boolean }[] = [];
  for (const id of ids) {
    if (getOwn(remote.layouts, id) !== undefined) {
      setOwn(layouts, id, merged.layouts[id]);
      count++;
    } else {
      rest.push({ id, t: merged.layouts[id].t, live: !isTombstone(merged.layouts[id]) });
    }
  }
  rest.sort((a, b) => (a.live !== b.live ? (a.live ? -1 : 1) : a.t !== b.t ? b.t - a.t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of rest) {
    if (count >= LIMITS.layouts) break;
    setOwn(layouts, r.id, merged.layouts[r.id]);
    count++;
  }
  return { schema: merged.schema, settings: merged.settings, learn: merged.learn, layouts, lessons: merged.lessons };
}

/**
 * One merge step of a sync cycle (design step 5), given a fresh server state:
 * absorb local edits, join with the remote document, decide whether the server lacks anything.
 *
 * `projected` is what the stores should hold afterwards. The caller writes it to the stores,
 * re-reads the stores and stores THAT as `sidecar.seen` (the `seen` returned here is the view from
 * before the projection and must be replaced; it is also what `redoApply` needs if the caller dies
 * between the two writes).
 *
 * `push` is the document to PUT when `needPush` (see fitForPush); `overflow` says that some layouts
 * could not be included in it.
 *
 * The remote document is merged UNPRUNED and the result is pruned. Pruning the remote first (the
 * client's TTL is a day shorter than the server's) would hide a tombstone the server still holds:
 * a device returning in that last day with the live layout would keep it, find that the server
 * "lacks" it, upload it, lose against the tombstone there, and repeat. The server never lacks a
 * tombstone this client has merely forgotten, because `needPush` compares against the unpruned
 * remote and a pruned result only ever has FEWER tombstones.
 *
 * Precondition: `sc.link !== null` and `!isRemoteDeleted(sc.link, remote)`.
 */
export function integrateRemote(
  sc: Sidecar,
  view: LocalView,
  remote: RemoteState,
  now: number,
  config: ViewConfig,
  known: LocalView = view,
): { sidecar: Sidecar; projected: LocalView; needPush: boolean; push: SyncDoc; overflow: boolean } {
  const link = sc.link as SyncLink;
  const first = !link.clockChecked;
  const remoteDoc = remote.doc === null ? emptyDoc() : remote.doc;
  // Before the first contact this is a "not met" absorb: a pending reset is local, and attempts of
  // unknown origin are parked for creditAttempts below.
  const absorbed = absorbLocal(sc, view, now, config, known);
  // This device's own tombstones expire by its own TTL BEFORE the merge: one that is past it but
  // still in the replica (the device was away) would otherwise win the merge against the server's
  // live layout and then be pruned from the result, so the layout would vanish here for one cycle
  // and come back with the next. The pseudo counter never takes part in a merge at all.
  let local = stripUnattributed(pruneDoc(absorbed.doc, now, CLIENT_TOMBSTONE_TTL_MS));
  if (first) local = adoptDocTimes(local, remote.serverTime, FIRST_CONTACT_TOLERANCE_MS, remoteDoc.lessons.epoch);
  let merged = pruneDoc(mergeDocs(local, remoteDoc), now, CLIENT_TOMBSTONE_TTL_MS);
  merged = creditAttempts(merged, absorbed.doc, sc.deviceId);
  merged = capDevices(merged, remoteDoc);
  const push = fitForPush(merged, remoteDoc);
  const needPush = !includesDoc(remoteDoc, push);
  const projected = projectDoc(merged, view, config);
  return {
    sidecar: {
      ...sc,
      link: { ...link, gen: remote.gen, version: remote.version, clockChecked: true },
      doc: merged,
      seen: view,
      dirty: needPush,
      lessonsResetPending: false,
    },
    projected,
    needPush,
    push,
    overflow: push !== merged,
  };
}

// ---------------------------------------------------------------------------------------------
// Recovering from an interrupted projection (Sidecar.applying)
// ---------------------------------------------------------------------------------------------

type Dict<T> = { [k: string]: T };

const same = (a: unknown, b: unknown) => canonical(a as Json) === canonical(b as Json);

function idOf(el: unknown): string | null {
  if (typeof el !== "object" || el === null || Array.isArray(el)) return null;
  const id = getOwn(el as Dict<unknown>, "id");
  return isSafeKey(id) ? id : null;
}

function indexById(arr: unknown): Map<string, Json> {
  const out = new Map<string, Json>();
  if (Array.isArray(arr)) {
    for (const el of arr) {
      const id = idOf(el);
      if (id !== null && !out.has(id)) out.set(id, el as Json);
    }
  }
  return out;
}

/** `cur` with every value that equals the one in `target` put back to what `pre` had (or removed). */
function unapplyDict<T>(cur: Dict<T>, target: Dict<T>, pre: Dict<T>, skip?: string): Dict<T> {
  const out: Dict<T> = {};
  for (const k of Object.keys(cur)) {
    if (k === skip) continue;
    const t = getOwn(target, k);
    if (t !== undefined && same(t, cur[k])) {
      const p = getOwn(pre, k);
      if (p !== undefined) setOwn(out, k, p);
    } else {
      setOwn(out, k, cur[k]);
    }
  }
  return out;
}

/**
 * The view an interrupted projection would have left if it had not started, as far as that can be
 * told: every value of `view` that equals the projection `target` is taken to be the projection's
 * doing and is replaced by the value from `pre` (the view before the projection). What then still
 * differs from `pre` was changed by somebody else in the meantime, i.e. is a local edit.
 */
function unapply(view: LocalView, target: LocalView, pre: LocalView, config: ViewConfig): LocalView {
  const field = config.layoutsField;
  const settings = unapplyDict(view.settings, target.settings, pre.settings, field);
  const curLayouts = getOwn(view.settings, field);
  if (Array.isArray(curLayouts)) {
    const cur = indexById(curLayouts);
    const tgt = indexById(getOwn(target.settings, field));
    const old = indexById(getOwn(pre.settings, field));
    const list: Json[] = [];
    for (const el of curLayouts) {
      const id = idOf(el);
      const t = id === null ? undefined : tgt.get(id);
      if (id === null || t === undefined || !same(t, el)) {
        list.push(el);
      } else {
        const p = old.get(id); // projected: show what was there before (nothing, if it is new)
        if (p !== undefined) list.push(p);
      }
    }
    // Gone from the view AND from the projection: removed by the projection, not by the user.
    for (const [id, p] of old) if (!cur.has(id) && !tgt.has(id)) list.push(p);
    setOwn(settings, field, list);
  }
  const lessons: LocalView["lessons"] = {};
  for (const layoutId of Object.keys(view.lessons)) {
    setOwn(
      lessons,
      layoutId,
      unapplyDict(view.lessons[layoutId], getOwn(target.lessons, layoutId) || {}, getOwn(pre.lessons, layoutId) || {}),
    );
  }
  return { settings, learn: unapplyDict(view.learn, target.learn, pre.learn), lessons };
}

/** The base of a "replace" projection: defaults, plus this device's device-local settings. */
function replaceBase(view: LocalView, config: ViewConfig): LocalView {
  const base = emptyView(config);
  for (const field of config.deviceLocal) {
    const own = getOwn(view.settings, field);
    if (own !== undefined) setOwn(base.settings, field, own);
  }
  return base;
}

/**
 * Finishes a projection that was interrupted (`sc.applying` is set, see Sidecar): returns what the
 * stores must be brought to. The caller writes `projected`, takes `seen` from the stores and
 * clears the marker, exactly as after integrateRemote.
 *
 * "merge": before projecting again, edits made since the interruption are rescued. `sc.seen` is the
 * view from before the projection and `view` is whatever the stores hold now; a value that is
 * neither the old one nor the projected one was written by the user (typically in another tab,
 * which is also the tab that finds the marker) and is absorbed as an edit made now. Attempts of
 * such an edit are credited as far as the total exceeds what the document accounts for.
 *
 * What cannot be told apart, and is therefore NOT rescued: an edit that set a value to exactly what
 * the projection wanted or back to what it was before (no harm: that is the value which ends up in
 * the stores resp. loses to the projection like any older write), and attempts recorded on top of
 * a lesson total the projection had not reached yet (they may be under-counted, never over-counted).
 */
export function redoApply(sc: Sidecar, view: LocalView, now: number, config: ViewConfig): { sidecar: Sidecar; projected: LocalView } {
  if (sc.applying === "replace") {
    return { sidecar: sc, projected: projectDoc(sc.doc, replaceBase(view, config), config) };
  }
  let doc = sc.doc;
  let dirty = sc.dirty;
  if (sc.seen !== null) {
    const rest = unapply(view, projectDoc(doc, view, config), sc.seen, config);
    const next = absorbView(doc, sc.seen, rest, { now, deviceId: sc.deviceId, config, reconcileAttempts: true });
    if (!docsEqual(next, doc)) {
      doc = pruneDoc(next, now, CLIENT_TOMBSTONE_TTL_MS);
      dirty = true;
    }
  }
  return { sidecar: doc === sc.doc ? sc : { ...sc, doc, dirty }, projected: projectDoc(doc, view, config) };
}

// ---------------------------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------------------------

/**
 * Link unlinked local data to an account. The next cycle is its FIRST CONTACT (see the top of this
 * file) and merges the data into the account.
 */
export function linkSidecar(sc: Sidecar, user: { id: string; name: string }): Sidecar {
  return {
    ...sc,
    link: { userId: user.id, name: user.name, gen: null, version: 0, firstSyncDone: false, clockChecked: false },
    orphanOf: null,
    dirty: true,
    lastSyncedAt: null,
    barrier: null,
  };
}

/**
 * Forget the account; the replica and `seen` stay, so the local data lives on on this device. It
 * remembers whose it was (`orphanOf`): only that user gets it back without being asked.
 */
export function unlinkSidecar(sc: Sidecar, barrier: string | null): Sidecar {
  return { ...sc, link: null, orphanOf: localOwner(sc), dirty: false, lastSyncedAt: null, barrier };
}

/**
 * A sidecar whose replica could not be read back. The replica is rebuilt from the stores: with
 * `seen = null` the next absorb records everything they hold with the legacy stamp, and the next
 * cycle is a first contact again (so the totals in the stores are reconciled against the account
 * instead of being counted on top of it).
 *
 * The device continues under `freshDeviceId` for the reason given at resetLessonsLocal: its
 * attempt counters restart, and the old ones live on in the account.
 */
export function rebuildSidecar(sc: Sidecar, freshDeviceId: string): Sidecar {
  return {
    ...sc,
    deviceId: freshDeviceId,
    link: sc.link === null ? null : { ...sc.link, clockChecked: false },
    doc: emptyDoc(),
    seen: null,
    dirty: sc.link !== null,
    lessonsResetPending: false,
    applying: null,
  };
}

/**
 * "Use the account's data": REPLACE this device's syncable data with the account's document.
 *
 * The replica becomes the remote document and the stores become its projection onto an EMPTY view
 * (defaults, no layouts, no lessons) that keeps only this device's device-local settings. Nothing
 * of the previous replica survives, and because `seen` is taken from the stores afterwards, the
 * disappearance of the previous account's data is not an edit: it produces no tombstones and no
 * writes in the new account's document.
 *
 * The caller writes `projected` to the stores IN FULL (marker "replace") and then sets
 * `sidecar.seen` from the stores.
 */
export function adoptAccount(
  sc: Sidecar,
  view: LocalView,
  remote: RemoteState,
  now: number,
  config: ViewConfig,
  user: { id: string; name: string },
): { sidecar: Sidecar; projected: LocalView } {
  const replica = pruneDoc(remote.doc === null ? emptyDoc() : remote.doc, now, CLIENT_TOMBSTONE_TTL_MS);
  return {
    sidecar: {
      ...sc,
      link: {
        userId: user.id,
        name: user.name,
        gen: remote.gen,
        version: remote.version,
        firstSyncDone: false,
        clockChecked: true,
      },
      orphanOf: null,
      doc: replica,
      seen: null,
      dirty: false,
      lessonsResetPending: false,
      lastSyncedAt: null,
      barrier: null,
    },
    projected: projectDoc(replica, replaceBase(view, config), config),
  };
}
