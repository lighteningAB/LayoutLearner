import "server-only";
import type { PublicAuthConfig, PublicAuthProvider } from "./types";

// Server-side feature gate for accounts + sync. It fails closed: any missing
// prerequisite turns the whole feature off.
//
// When the environment is read: these functions read process.env each time
// they are called, never at module load. That does NOT make the result
// dynamic everywhere. Route handlers (/api/auth/*, /api/sync) call them per
// request, but the pages call getAuthConfig() while they are statically
// rendered, so the on/off decision and the provider list shown in the UI are
// the ones from BUILD time. Changing an environment variable therefore needs
// a new build/deployment before the pages follow.

const MIN_SECRET_LENGTH = 32;

const warned = new Set<string>();
function errorOnce(key: string, message: string): void {
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[auth] ${message}`);
}

function env(name: string): string {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

export function githubEnabled(): boolean {
  return env("GITHUB_ID") !== "" && env("GITHUB_SECRET") !== "";
}

export function googleEnabled(): boolean {
  return env("GOOGLE_ID") !== "" && env("GOOGLE_SECRET") !== "";
}

/**
 * Passwordless dev login. The literal NODE_ENV comparison comes first so the
 * bundler folds this whole function to `return false` in production builds.
 */
export function devLoginEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.VERCEL) return false;
  return process.env.AUTH_DEV_LOGIN === "1";
}

/**
 * True when sessions are signed with the fixed, PUBLIC development secret
 * (NEXTAUTH_SECRET unset outside production). Anyone can mint a session token
 * for that secret, so callers must only honour it for loopback requests.
 */
export function usingDevFallbackSecret(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return (process.env.NEXTAUTH_SECRET ?? "") === "";
}

/**
 * Is this `Host` header value a loopback name (localhost, *.localhost,
 * 127.0.0.0/8, [::1])? Pass the Host header itself, never X-Forwarded-Host.
 *
 * This is NOT a network access control: a hand-written request can send any
 * Host header. It stops the ordinary case (a browser on another machine that
 * opened http://<this machine's address>:<port>, or a DNS-rebinding page) and
 * nothing more. The real control is not listening on other interfaces.
 */
export function isLoopbackHost(hostHeader: string | null | undefined): boolean {
  if (typeof hostHeader !== "string") return false;
  const value = hostHeader.trim().toLowerCase();
  if (value === "" || value.length > 255 || /[\s,/@]/.test(value)) return false;
  let hostname: string;
  if (value.startsWith("[")) {
    const m = /^\[([0-9a-f:]+)\](?::\d{1,5})?$/.exec(value);
    if (!m) return false;
    hostname = m[1];
    return hostname === "::1";
  }
  const m = /^([a-z0-9.-]+)(?::\d{1,5})?$/.exec(value);
  if (!m) return false;
  hostname = m[1];
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  return /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(hostname);
}

/**
 * Development only: must this request be refused because of where it came
 * from? True when the public fallback secret is in use and the request's Host
 * is not loopback. Always false in a production build.
 */
export function refusedOutsideLoopback(hostHeader: string | null | undefined): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (!usingDevFallbackSecret() || isLoopbackHost(hostHeader)) return false;
  errorOnce(
    "loopback",
    "refused a sign-in/sync request whose Host is not localhost: without NEXTAUTH_SECRET the development " +
      "secret is public, so accounts only work on http://localhost. Set NEXTAUTH_SECRET to use another host.",
  );
  return true;
}

/** Connection string for the production database driver, or "" when unset. */
export function getDatabaseUrl(): string {
  return env("DATABASE_URL") || env("POSTGRES_URL");
}

/** A database is available: a URL is configured, or we are outside production (local PGlite). */
export function storageAvailable(): boolean {
  if (getDatabaseUrl() !== "") return true;
  if (process.env.NODE_ENV !== "production") return true;
  return false;
}

/** The JWT signing secret, or null when the feature must be off. */
export function getAuthSecret(): string | null {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  if (secret.length >= MIN_SECRET_LENGTH) return secret;
  if (process.env.NODE_ENV !== "production") {
    // Outside production an UNSET secret falls back to a fixed dev value. A
    // secret that is set but too short is still refused, so mistakes surface early.
    // The fallback is public: the route handlers honour it only for requests
    // whose Host is loopback (see usingDevFallbackSecret / isLoopbackHost).
    // The literal stays inside this branch so that it is not even present in a production bundle.
    if (secret === "") return "layoutlearner-dev-only-insecure-secret-do-not-use-in-production";
    errorOnce(
      "secret-short",
      `NEXTAUTH_SECRET is shorter than ${MIN_SECRET_LENGTH} characters; accounts and sync are disabled.`,
    );
    return null;
  }
  errorOnce(
    "secret",
    `NEXTAUTH_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters; accounts and sync are disabled. Generate one with: openssl rand -base64 32`,
  );
  return null;
}

function enabledProviders(): PublicAuthProvider[] {
  const providers: PublicAuthProvider[] = [];
  if (githubEnabled()) providers.push({ id: "github", name: "GitHub", kind: "oauth" });
  if (googleEnabled()) providers.push({ id: "google", name: "Google", kind: "oauth" });
  if (process.env.NODE_ENV !== "production") {
    if (devLoginEnabled()) providers.push({ id: "dev", name: "Dev login", kind: "dev" });
  }
  return providers;
}

export function getAuthConfig(): PublicAuthConfig {
  const providers = enabledProviders();
  // No provider configured: the feature is simply not set up. Stay quiet.
  if (providers.length === 0) return { enabled: false, providers: [] };
  if (getAuthSecret() === null) return { enabled: false, providers: [] };
  if (!storageAvailable()) {
    errorOnce("db", "DATABASE_URL is not set; accounts and sync are disabled in production.");
    return { enabled: false, providers: [] };
  }
  return { enabled: true, providers };
}
