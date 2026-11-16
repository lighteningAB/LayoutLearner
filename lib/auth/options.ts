import "server-only";
import { createHash } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { devLoginEnabled, getAuthConfig, getAuthSecret, githubEnabled, googleEnabled, isLoopbackHost } from "./config";
import { USER_ID_RE } from "./types";

/**
 * ABSOLUTE session lifetime, counted from the sign-in (`authTime`), and also
 * the cookie's max-age. next-auth re-issues the cookie with a fresh 30-day
 * `exp` on every session check, so `exp` alone would let a session (or a
 * copied cookie) live forever as long as it is used; `authTime` is set once
 * at sign-in, never refreshed, and checked on every request.
 *
 * There is deliberately no server-side revocation: sessions are stateless
 * JWTs. Signing out deletes the cookie in that browser only; a copy of the
 * cookie stays usable until 30 days after the sign-in it came from.
 */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
/** How far in the future an `authTime` may lie (clock differences between server instances). */
const AUTH_TIME_SKEW_SECONDS = 5 * 60;
const SESSION_OVER = "session lifetime over";
const DEV_USERNAME_RE = /^[a-z0-9_-]{1,24}$/;
const KNOWN_PROVIDERS = new Set(["github", "google", "dev"]);
/** Codes next-auth itself logs look like OAUTH_CALLBACK_ERROR; anything else is not printed. */
const LOG_CODE_RE = /^[A-Z0-9_]{1,64}$/;

function logCode(code: unknown): string {
  return typeof code === "string" && LOG_CODE_RE.test(code) ? code : "UNRECOGNISED_CODE";
}

/**
 * The user a decoded session token stands for, or null. A token counts only
 * if it carries a well-formed id AND a sign-in time (`authTime`, epoch
 * seconds) less than SESSION_MAX_AGE_SECONDS ago. Tokens without `authTime`
 * are invalid. This is the single definition used by the jwt and session
 * callbacks and by getUserId().
 */
export function tokenUserId(
  token: { uid?: unknown; authTime?: unknown } | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string | null {
  if (!token) return null;
  const { uid, authTime } = token;
  if (typeof uid !== "string" || !USER_ID_RE.test(uid)) return null;
  if (typeof authTime !== "number" || !Number.isSafeInteger(authTime) || authTime <= 0) return null;
  if (authTime > nowSeconds + AUTH_TIME_SKEW_SECONDS) return null;
  if (nowSeconds - authTime >= SESSION_MAX_AGE_SECONDS) return null;
  return uid;
}

/**
 * Internal account id: a PSEUDONYM, not an anonymous value. It is a plain,
 * unsalted SHA-256 of "<provider>:<the provider's account number>", so it is
 * stable (the same account always maps to the same id, whatever the signing
 * secret) and contains no name or email -- but it is NOT irreversible in
 * practice: provider account numbers are guessable (GitHub's are small
 * sequential integers), so whoever holds an id can hash candidates until one
 * matches and learn which GitHub/Google account it belongs to. Treat it as
 * personal data. (No secret "pepper" is mixed in on purpose: losing or
 * rotating it would orphan every account, and whoever can read the database
 * can usually read the server's secrets too.)
 *
 * Provider ids never contain ":", so the encoding is unambiguous.
 */
export function deriveUserId(provider: string, providerAccountId: string): string {
  return "u_" + createHash("sha256").update(`${provider}:${providerAccountId}`, "utf8").digest("base64url");
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return name === "" ? null : name;
}

function cleanImage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (githubEnabled()) {
    providers.push(
      GithubProvider({
        clientId: (process.env.GITHUB_ID ?? "").trim(),
        clientSecret: (process.env.GITHUB_SECRET ?? "").trim(),
        // Minimal scope: no `user:email`. The stock provider also calls
        // /user/emails when the profile has no public email; replace that
        // request so the email endpoint is never touched.
        authorization: { params: { scope: "read:user" } },
        userinfo: {
          url: "https://api.github.com/user",
          async request({ client, tokens }) {
            return await client.userinfo(tokens.access_token as string);
          },
        },
        profile(profile) {
          return {
            id: String(profile.id),
            name: profile.name ?? profile.login ?? null,
            image: profile.avatar_url ?? null,
          };
        },
      }),
    );
  }

  if (googleEnabled()) {
    providers.push(
      GoogleProvider({
        clientId: (process.env.GOOGLE_ID ?? "").trim(),
        clientSecret: (process.env.GOOGLE_SECRET ?? "").trim(),
        // Minimal scope: no `email`. The id token still carries sub/name/picture.
        authorization: { params: { scope: "openid profile" } },
        profile(profile) {
          return {
            id: String(profile.sub),
            name: profile.name ?? null,
            image: profile.picture ?? null,
          };
        },
      }),
    );
  }

  // Passwordless dev login. The literal NODE_ENV check makes this whole block
  // (including the marker string below) dead code in a production build.
  if (process.env.NODE_ENV !== "production") {
    if (devLoginEnabled()) {
      providers.push(
        CredentialsProvider({
          id: "dev",
          name: "Dev login",
          credentials: { username: { label: "Username", type: "text" } },
          async authorize(credentials, req) {
            if (process.env.NODE_ENV === "production") return null;
            if (!devLoginEnabled()) return null;
            // Passwordless: only for requests addressed to this machine by a
            // loopback name. `next dev` listens on every interface, so a
            // browser elsewhere on the network could otherwise sign in as
            // anyone. (Host header, not X-Forwarded-Host; see isLoopbackHost
            // for what this does and does not stop.)
            const host = (req?.headers as Record<string, unknown> | undefined)?.host;
            if (typeof host !== "string" || !isLoopbackHost(host)) {
              console.warn("[auth] dev login refused: the request's Host is not localhost");
              return null;
            }
            const username = credentials?.username;
            if (typeof username !== "string" || !DEV_USERNAME_RE.test(username)) return null;
            // The literal below is grepped for in production bundles to prove
            // this code is absent there.
            console.warn("[auth] dev-login-marker-7f3a9c: passwordless dev sign-in used");
            return { id: username, name: username, image: null };
          },
        }),
      );
    }
  }

  return providers;
}

/** next-auth options, or null when the feature is off. Built per call: env is read at call time. */
export function getAuthOptions(): NextAuthOptions | null {
  if (!getAuthConfig().enabled) return null;
  const secret = getAuthSecret();
  if (secret === null) return null;
  const providers = buildProviders();
  if (providers.length === 0) return null;

  return {
    secret,
    providers,
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
    jwt: { maxAge: SESSION_MAX_AGE_SECONDS },
    // The app drives sign-in from its own dialog; no stock next-auth page is reachable.
    pages: { signIn: "/", signOut: "/", error: "/", verifyRequest: "/", newUser: "/" },
    // next-auth's default logger prints full error objects (stack traces, and
    // for OAuth failures provider responses). Log the code only, and only if
    // it looks like one of next-auth's own codes: nothing a caller can choose
    // (newlines, long strings) reaches the log. The browser-facing log relay
    // (POST /api/auth/_log) is additionally switched off in the route handler.
    logger: {
      error(code, metadata) {
        // An over-age session is routine, not an error (see the jwt callback).
        if (code === "JWT_SESSION_ERROR" && (metadata as { message?: unknown } | undefined)?.message === SESSION_OVER) return;
        console.error(`[auth] ${logCode(code)}`);
      },
      warn(code) {
        if (process.env.NODE_ENV !== "production") console.warn(`[auth] ${logCode(code)}`);
      },
      debug() {},
    },
    callbacks: {
      async signIn({ account }) {
        if (!account || !KNOWN_PROVIDERS.has(account.provider)) return false;
        if (account.type === "credentials") {
          // Second, independent gate for the dev provider.
          if (process.env.NODE_ENV === "production") return false;
          return account.provider === "dev" && devLoginEnabled();
        }
        return account.type === "oauth" && account.provider !== "dev";
      },
      async jwt({ token, account, user }) {
        if (account) {
          // Sign-in: build the token from scratch so nothing next-auth put in
          // it by default (email, provider subject) survives.
          const accountId = account.providerAccountId;
          if (!KNOWN_PROVIDERS.has(account.provider) || typeof accountId !== "string" || accountId === "") {
            throw new Error("invalid account");
          }
          if (account.provider === "dev") {
            if (process.env.NODE_ENV === "production" || !devLoginEnabled() || !DEV_USERNAME_RE.test(accountId)) {
              throw new Error("dev login disabled");
            }
          }
          return {
            uid: deriveUserId(account.provider, accountId),
            // Set here and nowhere else: the session's absolute lifetime runs from this moment.
            authTime: Math.floor(Date.now() / 1000),
            name: cleanName(user?.name),
            picture: cleanImage(user?.image),
          };
        }
        // Later requests. A token that is past its absolute lifetime (or has
        // no sign-in time, or no valid id) ends here: throwing makes next-auth
        // answer the session check with `{}` and delete the cookie, instead
        // of re-issuing it for another 30 days.
        const uid = tokenUserId(token);
        if (uid === null) throw new Error(SESSION_OVER);
        // Carry forward only the allow-listed claims; `authTime` is copied, never renewed.
        const next: Record<string, unknown> = {
          uid,
          authTime: token.authTime,
          name: cleanName(token.name),
          picture: cleanImage(token.picture),
        };
        for (const claim of ["iat", "exp", "jti"] as const) {
          if (token[claim] !== undefined) next[claim] = token[claim];
        }
        return next;
      },
      async session({ session, token }) {
        // Independent of the jwt callback: no valid id or sign-in time, no user.
        const uid = tokenUserId(token);
        if (uid === null) return { expires: session.expires };
        // `expires` is the end of the absolute lifetime, not next-auth's sliding "30 days from now".
        const end = ((token.authTime as number) + SESSION_MAX_AGE_SECONDS) * 1000;
        return {
          user: { id: uid, name: cleanName(token.name), image: cleanImage(token.picture) },
          expires: new Date(end).toISOString(),
        };
      },
    },
  };
}
