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
//   link   which account the replica belongs to (null = anonymous local data)
//
// Nothing here mutates its arguments; a function that changes nothing returns the SAME object.

import {
  CLIENT_TOMBSTONE_TTL_MS,
  canonical,
  clampDocTimes,
  docsEqual,
  emptyDoc,
  getOwn,
  includesDoc,
  mergeDocs,
  pruneDoc,
  setOwn,
} from "./doc.ts";
import type { Json, SyncDoc } from "./doc.ts";
import { absorbView, emptyView, projectDoc } from "./view.ts";
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
  /** The replica's timestamps have been checked against the server clock since linking. */
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
  /** "Reset lesson progress" was used since the last absorb. */
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
}

/** What the server said: the body of a 200 (GET or PUT) or of a 409. */
export interface RemoteState {
  doc: SyncDoc | null;
  version: number;
  gen: string | null;
  serverTime: number;
}

/** How far ahead of the server clock a replica timestamp may be before the first push. */
export const CLOCK_SLACK_MS = 5 * 60 * 1000;

export function sameView(a: LocalView, b: LocalView): boolean {
  return canonical(a as unknown as Json) === canonical(b as unknown as Json);
}

/**
 * Stamps the local edits (the difference between `view` and `sc.seen`) into the replica.
 * Returns `sc` itself when there is nothing to absorb.
 *
 * Lesson reset: while the device is LINKED, the reset bumps the lessons epoch, which erases the
 * results in the account and (through merge) on every other device of that account. While the
 * device is ANONYMOUS the reset only empties this replica: an epoch stamped "now" by a device that
 * never synced would otherwise wipe the lesson progress of whatever account the device signs in to
 * later, although the user only meant to reset this browser. The replica of an anonymous device
 * has no other reader, so rewriting it non-monotonically is safe.
 */
export function absorbLocal(sc: Sidecar, view: LocalView, now: number, config: ViewConfig): Sidecar {
  let doc = sc.doc;
  let seen = sc.seen;
  let epochReset = sc.lessonsResetPending;
  if (sc.lessonsResetPending && sc.link === null) {
    doc = {
      schema: doc.schema,
      settings: doc.settings,
      learn: doc.learn,
      layouts: doc.layouts,
      lessons: { epoch: doc.lessons.epoch, by: {} },
    };
    if (seen !== null) seen = { settings: seen.settings, learn: seen.learn, lessons: {} };
    epochReset = false;
  }
  if (!sc.lessonsResetPending && seen !== null && sameView(seen, view)) return sc;
  const next = absorbView(doc, seen, view, { now, deviceId: sc.deviceId, config, lessonsReset: epochReset });
  const changed = !docsEqual(next, sc.doc);
  return {
    v: 1,
    deviceId: sc.deviceId,
    link: sc.link,
    doc: changed ? next : sc.doc,
    seen: view,
    dirty: sc.dirty || changed,
    lessonsResetPending: false,
    lastSyncedAt: sc.lastSyncedAt,
    serverOffset: sc.serverOffset,
    barrier: sc.barrier,
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
 * One merge step of a sync cycle (design step 5), given a fresh server state:
 * absorb local edits, join with the remote document, decide whether the server lacks anything.
 *
 * `projected` is what the stores should hold afterwards. The caller writes it to the stores,
 * re-reads the stores and stores THAT as `sidecar.seen` (the `seen` returned here is the view from
 * before the projection and must be replaced).
 *
 * Precondition: `sc.link !== null` and `!isRemoteDeleted(sc.link, remote)`.
 */
export function integrateRemote(
  sc: Sidecar,
  view: LocalView,
  remote: RemoteState,
  now: number,
  config: ViewConfig,
): { sidecar: Sidecar; projected: LocalView; needPush: boolean } {
  const link = sc.link as SyncLink;
  let base = sc;
  if (!link.clockChecked) {
    // First contact with the server since linking: timestamps this device wrote while its clock was
    // unverified must not be (far) in the server's future, or the server rejects the whole
    // document. Done ONCE per link and before anything of this replica reached this account:
    // clamping is not a lattice operation.
    base = { ...sc, doc: clampDocTimes(sc.doc, remote.serverTime + CLOCK_SLACK_MS) };
  }
  const absorbed = absorbLocal(base, view, now, config);
  const remoteDoc = pruneDoc(remote.doc === null ? emptyDoc() : remote.doc, now, CLIENT_TOMBSTONE_TTL_MS);
  const merged = pruneDoc(mergeDocs(absorbed.doc, remoteDoc), now, CLIENT_TOMBSTONE_TTL_MS);
  const needPush = !includesDoc(remoteDoc, merged);
  const projected = projectDoc(merged, view, config);
  return {
    sidecar: {
      v: 1,
      deviceId: sc.deviceId,
      link: { ...link, gen: remote.gen, version: remote.version, clockChecked: true },
      doc: merged,
      seen: view,
      dirty: needPush,
      lessonsResetPending: false,
      lastSyncedAt: sc.lastSyncedAt,
      serverOffset: sc.serverOffset,
      barrier: sc.barrier,
    },
    projected,
    needPush,
  };
}

/** Link anonymous local data to an account. The next cycle merges it into the account. */
export function linkSidecar(sc: Sidecar, user: { id: string; name: string }): Sidecar {
  return {
    ...sc,
    link: { userId: user.id, name: user.name, gen: null, version: 0, firstSyncDone: false, clockChecked: false },
    dirty: true,
    lastSyncedAt: null,
    barrier: null,
  };
}

/** Forget the account; the replica and `seen` stay, so the local data lives on as anonymous data. */
export function unlinkSidecar(sc: Sidecar, barrier: string | null): Sidecar {
  return { ...sc, link: null, dirty: false, lastSyncedAt: null, barrier };
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
 * The caller writes `projected` to the stores IN FULL and then sets `sidecar.seen` from the stores.
 */
export function adoptAccount(
  sc: Sidecar,
  view: LocalView,
  remote: RemoteState,
  now: number,
  config: ViewConfig,
  user: { id: string; name: string },
): { sidecar: Sidecar; projected: LocalView } {
  const base = emptyView(config);
  for (const field of config.deviceLocal) {
    const own = getOwn(view.settings, field);
    if (own !== undefined) setOwn(base.settings, field, own);
  }
  const replica = pruneDoc(remote.doc === null ? emptyDoc() : remote.doc, now, CLIENT_TOMBSTONE_TTL_MS);
  return {
    sidecar: {
      v: 1,
      deviceId: sc.deviceId,
      link: {
        userId: user.id,
        name: user.name,
        gen: remote.gen,
        version: remote.version,
        firstSyncDone: false,
        clockChecked: true,
      },
      doc: replica,
      seen: null,
      dirty: false,
      lessonsResetPending: false,
      lastSyncedAt: null,
      serverOffset: sc.serverOffset,
      barrier: null,
    },
    projected: projectDoc(replica, base, config),
  };
}
