#!/usr/bin/env node
// Database maintenance for accounts + sync.
//
//   node scripts/db.mjs migrate          create the tables (idempotent)
//   node scripts/db.mjs dump [--doc]     one line per row: user_id, gen, version, updated_at, doc bytes
//   node scripts/db.mjs reset --yes      delete every row (tables are kept)
//
// Which database: DATABASE_URL (or POSTGRES_URL) from the environment, else
// from .env.local; with neither set, the local PGlite directory
// (LL_PGLITE_DIR, default .data/pglite). The connection string is never printed.
//
// PGlite caveat: a PGlite directory must only ever be opened by ONE process.
// The dev server keeps it open and records its pid in "<dir>.lock".
//   - `dump` therefore never opens the live directory: it copies it to a
//     temporary directory, opens the copy (Postgres crash recovery replays
//     the WAL, so the copy is consistent up to the last completed write),
//     prints, and deletes the copy.
//   - `migrate` and `reset` need the real directory and refuse while the lock
//     names a running process. Stop the dev server first.
//
// Requires Node >= 22.18 (imports lib/db/schema.ts via type stripping).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// lib/db/schema.ts is an ES module inside a package without "type": "module";
// Node loads it fine but prints a MODULE_TYPELESS_PACKAGE_JSON notice. Drop
// that one notice, keep every other warning.
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.code !== "MODULE_TYPELESS_PACKAGE_JSON") console.error(`${w.name}: ${w.message}`);
});
const { SCHEMA_SQL, TABLES } = await import("../lib/db/schema.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readEnvLocal() {
  const out = {};
  let text;
  try {
    text = fs.readFileSync(path.join(root, ".env.local"), "utf8");
  } catch {
    return out;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    let value = m[2];
    if (/^(".*"|'.*')$/.test(value)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

const fileEnv = readEnvLocal();
const setting = (name) => (process.env[name] ?? fileEnv[name] ?? "").trim();

function redact(err) {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://<redacted>");
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function pgliteDir() {
  return path.resolve(root, setting("LL_PGLITE_DIR") || ".data/pglite");
}

/** pid of a live process holding the PGlite directory, or null. */
function pgliteOwner(dir) {
  try {
    const pid = Number(fs.readFileSync(`${dir}.lock`, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && pidAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function openNeon(url) {
  const { neon } = await import("@neondatabase/serverless");
  const client = neon(url);
  return {
    label: "Postgres (DATABASE_URL)",
    sql: (text, params = []) => client.query(text, params),
    close: async () => {},
  };
}

async function openPglite(dir, label) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = await PGlite.create(dir);
  return {
    label,
    sql: async (text, params = []) => (await db.query(text, params)).rows,
    close: () => db.close(),
  };
}

/** Open the database for a command. `write` commands need exclusive access to a PGlite directory. */
async function open({ write }) {
  const url = setting("DATABASE_URL") || setting("POSTGRES_URL");
  if (url) return openNeon(url);

  const dir = pgliteDir();
  const shown = path.relative(root, dir) || dir;
  if (write) {
    const owner = pgliteOwner(dir);
    if (owner !== null) {
      throw new Error(
        `The local PGlite database (${shown}) is open in process ${owner} (the dev server?).\n` +
          "Stop that process first: two processes must never open one PGlite directory.",
      );
    }
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    // Hold the lock while we work so a dev server started meanwhile backs off.
    fs.writeFileSync(`${dir}.lock`, String(process.pid));
    const handle = await openPglite(dir, `PGlite (${shown})`);
    const close = handle.close;
    handle.close = async () => {
      await close();
      fs.rmSync(`${dir}.lock`, { force: true });
    };
    return handle;
  }

  if (!fs.existsSync(dir)) return { label: `PGlite (${shown}, not created yet)`, sql: null, close: async () => {} };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ll-pglite-dump-"));
  const copy = path.join(tmp, "db");
  fs.cpSync(dir, copy, { recursive: true });
  const handle = await openPglite(copy, `PGlite (copy of ${shown})`);
  const close = handle.close;
  handle.close = async () => {
    await close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return handle;
}

async function migrate() {
  const db = await open({ write: true });
  try {
    for (const statement of SCHEMA_SQL) await db.sql(statement);
    console.log(`migrate: ${db.label}: ensured tables ${TABLES.join(", ")}`);
  } finally {
    await db.close();
  }
}

async function dump(withDoc) {
  const db = await open({ write: false });
  try {
    console.log(`dump: ${db.label}`);
    if (db.sql === null) {
      console.log("0 rows");
      return;
    }
    let rows;
    try {
      rows = await db.sql(
        `SELECT user_id, gen, version::text AS version, updated_at::text AS updated_at, doc::text AS doc
           FROM ll_sync_docs ORDER BY user_id`,
      );
    } catch (err) {
      if (/does not exist/.test(redact(err))) {
        console.log("0 rows (tables not created yet; run: node scripts/db.mjs migrate)");
        return;
      }
      throw err;
    }
    for (const row of rows) {
      // Byte length of the compact JSON, i.e. what the API measures against its limit.
      const compact = JSON.stringify(JSON.parse(row.doc));
      console.log(
        [row.user_id, `gen=${row.gen}`, `version=${row.version}`, `updated_at=${row.updated_at}`, `doc_bytes=${Buffer.byteLength(compact)}`].join("  "),
      );
      if (withDoc) console.log(compact);
    }
    console.log(`${rows.length} row${rows.length === 1 ? "" : "s"}`);
    const rate = await db.sql("SELECT user_id, bucket, count, window_start::text AS window_start FROM ll_sync_rate ORDER BY user_id, bucket");
    for (const r of rate) console.log(`rate  ${r.user_id}  ${r.bucket}  count=${r.count}  window_start=${r.window_start}`);
  } finally {
    await db.close();
  }
}

async function reset(yes) {
  if (!yes) {
    throw new Error("reset deletes every user's synced data. Re-run with --yes to confirm.\n(With the local PGlite database, stop the dev server first.)");
  }
  const db = await open({ write: true });
  try {
    for (const statement of SCHEMA_SQL) await db.sql(statement);
    for (const table of TABLES) await db.sql(`DELETE FROM ${table}`);
    console.log(`reset: ${db.label}: deleted all rows from ${TABLES.join(", ")}`);
  } finally {
    await db.close();
  }
}

const [command, ...flags] = process.argv.slice(2);
try {
  if (command === "migrate") await migrate();
  else if (command === "dump") await dump(flags.includes("--doc"));
  else if (command === "reset") await reset(flags.includes("--yes"));
  else {
    console.error("usage: node scripts/db.mjs <migrate | dump [--doc] | reset --yes>");
    process.exitCode = 2;
  }
} catch (err) {
  console.error(redact(err));
  process.exitCode = 1;
}
