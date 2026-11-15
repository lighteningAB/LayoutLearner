import "server-only";
import { randomUUID } from "node:crypto";
import { DbUnavailableError, getSql, type Row } from "./client";

// Storage for sync documents: one row per user, optimistic concurrency by
// (gen, version). Every write is a single compare-and-set statement, so no
// transaction is needed (Neon's HTTP driver runs one statement per request).
//
// Note on jsonb: Postgres does not preserve object key order (or duplicate
// keys / insignificant whitespace) in jsonb, so a document read back is
// structurally equal to what was written but may serialise differently.
// Callers must compare documents canonically (docsEqual), never by string.
//
// Driver normalisation: `doc` always comes back as a parsed object and
// `version` as a JS number (Neon returns bigint as a string, PGlite as a
// BigInt or number).

export interface StoredDoc {
  doc: unknown;
  version: number;
  gen: string;
}

export type PutResult = { ok: true; version: number; gen: string } | { ok: false };

export interface RateResult {
  allowed: boolean;
  /** Seconds until the current window ends (at least 1). */
  retryAfter: number;
}

function toVersion(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value as string | bigint);
  if (!Number.isSafeInteger(n) || n < 1) throw new DbUnavailableError("stored version is not a positive integer");
  return n;
}

function toDoc(value: unknown): unknown {
  // Both drivers parse jsonb; tolerate a driver that hands back text.
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throw new DbUnavailableError("stored document is not valid JSON");
    }
  }
  return value;
}

function toStored(row: Row): StoredDoc {
  if (typeof row.gen !== "string") throw new DbUnavailableError("stored gen is not a string");
  return { doc: toDoc(row.doc), version: toVersion(row.version), gen: row.gen };
}

export async function getDoc(userId: string): Promise<StoredDoc | null> {
  const sql = await getSql();
  const rows = await sql("SELECT gen, version, doc FROM ll_sync_docs WHERE user_id = $1", [userId]);
  return rows.length === 0 ? null : toStored(rows[0]);
}

/**
 * Compare-and-set write. `expectedVersion: 0` means "create; fail if a row
 * exists". Otherwise the row is replaced only if it is still exactly at
 * (expectedGen, expectedVersion). `{ ok: false }` means the precondition did
 * not hold and nothing was written.
 */
export async function putDoc(
  userId: string,
  input: { expectedVersion: number; expectedGen: string | null; doc: unknown },
): Promise<PutResult> {
  const { expectedVersion, expectedGen } = input;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) return { ok: false };
  // The document travels as a text parameter and is cast in SQL, so both
  // drivers serialise it identically.
  const json = JSON.stringify(input.doc);
  if (typeof json !== "string") return { ok: false };
  const sql = await getSql();

  let rows: Row[];
  if (expectedVersion === 0) {
    rows = await sql(
      `INSERT INTO ll_sync_docs (user_id, gen, version, doc, updated_at)
       VALUES ($1, $2, 1, $3::text::jsonb, now())
       ON CONFLICT (user_id) DO NOTHING
       RETURNING gen, version`,
      [userId, randomUUID(), json],
    );
  } else {
    if (typeof expectedGen !== "string") return { ok: false };
    rows = await sql(
      `UPDATE ll_sync_docs
          SET version = version + 1, doc = $4::text::jsonb, updated_at = now()
        WHERE user_id = $1 AND version = $2 AND gen = $3
        RETURNING gen, version`,
      [userId, expectedVersion, expectedGen, json],
    );
  }
  if (rows.length === 0) return { ok: false };
  if (typeof rows[0].gen !== "string") throw new DbUnavailableError("stored gen is not a string");
  return { ok: true, version: toVersion(rows[0].version), gen: rows[0].gen };
}

/** The rate bucket that survives account deletion until its window ends (see deleteDoc). */
export const DELETE_BUCKET = "delete";

/**
 * Erase the user's document and rate counters. Idempotent.
 *
 * The one exception is the still-running `delete` rate window: removing it
 * would let a client reset every limit by calling DELETE in a loop. That row
 * holds only the opaque user id, a timestamp and a counter, and it is removed
 * by the garbage collection below once its window is over (the next time
 * anyone deletes an account).
 */
export async function deleteDoc(userId: string): Promise<void> {
  const sql = await getSql();
  await sql("DELETE FROM ll_sync_docs WHERE user_id = $1", [userId]);
  await sql("DELETE FROM ll_sync_rate WHERE user_id = $1 AND bucket <> $2", [userId, DELETE_BUCKET]);
  await sql("DELETE FROM ll_sync_rate WHERE window_start < now() - interval '1 day'");
}

/**
 * Fixed-window rate limiter in a single upsert. Counts this hit and reports
 * whether the caller is still within `limit` hits per `windowSeconds`.
 */
export async function hitRate(
  userId: string,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  const sql = await getSql();
  const rows = await sql(
    `INSERT INTO ll_sync_rate AS r (user_id, bucket, window_start, count)
     VALUES ($1, $2, now(), 1)
     ON CONFLICT (user_id, bucket) DO UPDATE SET
       window_start = CASE WHEN r.window_start <= now() - make_interval(secs => $3::int)
                           THEN now() ELSE r.window_start END,
       count = CASE WHEN r.window_start <= now() - make_interval(secs => $3::int)
                    THEN 1 ELSE LEAST(r.count + 1, 1000000) END
     RETURNING count,
       GREATEST(1, CEIL(EXTRACT(EPOCH FROM (window_start + make_interval(secs => $3::int) - now()))))::int AS retry_after`,
    [userId, bucket, windowSeconds],
  );
  if (rows.length === 0) throw new DbUnavailableError("rate limiter returned no row");
  const count = Number(rows[0].count);
  const retryAfter = Number(rows[0].retry_after);
  if (!Number.isFinite(count)) throw new DbUnavailableError("rate limiter returned a bad count");
  return {
    allowed: count <= limit,
    retryAfter: Number.isFinite(retryAfter) && retryAfter >= 1 ? Math.min(retryAfter, windowSeconds) : windowSeconds,
  };
}
