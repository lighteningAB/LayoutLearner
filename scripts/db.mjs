#!/usr/bin/env node
// Database maintenance for accounts + sync.
//
//   node scripts/db.mjs migrate          create the tables (idempotent)
//   node scripts/db.mjs dump [--doc]     one line per row: user_id, gen, version, updated_at, doc bytes
//   node scripts/db.mjs reset --yes [--confirm-host=<host>]
//                                        delete every row (tables are kept)
//
// Which database: DATABASE_URL (or POSTGRES_URL) from the environment, else
// from .env.local; with neither set, the local PGlite directory
// (LL_PGLITE_DIR, default .data/pglite). NOTE: a DATABASE_URL left in
// .env.local (for example by `vercel env pull`) is picked up silently, so
// every command prints its target FIRST, before it touches anything: the
// PGlite directory, or the database HOST and where the URL came from. The
// connection string itself (user, password) is never printed.
//
// `reset` on a real Postgres database (anything but PGlite) needs both --yes
// and --confirm-host=<the host it printed>. Without the matching host it only
// reports the target and the row counts, and deletes nothing.
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

/** The configured Postgres URL and where it came from, or null (= local PGlite). */
function postgresTarget() {
  for (const name of ["DATABASE_URL", "POSTGRES_URL"]) {
    const url = setting(name);
    if (!url) continue;
    const source = (process.env[name] ?? "").trim() ? "the environment" : ".env.local";
    let host = null;
    try {
      // host = hostname[:port]; never the user, password, path or query.
      host = new URL(url).host || null;
    } catch {
      // unparseable: host stays null
    }
    return { url, name, source, host };
  }
  return null;
}

function describeTarget() {
  const pg = postgresTarget();
  if (pg) return `Postgres at host ${pg.host ?? "<could not be read from the URL>"} (${pg.name} from ${pg.source})`;
  return `local PGlite directory ${shownDir(pgliteDir())}`;
}

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

/** A directory as shown to the user: relative when it is inside the repository, absolute otherwise. */
function shownDir(dir) {
  const rel = path.relative(root, dir);
  return rel === "" || rel.startsWith("..") || path.isAbsolute(rel) ? dir : rel;
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

async function openNeon(url, label) {
  const { neon } = await import("@neondatabase/serverless");
  const client = neon(url);
  return {
    label,
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
  const pg = postgresTarget();
  if (pg) return openNeon(pg.url, `Postgres at host ${pg.host ?? "?"} (${pg.name})`);

  const dir = pgliteDir();
  const shown = shownDir(dir);
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
  console.log(`migrate: target: ${describeTarget()}`);
  const db = await open({ write: true });
  try {
    for (const statement of SCHEMA_SQL) await db.sql(statement);
    console.log(`migrate: ${db.label}: ensured tables ${TABLES.join(", ")}`);
  } finally {
    await db.close();
  }
}

async function dump(withDoc) {
  console.log(`dump: target: ${describeTarget()}`);
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

/** "ll_sync_docs: 3 rows, ll_sync_rate: 7 rows". Read-only; a missing table counts as 0 rows. */
async function countRows(db) {
  const parts = [];
  for (const table of TABLES) {
    let n;
    try {
      n = Number((await db.sql(`SELECT count(*)::text AS n FROM ${table}`))[0].n);
    } catch (err) {
      if (!/does not exist/.test(redact(err))) throw err;
      n = 0;
    }
    parts.push(`${table}: ${n} row${n === 1 ? "" : "s"}`);
  }
  return parts.join(", ");
}

async function reset(yes, confirmHost) {
  // Nothing is opened, read or changed before the target has been printed.
  console.log(`reset: target: ${describeTarget()}`);
  if (!yes) {
    throw new Error(
      "reset deletes EVERY user's synced data in the target above. Nothing was deleted.\n" +
        "Re-run with --yes to confirm. (With the local PGlite database, stop the dev server first.)",
    );
  }
  const pg = postgresTarget();
  if (pg && pg.host === null) {
    throw new Error(`reset: the host in ${pg.name} could not be read, so the target cannot be confirmed. Nothing was deleted.`);
  }
  // A real Postgres database needs its host typed out as well: a DATABASE_URL
  // forgotten in .env.local must not be enough to wipe production.
  const confirmed = !pg || confirmHost === pg.host;
  if (pg && !confirmed) {
    let counts;
    try {
      const db = await openNeon(pg.url, "");
      counts = await countRows(db);
    } catch (err) {
      counts = `could not be counted (${redact(err).slice(0, 120)})`;
    }
    console.log(`reset: rows that would be deleted: ${counts}`);
    throw new Error(
      (confirmHost === null
        ? "reset: this is a real Postgres database, not the local PGlite one."
        : `reset: --confirm-host=${confirmHost} does not match the target host.`) +
        " Nothing was deleted.\n" +
        `If you really mean to erase it, re-run with: node scripts/db.mjs reset --yes --confirm-host=${pg.host}`,
    );
  }
  const db = await open({ write: true });
  try {
    for (const statement of SCHEMA_SQL) await db.sql(statement);
    console.log(`reset: rows about to be deleted: ${await countRows(db)}`);
    for (const table of TABLES) await db.sql(`DELETE FROM ${table}`);
    console.log(`reset: ${db.label}: deleted all rows from ${TABLES.join(", ")}`);
  } finally {
    await db.close();
  }
}

const [command, ...flags] = process.argv.slice(2);
const flagValue = (name) => {
  const hit = flags.find((f) => f.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
};
try {
  if (command === "migrate") await migrate();
  else if (command === "dump") await dump(flags.includes("--doc"));
  else if (command === "reset") await reset(flags.includes("--yes"), flagValue("confirm-host"));
  else {
    console.error("usage: node scripts/db.mjs <migrate | dump [--doc] | reset --yes [--confirm-host=<host>]>");
    process.exitCode = 2;
  }
} catch (err) {
  console.error(redact(err));
  process.exitCode = 1;
}
