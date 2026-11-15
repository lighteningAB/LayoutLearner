"use client";
// Client session store for accounts. Replaces next-auth's SessionProvider / useSession.
//
// Why not SessionProvider: it fetches /api/auth/session on every page load for every visitor. This
// store makes ZERO requests unless this browser has a reason to believe it is signed in:
//
//   feature off                nothing at all (no listeners, no storage access, no requests)
//   feature on, no "hint"      status "signed-out", no requests
//   feature on, hint present   one GET /api/auth/session, then "signed-in" or "signed-out"
//
// The hint is a small localStorage entry (ACCOUNT_HINT_KEY, under the app's "ll:v1:" prefix so that
// "Clear all data" removes it). It is written right before a sign-in starts and removed when a
// session check says "not signed in" or on sign-out. Its value is { s, u, at }:
//
//   s    a random stamp, new on every change
//   u    the user id the session was last confirmed for; null while a sign-in is in progress
//   at   when it was written
//
// Besides "should I ask the server", the hint is the cross-tab signal: every tab watches the key.
// A tab only treats its session as CURRENT while the hint is byte-for-byte the one its own session
// check ended with (`sessionIsCurrent`). Any sign-in or sign-out in any tab changes the hint first,
// so the other tabs stop trusting their idea of "who is signed in" before the cookie changes, and
// re-check. The sync engine asks `sessionIsCurrent()` before every request and before applying
// every response; that is what keeps one account's data from being sent with another account's
// cookie when the user switches accounts in a second tab.
import { useSyncExternalStore } from "react";
import { USER_ID_RE, type PublicAuthConfig } from "@/lib/auth/types";

export interface AccountUser {
  id: string;
  name: string;
  image: string | null;
}

export interface AccountState {
  enabled: boolean;
  providers: PublicAuthConfig["providers"];
  status: "off" | "signed-out" | "loading" | "signed-in";
  user: AccountUser | null;
}

export const ACCOUNT_HINT_KEY = "ll:v1:account";
/** sessionStorage: this TAB started the sign-in the hint describes (survives the OAuth redirect). */
const OWNER_KEY = "ll:account-signin";

/** Why the store last went from signed-in to signed-out. */
export type SignOutReason = "user" | "expired" | "elsewhere" | null;

const SESSION_TIMEOUT_MS = 15_000;
const RECHECK_ON_FOCUS_MS = 10 * 60 * 1000;
/** How long a "sign-in in progress" hint written by another tab is left alone. */
const PENDING_MS = 10 * 60 * 1000;
const RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const FLUSH_BUDGET_MS = 3_000;

const OFF: AccountState = { enabled: false, providers: [], status: "off", user: null };

let config: PublicAuthConfig | null = null;
let configKey = "";
/** What the server renders and what the client shows until `initAccount` ran. */
let base: AccountState = OFF;
let state: AccountState = OFF;
let started = false;

const listeners = new Set<() => void>();

/** The hint text this tab's signed-in state was confirmed against; null = not confirmed. */
let confirmedRaw: string | null = null;
let checkSeq = 0;
let lastCheckedAt = 0;
let lastNudgeAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryIndex = 0;
let signOutReason: SignOutReason = null;
let flushBeforeSignOut: (() => Promise<void>) | null = null;

interface Hint {
  s: string;
  u: string | null;
  at: number;
}

// ---------------------------------------------------------------------------------------------
// Storage helpers (every access may throw: private mode, blocked storage)
// ---------------------------------------------------------------------------------------------

function readHintRaw(): string | null {
  try {
    return window.localStorage.getItem(ACCOUNT_HINT_KEY);
  } catch {
    return null;
  }
}

function parseHint(raw: string | null): Hint | null {
  if (raw === null) return null;
  try {
    const h = JSON.parse(raw) as Partial<Hint> | null;
    if (!h || typeof h.s !== "string") return null;
    return { s: h.s, u: typeof h.u === "string" ? h.u : null, at: typeof h.at === "number" ? h.at : 0 };
  } catch {
    return null;
  }
}

function randomStamp(): string {
  try {
    const buf = new Uint32Array(2);
    crypto.getRandomValues(buf);
    return buf[0].toString(36) + buf[1].toString(36);
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

function writeHint(userId: string | null): Hint {
  const hint: Hint = { s: randomStamp(), u: userId, at: Date.now() };
  try {
    window.localStorage.setItem(ACCOUNT_HINT_KEY, JSON.stringify(hint));
  } catch {
    /* storage unavailable: the session works for this page load only */
  }
  return hint;
}

function removeHint(): void {
  try {
    window.localStorage.removeItem(ACCOUNT_HINT_KEY);
  } catch {
    /* ignore */
  }
}

function readOwner(): string | null {
  try {
    return window.sessionStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function setOwner(stamp: string | null): void {
  try {
    if (stamp === null) window.sessionStorage.removeItem(OWNER_KEY);
    else window.sessionStorage.setItem(OWNER_KEY, stamp);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------------------------

function setState(status: AccountState["status"], user: AccountUser | null): void {
  const prev = state;
  if (
    prev.status === status &&
    (prev.user?.id ?? null) === (user?.id ?? null) &&
    (prev.user?.name ?? null) === (user?.name ?? null) &&
    (prev.user?.image ?? null) === (user?.image ?? null)
  ) {
    return;
  }
  state = { enabled: prev.enabled, providers: prev.providers, status, user };
  notify();
}

function notify(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      /* a listener must not break the store */
    }
  }
}

function becomeSignedOut(reason: SignOutReason): void {
  confirmedRaw = null;
  if (state.status === "signed-in") signOutReason = reason;
  setState("signed-out", null);
}

function clearRetry(): void {
  if (retryTimer !== null) clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  clearRetry();
  const delay = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)];
  retryIndex++;
  retryTimer = setTimeout(() => void check(), delay * (0.8 + Math.random() * 0.4));
}

function parseUser(body: unknown): AccountUser | null {
  const user = (body as { user?: { id?: unknown; name?: unknown; image?: unknown } } | null)?.user;
  if (!user || typeof user.id !== "string" || !USER_ID_RE.test(user.id)) return null;
  return {
    id: user.id,
    name: typeof user.name === "string" && user.name !== "" ? user.name : "Account",
    image: typeof user.image === "string" ? user.image : null,
  };
}

/**
 * Ask the server who is signed in, if (and only if) the hint says somebody might be.
 * `owner`: this tab itself just attempted the sign-in the hint describes.
 */
async function check(owner = false): Promise<void> {
  if (!started) return;
  clearRetry();
  const startRaw = readHintRaw();
  if (startRaw === null) {
    checkSeq++;
    becomeSignedOut("elsewhere");
    return;
  }
  const seq = ++checkSeq;
  const wasSignedIn = state.status === "signed-in";
  // While a user is known, a re-check keeps showing that user; `sessionIsCurrent()` is what stops
  // the engine from acting on a session that is being re-verified.
  if (!wasSignedIn) setState("loading", null);

  /** undefined = no answer (network / server trouble); null = the server says "not signed in". */
  let user: AccountUser | null | undefined;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SESSION_TIMEOUT_MS);
  try {
    const res = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: abort.signal,
    });
    if (res.ok) user = parseUser(await res.json());
    else user = res.status >= 500 ? undefined : null;
  } catch {
    user = undefined;
  } finally {
    clearTimeout(timer);
  }
  if (seq !== checkSeq) return; // superseded by a newer check, a sign-in or a sign-out

  if (user === undefined) {
    // Offline must not look like "signed out": keep the status ("loading", or the known user) and
    // try again later.
    scheduleRetry();
    return;
  }

  const nowRaw = readHintRaw();
  if (nowRaw !== startRaw) {
    // The hint changed while the request was in flight (another tab signed in or out): the answer
    // may describe the old cookie. Start over.
    return check(owner);
  }
  const hint = parseHint(nowRaw);
  const mine = owner || (hint !== null && readOwner() === hint.s);
  const pendingElsewhere = hint !== null && hint.u === null && !mine && Date.now() - hint.at < PENDING_MS;
  retryIndex = 0;
  lastCheckedAt = Date.now();

  if (user === null) {
    // Leave another tab's "sign-in in progress" hint alone: that tab may be away at the OAuth
    // provider and needs the hint when it comes back.
    if (!pendingElsewhere) removeHint();
    if (mine) setOwner(null);
    becomeSignedOut("expired");
    return;
  }

  if (pendingElsewhere) {
    // Another tab is in the middle of a sign-in: the cookie is about to change. Show the user the
    // server reported, but do not confirm the session; that tab rewrites the hint when it is done
    // and this tab then checks again.
    confirmedRaw = null;
  } else {
    if (hint === null || hint.u !== user.id) writeHint(user.id);
    confirmedRaw = readHintRaw();
    if (mine) setOwner(null);
  }
  signOutReason = null;
  const before = state;
  setState("signed-in", user);
  // Same user as before, but the session was re-confirmed: tell the listeners anyway, the sync
  // engine may be waiting for exactly that.
  if (state === before) notify();
}

// ---------------------------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------------------------

function onStorage(e: StorageEvent): void {
  if (e.key !== null && e.key !== ACCOUNT_HINT_KEY) return;
  if (e.storageArea !== null && e.storageArea !== window.localStorage) return;
  if (readHintRaw() === confirmedRaw && state.status === "signed-in") return; // nothing changed for us
  void check();
}

function onAttention(): void {
  if (document.visibilityState === "hidden") return;
  if (state.status === "loading") {
    retryIndex = 0;
    void check();
  } else if (state.status === "signed-in" && Date.now() - lastCheckedAt >= RECHECK_ON_FOCUS_MS) {
    void check();
  }
}

function onOnline(): void {
  if (state.status === "loading" || (state.status === "signed-in" && confirmedRaw === null)) {
    retryIndex = 0;
    void check();
  }
}

/** Sets the configuration without starting anything. Safe during render and on the server. */
export function primeAccount(next: PublicAuthConfig): void {
  if (started) return;
  const key = JSON.stringify(next);
  if (key === configKey) return;
  configKey = key;
  config = next;
  base = next.enabled ? { enabled: true, providers: next.providers, status: "signed-out", user: null } : OFF;
  state = base;
}

/** Starts the store in the browser. Idempotent; does nothing when the feature is off. */
export function initAccount(next: PublicAuthConfig): void {
  primeAccount(next);
  if (started || typeof window === "undefined" || !config || !config.enabled) return;
  started = true;
  window.addEventListener("storage", onStorage);
  window.addEventListener("focus", onAttention);
  document.addEventListener("visibilitychange", onAttention);
  window.addEventListener("online", onOnline);
  // A tab that comes back from the OAuth provider is hinted even if another tab removed the hint
  // while it was away.
  const owner = readOwner();
  if (owner !== null && readHintRaw() === null) {
    try {
      window.localStorage.setItem(ACCOUNT_HINT_KEY, JSON.stringify({ s: owner, u: null, at: Date.now() }));
    } catch {
      /* ignore */
    }
  }
  if (readHintRaw() !== null) void check();
}

export function getAccount(): AccountState {
  return state;
}

export function subscribeAccount(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getServerSnapshot = () => base;

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccount, getServerSnapshot);
}

export function refreshSession(): Promise<void> {
  return check();
}

/**
 * True while this tab's signed-in state is confirmed against the hint as it is in localStorage
 * right now. False means "somebody signed in or out (or is doing so) since the last check": the
 * caller must neither send nor apply account data, and a re-check is started.
 */
export function sessionIsCurrent(): boolean {
  if (state.status !== "signed-in") return false;
  if (confirmedRaw !== null && readHintRaw() === confirmedRaw) return true;
  if (Date.now() - lastNudgeAt > 15_000) {
    lastNudgeAt = Date.now();
    void check();
  }
  return false;
}

/** The stamp of the hint this tab's session is confirmed against (null: not confirmed). */
export function sessionStamp(): string | null {
  return parseHint(confirmedRaw)?.s ?? null;
}

export function getSignOutReason(): SignOutReason {
  return signOutReason;
}

/** The sync engine registers its "push pending changes" step here; it runs before a sign-out. */
export function setSignOutFlush(flush: (() => Promise<void>) | null): void {
  flushBeforeSignOut = flush;
}

export async function signInWith(providerId: string, opts?: { username?: string }): Promise<{ ok: boolean; error?: string }> {
  if (!started || !config || !config.enabled) return { ok: false, error: "Accounts are not available" };
  const provider = config.providers.find((p) => p.id === providerId);
  if (!provider) return { ok: false, error: "Unknown sign-in method" };

  // From here on no tab may trust its current session: the cookie is about to change.
  checkSeq++;
  clearRetry();
  confirmedRaw = null;
  const hint = writeHint(null);
  setOwner(hint.s);

  try {
    const { signIn } = await import("next-auth/react");
    if (provider.kind === "oauth") {
      // Full-page redirect to the provider; the session is fetched when the app loads again.
      await signIn(providerId, { callbackUrl: window.location.href });
      return { ok: true };
    }
    const res = await signIn(providerId, { username: opts?.username ?? "", redirect: false });
    // Whatever happened, find out who is signed in now (a failed attempt leaves the old session).
    await check(true);
    if (!res || res.error || !res.ok) return { ok: false, error: "Sign-in failed" };
    return getAccount().status === "signed-in" ? { ok: true } : { ok: false, error: "Couldn't confirm the session" };
  } catch {
    await check(true);
    return { ok: false, error: "Couldn't reach the server" };
  }
}

/**
 * Signs this browser out. Local data is untouched. Unless `skipFlush`, pending local changes get
 * one last chance (bounded) to reach the account first.
 */
export async function signOutAccount(opts?: { skipFlush?: boolean }): Promise<void> {
  if (!started || !config || !config.enabled) return;
  if (state.status === "signed-out" && readHintRaw() === null) return;
  if (!opts?.skipFlush && flushBeforeSignOut && state.status === "signed-in") {
    const flush = flushBeforeSignOut;
    await Promise.race([
      flush().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, FLUSH_BUDGET_MS)),
    ]);
  }
  checkSeq++;
  clearRetry();
  removeHint();
  setOwner(null);
  becomeSignedOut("user");
  try {
    const { signOut } = await import("next-auth/react");
    await signOut({ redirect: false });
  } catch {
    // The cookie could not be cleared (offline). The hint is gone, so this browser behaves as
    // signed out; the cookie expires on its own or is replaced by the next sign-in.
  }
}
