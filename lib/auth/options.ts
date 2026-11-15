import "server-only";
import { createHash } from "node:crypto";
import type { NextAuthOptions } from "next-auth";
import type { Provider } from "next-auth/providers/index";
import CredentialsProvider from "next-auth/providers/credentials";
import GithubProvider from "next-auth/providers/github";
import GoogleProvider from "next-auth/providers/google";
import { devLoginEnabled, getAuthConfig, getAuthSecret, githubEnabled, googleEnabled } from "./config";
import { USER_ID_RE } from "./types";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const DEV_USERNAME_RE = /^[a-z0-9_-]{1,24}$/;
const KNOWN_PROVIDERS = new Set(["github", "google", "dev"]);

/** Stable internal id. Provider ids never contain ":", so the encoding is unambiguous. */
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
          async authorize(credentials) {
            if (process.env.NODE_ENV === "production") return null;
            if (!devLoginEnabled()) return null;
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
    // for OAuth failures provider responses). Log the code only.
    logger: {
      error(code) {
        console.error(`[auth] ${String(code)}`);
      },
      warn(code) {
        if (process.env.NODE_ENV !== "production") console.warn(`[auth] ${String(code)}`);
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
            name: cleanName(user?.name),
            picture: cleanImage(user?.image),
          };
        }
        // Later requests: carry forward only the allow-listed claims.
        const next: Record<string, unknown> = {
          name: cleanName(token.name),
          picture: cleanImage(token.picture),
        };
        if (typeof token.uid === "string" && USER_ID_RE.test(token.uid)) next.uid = token.uid;
        for (const claim of ["iat", "exp", "jti"] as const) {
          if (token[claim] !== undefined) next[claim] = token[claim];
        }
        return next;
      },
      async session({ session, token }) {
        const uid = typeof token.uid === "string" && USER_ID_RE.test(token.uid) ? token.uid : null;
        if (uid === null) return { expires: session.expires };
        return {
          user: { id: uid, name: cleanName(token.name), image: cleanImage(token.picture) },
          expires: session.expires,
        };
      },
    },
  };
}
