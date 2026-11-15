import "server-only";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL } from "./schema";

// Local-development database: PGlite (Postgres compiled to WASM, in-process,
// persisted to a directory). This module is loaded ONLY through a dynamic
// import behind a literal `process.env.NODE_ENV !== "production"` check in
// client.ts, so neither it nor the PGlite package is part of a production build.

type Row = Record<string, unknown>;
type Query = (text: string, params?: unknown[]) => Promise<Row[]>;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Open (creating and bootstrapping if needed) the PGlite database in `dir`. Throws plain Errors. */
export async function openPglite(dir: string): Promise<Query> {
  if (process.env.NODE_ENV === "production") throw new Error("PGlite is not available in production");
  fs.mkdirSync(path.dirname(dir), { recursive: true });

  // Two processes must never open one PGlite directory. A sibling lock file
  // records the owning pid; scripts/db.mjs honours the same file.
  const lockFile = `${dir}.lock`;
  let owner = 0;
  try {
    owner = Number(fs.readFileSync(lockFile, "utf8").trim());
  } catch {
    // no lock file: the directory is free
  }
  if (Number.isInteger(owner) && owner > 0 && owner !== process.pid && pidAlive(owner)) {
    throw new Error(
      `local database directory is in use by process ${owner}; stop it or set LL_PGLITE_DIR to another directory`,
    );
  }
  fs.writeFileSync(lockFile, String(process.pid));
  process.once("exit", () => {
    try {
      if (fs.readFileSync(lockFile, "utf8").trim() === String(process.pid)) fs.unlinkSync(lockFile);
    } catch {
      // best effort
    }
  });

  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create(dir);
  // Idempotent bootstrap; Neon gets the same statements via `node scripts/db.mjs migrate`.
  for (const statement of SCHEMA_SQL) await db.query(statement);
  return async (text, params = []) => (await db.query(text, params)).rows as Row[];
}
