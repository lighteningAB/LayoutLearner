import type { NextRequest } from "next/server";
import { getAuthConfig } from "@/lib/auth/config";
import { getUserId } from "@/lib/auth/session";
import { isDbUnavailable } from "@/lib/db/client";
import { deleteDoc, getDoc, hitRate, putDoc, DELETE_BUCKET, type StoredDoc } from "@/lib/db/store";
import {
  LIMITS,
  TOMBSTONE_TTL_MS,
  emptyDoc,
  mergeDocs,
  pruneDoc,
  validateDoc,
  type SyncDoc,
} from "@/lib/sync/doc";

// Cross-device sync endpoint. One JSON document per signed-in user.
//
//   GET    -> { doc, version, gen, serverTime }
//   PUT    { baseVersion, gen, doc } -> joined document, or 409 with the current one
//   DELETE -> erase everything stored for the user
//
// Security model, in the order the checks run:
//   1. feature gate (404, nothing else happens);
//   2. same-origin policy: custom header + Origin / Sec-Fetch-Site (403);
//   3. identity from the session cookie ONLY (401) -- nothing in the query,
//      body or headers can name a user;
//   4. per-user rate limit (429);
//   5. bounded body, strict validation, server-side join, compare-and-set.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = LIMITS.docBytes + 1024;
/** Client clocks may run this far ahead of the server. */
const MAX_FUTURE_MS = 60 * 60 * 1000;
/** Slack when re-checking stored data (written when the clock was earlier, possibly on another instance). */
const STORED_MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const RATE = {
  read: { bucket: "read", limit: 240, windowSeconds: 60 },
  write: { bucket: "write", limit: 60, windowSeconds: 60 },
  delete: { bucket: DELETE_BUCKET, limit: 10, windowSeconds: 60 * 60 },
} as const;

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  Vary: "Cookie",
};

function json(status: number, body: unknown, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...BASE_HEADERS, ...extra } });
}

const fail = (status: number, error: string, extra?: Record<string, string>) => json(status, { error }, extra);

// ---------------------------------------------------------------------------
// Same-origin policy
// ---------------------------------------------------------------------------

function firstValue(header: string | null): string {
  return (header ?? "").split(",")[0].trim();
}

/** Origins this deployment answers on, derived the way next-auth derives its own URL. */
function allowedOrigins(req: NextRequest): Set<string> {
  const origins = new Set<string>();
  const configured = (process.env.NEXTAUTH_URL ?? "").trim();
  if (configured !== "") {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      // ignore a malformed NEXTAUTH_URL
    }
  }
  const host = firstValue(req.headers.get("host"));
  if (process.env.VERCEL || process.env.AUTH_TRUST_HOST) {
    // Behind a proxy that sets (and overwrites) the forwarding headers.
    const forwardedHost = firstValue(req.headers.get("x-forwarded-host")) || host;
    const proto = firstValue(req.headers.get("x-forwarded-proto")) === "http" ? "http" : "https";
    if (forwardedHost !== "") origins.add(`${proto}://${forwardedHost}`);
  } else if (origins.size === 0 && host !== "") {
    // Plain `next dev` / `next start` without NEXTAUTH_URL: the Host header is
    // the only thing we know. Forwarding headers are client-controlled here
    // and deliberately ignored.
    let proto = "http:";
    try {
      proto = new URL(req.url).protocol;
    } catch {
      // keep http:
    }
    origins.add(`${proto}//${host}`);
  }
  return origins;
}

function sameOriginRequest(req: NextRequest): boolean {
  // A custom header cannot be sent cross-origin without a CORS preflight, and
  // this endpoint never answers a preflight with CORS headers.
  if (req.headers.get("x-ll-sync") !== "1") return false;

  const origin = req.headers.get("origin");
  const fetchSite = req.headers.get("sec-fetch-site");
  if (origin !== null && !allowedOrigins(req).has(origin)) return false;
  if (fetchSite !== null && fetchSite !== "same-origin") return false;
  if (req.method !== "GET" && req.method !== "HEAD") {
    // State-changing requests must positively prove where they come from.
    if (origin === null && fetchSite === null) return false;
    if (req.method === "PUT") {
      const mediaType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (mediaType !== "application/json") return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Body handling
// ---------------------------------------------------------------------------

type BodyResult = { ok: true; bytes: Uint8Array } | { ok: false; status: 400 | 413 };

/** Read the request body, giving up as soon as it exceeds the cap. */
async function readBody(req: NextRequest): Promise<BodyResult> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d{1,15}$/.test(declared)) return { ok: false, status: 400 };
    if (Number(declared) > MAX_BODY_BYTES) return { ok: false, status: 413 };
  }
  if (!req.body) return { ok: false, status: 400 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

interface Envelope {
  baseVersion: number;
  gen: string | null;
  doc: unknown;
}

/** Parse the PUT envelope. Unknown keys (userId and friends included) are ignored. */
function parseEnvelope(bytes: Uint8Array): Envelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const own = (key: string): unknown =>
    Object.prototype.hasOwnProperty.call(parsed, key) ? (parsed as Record<string, unknown>)[key] : undefined;
  const baseVersion = own("baseVersion");
  const gen = own("gen");
  const doc = own("doc");
  if (typeof baseVersion !== "number" || !Number.isSafeInteger(baseVersion) || baseVersion < 0) return null;
  if (gen !== null && gen !== undefined && (typeof gen !== "string" || gen.length === 0 || gen.length > 64)) {
    return null;
  }
  if (doc === undefined) return null;
  return { baseVersion, gen: typeof gen === "string" ? gen : null, doc };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function snapshot(current: StoredDoc | null) {
  return {
    doc: current?.doc ?? null,
    version: current?.version ?? 0,
    gen: current?.gen ?? null,
    serverTime: Date.now(),
  };
}

const conflict = (current: StoredDoc | null) => json(409, { error: "conflict", ...snapshot(current) });

async function handleGet(userId: string): Promise<Response> {
  return json(200, snapshot(await getDoc(userId)));
}

async function handlePut(req: NextRequest, userId: string): Promise<Response> {
  const body = await readBody(req);
  if (body.ok === false) return fail(body.status, body.status === 413 ? "too_large" : "bad_request");
  const envelope = parseEnvelope(body.bytes);
  if (envelope === null) return fail(400, "bad_request");

  const checked = validateDoc(envelope.doc, { now: Date.now(), maxFutureMs: MAX_FUTURE_MS });
  if (checked.ok === false) return json(400, { error: "invalid_document", detail: checked.error });
  const incoming = checked.doc;

  // 1. Precondition against the stored document.
  const current = await getDoc(userId);
  if ((current?.version ?? 0) !== envelope.baseVersion) return conflict(current);
  if (current !== null && envelope.gen !== null && envelope.gen !== current.gen) return conflict(current);

  // 2. Join with what is stored. The server never overwrites: a stale, buggy
  //    or hostile client cannot lower bests or drop tombstones.
  let base: SyncDoc = emptyDoc();
  if (current !== null) {
    const stored = validateDoc(current.doc, { now: Date.now(), maxFutureMs: STORED_MAX_FUTURE_MS });
    if (stored.ok === false) {
      console.error(`[sync] stored document failed validation: ${stored.error}`);
      return fail(500, "internal");
    }
    base = stored.doc;
  }
  const now = Date.now();
  const joined = pruneDoc(mergeDocs(base, incoming), now, TOMBSTONE_TTL_MS);
  if (Buffer.byteLength(JSON.stringify(joined), "utf8") > LIMITS.docBytes) return fail(413, "too_large");
  // The join of two valid documents can still exceed a per-collection limit.
  const rechecked = validateDoc(joined, { now, maxFutureMs: STORED_MAX_FUTURE_MS });
  if (rechecked.ok === false) {
    console.error(`[sync] joined document failed validation: ${rechecked.error}`);
    // A count limit (e.g. more live layouts than LIMITS.layouts; pruneDoc has already evicted the
    // oldest tombstones to make room), not a size problem: a distinct code so the client can say so.
    return fail(413, "limit_exceeded");
  }
  const next = rechecked.doc;
  if (Buffer.byteLength(JSON.stringify(next), "utf8") > LIMITS.docBytes) return fail(413, "too_large");

  // 3. Compare-and-set. Losing a race is reported like any other conflict.
  const written = await putDoc(userId, {
    expectedVersion: current?.version ?? 0,
    expectedGen: current?.gen ?? null,
    doc: next,
  });
  if (written.ok === false) return conflict(await getDoc(userId));

  // 4. The client adopts the joined document.
  return json(200, { doc: next, version: written.version, gen: written.gen, serverTime: Date.now() });
}

async function handleDelete(userId: string): Promise<Response> {
  await deleteDoc(userId);
  return json(200, { ok: true });
}

async function handle(req: NextRequest): Promise<Response> {
  try {
    if (!getAuthConfig().enabled) return fail(404, "disabled");

    const method = req.method;
    if (method === "OPTIONS") {
      // No CORS headers, ever: a cross-origin preflight fails in the browser.
      return new Response(null, {
        status: 204,
        headers: { Allow: "GET, PUT, DELETE", "Cache-Control": "no-store", Vary: "Cookie" },
      });
    }
    if (method !== "GET" && method !== "HEAD" && method !== "PUT" && method !== "DELETE") {
      return fail(405, "method_not_allowed", { Allow: "GET, PUT, DELETE" });
    }

    if (!sameOriginRequest(req)) return fail(403, "forbidden_origin");

    const userId = await getUserId();
    if (userId === null) return fail(401, "unauthorized");

    // Defence in depth against an account switch in another tab: the client states which account it
    // BELIEVES it is acting for. This never selects the user (the session does); a mismatch only rejects.
    const claimed = req.headers.get("x-ll-user");
    if (claimed !== null && claimed !== userId) return fail(401, "wrong_user");
    if (claimed === null && (method === "PUT" || method === "DELETE")) return fail(401, "wrong_user");

    const rule = method === "PUT" ? RATE.write : method === "DELETE" ? RATE.delete : RATE.read;
    const rate = await hitRate(userId, rule.bucket, rule.limit, rule.windowSeconds);
    if (!rate.allowed) return fail(429, "rate_limited", { "Retry-After": String(rate.retryAfter) });

    if (method === "PUT") return await handlePut(req, userId);
    if (method === "DELETE") return await handleDelete(userId);
    return await handleGet(userId);
  } catch (err) {
    if (isDbUnavailable(err)) {
      console.error(`[sync] ${String(err.message).slice(0, 400)}`);
      return fail(503, "unavailable");
    }
    // Never log the error object itself: it could carry request data.
    console.error(`[sync] unexpected error: ${err instanceof Error ? err.name : "unknown"}`);
    return fail(500, "internal");
  }
}

export {
  handle as GET,
  handle as PUT,
  handle as DELETE,
  handle as POST,
  handle as PATCH,
  handle as OPTIONS,
};
