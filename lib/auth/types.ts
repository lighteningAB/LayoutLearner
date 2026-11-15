// Shared (client-safe) auth types. This file must not import anything
// server-only: it is imported by client components.

export type AuthProviderKind = "oauth" | "dev";

export interface PublicAuthProvider {
  id: string;
  name: string;
  kind: AuthProviderKind;
}

/** Serialised to the client. `enabled: false` always comes with `providers: []`. */
export interface PublicAuthConfig {
  enabled: boolean;
  providers: PublicAuthProvider[];
}

/** The only user fields that ever leave the server. No email, by design. */
export interface SessionUser {
  id: string;
  name: string | null;
  image: string | null;
}

/** Internal user ids: "u_" + base64url(sha256(provider + ":" + providerAccountId)). */
export const USER_ID_RE = /^u_[A-Za-z0-9_-]{43}$/;
