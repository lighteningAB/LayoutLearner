import "server-only";
import type { PublicAuthConfig, PublicAuthProvider } from "./types";

// Server-side feature gate for accounts + sync. Everything here reads the
// environment at CALL time (never at module load) and fails closed: any
// missing prerequisite turns the whole feature off.

/** Dev-only signing secret. Never reachable in a production build (see getAuthSecret). */
const DEV_ONLY_INSECURE_FALLBACK_SECRET =
  "layoutlearner-dev-only-insecure-secret-do-not-use-in-production";

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
    if (secret === "") return DEV_ONLY_INSECURE_FALLBACK_SECRET;
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
