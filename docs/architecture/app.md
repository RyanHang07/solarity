# The application

Premise, stack, directory and route structure, Circles and invites, realtime, PWA and push, environment.

---

## 1. Premise

Friends who see each other's daily progress motivate each other to stay consistent. Small invite-only Circles (max 10), each member tracking their own daily goals, checking in once a day. Progress surfaces as a daily batched digest rather than live noise.

Build phases, screen inventory and the deferred galaxy visualization are in `product-and-design.md`. `goal_categories` is in v1 even though its main consumer is deferred: a category is required at goal creation regardless, and it is useful for filtering and stats.

---

## 2. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server rendering for fast first paint on iOS Safari; native Vercel integration. Note the `middleware` file convention is renamed `proxy` in 16. |
| Language | TypeScript, strict | Schema-heavy app |
| Data fetching | TanStack Query | Client cache over Supabase |
| Client state | Zustand | Lightweight |
| Styling | Tailwind | Fast iteration |
| Backend | Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) | One vendor; Postgres gives full SQL and RLS |
| Auth | Google only (v1) | Apple deferred pending a developer account: adding it later is a provider toggle, not a schema change |
| Cache / rate limit | Upstash Redis (REST) | Serverless-friendly |
| Hosting | Vercel | Native Next.js, cron support |
| Scheduled jobs | pg_cron (+ pg_net for Edge Functions) | Runs inside Postgres, so the SQL jobs need no network hop, no shared secret, and no deployed app |
| Testing | Vitest + Testing Library | |
| PWA | hand-rolled: no dependency | See "PWA & push delivery" below. `next-pwa` was the original choice and was reversed. |

**Redis is always a fast path, never the source of truth.** Every Redis-backed read falls back to a live Postgres query on a miss or outage. Without that rule a Redis outage takes down whatever screen depends on it: unacceptable for the home dashboard.

---

---

## 2b. Application structure

```
app/
  (app)/            signed-in screens; layout.tsx is the onboarding gate
  actions/          server actions: the only place .rpc() may appear
  api/csp-report/   where CSP violations land; logs and returns 204
  auth/             sign-in page, OAuth callback route, error page
  onboarding/       username + timezone, then install/ (10b), then notifications/ (10c)
  manifest.ts       web app manifest
components/         client components
lib/
  digest-days.ts    grouping, ordering, UTC-pinned dates — pure, unit-tested
  notification-types.ts  which types the Notifications tab owns
  security-headers.ts  the CSP and the fixed headers, in one place
  csp-report.ts     reads both spellings of a violation report
  supabase/         browser client, server client, admin client, proxy helper
  ratelimit.ts      Upstash limiters
  errors.ts         SQLSTATE → user-facing message
  profanity.ts      obscenity matcher
  safe-redirect.ts  open-redirect guard for the `next=` parameter
proxy.ts            session refresh + anonymous redirect + the nonce CSP
next.config.ts      the headers with no per-request component
```

### Four enforcement points, in order

**Sign-in always asks which Google account.** `signInWithOAuth` passes `prompt=select_account`, because Google skips its own chooser whenever exactly one account is signed in to the browser — so signing out of Solarity and signing back in silently returns you to the account you just left, and nothing in the app can undo that: the session is Google's, and `signOut` cannot reach it. One extra tap for someone with a single account; the difference between usable and not for anyone with two.

0. **`next.config.ts`** ships the fixed security headers on every path, including the static assets the proxy deliberately skips. See `security.md` section 3b.
1. **`proxy.ts`** refreshes the auth session, mints the per-request CSP nonce, and redirects anonymous requests to sign-in. It uses `getUser()`, not `getSession()`: the latter reads the cookie without verifying it, which is not a basis for an authorization decision. It deliberately does **not** check onboarding: that would be a database round trip on every request, including prefetches and asset fetches.
2. **`app/(app)/layout.tsx`** checks that a username exists and redirects to onboarding otherwise. One query per protected navigation, and the same query the header needs anyway.
3. **`app/actions/*`** wrap each RPC with rate limiting, profanity screening, and error mapping. RLS still protects the data if this layer is bypassed; what is lost is throttling.

The service-role client is confined to work no user can be the actor of: currently the username-availability check, which must read rows RLS hides. An ESLint rule blocks importing it into components, and a second rule blocks `.rpc(` outside `app/actions/`.

### Redirect handling

The `next=` parameter survives the whole OAuth round trip so an invite link resolves after sign-in (section 10). It is therefore attacker-controllable.

`safeRedirect()` constrains it to a single-leading-slash relative path, rejecting `//host` and any backslash, so the sign-in page cannot be turned into an open redirect.

### Rate limits

Keyed by user id, enforced in server actions via `lib/ratelimit.ts`.

**Except the two invite limits**, which key on client IP and on a hash of the token. `/join/[token]` serves signed-out visitors, so it needs identities that exist before sign-in; `lib/request-identity.ts` supplies both. It is also the only limit enforced during a page render rather than in an action, because the thing being metered is a read.

| Action | Limit |
|---|---|
| Onboarding / rename | 15 / hour |
| Create Circle | 5 / day |
| Join Circle | 10 / hour |
| Create goal | 20 / hour |
| Check in | 60 / hour |
| Photo upload | 20 / hour |
| Create invite link | 10 / hour |
| **Revoke invite link** | **none, deliberately** |
| Submit report | 10 / day |
| Invite attempt | 20 / hour, keyed by **client IP**. Preview and join |
| Single invite token | 60 / hour, keyed by a **hash of the token**. Preview only |

**Never use a secret as a rate-limit key.** Invite tokens are bearer credentials, and a key name reaches Redis keyspace and every log line that touches it. Hash first: SHA-256, truncated to 32 hex characters.

**Never let a limiter disable the resource it protects.** An attempt counter on `invite_links` that auto-disabled a link after N failures would let anyone who learns a token kill it by failing against it repeatedly. A limiter slows the attacker; it must never act on the victim's data.

**Never meter a kill switch.** Revoking an invite link is the sole unmetered write in the app, and the reason is the same principle from the other side: a cap on revocation means a leaked bearer token can outlive the owner's ability to turn it off. It is cheap, idempotent and admin-only, so there is nothing worth bounding anyway.

This is the app's primary abuse control, not Turnstile. A Google account is already a higher barrier than a CAPTCHA; what needs bounding is a signed-in user hammering the RPCs.

**Where `enforce()` goes in an action matters.** It runs *after* cheap local validation and immediately *before* the first call that leaves the process. Placing it first, which is the obvious reading of "check the limit before doing work", charges a token for every rejected attempt: mistype a Circle name twice and two of your five daily creations are gone. Since length and profanity checks touch nothing but memory, leaving them unmetered protects nothing and costs a person their allowance for a typo. The limits exist to bound expensive operations, not keystrokes.

Limiters are constructed on first use rather than at module scope. `Redis.fromEnv()` throws when the Upstash variables are absent, and `lib/ratelimit.ts` sits in the import graph of every server action, so building them eagerly turned a missing runtime variable into a failed `next build`.

**`ephemeralCache: false`, and it matters more than it looks.** Left undefined, `@upstash/ratelimit` builds an in-process `Map` and records `blockUntil(identifier, endOfWindow)` on every refusal; later calls then answer from memory **without consulting Redis**, for up to the full window.

That gives the limiter two sources of truth, only one of which anything can clear. Deleting the Redis keys leaves the process still refusing, so `scripts/reset-ratelimit.mjs` looks broken and the only real fix is restarting the server. It is worse in development than the hour suggests: the invite limits key on client IP, localhost sends no `x-forwarded-for`, so every local request shares one bucket and a single test run locks the join page until the dev server restarts.

The cost of turning it off is that a refused request spends a Redis command instead of being answered from memory, so sustained abuse from one identifier burns the free-tier command budget faster. Revisit alongside `analytics`, when there is traffic to measure.

### Error mapping

`lib/errors.ts` reads the **HINT first, then the SQLSTATE.**

The HINT is the contract. A function may raise `check_violation` for something a person should read ("you already have 10 active goals") or for something they should not ("value too long for character varying(50)"), so the SQLSTATE alone cannot tell them apart. Every raise written to be read carries a hint; `BY_HINT` holds the copy for all fourteen codes.

The SQLSTATE switch is the fallback for raises that predate the convention: `23505` unique violation, `23514` check violation, `22023` the RPCs' own `invalid_parameter_value`, `42501` RLS or a missing grant.

Anything unrecognised returns a generic message, since raw Postgres errors disclose table and column names. Adding a hint in a migration and forgetting to add it here degrades to that generic message rather than leaking Postgres text, so the failure mode is dull rather than dangerous.

**Never keyed on message text.** Renaming a constraint would then silently change what people read.

Server actions return `{ ok: true } | { ok: false, error }` rather than throwing. A thrown error in a server action reaches production as an opaque "An error occurred", which is useless in a form.

---

---

## 10. Circles, invites & roles

- Invite-only, via a shareable link or direct invite.
- Unauthenticated visitors are routed through Google sign-in first, with the token held through the redirect so they land back on the join confirmation.
- **Join confirmation shows name and member count only.** A link may have been forwarded to anyone, including a previously kicked member who kept the URL. Name and size are what the inviter implicitly shared; the roster is not.
- **10-member hard cap**, enforced at the DB level, re-checked at join time since membership changes between link creation and use.
- No max-use count on links; capacity checks cover it.

**Roles**: `owner` (one, can transfer but not leave without transferring), `admin` (kick members, manage links), `member`. No cap on admins: the 10-member cap already bounds the risk.

**Admins cannot act on the owner.** Kicking and demoting target only `member` or `admin`. Only the owner demotes an admin, and only the owner changes their own role via transfer. This stops a promoted member removing the person who promoted them.

**Kicking does not block.** Nothing prevents re-invitation unless a block is separately in place, so the kick flow should surface "also block this user?" as a deliberate second step.

### Invite links respect the Circle's lifecycle

Originally they checked only the token, so an archived Circle still accepted joins. Joining an archived *empty* Circle then produced a member with no owner: the same unrecoverable state owner succession fixes, reached from the opposite direction.

Succession guarded departures. Nothing guarded arrivals.

Now: both entry points require `group_status = 'active'`; `join_circle` additionally refuses a Circle with zero owners; a trigger disables outstanding links when a Circle leaves `active`; and `create_invite_link` will not mint a link for a non-active Circle.

**Links expire after 7 days by default.** A link is a bearer credential, so a permanent one means a forwarded message or screenshot keeps a way in open indefinitely. Callers may set a longer window or opt out explicitly.

**One active link per Circle, by convention rather than by constraint.** `create_invite_link` disables every enabled row for the Circle before inserting. Nothing in the schema enforces it: only `token` is unique, so several enabled rows are physically possible, and permitting them later is a one-line removal.

Two consequences the UI has to carry:

- **Regenerating silently kills everything already shared.** A "Generate link" button pressed twice invalidates links people are already holding, so the action needs a warning before it fires.
- **Revoking and replacing must be separate actions.** Minting a new link is currently the only way to kill an old one, which forces you to create a successor you then have to avoid sharing. An explicit revoke sets `enabled = false` without issuing a token.

**Preview is reachable signed out.** `circle_preview` is granted to `anon` so a link shows the Circle's name and size before anyone is asked to sign in. For a token the holder already has, that reveals whether it is still live and what the Circle is called; at 32 CSPRNG bytes it is not a guessing surface. Being asked to authenticate before learning what you are joining costs more than that.

### Failure states

Each error carries a machine code in the **HINT**, so clients branch on the code rather than the prose.

| Situation | `circle_preview.status` | `join_circle` HINT | Name shown |
|---|---|---|---|
| Valid | `ok` | none | yes |
| Token doesn't exist | `not_found` | `INVITE_INVALID` | **no** |
| **Blocked** | previews normally | `INVITE_INVALID` | n/a |
| Revoked | `revoked` | `INVITE_REVOKED` | yes |
| Expired | `expired` | `INVITE_EXPIRED` | yes |
| Cycle ended | `circle_locked` | `CIRCLE_LOCKED` | yes |
| Archived | `circle_archived` | `CIRCLE_ARCHIVED` | yes |
| Full | `circle_full` | `CIRCLE_FULL` | yes |
| Already a member | `ok` | none, idempotent | yes |
| Circle has no owner | previews normally | `CIRCLE_ORPHANED` | yes |
| Not signed in | n/a | `NOT_AUTHENTICATED` | n/a |

**`CIRCLE_ORPHANED` should be unreachable.** Every Circle must have exactly one owner, and only an owner can invite, kick, set a deadline or resolve a streak decision, so a Circle with none is a room nobody can administer. Succession exists to prevent it. The check is here because it happened anyway: joining an archived, empty Circle recreated the ownerless state from the opposite direction. Treat a sighting as a bug elsewhere, not as a state users encounter.

**Two stay generic on purpose.** A nonexistent token must be indistinguishable or the endpoint becomes an oracle for guessing tokens. A blocked user gets the *same* message: naming the block confirms it and points at whoever administers the Circle.

**The rest are safe to name** because the caller demonstrably held a real token, so nothing is revealed they couldn't already infer.

**UI asymmetry to expect**: a blocked user's preview succeeds and only the join fails. Mildly confusing by design; the alternative leaks the block.

---

---

## 6. Realtime

Deliberately **not** used for the progress feed: the daily digest is the design, and live pushes would contradict it and add load.

`notifications` is published to `supabase_realtime`; nothing else is. Reserved for the immediate types (`kicked`, `group_locked_renewal`) and any future presence feature.

Realtime respects RLS, so `notifications_select_own` governs the socket too: one access model, not two. **Corollary**: a missing or wrong policy produces *silence*, not an error, so "realtime is broken" and "RLS is filtering everything" look identical from the client.

---

---

## 6b. The dashboard

Three tabs, addressable by `?tab=`, read on the server with no client state.

| Tab | Answers |
|---|---|
| Overview | Where you stand: today's check-in, your goals, and **five days of digest boxes** |
| Circles | The list, and the create form |
| Notifications | The four **event** types, and nothing else |

### The day boxes

One box per day, newest first, five days, from `digest_snapshots`. Each box lists the Circles that reported *that day*; a Circle with no snapshot for a day is simply absent from it, and a Circle with no snapshots at all appears nowhere here — the Circles tab is where the full list lives.

**Five days, never five rows.** One query, `.in("group_id", …)` with `limit(circles × 5)`, grouped in TypeScript. At most one row exists per Circle per date, so that limit cannot cut into the fifth day while a fifth day exists. Taking the newest N *rows* instead would drop a Circle whose day sorted last, and would show fewer days the more Circles someone is in — the panel would mean something different for every account.

**Collapsed is a line; expanded is a `<details>`** holding the roll call: every member marked finished or not, their username **as it was that day**, their streak, your own row marked, and whether the Circle's group streak moved since the box below. `<details>` rather than client state, so it needs no client component, survives with JavaScript off, and keeps the hidden content in the document for search and screen readers.

**Ordering is a fact about now, not about the day.** A Circle with a pending streak decision or an unread event notification sorts to the top of *every* box, including last week's. Deliberate: the boxes are a place to scan, and the thing waiting on you should not be halfway down the fourth one.

**Dates are formatted UTC-pinned.** These are check-in dates that already had a timezone applied; `new Date(date)` re-applies an offset and dates every box a day early for anyone west of UTC. `lib/digest-days.ts` holds the grouping, ordering, formatting and delta as pure functions, tested in a runner deliberately pinned to a non-UTC zone.

## 7b. PWA & push delivery

Notifications are the app's re-engagement loop, and on iOS they only work for an installed PWA. That makes the PWA layer functional infrastructure, not polish.

**Files**: `app/manifest.ts` (Next.js native), `public/sw.js` (plain JS, served statically rather than compiled), `components/service-worker-registrar.tsx` (mounted in the root layout).

**No PWA library.** `next-pwa` was the original choice and was reversed: it's unmaintained, pulls a high-severity build-time advisory that fails `npm audit` in CI, and its actual value is Workbox caching this app barely benefits from: the product needs the network to do anything meaningful, TanStack Query handles client caching, and Redis handles the server side. Crucially, **no PWA library writes the push handlers**; those are the same ~40 lines either way. If real offline support is ever wanted (viewing goals with no signal, queuing check-ins to sync later), Serwist is the migration target and the manifest and handlers port over unchanged.

**Drawing under the hardware costs a rule elsewhere.** `viewport-fit=cover` plus a translucent status bar extends the page beneath the status bar and the camera housing, which is what makes the themed background reach the edges. The compensation is `padding: env(safe-area-inset-*)` on `body` in `globals.css`, all four sides — landscape insets one side and the home indicator takes a slice of the bottom. It lives on `body` rather than per layout because every route renders inside it, and because a rule per layout is a rule someone forgets on the next one. **The request and the compensation are in different files**, which is exactly why this was missing until an iPhone showed it.

**iOS needs more than the manifest.** iOS ignores the web manifest for standalone display and reads `apple-mobile-web-app-capable` instead, set via `metadata.appleWebApp` in the root layout. Without it, "Add to Home Screen" produces a browser-chrome window rather than an installed app, and push only fires for the installed case. The manifest alone is not enough.

**The worker claims control immediately** (`skipWaiting` + `clients.claim`). Otherwise someone who has just installed the PWA receives no push until they fully quit and reopen it.

**Notifications are tagged per Circle** (`circle-{group_id}`). A phone replaces a notification carrying the same tag rather than stacking another beneath it, so someone who ignores the app for a week returns to one notification per Circle instead of seven. The tradeoff is losing the "I missed several days" signal: reversible by dropping the tag if that turns out to matter more.

**The install nudge is `/onboarding/install`**, its own route rather than a phase inside `/onboarding`, because `/onboarding` bounces to the dashboard the moment a username exists and by then one does. It sits outside `(app)` for the same reason `/onboarding` does: neither the onboarding gate nor the `/today` gate should fire during signup.

`beforeinstallprompt` is captured by an **inline script in the root layout**, before hydration. The event object is the only route to the install dialog and there is no API to ask for one later, so a listener added from an effect would miss it on a slow connection, on exactly the devices where installing matters most. `lib/install-prompt.ts` holds the script and the contract it writes to.

**Every branch of the nudge has a way forward**, because every signal it reads lies somewhere: `display-mode: standalone` is unreliable on iOS before the first home-screen launch, `beforeinstallprompt` never fires in Firefox or Safari, and the iOS branch is a user-agent sniff. Detection is a hint, never a gate. The sniff earns its place because iOS is the one platform that can install and never says so, and the platform where skipping the install means push never works at all; a wrong answer costs a paragraph, next to a Skip that still works.

**The toggle in settings is per device, and asks the server.** Whether push is on is the conjunction of three facts: the browser permits it, this browser holds a subscription, and the row still names *you*. The third matters because a browser keeps its `PushSubscription` across sign-ins while `subscribe_push` hands the endpoint to whoever subscribed last, so a local-only check would show "on" to someone whose endpoint now belongs to a flatmate. `pushSubscribed(endpoint)` is the read.

Turning it off unsubscribes the browser **first**, then deletes the row: a half-failure then converges, because the sender prunes dead endpoints on 404 or 410. The reverse order leaves a live subscription with no row and nothing to notice.

**`notifications` is two things at once, and the split is deliberate.** For the four event types it is an outbox: written by the database, rendered on the Notifications tab, marked read when shown, counted by the badge. For `digest` it is a **delivery queue**: written by `build_daily_digests`, read once by `send-digest-push`, and never rendered — the day boxes on Overview show that content from `digest_snapshots` instead. So `read_at` never applies to a digest and stays `null`; a timestamp would claim you read something the app never showed you. The type list lives in `lib/notification-types.ts` and is imported by all three readers, because a drift between them is silent in every direction.

**Registration deliberately does NOT request notification permission.** Browsers effectively allow one ask: a denial is sticky and cannot be re-prompted, only reversed by the user digging through settings. Asking on first page load, before anyone knows what Solarity is, mostly buys a permanent no. The prompt belongs in onboarding, **after** the add-to-home-screen step, once the reason is obvious.

**Icons are in place**, with sizes and constraints tabulated in section 14. They are load-bearing rather than decorative: without at least 192 and 512 a phone will not offer installation, and on iOS no installation means no notifications at all. The current set is a generated placeholder mark, correct in dimensions and replaceable in v2.

**Verified on a real iPhone.** The permission dialog, an actual push delivery, and the safe-area inset are all unreachable from a headless browser, so step 10 was built and unverified until a manual pass covered them. It found the four-identical-notifications problem that became 10g; everything else held. **The eight flows are kept in `history.md`** rather than deleted: a permission dialog is one-shot per browser, so the next device and the next iOS version need the same procedure.

**Resolved:**

- ~~**`pushsubscriptionchange` handling.**~~ **Done in 10e.** A push service can invalidate a device's subscription and issue a new one, and that device then stops receiving notifications **silently**: nothing errors. The worker posts `RESUBSCRIBE_PUSH` to any open window, and `ServiceWorkerRegistrar` now calls `resubscribeIfPermitted`, which shares the write path with the opt-in screen and **never prompts** — not granted returns `denied` rather than asking. Fire and forget, because nobody is watching a repair they did not request.

  **The gap that remains is structural**: the worker can only post to an *open* window, so a device that never opens the app is repaired at its next visit rather than in the background. `send-digest-push` still prunes the dead endpoint on a 404 or 410, which stops the retries in the meantime.

---

## 14. Environment & external services

Everything here is already configured: these are the notes worth keeping, not the steps.

### Environment variables

Client-exposed (`NEXT_PUBLIC_*` is bundled into the browser: anything here is public):

| Var | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same (now labelled "publishable") |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `npx web-push generate-vapid-keys` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile |

Server-only: never `NEXT_PUBLIC_`, never imported into a component:

| Var | Notes |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | bypasses RLS entirely. Only `createAdminClient` touches it, and lint bans importing that into components. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | regional database; global costs more and buys nothing yet |
| `VAPID_PRIVATE_KEY` | |
| `TURNSTILE_SECRET_KEY` | |
| `CRON_SECRET` | **Set as a Supabase Edge Function secret, not only a Vercel env var**: the functions read it from the Supabase runtime. Also mirrored into Vault as `cron_secret` so `cron.job` doesn't hold it in plaintext. |

Vercel needs all of them under Project Settings → Environment Variables. `.env*` is gitignored.

**`supabase/config.toml` is committed and holds no secrets.** It is the only version-controlled record of which Supabase project this checkout points at, since the link state lives in the gitignored `supabase/.temp/`. It configures the local stack only; its `[auth]` block is stock and does **not** describe the hosted project. `supabase config push` would therefore reset the dashboard's auth settings: see `testing.md`, "config.toml".

### Google OAuth

Client ID and secret live in **Supabase's dashboard** (Auth → Providers → Google), not in app env vars. The authorized redirect URI registered in Google Cloud Console is Supabase's callback, not the app's:

```
https://wyuadcnrxisqmzygzhzd.supabase.co/auth/v1/callback
```

The app's own `/auth/callback` route is where Supabase redirects *after* that, and must be listed in Supabase → Auth → URL Configuration → Redirect URLs. Add both `http://localhost:3000/**` and the Vercel URL.

### Email delivery

Auth email goes through **Brevo SMTP** (free tier, 300/day), configured in Supabase → Project Settings → Authentication → SMTP Settings rather than in application environment variables, exactly like the Google OAuth client secret. Verified end to end.

This replaced Supabase's built-in sender, capped at **2 messages per hour** and documented as demonstration-grade.

That cap was latent rather than active, since nothing sends email yet. It becomes load-bearing the moment email confirmation exists: on the built-in sender, the third person to sign up within an hour never receives a link, with no error and nothing to debug.

| Setting | Value |
|---|---|
| Host, port | `smtp-relay.brevo.com`, 587 |
| Username | a generated `xxxxxx@smtp-brevo.com` login, **not** the Brevo account email |
| Password | an SMTP key, **not** an API key |
| Sender | a single verified address; no domain authentication, since no custom domain exists |
| Minimum interval per user | 60 seconds |

Two caps apply and they are independent. Brevo allows 300/day; Supabase separately caps **30 new users per hour** by default under Auth → Rate Limits, and that one binds first.

**Deliverability is the real constraint, not volume.** Without a custom domain, SPF and DKIM cannot align with the From address, so mail is more likely to be filtered. That failure is silent: the recipient never gets in and concludes the product is broken. A test to the sender's own Gmail reached the inbox, which is the easiest possible case and not evidence about strangers on other providers. The accepted mitigation is explicit spam-folder copy on the check-email screen; the real fix is a domain.

`scripts/test-email.mjs` exercises the credentials **without** involving Supabase, so a failure distinguishes bad credentials from an auth flow that was never going to send anything. Worth keeping: Supabase only generates auth email when a flow asks it to, and a Google-only project asks for none, so "SMTP is configured" and "email works" are separate claims.

### Deferred, with reasons

- **Apple Sign In**: needs an Apple Developer membership ($99/yr). Adding it later is a provider toggle plus a Services ID; no schema or app changes. Google-only is enough to ship v1.
- **Custom domain**: a PWA needs HTTPS and a valid manifest, both of which `*.vercel.app` provides. Two things want one and neither is a v1 blocker: Apple Sign In's domain verification, and email deliverability (above). Its cost has grown from "nothing" to "silently degraded email", which is worth revisiting at launch.

### Icons

| File | Size | Notes |
|---|---|---|
| `public/icons/icon-192.png` | 192×192 | manifest, `purpose: any` |
| `public/icons/icon-512.png` | 512×512 | manifest, splash screen source |
| `public/icons/icon-512-maskable.png` | 512×512 | `purpose: maskable`. Artwork inside the centre 80% circle so Android can crop to any shape. |
| `public/icons/badge-72.png` | 72×72 | notification badge, Android status bar. **Monochrome white on transparent**: the OS tints it; colour is discarded. |
| `app/apple-icon.png` | 180×180 | iOS home screen. Opaque, square, no transparency and no pre-rounded corners: iOS applies the mask. Next.js serves it from `app/` automatically. |
| `app/favicon.ico` | multi-size | 16/32/48/64/256 in one file. |

Current set is a placeholder sun mark generated programmatically: correct dimensions, replaceable in v2.

### Other standing config

- **Dependabot** on in GitHub (alerts + version updates).
- **CI**: `.github/workflows/ci.yml` runs Vitest and `npm audit` on every PR.
- **Not installed yet**: `pixi.js` and anything galaxy-specific. No reason to carry the weight before v3.

---
