// Narrow next-auth's session/JWT types to what this app actually stores.
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    // `email` is never sent (it is stripped from the token at sign-in); it is
    // typed as always-absent only so older code reading it still compiles.
    user?: { id: string; name: string | null; image: string | null; email?: null };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid?: string;
    /** Epoch seconds of the sign-in this session came from. Set once, never refreshed. */
    authTime?: number;
  }
}
