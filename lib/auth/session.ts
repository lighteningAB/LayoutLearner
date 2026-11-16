import "server-only";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { cookies, headers } from "next/headers";
import { refusedOutsideLoopback } from "./config";
import { getAuthOptions, tokenUserId } from "./options";
import { USER_ID_RE } from "./types";

/** The user the session cookie itself stands for, checked without going through next-auth's callbacks. */
async function userIdFromCookie(secret: string): Promise<string | null> {
  const jar: Record<string, string> = {};
  for (const cookie of (await cookies()).getAll()) jar[cookie.name] = cookie.value;
  // Cookies only: no request headers are passed, so an Authorization header can never stand in for the cookie.
  // The cookie is named "__Secure-..." on https and plain otherwise; whichever is present has to decode
  // with our secret, and the caller additionally requires it to name the same user as the session.
  for (const secureCookie of [true, false]) {
    const token = await getToken({ req: { cookies: jar, headers: {} } as never, secret, secureCookie });
    const id = tokenUserId(token);
    if (id !== null) return id;
  }
  return null;
}

/**
 * The signed-in user's internal id, for route handlers. Null when the feature
 * is off, there is no valid session, the session carries no well-formed id, or
 * the session is past its absolute lifetime (30 days from sign-in; tokens
 * without a sign-in time are invalid). This is the ONLY source of user
 * identity for the API.
 *
 * The lifetime is enforced twice on purpose: by the jwt/session callbacks
 * (through getServerSession) and here, directly on the decoded cookie.
 */
export async function getUserId(): Promise<string | null> {
  const options = getAuthOptions();
  if (!options || typeof options.secret !== "string") return null;
  let session: unknown;
  let fromCookie: string | null;
  try {
    // Development with the public fallback secret: loopback requests only.
    if (refusedOutsideLoopback((await headers()).get("host"))) return null;
    session = await getServerSession(options);
    fromCookie = await userIdFromCookie(options.secret);
  } catch {
    return null;
  }
  const id = (session as { user?: { id?: unknown } } | null)?.user?.id;
  if (typeof id !== "string" || !USER_ID_RE.test(id)) return null;
  return fromCookie === id ? id : null;
}
