# Accounts and sync: owner setup

This document turns on optional accounts and cross-device sync for a deployment of Layout Learner, and explains how to run, verify and switch it off again. The production site is https://layout-learner.vercel.app, deployed from `main` on Vercel.

## 1. What the feature is

Without any configuration the app is fully local: settings, custom layouts and lesson progress live in the browser's `localStorage` and nothing is sent to a server.

With accounts enabled, a visitor can sign in with GitHub or Google. While signed in, the app keeps one JSON document per account in a Postgres database and merges it with the local data on every device the person signs in on. The document holds lesson progress, settings and custom layouts. Three settings stay device-local because they depend on the device: `emulateLayout`, `showHands` and `fontSize`. The database key is an opaque id (`u_` plus a SHA-256 of provider and provider account id); no email, name or avatar is written to the database. The same person signing in with GitHub and with Google gets two separate accounts.

The feature is off by default and fails closed. It is on only when all of these hold:

1. at least one provider has both of its variables set (`GITHUB_ID` and `GITHUB_SECRET`, or `GOOGLE_ID` and `GOOGLE_SECRET`);
2. `NEXTAUTH_SECRET` is at least 32 characters (required in production);
3. a database URL is set (`DATABASE_URL`, or `POSTGRES_URL` as a fallback; required in production).

If any of these is missing, the site shows no sign-in UI, and `/api/auth/*` and `/api/sync` answer `404` with `{"error":"disabled"}`. The rest of the app is unaffected. If no provider is configured the app logs nothing; if a provider is configured but the secret or database is missing, it logs one line saying why (section 11).

Sessions are JWTs in a cookie, valid for 30 days. There is no session table.

The on/off decision is read on the server and baked into statically rendered pages at build time. After changing any environment variable you must redeploy.

## 2. Prerequisites

- Owner access to the Vercel project (Hobby is enough).
- A GitHub account and/or a Google account for creating OAuth credentials. One provider is enough.
- The Vercel CLI, logged in and linked (`vercel login`, then `vercel link` in the repository root). It is needed only to pull environment variables for the migration in section 7.
- Node 22.18 or newer, and `yarn install` run once. `scripts/db.mjs` imports a `.ts` file directly and needs Node's type stripping. The property and simulation scripts in section 9 need Node 23.6 or newer.
- `openssl`, or any other way to produce 32 random bytes.

## 3. GitHub OAuth app

Create the app under your account or an organisation: profile picture, Settings, Developer settings, OAuth apps, New OAuth App (labels may differ slightly). Fill in:

| Field | Value |
|---|---|
| Application name | `Layout Learner` (shown to users on the consent screen) |
| Homepage URL | `https://layout-learner.vercel.app` |
| Application description | optional |
| Authorization callback URL | `https://layout-learner.vercel.app/api/auth/callback/github` |
| Enable Device Flow | leave off |

Click Register application, then generate a client secret. Copy the Client ID (`GITHUB_ID`) and the client secret (`GITHUB_SECRET`) immediately; the secret is shown once. The app requests only the `read:user` scope: it reads the public profile (numeric id, display name, avatar) and never asks for the email address.

Local development. Create a second OAuth app used only on your machine, with Homepage URL `http://localhost:3000` and callback URL `http://localhost:3000/api/auth/callback/github`, so the production secret never sits in a local file. (GitHub's current documentation says one OAuth app can hold up to 10 callback URLs through "Add callback URL", so adding the localhost URL to the production app also works; a separate app is simply tidier.) Local development does not need GitHub at all if you use the dev login (section 9).

Vercel preview deployments get a new hostname per branch and commit, and the callback URL must match exactly, so OAuth cannot work on previews. Either leave the provider variables unset for the Preview environment (the feature is then simply off there), or scope them to Production only (section 6).

## 4. Google OAuth client

In the Google Cloud console, create or choose a project and open Google Auth Platform, Clients (older consoles: APIs and Services, Credentials, Create credentials, OAuth client ID). If asked, finish the app registration (branding: app name, support email, developer contact) first. Then create a client:

| Field | Value |
|---|---|
| Application type | Web application |
| Name | `Layout Learner` |
| Authorized JavaScript origins | `https://layout-learner.vercel.app` and, for local use, `http://localhost:3000` |
| Authorized redirect URIs | `https://layout-learner.vercel.app/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google` |

The redirect URIs are what this app needs, because the server handles the OAuth response; the origins are harmless. Google does not accept wildcards, paths or raw IP addresses, and requires https except for localhost. Copy the client ID (`GOOGLE_ID`) and client secret (`GOOGLE_SECRET`); Google shows the full secret only when the client is created. Changes to a client can take from about five minutes to a few hours to apply.

Scopes: the app requests only `openid profile`.

Publishing status (the Audience page of Google Auth Platform). A new project starts in Testing: only users you list as test users, at most 100, can sign in. For a public site set the status to In production with the Publish app button. Google's documentation states that apps requesting only the openid, profile and email scopes are exempt from the unverified-app warning and from the 7-day authorization expiry that applies to other Testing apps, but users who are not on the test list are still blocked until the app is published.

## 5. Database: Neon through the Vercel Marketplace

1. In the Vercel dashboard open the Marketplace, find Neon and click Install. Choose Create New Neon Account unless you already have a Neon account (then use Link Existing Neon Account), pick a region close to your Vercel functions, pick the Free plan, accept the terms and name the database. In Vercel's terms a "Database" is a Neon project. Vercel then opens the Storage tab for it.
2. In the Storage tab open the database and choose Connect Project. Select the Layout Learner project and the environments that should receive the variables.
   - Production: required.
   - Development: connect it if you want `vercel env pull` to give you a connection string.
   - Preview: optional. "Create database branch for deployment" can create a Neon branch per preview deployment, but sign-in does not work on previews (section 3), so this is of no use unless you configured provider variables for Preview. Leave Production unchecked for branching.
3. Leave the custom prefix empty.

The integration injects `DATABASE_URL` (pooled connection string), `DATABASE_URL_UNPOOLED` (direct), `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`, and legacy `POSTGRES_*` variables. The app reads `DATABASE_URL`, then falls back to `POSTGRES_URL`, and uses Neon's serverless HTTP driver, which works with the pooled URL. The other variables are unused and harmless. The exact button labels in the Vercel and Neon dashboards may differ from the above.

Free plan caveats (from Neon's plan page at the time of writing; check it before relying on them): 1 GB storage per project, 100 compute-hours per project per month, and scale to zero after 5 minutes idle, which cannot be turned off on Free. After an idle period the first request has to wake the database and is slower; the app's query timeout is 8 seconds. If the compute allowance is used up the database is suspended until the next billing period, and sync answers `503`; the app itself keeps working locally. If the storage cap is hit, writes fail but reads still work. Each account document is at most 256 KB, so storage is not a concern at personal scale.

## 6. Environment variables

Set these in the Vercel project under Settings, Environment Variables. Never commit real values; `.env.example` lists the names with empty values, and `.env.local` is git-ignored.

| Name | Required | Value comes from | Vercel environments |
|---|---|---|---|
| `NEXTAUTH_SECRET` | yes (production) | `openssl rand -base64 32`. At least 32 characters; a shorter value turns the feature off | Production |
| `NEXTAUTH_URL` | recommended | `https://layout-learner.vercel.app` | Production only |
| `GITHUB_ID`, `GITHUB_SECRET` | one provider pair needed | GitHub OAuth app (section 3) | Production |
| `GOOGLE_ID`, `GOOGLE_SECRET` | one provider pair needed | Google OAuth client (section 4) | Production |
| `DATABASE_URL` | yes (production) | Injected by the Neon integration (`POSTGRES_URL` is accepted as a fallback) | Production (injected); Development if you want it for `vercel env pull` |
| `AUTH_DEV_LOGIN` | never on Vercel | `1`, in your local `.env.local` only | none |
| `LL_PGLITE_DIR` | never on Vercel | Local dev database directory, default `.data/pglite` | none |
| `NEXT_DIST_DIR` | never on Vercel | Alternative Next.js build directory for local servers, default `.next` | none |

Notes:

- `NEXTAUTH_URL` is optional on Vercel, where next-auth derives the site URL from the forwarded host. Setting it to the canonical https URL is still recommended. The sync API accepts requests whose `Origin` matches `NEXTAUTH_URL` or the deployment host.
- `AUTH_DEV_LOGIN` is ignored in production builds and on Vercel (the code is not in the production bundle). Do not set it there anyway.
- To keep the feature off on Preview deployments, do not tick Preview when adding the provider variables. With no provider variables the feature is off and logs nothing.

## 7. Create the tables

The tables do not exist until you create them. This is a one-time step per database.

```bash
vercel env pull .env.local
yarn db:migrate
```

`vercel env pull` pulls the Development environment by default. If you connected Neon only to Production, pull that instead:

```bash
vercel env pull .env.local --environment=production
```

`.env.local` is git-ignored. Delete it afterwards if you do not want a production connection string on your disk. You can also pass the URL for one command only:

```bash
DATABASE_URL='<connection string from the Vercel Storage tab>' yarn db:migrate
```

`yarn db:migrate` is `node scripts/db.mjs migrate`. It runs two `CREATE TABLE IF NOT EXISTS` statements, so it is idempotent and safe to repeat, and prints `migrate: Postgres (DATABASE_URL): ensured tables ll_sync_docs, ll_sync_rate`.

- `ll_sync_docs`: one row per account: `user_id`, `gen`, `version`, `doc` (jsonb, limited to 1 MiB by a constraint and to 256 KB by the API), `updated_at`.
- `ll_sync_rate`: rate-limit counters per account and bucket.

The script reads `DATABASE_URL` (or `POSTGRES_URL`) from the shell environment first, then from `.env.local`, and never prints the connection string. If neither is set it silently uses the local PGlite database, so check that the first output line says `Postgres (DATABASE_URL)` and not `PGlite`. It needs Node 22.18 or newer.

Check the result:

```bash
yarn db:dump
node scripts/db.mjs dump --doc
```

`dump` prints one line per account (`user_id`, `gen`, `version`, `updated_at`, `doc_bytes`) and a row count; `--doc` also prints each document, which contains progress data and no identity. A fresh database prints `0 rows`; before `migrate` it prints `0 rows (tables not created yet; run: node scripts/db.mjs migrate)`.

## 8. Deploy and verify

Environment variable changes take effect only on a new deployment. Redeploy production from the Vercel dashboard (Deployments, the latest one, Redeploy) or push to `main`.

Checklist:

1. Open https://layout-learner.vercel.app. A sign-in control is visible.
2. The provider list shows exactly what you configured and no `dev` entry:
   ```bash
   curl -s https://layout-learner.vercel.app/api/auth/providers
   ```
3. Sign in with GitHub, sign out, sign in with Google (if both are configured).
4. Complete a lesson. Open the site in another browser or a separate browser profile, sign in with the same account, and confirm the progress appears.
5. Open Settings and find the account and sync section (its exact heading may differ in the current UI). Use Export to download your data, then Delete account data to erase the server copy.
6. Check the database before and after the delete (with a production `DATABASE_URL` available as in section 7):
   ```bash
   yarn db:dump
   ```
   After step 4 your account has a row; after the delete it is gone. A `delete` rate-limit counter for the id may remain for up to an hour; it holds only the opaque id, a timestamp and a count, and is cleaned up on a later deletion.
7. The API gate, from a terminal and signed out:
   ```bash
   curl -i https://layout-learner.vercel.app/api/sync
   curl -i -H 'X-LL-Sync: 1' https://layout-learner.vercel.app/api/sync
   ```
   The first answers `403` with `{"error":"forbidden_origin"}` (the `X-LL-Sync` header is missing). The second answers `401` with `{"error":"unauthorized"}` (no session cookie). A `404` with `{"error":"disabled"}` means the feature is off (section 11).

## 9. Local development

Local development needs no OAuth app and no cloud database. Create `.env.local` (git-ignored):

```
AUTH_DEV_LOGIN=1
NEXTAUTH_URL=http://localhost:3000
```

Then run `yarn dev`. With no `DATABASE_URL` set the server uses PGlite (Postgres compiled to WASM) in `.data/pglite` and creates the tables itself on first use, so `yarn db:migrate` is not needed locally. With no `NEXTAUTH_SECRET` a fixed insecure development secret is used; a secret that is set but shorter than 32 characters turns the feature off even in development. The "Dev login" provider accepts any username matching `[a-z0-9_-]{1,24}` with no password, which makes it easy to test as several users. It exists only when `NODE_ENV` is not production and the app is not running on Vercel.

To test real GitHub or Google sign-in locally, add the provider variables with the local credentials from sections 3 and 4.

A PGlite directory must be opened by one process only. The dev server holds a lock file `<dir>.lock`. `yarn db:dump` works while the server runs (it reads a copy); `migrate` and `reset` refuse until you stop the server. To run a second server side by side, give it its own `LL_PGLITE_DIR` and `NEXT_DIST_DIR`.

Verification tools:

```bash
# Multi-device browser check (headless Chrome through playwright-core; needs Google Chrome).
# The default base URL is http://localhost:3100.
NEXT_DIST_DIR=.next-3100 LL_PGLITE_DIR=.data/pglite-3100 AUTH_DEV_LOGIN=1 NEXTAUTH_URL=http://localhost:3100 yarn dev -p 3100
node scripts/verify-sync.mjs dev:A goto:/ devlogin:alice dev:B goto:/ devlogin:alice
node scripts/verify-sync.mjs --base http://localhost:3000 dev:A goto:/ devlogin:alice "api:GET /api/sync"

# Property tests of the merge core (merge laws on thousands of random documents)
node scripts/sync-property.mjs --cases 5000 --seed 1

# Randomised simulation of the client sync logic against a model server
node scripts/sync-engine-sim.mjs --runs 400 --devices 3 --seed 1
```

The header of `scripts/verify-sync.mjs` lists every step (`dev:`, `fresh:`, `devlogin:`, `api:`, `apiraw:`, `lesson:`, `block:`, `assert:` and more). A failure in either Node script prints the seed and a repro. Both need Node 23.6 or newer.

## 10. Turning the feature off

Remove the provider variables (`GITHUB_ID`, `GITHUB_SECRET`, `GOOGLE_ID`, `GOOGLE_SECRET`) from the Production environment, or remove `NEXTAUTH_SECRET` or the database URL, and redeploy. The sign-in UI disappears and the API answers `404 {"error":"disabled"}`.

Effect on users: the site behaves as it does for a visitor who never signed in. Their settings, layouts and progress stay in their browser, and their session cookies are no longer honoured. Nothing syncs until the feature is switched on again; after that, signing in resumes sync and merges what changed locally in the meantime.

The data in Neon stays until you delete it. To erase every account's data while keeping the tables:

```bash
node scripts/db.mjs reset --yes
```

It needs the production `DATABASE_URL` in the environment or `.env.local`, refuses to run without `--yes`, and deletes all rows in `ll_sync_docs` and `ll_sync_rate`. To remove the tables as well, delete the database in the Vercel Storage tab or the Neon console. Users can also delete their own server copy from Settings.

## 11. Operations

Rotating `NEXTAUTH_SECRET`. Sessions are JWTs signed with this secret, so a new secret signs everyone out; they see "Session expired" and sign in again. No data is lost: the account id is a SHA-256 of the provider name and the provider's account id (`deriveUserId` in `lib/auth/options.ts`) and does not involve the secret. Local data on each device is kept and merges on the next sign-in.

Limits (from `app/api/sync/route.ts` and `lib/sync/doc.ts`):

- Account document: 256 KB. A write over that returns `413 too_large`.
- Request rate per account: reads 240 per minute, writes 60 per minute, account-data deletions 10 per hour. Over the limit gives `429 rate_limited` with a `Retry-After` header.
- Deleted custom layouts leave a tombstone for 180 days so that deletions propagate; a device offline for longer than that may bring a deleted layout back.
- The server merges every incoming document into the stored one instead of overwriting it, so a stale device cannot lower best scores.

What is stored: per account, the opaque user id, the synced document (lesson stars, best WPM and accuracy, attempt counters, settings, custom layouts) and timestamps. No email, name or avatar is stored; the display name and avatar live in the session cookie to show who is signed in. The public statement is at `/privacy`; keep it in step with this document if what is stored changes.

Server log lines the code prints (Vercel runtime logs):

- `[auth] NEXTAUTH_SECRET is missing or shorter than 32 characters; accounts and sync are disabled. Generate one with: openssl rand -base64 32`
- `[auth] DATABASE_URL is not set; accounts and sync are disabled in production.`
- `[auth] <code>`: a next-auth error code (full error objects are not logged).
- `[sync] database query failed (...)`, `[sync] database client could not be created (...)`: storage problems. Connection strings are redacted.
- `[sync] unexpected error: <name>` and `[sync] stored document failed validation: ...`: unexpected failures.

Troubleshooting:

| Symptom | Check |
|---|---|
| No sign-in UI on production | `curl -i https://layout-learner.vercel.app/api/auth/providers`; a `404` with `disabled` means the feature is off. In Production confirm: a provider has both its ID and secret set, `NEXTAUTH_SECRET` has 32 or more characters, `DATABASE_URL` is set. Look for the two `[auth]` log lines above. Then redeploy: the setting is baked in at build time. A provider with only one of its two values counts as not configured and logs nothing. |
| Works on production but not on a preview URL | Expected; OAuth callbacks cannot match a changing hostname (section 3). |
| `redirect_uri_mismatch` (Google) or a redirect URI mismatch message (GitHub) | The callback URL registered with the provider does not match exactly. It must be `<site origin>/api/auth/callback/github` or `/google`: same scheme and host, no trailing slash. `localhost` and `127.0.0.1` are different hosts. Google changes can take minutes to hours. |
| Google "Access blocked" for other people | The audience is still Testing. Publish it (section 4). |
| Sync error, `/api/sync` answers `503 {"error":"unavailable"}` | The database is unreachable or the tables are missing. Run `yarn db:migrate` against the production database, check the Neon project is not suspended, and read the `[sync] database ...` log line. |
| "Session expired" | The server answered 401: the 30-day session ended, the cookie was cleared, or `NEXTAUTH_SECRET` changed. Sign in again; local data is untouched. |
| `403 forbidden_origin` in the browser | The request did not come from an origin the server recognises, for example a custom domain that differs from `NEXTAUTH_URL`. Set `NEXTAUTH_URL` to the domain people actually use. |
| `429 rate_limited` | Too many requests for one account; wait for `Retry-After` seconds. |
| `yarn db:migrate` prints "PGlite" or fails to import | No database URL was found (run `vercel env pull`), or Node is older than 22.18. |
