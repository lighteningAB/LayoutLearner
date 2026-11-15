// Database schema for accounts + sync.
//
// This file has NO imports and only erasable TypeScript syntax, so
// scripts/db.mjs can import it directly under Node's type stripping.
// Every statement is idempotent. The same SQL runs on Neon and on PGlite.
//
// Privacy: the only identifier stored is the opaque internal user id
// ("u_" + sha256 of provider + account id). No email, name or avatar.

export const SCHEMA_SQL: string[] = [
  `CREATE TABLE IF NOT EXISTS ll_sync_docs (
    user_id text PRIMARY KEY CHECK (user_id ~ '^u_[A-Za-z0-9_-]{43}$'),
    gen text NOT NULL,
    version bigint NOT NULL CHECK (version >= 1),
    doc jsonb NOT NULL CHECK (length(doc::text) <= 1048576),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS ll_sync_rate (
    user_id text NOT NULL,
    bucket text NOT NULL,
    window_start timestamptz NOT NULL,
    count int NOT NULL,
    PRIMARY KEY (user_id, bucket)
  )`,
];

export const TABLES: string[] = ["ll_sync_docs", "ll_sync_rate"];
