"use client";
// The client sync engine: keeps this device's replica (lib/sync/doc.ts) in step with the app's
// localStorage stores and, while signed in, with the account's copy on the server.
//
// Two jobs, deliberately separate:
//
//   TRACKING (whenever the feature is on, signed in or not; purely local)
//     Store changes are absorbed into the replica (debounced) together with a new `seen` snapshot.
//     This is what gives every local edit a timestamp, deletions a tombstone and lesson attempts a
//     per-device counter, so that the data can be merged later, e.g. on the first sign-in.
//
//   SYNC CYCLES (only signed in, linked to that account, no account mismatch pending)
//     absorb -> GET -> merge -> project to the stores -> PUT if (and only if) the server lacks
//     something. The transitions themselves are the pure functions in lib/sync/cycle.ts.
//
// CROSS-ACCOUNT SAFETY INVARIANT
//   A request is only sent, and its result is only applied, if AT THAT MOMENT
//     (1) the signed-in user id equals the id the request was started for, and the account store
//         confirms the session is current (no sign-in / sign-out in any tab since it was checked),
//     (2) the sidecar in localStorage still has the device id and the link (`link.userId`) the
//         request was started with, and
//     (3) the in-memory session epoch is unchanged (it is bumped by every sign-in, sign-out, user
//         switch, "Clear all data", unlink and mismatch resolution in this tab).
//   Every request goes through `api()`, which checks this before sending and again after the
//   response arrived, and answers "stale" otherwise; every synchronous section that applies a
//   response re-reads the sidecar and checks again (`stillValid`). Consequences: a response for
//   account A is never merged into data linked to account B; nothing is uploaded while the link
//   and the signed-in user disagree (phase "mismatch"); and a response that arrives after "Clear
//   all data" cannot bring the old replica, link or remote data back.
//
// RULES THE CODE FOLLOWS
//   - The sidecar is shared by all tabs. It is re-read from localStorage at the start of every
//     synchronous critical section and written back before yielding; no copy survives an `await`.
//   - Nothing here throws into React or blocks the UI; every listener and timer body is guarded.
//   - Local edits are never lost to a slow request: the merge step always re-reads the stores and
//     absorbs before merging, and "is there something to push" is decided by `includesDoc`.
import { useSyncExternalStore } from "react";
import {
  getAccount,
  getSignOutReason,
  refreshSession,
  sessionIsCurrent,
  sessionStamp,
  setSignOutFlush,
  signInWith,
  signOutAccount,
  subscribeAccount,
} from "@/lib/auth/client";
import type { PublicAuthConfig } from "@/lib/auth/types";
import {
  absorbLocal,
  adoptAccount,
  integrateRemote,
  isRemoteDeleted,
  linkSidecar,
  unlinkSidecar,
  type RemoteState,
  type Sidecar,
} from "./cycle";
import { clampDocTimes, emptyDoc, validateDoc, type SyncDoc } from "./doc";
import { DATA_CLEARED_EVENT, LESSONS_RESET_EVENT, getViewConfig, readView, subscribeStores, writeView } from "./local";
import { SIDECAR_KEY, newSidecar, rawSidecar, readSidecar, writeSidecar } from "./meta";

export type SyncPhase = "disabled" | "signed-out" | "idle" | "syncing" | "synced" | "offline" | "error" | "mismatch";

export interface SyncStatus {
  phase: SyncPhase;
  /** Local changes not yet confirmed by the server. */
  pending: boolean;
  /** Epoch ms of the last successful round trip (persisted). */
  lastSyncedAt: number | null;
  error: null | { code: string; message: string; retryAt: number | null };
  /** Set while phase === "mismatch". */
  mismatch: null | { localAccountName: string | null; hasUnsyncedLocalChanges: boolean };
}

export type SyncEvent = "first-sync" | "remote-deleted" | "device-cleared" | "session-expired";

const ABSORB_DEBOUNCE_MS = 400;
const ABSORB_MAX_WAIT_MS = 2_000;
const PUSH_DELAY_MS = 1_100; // after the absorb: ~1.5 s after the last local change
const POLL_MS = 60_000;
const FOCUS_THROTTLE_MS = 5_000;
const REQUEST_TIMEOUT_MS = 15_000;
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const MAX_ROUNDS = 5;
const LOCK_NAME = "ll-sync";

const DISABLED: SyncStatus = { phase: "disabled", pending: false, lastSyncedAt: null, error: null, mismatch: null };
const SIGNED_OUT: SyncStatus = { phase: "signed-out", pending: false, lastSyncedAt: null, error: null, mismatch: null };

let config: PublicAuthConfig | null = null;
let base: SyncStatus = DISABLED;
let status: SyncStatus = DISABLED;
let started = false;

const listeners = new Set<() => void>();
const eventListeners = new Set<(e: SyncEvent) => void>();
const eventLog: { event: SyncEvent; at: number }[] = [];

/** Session epoch, part (3) of the invariant above. */
let epoch = 0;
let lastUserId: string | null = null;
/** Identifies the syncable situation (user + device + link); a cycle is kicked when it changes. */
let syncableKey: string | null = null;

let absorbTimer: ReturnType<typeof setTimeout> | null = null;
let absorbFirstAt = 0;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let evalTimer: ReturnType<typeof setTimeout> | null = null;
let backoffIndex = 0;
/** The last cycle failed in a way that retrying by itself cannot fix (400 / 403 / 413 ...). */
let hardError = false;
let lastFocusSyncAt = 0;
let running: Promise<void> | null = null;
let rerun = false;
let lockChain: Promise<unknown> = Promise.resolve();
const inFlight = new Set<AbortController>();

// ---------------------------------------------------------------------------------------------
// Status store and events
// ---------------------------------------------------------------------------------------------

function setStatus(patch: Partial<SyncStatus>): void {
  const next: SyncStatus = { ...status, ...patch };
  const a = status;
  if (
    a.phase === next.phase &&
    a.pending === next.pending &&
    a.lastSyncedAt === next.lastSyncedAt &&
    JSON.stringify(a.error) === JSON.stringify(next.error) &&
    JSON.stringify(a.mismatch) === JSON.stringify(next.mismatch)
  ) {
    return;
  }
  status = next;
  try {
    document.documentElement.dataset.sync = next.phase;
  } catch {
    /* ignore */
  }
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      /* a listener must not break the engine */
    }
  }
}

function emit(event: SyncEvent): void {
  eventLog.push({ event, at: Date.now() });
  if (eventLog.length > 50) eventLog.shift();
  for (const l of [...eventListeners]) {
    try {
      l(event);
    } catch {
      /* ignore */
    }
  }
}

/** Wraps a listener / timer body: the engine never throws into the page. */
function guarded<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A) => {
    try {
      fn(...args);
    } catch {
      /* keep the app running; the next trigger tries again */
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Sidecar access
// ---------------------------------------------------------------------------------------------

function storageFailed(): null {
  setStatus({
    phase: "error",
    error: { code: "storage", message: "Sync needs browser storage", retryAt: null },
  });
  return null;
}

/** The sidecar as stored right now; created if absent or unusable. Null: storage does not work. */
function load(): Sidecar | null {
  const read = readSidecar();
  if (read.ok === false) return storageFailed();
  if (read.sidecar !== null) return read.sidecar;
  // Absent (first run, cleared by another tab or by hand) or unusable. If this tab is signed in,
  // the session that was current when the data vanished must not pull it back (see `barrier`).
  const fresh = newSidecar(sessionStamp());
  return writeSidecar(fresh) ? fresh : storageFailed();
}

function save(sc: Sidecar): boolean {
  if (writeSidecar(sc)) return true;
  storageFailed();
  return false;
}

/** Timestamps are taken from the server's clock once its offset is known. */
function nowFor(sc: Sidecar): number {
  return Date.now() + (sc.serverOffset ?? 0);
}

function reflect(sc: Sidecar): void {
  const patch: Partial<SyncStatus> = { pending: sc.link !== null && sc.dirty, lastSyncedAt: sc.lastSyncedAt };
  if (status.phase === "mismatch" && sc.link !== null) {
    patch.mismatch = { localAccountName: sc.link.name, hasUnsyncedLocalChanges: sc.dirty };
  }
  setStatus(patch);
}

// ---------------------------------------------------------------------------------------------
// Tracking: stores -> replica
// ---------------------------------------------------------------------------------------------

/** One synchronous block: read sidecar, read the stores, absorb, write the sidecar. */
function absorbNow(): Sidecar | null {
  const sc = load();
  if (sc === null) return null;
  const next = absorbLocal(sc, readView(), nowFor(sc), getViewConfig());
  if (next !== sc && !save(next)) return null;
  reflect(next);
  return next;
}

function scheduleAbsorb(): void {
  const now = Date.now();
  if (absorbTimer === null) absorbFirstAt = now;
  else clearTimeout(absorbTimer);
  // Debounced, so that a burst of store writes is seen as ONE change: "Reset settings" empties the
  // custom layouts and restores them within one tick, which must not produce tombstones.
  const wait = Math.max(0, Math.min(ABSORB_DEBOUNCE_MS, absorbFirstAt + ABSORB_MAX_WAIT_MS - now));
  absorbTimer = setTimeout(
    guarded(() => {
      absorbTimer = null;
      const sc = absorbNow();
      if (sc !== null && sc.dirty && canSync(sc)) schedulePush();
    }),
    wait,
  );
}

function schedulePush(): void {
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(
    guarded(() => {
      pushTimer = null;
      // Another tab may have pushed the same change in the meantime (the sidecar is shared).
      const sc = currentSidecar();
      if (sc !== null && sc.dirty && canSync(sc)) void requestCycle();
    }),
    PUSH_DELAY_MS,
  );
}

function cancelTimers(): void {
  for (const t of [absorbTimer, pushTimer, retryTimer]) if (t !== null) clearTimeout(t);
  absorbTimer = pushTimer = retryTimer = null;
}

// ---------------------------------------------------------------------------------------------
// Who may sync
// ---------------------------------------------------------------------------------------------

function signedInUser(): { id: string; name: string } | null {
  const account = getAccount();
  return account.status === "signed-in" && account.user ? account.user : null;
}

function canSync(sc: Sidecar): boolean {
  const user = signedInUser();
  return user !== null && sc.link !== null && sc.link.userId === user.id;
}

interface Ctx {
  epoch: number;
  /** The signed-in user the work was started for. */
  userId: string;
  deviceId: string;
  /** `link.userId` of the sidecar when the work started (differs from userId only for "use-account"). */
  linkUserId: string | null;
}

function capture(sc: Sidecar, userId: string): Ctx {
  return { epoch, userId, deviceId: sc.deviceId, linkUserId: sc.link ? sc.link.userId : null };
}

/** The invariant from the header, against the sidecar `sc` that was JUST read from localStorage. */
function stillValid(ctx: Ctx, sc: Sidecar | null): sc is Sidecar {
  if (sc === null || ctx.epoch !== epoch) return false;
  const user = signedInUser();
  if (user === null || user.id !== ctx.userId) return false;
  if (sc.deviceId !== ctx.deviceId) return false;
  if ((sc.link ? sc.link.userId : null) !== ctx.linkUserId) return false;
  return sessionIsCurrent();
}

function currentSidecar(): Sidecar | null {
  const read = readSidecar();
  return read.ok ? read.sidecar : null;
}

function bumpEpoch(): void {
  epoch++;
  for (const a of inFlight) a.abort();
  inFlight.clear();
}

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------

type ApiResult =
  | { kind: "ok"; remote: RemoteState; receivedAt: number }
  | { kind: "conflict"; remote: RemoteState; receivedAt: number }
  | { kind: "done" } // DELETE succeeded
  | { kind: "stale" }
  | { kind: "network" }
  | { kind: "bad" }
  | { kind: "http"; status: number; error: string; detail: string; retryAfter: number | null };

function parseRemote(body: unknown): RemoteState | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { doc?: unknown; version?: unknown; gen?: unknown; serverTime?: unknown };
  if (typeof b.version !== "number" || !Number.isSafeInteger(b.version) || b.version < 0) return null;
  if (b.gen !== null && (typeof b.gen !== "string" || b.gen === "" || b.gen.length > 64)) return null;
  if (typeof b.serverTime !== "number" || !Number.isFinite(b.serverTime)) return null;
  let doc: SyncDoc | null = null;
  if (b.doc !== null && b.doc !== undefined) {
    // The server is trusted about WHO the data belongs to, not about its shape.
    const checked = validateDoc(b.doc, { now: 0, maxFutureMs: Number.MAX_SAFE_INTEGER });
    if (checked.ok === false) return null;
    doc = checked.doc;
  }
  return { doc, version: b.version, gen: b.gen as string | null, serverTime: b.serverTime };
}

/** The ONLY place that talks to /api/sync. Enforces the cross-account invariant on both sides. */
async function api(ctx: Ctx, method: "GET" | "PUT" | "DELETE", body?: unknown): Promise<ApiResult> {
  if (!stillValid(ctx, currentSidecar())) return { kind: "stale" };
  const abort = new AbortController();
  inFlight.add(abort);
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  let parsed: unknown = null;
  try {
    res = await fetch("/api/sync", {
      method,
      // X-LL-User: the server rejects (401) when the cookie belongs to a different account than this tab believes.
      headers:
        body === undefined
          ? { "X-LL-Sync": "1", "X-LL-User": ctx.userId }
          : { "X-LL-Sync": "1", "X-LL-User": ctx.userId, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: abort.signal,
    });
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
  } catch {
    return stillValid(ctx, currentSidecar()) ? { kind: "network" } : { kind: "stale" };
  } finally {
    clearTimeout(timer);
    inFlight.delete(abort);
  }
  const receivedAt = Date.now();
  if (!stillValid(ctx, currentSidecar())) return { kind: "stale" };

  if (res.status === 200 && method === "DELETE") return { kind: "done" };
  if (res.status === 200 || res.status === 409) {
    const remote = parseRemote(parsed);
    if (remote === null) return { kind: "bad" };
    return { kind: res.status === 200 ? "ok" : "conflict", remote, receivedAt };
  }
  const b = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { error?: unknown; detail?: unknown };
  const retryAfter = Number(res.headers.get("Retry-After"));
  return {
    kind: "http",
    status: res.status,
    error: typeof b.error === "string" ? b.error : "",
    detail: typeof b.detail === "string" ? b.detail : "",
    retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
}

// ---------------------------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------------------------

function scheduleRetry(delayMs: number): number {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = setTimeout(
    guarded(() => {
      retryTimer = null;
      void requestCycle();
    }),
    delayMs,
  );
  return Date.now() + delayMs;
}

function backoffDelay(): number {
  const delay = BACKOFF_MS[Math.min(backoffIndex, BACKOFF_MS.length - 1)];
  backoffIndex++;
  return Math.round(delay * (0.8 + Math.random() * 0.4));
}

function transient(phase: "offline" | "error", code: string, message: string, delayMs: number): void {
  setStatus({ phase, error: { code, message, retryAt: scheduleRetry(delayMs) } });
}

/** An error that retrying alone cannot fix: no timer. The next local change, focus or syncNow() tries again. */
function hard(code: string, message: string): void {
  hardError = true;
  setStatus({ phase: "error", error: { code, message, retryAt: null } });
}

const offline = () => typeof navigator !== "undefined" && navigator.onLine === false;

async function fail(ctx: Ctx, r: ApiResult, clockRetried = false): Promise<void> {
  if (ctx.epoch !== epoch) return; // the situation changed; whoever changed it set the phase
  switch (r.kind) {
    case "stale":
      // The session is being re-verified (or another tab moved on). Not an error: look again soon.
      setStatus({ phase: "idle", error: null });
      scheduleRetry(4_000);
      return;
    case "network":
      transient("offline", "network", "Can't reach the server", backoffDelay());
      return;
    case "bad":
      hard("bad_response", "Unexpected response from the server");
      return;
    case "http":
      break;
    default:
      return;
  }
  if (r.status === 401) {
    setStatus({ phase: "idle", error: null });
    await refreshSession();
    if (ctx.epoch !== epoch) return; // signed out: onAccountChange emitted "session-expired"
    if (signedInUser() !== null) hard("unauthorized", "Session expired");
    return;
  }
  if (r.status === 429) {
    const seconds = Math.min(3_600, Math.max(1, r.retryAfter ?? 30));
    transient("error", "rate_limited", "Too many requests", seconds * 1000 + Math.round(Math.random() * 1000));
    return;
  }
  if (r.status >= 500) {
    transient(
      offline() ? "offline" : "error",
      r.status === 503 ? "unavailable" : "server",
      r.status === 503 ? "Sync is temporarily unavailable" : "The server had a problem",
      backoffDelay(),
    );
    return;
  }
  if (r.status === 413) return hard("too_large", "Account data is too large to sync");
  if (r.status === 400 && r.error === "invalid_document" && clockRetried && /future/.test(r.detail)) {
    return hard("clock", "This device's clock looks wrong");
  }
  if (r.status === 400) return hard("rejected", "Sync data was rejected");
  if (r.status === 403) return hard("forbidden", "Sync request was refused");
  if (r.status === 404) return hard("unavailable", "Sync is not available");
  return hard("http_" + r.status, "Sync failed");
}

// ---------------------------------------------------------------------------------------------
// The sync cycle
// ---------------------------------------------------------------------------------------------

/** Serialises cycles: across tabs with the Web Locks API, within the tab with a promise chain. */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (locks && typeof locks.request === "function") {
      return locks.request(LOCK_NAME, () => fn()) as Promise<T>;
    }
    return fn();
  };
  const result = lockChain.then(run, run);
  lockChain = result.catch(() => {});
  return result;
}

type Applied = "stale" | "deleted" | "concurrent" | { needPush: boolean; version: number; gen: string | null; doc: SyncDoc };

/**
 * Design step 3 + 5 as ONE synchronous block: re-read the sidecar, check the invariant, detect
 * "deleted elsewhere", absorb, merge, project to the stores, take `seen` from the stores, write
 * the sidecar.
 */
function applyRemote(ctx: Ctx, r: { remote: RemoteState; receivedAt: number }, sent: { gen: string | null; version: number }): Applied {
  const sc = currentSidecar();
  if (!stillValid(ctx, sc) || sc.link === null) return "stale";
  // Another tab advanced the link while this request was in flight (only possible without Web
  // Locks): this response describes an older server state. Do not judge anything by it.
  if (sc.link.gen !== sent.gen || sc.link.version !== sent.version) return "concurrent";
  const remote = r.remote;
  if (isRemoteDeleted(sc.link, remote)) {
    // The account's data was erased from another device. This device keeps its data as anonymous
    // local data and signs out; it must NOT upload (that would re-create what the user deleted).
    if (!save(unlinkSidecar(sc, sessionStamp()))) return "stale";
    bumpEpoch();
    syncableKey = null;
    emit("remote-deleted");
    void signOutAccount({ skipFlush: true });
    return "deleted";
  }
  const serverOffset = remote.serverTime - r.receivedAt;
  const now = Date.now() + serverOffset;
  const view = readView();
  const out = integrateRemote({ ...sc, serverOffset }, view, remote, now, getViewConfig());
  writeView(out.projected, view);
  // `seen` is what the stores actually hold now (they may have normalised or refused a value).
  const next: Sidecar = { ...out.sidecar, seen: readView() };
  if (!save(next)) return "stale";
  reflect(next);
  const link = next.link as NonNullable<Sidecar["link"]>;
  return { needPush: out.needPush, version: link.version, gen: link.gen, doc: next.doc };
}

async function cycle(): Promise<void> {
  const user = signedInUser();
  const first = load();
  if (user === null || first === null || !canSync(first)) return;
  const ctx = capture(first, user.id);
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
  setStatus({ phase: "syncing" });
  if (absorbNow() === null) return;

  let server: { remote: RemoteState; receivedAt: number } | null = null;
  let sent = { gen: null as string | null, version: 0 };
  let clockRetried = false;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (server === null) {
      const before = currentSidecar();
      if (!stillValid(ctx, before) || before.link === null) return fail(ctx, { kind: "stale" });
      sent = { gen: before.link.gen, version: before.link.version };
      const got = await api(ctx, "GET");
      if (got.kind !== "ok") return fail(ctx, got);
      server = got;
    }

    const applied = applyRemote(ctx, server, sent);
    if (applied === "deleted") return;
    if (applied === "stale") return fail(ctx, { kind: "stale" });
    if (applied === "concurrent") {
      server = null;
      continue;
    }
    if (!applied.needPush) return succeed(ctx);

    // The server lacks something: push the whole replica. Never reached when nothing is missing,
    // so an idle signed-in tab only ever makes GETs (no version churn).
    sent = { gen: applied.gen, version: applied.version };
    const put = await api(ctx, "PUT", { baseVersion: applied.version, gen: applied.gen, doc: applied.doc });
    if (put.kind === "ok" || put.kind === "conflict") {
      // 200: the body is the server-side join. 409: the body is the current server state. Either
      // way it is the newest server state; merge it and look again.
      server = put;
      continue;
    }
    if (put.kind === "http" && put.status === 400 && put.error === "invalid_document" && /future/.test(put.detail) && !clockRetried) {
      // The replica carries timestamps the server considers to be in the future (this device's
      // clock changed after the offset was learned). Clamp ONCE to the server's time and retry.
      clockRetried = true;
      const fresh = await api(ctx, "GET");
      if (fresh.kind !== "ok") return fail(ctx, fresh);
      const sc = currentSidecar();
      if (!stillValid(ctx, sc) || sc.link === null) return fail(ctx, { kind: "stale" });
      sent = { gen: sc.link.gen, version: sc.link.version };
      const serverOffset = fresh.remote.serverTime - fresh.receivedAt;
      if (!save({ ...sc, serverOffset, doc: clampDocTimes(sc.doc, fresh.remote.serverTime), dirty: true })) return;
      server = fresh;
      continue;
    }
    return fail(ctx, put, clockRetried);
  }
  // Still not settled after several rounds: another device keeps writing. Try again shortly.
  if (ctx.epoch === epoch) transient("error", "busy", "Sync is busy, retrying", backoffDelay());
}

function succeed(ctx: Ctx): void {
  const sc = currentSidecar();
  if (!stillValid(ctx, sc) || sc.link === null) {
    void fail(ctx, { kind: "stale" });
    return;
  }
  const firstSync = !sc.link.firstSyncDone;
  const next: Sidecar = { ...sc, lastSyncedAt: Date.now(), link: { ...sc.link, firstSyncDone: true } };
  if (!save(next)) return;
  backoffIndex = 0;
  hardError = false;
  setStatus({ phase: "synced", error: null, pending: next.dirty, lastSyncedAt: next.lastSyncedAt });
  if (firstSync) emit("first-sync");
}

/** Runs a cycle, or asks the running one to go round once more. At most one per tab. */
function requestCycle(): Promise<void> {
  if (!started) return Promise.resolve();
  if (running !== null) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      for (let i = 0; i < 3; i++) {
        rerun = false;
        await withLock(cycle);
        if (!rerun) break;
      }
    } catch {
      // A bug or an unexpected browser error must not escape; report it and try again later.
      try {
        transient("error", "internal", "Sync hit a problem, retrying", backoffDelay());
      } catch {
        /* ignore */
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

// ---------------------------------------------------------------------------------------------
// Linking: which account does the local data belong to
// ---------------------------------------------------------------------------------------------

/**
 * Brings the phase in line with (account state, sidecar). Called on start, on every account
 * change and when another tab changed the sidecar. Kicks a cycle when the device BECOMES syncable.
 */
function evaluate(): boolean {
  if (!started) return false;
  if (evalTimer !== null) clearTimeout(evalTimer);
  evalTimer = null;
  const account = getAccount();
  const user = signedInUser();
  const userId = user ? user.id : null;
  if (userId !== lastUserId) {
    const signedOut = lastUserId !== null && userId === null;
    lastUserId = userId;
    bumpEpoch();
    if (signedOut && getSignOutReason() === "expired") emit("session-expired");
  }

  let sc = absorbNow();
  if (sc === null) return false;

  if (user === null) {
    syncableKey = null;
    if (pushTimer !== null) clearTimeout(pushTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    pushTimer = retryTimer = null;
    setStatus({
      phase: account.status === "loading" ? (offline() ? "offline" : "idle") : "signed-out",
      error: null,
      mismatch: null,
    });
    return false;
  }

  if (!sessionIsCurrent()) {
    // Signed in as far as this tab knows, but a sign-in / sign-out is under way somewhere (the
    // account store is re-checking). Decide nothing until it is confirmed.
    syncableKey = null;
    setStatus({ phase: "idle", error: null, mismatch: null });
    evalTimer = setTimeout(guarded(() => void evaluate()), 4_000);
    return false;
  }

  if (sc.link === null && sc.barrier !== null && sc.barrier === sessionStamp()) {
    // This very session was ended for this device (data cleared, or the account's data deleted)
    // by another tab. Do not link again: finish the sign-out here as well.
    syncableKey = null;
    void signOutAccount({ skipFlush: true });
    return false;
  }

  if (sc.link === null) {
    // Anonymous local data (or a brand-new device): it joins the account on the next cycle.
    sc = linkSidecar(sc, user);
    if (!save(sc)) return false;
  } else if (sc.link.userId !== user.id) {
    // The local data belongs to ANOTHER account. Nothing is synced in either direction until the
    // user decides (resolveMismatch). Derived from persisted state, so it survives a reload.
    syncableKey = null;
    if (pushTimer !== null) clearTimeout(pushTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
    pushTimer = retryTimer = null;
    setStatus({
      phase: "mismatch",
      error: status.phase === "mismatch" ? status.error : null,
      mismatch: { localAccountName: sc.link.name, hasUnsyncedLocalChanges: sc.dirty },
      pending: sc.dirty,
    });
    return false;
  } else if (sc.link.name !== user.name) {
    sc = { ...sc, link: { ...sc.link, name: user.name } };
    if (!save(sc)) return false;
  }

  const key = `${user.id}|${sc.deviceId}`;
  if (key !== syncableKey) {
    syncableKey = key;
    backoffIndex = 0;
    hardError = false;
    setStatus({ phase: "idle", error: null, mismatch: null });
    reflect(sc);
    void requestCycle();
    return true;
  }
  if (status.phase === "mismatch" || status.phase === "signed-out") setStatus({ phase: "idle", error: null, mismatch: null });
  reflect(sc);
  return false;
}

// ---------------------------------------------------------------------------------------------
// Browser events
// ---------------------------------------------------------------------------------------------

function trigger(opts: { allowHardError: boolean }): void {
  const sc = currentSidecar();
  if (sc === null || !canSync(sc)) return;
  if (hardError && !opts.allowHardError) return;
  void requestCycle();
}

// A local change is also one of the occasions on which a hard error is retried: the replica stays
// dirty while the error lasts, so the absorb that follows schedules a push.
const onStoreChange = guarded(() => scheduleAbsorb());

const onLessonsReset = guarded(() => {
  const sc = load();
  if (sc === null) return;
  // Consumed by the next absorb. While linked, that bumps the lessons epoch, so the reset
  // propagates to the account and to every other device of it (see absorbLocal in cycle.ts).
  save({ ...sc, lessonsResetPending: true });
  scheduleAbsorb();
});

/**
 * "Clear all data" removed every ll:v1:* key, the sidecar and the sign-in hint included. Clearing
 * a device also signs it out; the account's data on the server is untouched. Start over with a
 * fresh device id, so that nothing of the old replica can come back.
 */
function startOver(thisTab: boolean): void {
  const wasSignedIn = getAccount().status === "signed-in" || getAccount().status === "loading";
  const stamp = sessionStamp();
  bumpEpoch(); // any response still in flight is now stale
  cancelTimers();
  syncableKey = null;
  hardError = false;
  backoffIndex = 0;
  if (thisTab) {
    // Unconditionally a NEW sidecar (new device id, empty replica, seen = null), carrying the
    // barrier against the session that was just ended.
    if (!save(newSidecar(stamp))) return;
    if (wasSignedIn) {
      emit("device-cleared");
      void signOutAccount({ skipFlush: true });
    }
  }
  // In another tab: `load()` (inside evaluate) picks up the clearing tab's new sidecar, or makes
  // one with this tab's own barrier if that has not arrived yet.
  evaluate();
}

const onDataCleared = guarded(() => startOver(true));

const onStorage = guarded((e: StorageEvent) => {
  if (e.storageArea !== null && e.storageArea !== window.localStorage) return;
  if (e.key !== null && e.key !== SIDECAR_KEY) return;
  if (e.key === null || e.newValue === null) {
    // Another tab cleared all data (that tab signs out; the hint going away tells our account store).
    startOver(false);
    return;
  }
  const before = status.lastSyncedAt;
  evaluate();
  const sc = currentSidecar();
  if (sc === null) return;
  // Another tab completed a cycle: this tab is as synced as that one.
  if (
    canSync(sc) &&
    sc.lastSyncedAt !== null &&
    sc.lastSyncedAt !== before &&
    running === null &&
    (status.phase === "idle" || status.phase === "error" || status.phase === "offline" || status.phase === "synced")
  ) {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
    backoffIndex = 0;
    hardError = false;
    setStatus({ phase: "synced", error: null });
  }
});

const onAttention = guarded(() => {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastFocusSyncAt < FOCUS_THROTTLE_MS) return;
  lastFocusSyncAt = now;
  trigger({ allowHardError: true });
});

const onHidden = guarded(() => {
  if (document.visibilityState !== "hidden") return;
  flushLocal();
});

/** Absorb NOW (the page may be going away). Local only: no request is made here. */
function flushLocal(): void {
  if (absorbTimer !== null) clearTimeout(absorbTimer);
  absorbTimer = null;
  absorbNow();
}

const onPageHide = guarded(() => flushLocal());

const onOnline = guarded(() => {
  backoffIndex = 0;
  trigger({ allowHardError: false });
});

const onPoll = guarded(() => {
  if (document.visibilityState !== "visible") return; // no polling in hidden tabs
  if (retryTimer !== null) return; // a retry is already scheduled
  const sc = currentSidecar();
  // Another tab of this browser synced recently and nothing is pending here: let it do the polling.
  if (sc !== null && !sc.dirty && sc.lastSyncedAt !== null && Date.now() - sc.lastSyncedAt < POLL_MS * 0.75) return;
  trigger({ allowHardError: false });
});

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

/** Sets the configuration without starting anything. Safe during render and on the server. */
export function primeSync(next: PublicAuthConfig): void {
  if (started) return;
  config = next;
  const nextBase = next.enabled ? SIGNED_OUT : DISABLED;
  if (nextBase !== base) {
    base = nextBase;
    status = nextBase;
  }
}

/** Starts the engine in the browser and wires it to the account store. Idempotent; inert when the feature is off. */
export function initSync(next: PublicAuthConfig): void {
  primeSync(next);
  if (started || typeof window === "undefined" || !config || !config.enabled) return;
  started = true;
  try {
    document.documentElement.dataset.sync = status.phase;
    subscribeStores(onStoreChange);
    window.addEventListener(LESSONS_RESET_EVENT, onLessonsReset);
    window.addEventListener(DATA_CLEARED_EVENT, onDataCleared);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onAttention);
    document.addEventListener("visibilitychange", onAttention);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("online", onOnline);
    setInterval(onPoll, POLL_MS);
    subscribeAccount(guarded(evaluate));
    setSignOutFlush(async () => {
      const sc = absorbNow();
      if (sc !== null && sc.dirty && canSync(sc)) await requestCycle();
    });
    if (process.env.NODE_ENV !== "production") installDebugHook();
    evaluate();
  } catch {
    /* the app works without sync */
  }
}

export function getSyncStatus(): SyncStatus {
  return status;
}

function subscribeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getServerSnapshot = () => base;

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeStatus, getSyncStatus, getServerSnapshot);
}

export function onSyncEvent(listener: (e: SyncEvent) => void): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

/** User-triggered sync: forgets the backoff and any hard error, then runs a cycle. */
export async function syncNow(): Promise<void> {
  if (!started) return;
  try {
    backoffIndex = 0;
    hardError = false;
    const kicked = evaluate();
    const sc = currentSidecar();
    if (sc === null || !canSync(sc)) return;
    if (running !== null && !kicked) rerun = true; // one more full round after the one in flight
    await requestCycle();
  } catch {
    /* never throws */
  }
}

/**
 * Decides what happens when the signed-in account differs from the account the local data belongs
 * to (phase "mismatch"):
 *   "merge"        the local data joins the signed-in account;
 *   "use-account"  the local data is REPLACED by the signed-in account's data;
 *   "cancel"       sign out again; link and local data stay as they are.
 */
export async function resolveMismatch(choice: "merge" | "use-account" | "cancel"): Promise<void> {
  if (!started) return;
  try {
    const user = signedInUser();
    const sc = absorbNow();
    if (user === null || sc === null || sc.link === null || sc.link.userId === user.id) return;

    if (choice === "cancel") {
      await signOutAccount({ skipFlush: true });
      return;
    }

    if (choice === "merge") {
      if (!sessionIsCurrent()) return;
      bumpEpoch();
      if (!save(linkSidecar(sc, user))) return;
      if (!evaluate()) void requestCycle();
      if (running !== null) await running;
      return;
    }

    // "use-account": fetch the account's document first; nothing changes locally if that fails.
    const ctx = capture(sc, user.id);
    const got = await withLock(() => api(ctx, "GET"));
    if (got.kind !== "ok") {
      if (ctx.epoch !== epoch || got.kind === "stale") return;
      setStatus({
        error: {
          code: got.kind === "network" ? "network" : "fetch_failed",
          message: got.kind === "network" ? "Can't reach the server" : "Couldn't load the account's data",
          retryAt: null,
        },
      });
      return;
    }
    // One synchronous block: replace the replica, the stores and the link together.
    const now = currentSidecar();
    if (!stillValid(ctx, now)) return;
    if (absorbTimer !== null) clearTimeout(absorbTimer);
    absorbTimer = null;
    const serverOffset = got.remote.serverTime - got.receivedAt;
    const view = readView();
    const out = adoptAccount({ ...now, serverOffset }, view, got.remote, Date.now() + serverOffset, getViewConfig(), user);
    writeView(out.projected, view);
    bumpEpoch();
    if (!save({ ...out.sidecar, seen: readView() })) return;
    if (!evaluate()) void requestCycle();
    if (running !== null) await running;
  } catch {
    /* never throws */
  }
}

/** Pretty JSON of everything that syncs, for "Export my data". Works signed out as well. */
export function exportSyncedData(): string {
  let doc: SyncDoc = emptyDoc();
  let account: { id: string; name: string } | null = null;
  try {
    if (started) {
      const sc = absorbNow();
      if (sc !== null) {
        doc = sc.doc;
        const user = signedInUser();
        if (user !== null && sc.link !== null && sc.link.userId === user.id) account = { id: user.id, name: user.name };
      }
    } else if (typeof window !== "undefined") {
      // Feature off: nothing is tracked, so build the document from the stores without storing it.
      doc = absorbLocal(newSidecar(), readView(), Date.now(), getViewConfig()).doc;
    }
  } catch {
    /* export what we have */
  }
  return JSON.stringify({ exportedAt: new Date().toISOString(), account, document: doc }, null, 2);
}

/**
 * Erases the account's data on the server, then unlinks this device (its data stays, as anonymous
 * local data) and signs out.
 */
export async function deleteAccountData(): Promise<{ ok: boolean; error?: string }> {
  if (!started) return { ok: false, error: "Sync is not available" };
  try {
    const user = signedInUser();
    const sc = absorbNow();
    if (user === null || sc === null) return { ok: false, error: "Not signed in" };
    if (sc.link !== null && sc.link.userId !== user.id) return { ok: false, error: "This device holds another account's data" };
    // Let a cycle that is in flight finish first, and take the lock for the DELETE: a first
    // upload still on the wire must not re-create the row right after it was deleted.
    if (running !== null) await running;
    if (signedInUser()?.id !== user.id) return { ok: false, error: "Not signed in" };
    bumpEpoch();
    const at = currentSidecar();
    if (at === null) return { ok: false, error: "Sync needs browser storage" };
    const ctx = capture(at, user.id);
    const result = await withLock(() => api(ctx, "DELETE"));
    if (result.kind !== "done") {
      evaluate();
      if (signedInUser() !== null) void requestCycle();
      if (result.kind === "network") return { ok: false, error: "Can't reach the server" };
      if (result.kind === "http" && result.status === 429) return { ok: false, error: "Too many requests" };
      if (result.kind === "http" && result.status === 401) {
        void refreshSession();
        return { ok: false, error: "Session expired" };
      }
      return { ok: false, error: "Couldn't delete the account data" };
    }
    const after = currentSidecar();
    if (after !== null && after.deviceId === ctx.deviceId && (after.link === null || after.link.userId === user.id)) {
      save(unlinkSidecar(after, sessionStamp()));
    }
    bumpEpoch();
    syncableKey = null;
    await signOutAccount({ skipFlush: true });
    return { ok: true };
  } catch {
    return { ok: false, error: "Couldn't delete the account data" };
  }
}

// ---------------------------------------------------------------------------------------------
// Development hook (absent from production builds): lets scripts/verify-sync.mjs drive the engine
// before the real UI exists.
// ---------------------------------------------------------------------------------------------

function installDebugHook(): void {
  (window as unknown as { __llSync?: unknown }).__llSync = {
    signIn: (name: string) => signInWith("dev", { username: name }),
    signOut: () => signOutAccount(),
    status: () => ({ account: getAccount(), sync: getSyncStatus() }),
    syncNow: () => syncNow(),
    resolve: (choice: "merge" | "use-account" | "cancel") => resolveMismatch(choice),
    sidecar: () => {
      const raw = rawSidecar();
      return raw === null ? null : JSON.parse(raw);
    },
    events: () => eventLog.map((e) => e.event),
    exportData: () => exportSyncedData(),
    deleteAccount: () => deleteAccountData(),
  };
}
