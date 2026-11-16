import "server-only";

// One tiny interface over two Postgres drivers:
//   - Neon's serverless HTTP driver when DATABASE_URL (or POSTGRES_URL) is set;
//   - PGlite (Postgres compiled to WASM, in-process, persisted to a directory)
//     for local development when no URL is set. Never in production.
// The same SQL text, with $1..$n placeholders, runs on both. Values are only
// ever passed as parameters.

export type Row = Record<string, unknown>;
export type Sql = (text: string, params?: unknown[]) => Promise<Row[]>;

/** Raised for any storage failure. The message is safe to log; it never contains the connection string. */
export class DbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbUnavailableError";
  }
}

/**
 * Is `err` a DbUnavailableError? Deliberately NOT `instanceof`: in development
 * the PGlite query function lives on globalThis across hot reloads, so the
 * errors it throws can come from an earlier copy of this module, whose class
 * is a different object from the one the importer sees.
 */
export function isDbUnavailable(err: unknown): err is DbUnavailableError {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "DbUnavailableError";
}

const QUERY_TIMEOUT_MS = 8000;

interface DbGlobal {
  __llNeon?: { url: string; sql: Sql };
  __llPglite?: { dir: string; sql: Promise<Sql> };
}
const g = globalThis as unknown as DbGlobal;

function databaseUrl(): string {
  return (process.env.DATABASE_URL ?? "").trim() || (process.env.POSTGRES_URL ?? "").trim();
}

/** Strip anything that could carry credentials out of a driver error. */
function safeMessage(err: unknown): string {
  const raw = err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
  return raw.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://<redacted>").slice(0, 300);
}

async function neonSql(url: string): Promise<Sql> {
  if (g.__llNeon && g.__llNeon.url === url) return g.__llNeon.sql;
  let query: (text: string, params?: unknown[], opts?: Record<string, unknown>) => Promise<unknown>;
  try {
    const { neon } = await import("@neondatabase/serverless");
    const client = neon(url);
    query = (text, params, opts) => client.query(text, params as unknown[] | undefined, opts);
  } catch (err) {
    throw new DbUnavailableError(`database client could not be created (${safeMessage(err)})`);
  }
  const sql: Sql = async (text, params = []) => {
    try {
      const rows = await query(text, params, {
        fetchOptions: { signal: AbortSignal.timeout(QUERY_TIMEOUT_MS), cache: "no-store" },
      });
      return rows as Row[];
    } catch (err) {
      throw new DbUnavailableError(`database query failed (${safeMessage(err)})`);
    }
  };
  g.__llNeon = { url, sql };
  return sql;
}

/**
 * Get the query function for the configured database. Throws
 * DbUnavailableError when no database is usable.
 */
export async function getSql(): Promise<Sql> {
  const url = databaseUrl();
  if (url !== "") return neonSql(url);

  // Local fallback. The literal NODE_ENV check removes this branch (and the
  // PGlite import) from production builds.
  if (process.env.NODE_ENV !== "production") {
    const path = await import("node:path");
    const dir = path.resolve(process.cwd(), (process.env.LL_PGLITE_DIR ?? "").trim() || ".data/pglite");
    // Kept on globalThis so dev hot reloads never open the directory twice.
    if (!g.__llPglite || g.__llPglite.dir !== dir) {
      const opening = openPglite(dir);
      g.__llPglite = { dir, sql: opening };
      opening.catch(() => {
        if (g.__llPglite?.sql === opening) g.__llPglite = undefined;
      });
    }
    return g.__llPglite.sql;
  }

  throw new DbUnavailableError("no database configured");
}

async function openPglite(dir: string): Promise<Sql> {
  if (process.env.NODE_ENV !== "production") {
    try {
      const { openPglite: open } = await import("./pglite");
      const query = await open(dir);
      return async (text, params = []) => {
        try {
          return await query(text, params);
        } catch (err) {
          throw new DbUnavailableError(`database query failed (${safeMessage(err)})`);
        }
      };
    } catch (err) {
      throw new DbUnavailableError(`local database could not be opened (${safeMessage(err)})`);
    }
  }
  throw new DbUnavailableError("no database configured");
}
