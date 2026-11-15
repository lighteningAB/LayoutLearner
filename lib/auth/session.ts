import "server-only";
import { getServerSession } from "next-auth";
import { getAuthOptions } from "./options";
import { USER_ID_RE } from "./types";

/**
 * The signed-in user's internal id, for route handlers. Null when the feature
 * is off, there is no valid session, or the session carries no well-formed id.
 * This is the ONLY source of user identity for the API.
 */
export async function getUserId(): Promise<string | null> {
  const options = getAuthOptions();
  if (!options) return null;
  let session: unknown;
  try {
    session = await getServerSession(options);
  } catch {
    return null;
  }
  const id = (session as { user?: { id?: unknown } } | null)?.user?.id;
  return typeof id === "string" && USER_ID_RE.test(id) ? id : null;
}
