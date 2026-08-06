# Pre-Build Setup Checklist

Ordered so each step's prerequisites are already in place by the time you reach it. Google sign-in needs a Supabase project to exist first (its redirect URI points at Supabase's callback URL), so accounts come before OAuth configuration. Apple Sign In is deferred until an Apple Developer Program membership is set up — see the note in step 4.

## 1. GitHub

- Create the repo.
- Enable Dependabot (Settings → Security → Dependabot alerts + version updates) — zero-cost, closes out item 13 from the security review immediately.

## 2. Supabase

- Create an account and a new project. Note down, from Project Settings → API: the project URL, the `anon` public key, and the `service_role` key (this last one is sensitive — never exposed client-side, per the secrets-management rule already in the doc).
- Install the Supabase CLI locally (`npm install -g supabase`) for running migrations and local dev (`supabase start` runs a local Postgres via Docker, so schema changes can be tested before pushing).
- Create two Storage buckets: `checkin-photos` and `avatars`, and set their RLS policies per architecture doc section 18 item 3 (shared-group + not-hidden for check-in photos; open-read/owner-write for avatars).
- Auth → Providers: enable Google (configuration happens in step 3, but the toggle and redirect URI live here). Leave Apple off for now — see step 4.

## 3. Google OAuth

- In Google Cloud Console: create a project (or reuse one), configure the OAuth consent screen, then create an OAuth 2.0 Client ID (type: Web application).
- Authorized redirect URI: the callback URL Supabase gives you under Auth → Providers → Google (format is `https://<project-ref>.supabase.co/auth/v1/callback`).
- Paste the resulting Client ID and Client Secret into Supabase's Google provider settings — these live in Supabase's dashboard, not in the app's own environment variables.

## 4. Apple Sign In — deferred

Skipped for now, no Apple Developer Program membership ($99/year) set up yet. Google-only auth is enough to build and ship v1 — Supabase Auth handles providers independently, so adding Apple later is just enabling the toggle and following the steps below, no schema or code changes needed elsewhere in the app.

When ready to add it:
- Requires an active Apple Developer Program membership ($99/year) — hard prerequisite, even for web-only Sign in with Apple.
- Create an App ID with the "Sign In with Apple" capability enabled, then a Services ID (this is the client ID used for web auth).
- Configure the Services ID's domains and return URLs to point at Supabase's Apple callback URL.
- Generate a Sign in with Apple private key (.p8 file) — note the Key ID and your Team ID alongside it.
- Enter the Services ID, Team ID, Key ID, and the private key into Supabase's Apple provider settings.

## 5. Upstash Redis

- Create an account, create a Redis database (regional is fine for a v1 launch; global adds cost that isn't justified yet).
- Note the REST URL and REST Token from the database's dashboard — these go into the app's environment variables (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`).

## 6. Cloudflare Turnstile

- Create a Cloudflare account (free tier is sufficient), add a Turnstile site for your domain.
- Note the Site Key (client-side, safe to expose) and Secret Key (server-side only, used to verify tokens on submit).

## 7. Web Push (VAPID keys)

- Generate a VAPID key pair — the `web-push` npm package has a CLI for this (`npx web-push generate-vapid-keys`).
- Public key goes client-side (used when subscribing a browser to push); private key stays server-side only, alongside the other secrets already flagged in the architecture doc.

## 8. Domain — optional, deferred

Not a hard requirement for v1. A PWA needs HTTPS and a valid manifest, both of which `*.vercel.app` already provides — "add to home screen" and offline behavior work fine on the free Vercel subdomain. The one real hard requirement for a custom domain is Apple Sign In's domain verification, which is itself deferred (step 4). Register a domain later when it's actually needed for launch/branding or when Apple Sign In gets added back in — no need to spend money on it now.

## 9. Vercel

- Create an account, import the GitHub repo as a new project (framework preset: Next.js — should auto-detect).
- Skip setting a custom domain for now — the default `*.vercel.app` URL works for development and testing (see step 8).
- Add all environment variables from the list below in Project Settings → Environment Variables, split correctly between Production/Preview/Development as needed.

## 10. Environment variables (consolidated)

Client-exposed (`NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`

Server-only (never bundled to the client, per the architecture doc's explicit secrets-management rule):
- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `VAPID_PRIVATE_KEY`
- `TURNSTILE_SECRET_KEY`

## 11. Core npm packages

Framework/data: `next`, `react`, `typescript`, `@supabase/supabase-js`, `@supabase/ssr`, `@tanstack/react-query`, `zustand`, `tailwindcss`.

Infra: `@upstash/redis`, `@upstash/ratelimit`, `web-push`.

Product-specific, tied to decisions already made: `browser-image-compression` (client-side photo compression before upload), `obscenity` (username/group-name profanity filtering).

PWA: `next-pwa` — decided, see architecture doc section 2.

Testing: `vitest`, `@testing-library/react`.

Not yet: `pixi.js` and anything else galaxy-specific — hold off installing until Phase 2 actually starts, no reason to carry the dependency weight before then.

## 12. Build-time decisions — resolved

- **PWA tooling**: `next-pwa` (see section 11).
- **Postgres migration structure**: one large initial migration covering every v1 table (users through `audit_log`, `user_blocks`, `group_daily_completion`, `group_member_category_stats` — excluding the deferred galaxy tables in architecture doc sections 11-15), rather than splitting by feature area. Matches how the schema was designed as one cohesive unit; later schema changes get their own individual migrations as normal.
- **CI pipeline**: GitHub Actions workflow added now (Vitest on every PR + `npm audit`), rather than waiting for real code/tests to exist — see the workflow file provided alongside this checklist.
