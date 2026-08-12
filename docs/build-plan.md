# Solarity — Build Plan

**What the work is.** Change log, next steps, decisions not yet built, bug patterns, and the checks that catch them.

This doc does not describe the system. What exists and why it is shaped that way lives in `architecture.md`; build phases, naming and the deferred visual design live in `product-and-design.md`.

---

## Change log

### 12 August 2026 — verification pass, and migration 58

**Browser verification complete. All six tests passed.** The application layer has now run for the first time.

| Test | Result |
|---|---|
| 1. Sign-in round trip | Pass. `next` survives the OAuth round trip; signed-in users never see signed-out screens. |
| 2. Open-redirect guard | Pass, including `%5C`. Valid relative paths still work, so the guard is not simply refusing everything. |
| 3. Onboarding | Pass, including the case-insensitive uniqueness check. Timezone stored as a real IANA zone, not `UTC`. |
| 4. Gate | Pass. A null username bounces from every route under `(app)`, confirming one gate rather than per-page checks. |
| 5. PWA install | Pass on iOS. Opens from the home screen with **no Safari chrome**, so `appleWebApp` metadata is reaching the page and push remains viable. |
| 6. Regressions | `tsc`, `eslint`, `next build` clean; `db diff` silent. |

**Test 1 found a real bug, which is what the pass exists for.** `first_name` and `last_name` had a reader and no writer: `handle_new_user` read `raw_user_meta_data ->> 'given_name'` and `'family_name'`, keys Supabase's Google provider does not supply. Its actual keys are `avatar_url, email, email_verified, full_name, iss, name, phone_verified, picture, provider_id, sub`. Both columns were null on every account and always would have been, and `/onboarding` degraded silently from "Welcome, Ryan" to "Welcome".

**Migration 58 collapsed three name concepts into two.** A legal-shaped first/last pair earns its place in a product with billing or formal correspondence; Solarity has neither, and carrying it alongside an OAuth full name and a username made three overlapping ideas where two would do.

| Concept | Role |
|---|---|
| `username` | unique, ASCII, the identity. Rosters, digests, leaderboards. |
| `display_name` | optional, non-unique, cosmetic. Render `coalesce(display_name, username)`. |

`first_name` and `last_name` dropped, `display_name` added (1 to 50 characters after trimming, whitespace-only rejected). `handle_new_user` now reads `display_name`, then `full_name`, then `name`, truncating to 50 so an over-long value cannot abort signup over a decorative field. `export_user_data` updated, since it is a data-subject obligation and must describe columns that exist. Existing rows backfilled from Google's `full_name`.

Verified: over-length rejected, whitespace-only rejected, null accepted, exactly 50 accepted, `authenticated` holds SELECT and UPDATE on `display_name` but not on `username`, `anon` holds nothing. Types, `app/onboarding/page.tsx`, and both docs updated. `tsc` and `eslint` clean.

Migration 58 fetched into the repo: 58 files, comments intact, local and remote match.

### 12 August 2026 — auth, onboarding, icons `committed as "oauth skeleton"`

The app has a running front end for the first time: sign in with Google, choose a username, land on a dashboard.

| Path | Purpose |
|---|---|
| `app/auth/sign-in/page.tsx` | Google sign-in; redirects if already authenticated |
| `app/auth/callback/route.ts` | Exchanges the OAuth code for a session |
| `app/auth/error/page.tsx` | Reports a failed or cancelled sign-in |
| `app/actions/auth.ts` | `signInWithGoogle`, `signOut` |
| `app/actions/onboarding.ts` | `complete_onboarding` with rate limiting and profanity screening |
| `app/onboarding/` | Username and timezone form |
| `app/(app)/layout.tsx` | Onboarding gate and header for every signed-in screen |
| `app/(app)/dashboard/page.tsx` | Placeholder listing your Circles |

Supporting modules: `lib/errors.ts` (SQLSTATE to message), `lib/profanity.ts`, `lib/safe-redirect.ts`.

**Icons.** Six files: `icon-192`, `icon-512`, `icon-512-maskable`, `badge-72` in `public/icons/`, plus `app/apple-icon.png` (180×180) and `app/favicon.ico`. Sizes and platform constraints are in `architecture.md` section 14. Placeholder artwork, correct dimensions.

**Four corrections made along the way**

- `middleware.ts` became `proxy.ts`, exporting `proxy`. Next.js 16 renamed the file convention and warned on every build. `sw.js`, the manifest and `/icons` were also excluded from the matcher: a service worker that receives a redirect instead of JavaScript fails to register, which on iOS means no install and therefore no push.
- `lib/database.types.ts` had every `Relationships: []` array emptied, so any embedded join (`groups(name)`) was a type error. Restored from the live schema.
- The onboarding gate went in `app/(app)/layout.tsx` rather than the proxy. In the proxy it would be a database round trip on every request, including prefetches.
- Timezone detection uses `useSyncExternalStore` rather than `useEffect` plus `setState`. The React lint rule rejects the latter, and this avoids a hydration mismatch.

**Pre-commit audit.** Comments were trimmed to local mechanics and pointers, since the rationale lives in the docs. Three findings, all fixed:

- **`Redis.fromEnv()` ran at module scope**, and `lib/ratelimit.ts` is in the import graph of every server action, so an absent Upstash variable failed `next build` rather than a request. Limiters are now built on first use, and `enforce` takes a limit name rather than an instance. `next build` succeeds with no environment at all.
- **CI ran only Vitest and `npm audit`**, and there are no tests yet. It now typechecks, lints, builds and tests, with the build step deliberately running without environment variables.
- **No `.gitattributes`**, so `.gitignore` showed as an 86-line rewrite for a 4-line change. Added, with `eol=lf` and binary rules for images.

**`supabase/config.toml` created** via `supabase init`, `project_id` set, project re-linked. See "config.toml" below.

**Email delivery.** Brevo SMTP configured in Supabase, replacing the built-in 2-per-hour demonstration sender. Verified end to end with `scripts/test-email.mjs`, which is deliberately independent of Supabase so a failure names whether the credentials or the auth configuration is at fault. Details and tripwires in track 1.

**Documentation.** `setup-checklist.md` folded into `architecture.md` section 14. `plan-public-and-auth.md` folded into this doc. Section 2b added to architecture, describing the application structure. The three docs are now split by concern: architecture records the system, this doc records the work, product-and-design owns phasing and appearance.

**Verified at the time:** `tsc --noEmit` clean, `eslint` clean, `next build` succeeds with and without environment variables, `supabase db diff` prints nothing. Browser verification came later, in the entry above.

### Earlier

- Full schema, RLS, RPCs, derived data, digest, Edge Functions and scheduled jobs built and audited. Inventory in `architecture.md`.
- Cloud state pulled into version control: 57 migrations, 4 Edge Functions.
- `next-pwa` reversed in favour of a hand-rolled service worker. Rationale in `architecture.md` section 7b.

---

# Next steps

Three tracks. Track 1 is done. **Track 2 is where the work is now**, and it is the only track that tests whether the product works. Track 3 waits until it does.

---

## Track 1 — Brevo setup ✅ done

**Result, 12 August 2026.** Brevo free plan configured, sender `ryanhang07@gmail.com` verified, SMTP key generated, Supabase pointed at `smtp-relay.brevo.com:587` with login `b55571001@smtp-brevo.com`. `scripts/test-email.mjs` authenticated and delivered **to the inbox, not spam**.

**Do not over-read that result.** A Gmail address sending to itself is close to the easiest case a mail system can face: no reputation history is required and the receiving provider is unusually forgiving. It proves the credentials and the verified sender are correct. It does **not** prove deliverability to a stranger on a different provider, which is the case that actually matters at signup. Re-run the script against a non-Gmail address (Outlook, Yahoo, a work account) before relying on confirmation email, and treat the spam-folder copy on `/auth/check-email` as required regardless.

Steps retained below as a record of what was configured and where the settings live.

**Why this was done first.** Supabase's built-in email sender does **2 messages per hour** and is explicitly for demonstration. Every email-shaped feature depends on replacing it: signup confirmation, password reset, and the support contact form. It was also a self-contained manual task with no dependency on any code.

### The 90-day expiry, and the alert for it

Brevo expires **inactive SMTP keys after 90 days**. Nothing in Solarity sends email until the signup flow exists, so this key is idle from now on and the clock is running.

**How the failure would actually surface.** Not silently, but not visibly to you either:

| Who | What they see |
|---|---|
| The person signing up | A hard failure. Supabase returns `500: Error sending confirmation email` and `signUp` rejects. They cannot create an account. |
| Supabase Auth logs | `535 5.7.8 Error: authentication failed`, which names the cause precisely. |
| You | Nothing, unless you happen to be reading those logs or somebody tells you. |

So the real risk is not a silent failure, it is an **unwitnessed** one: broken for everybody, obvious in a log nobody is watching.

**The fix: `.github/workflows/email-heartbeat.yml`.** A scheduled workflow sends one email through Brevo on the 1st of each month, using `scripts/test-email.mjs`. That does two jobs at once:

1. **Prevents the expiry.** A key used monthly never goes 90 days idle.
2. **Alerts on failure.** GitHub emails the repository owner when a scheduled workflow fails, so a revoked, rotated or expired key surfaces as a failed run rather than as a broken signup.

Twelve emails a year against a 300-per-day allowance. Monthly gives roughly three times the margin the expiry needs.

**Repository secrets required** (Settings → Secrets and variables → Actions). The workflow does nothing until these exist:

| Secret | Value |
|---|---|
| `BREVO_SMTP_LOGIN` | the `xxxxxx@smtp-brevo.com` login |
| `BREVO_SMTP_KEY` | the SMTP key |
| `BREVO_SENDER` | the verified sender address |
| `BREVO_ALERT_TO` | where the heartbeat lands; the sender address is fine |

Run it once by hand from the Actions tab (`workflow_dispatch`) to confirm the secrets are right, rather than waiting a month to find out.

**One caveat.** GitHub disables scheduled workflows in repositories with no activity for 60 days. It warns by email first, but if the repo goes quiet for two months, re-enable this before trusting it again. It is a monitor, not a guarantee.

### 0. Decide the sender address first

This address appears in the From line of every confirmation and reset email, so it becomes public the moment anyone signs up. Using a personal address publishes it.

**Recommendation: create a free mailbox for the project**, something like `solarity.app@gmail.com`. It costs nothing, keeps your personal address out of strangers' inboxes, and it doubles as the destination for the support contact form later. Do this before touching Brevo, because the next two steps both need it.

### 1. Create a Brevo account

Free plan, 300 emails per day, no card required. Some new accounts are held for a short manual review before transactional sending is enabled, so if sending is blocked at first, that is expected rather than a misconfiguration.

### 2. Verify the sender

**Settings → Senders, Domains, IPs → Senders**, then **Add a sender**. Two fields:

- **From name**: `Solarity`. Inboxes truncate around 20 to 30 characters, so keep it short.
- **From email**: the address from step 0.

Save, then Brevo emails that address a **6-digit code**. Paste it back and click **Verify sender**.

**An unverified sender cannot send transactional email at all**, and it fails as a rejection rather than a warning, so this is not skippable.

**Expect a warning icon next to DKIM and DMARC.** That is correct, not a mistake: free sender domains like gmail.com cannot be authenticated, because you do not own the domain. It is the same fact as the spam problem below, surfaced in Brevo's UI.

### 3. Create an SMTP key

**Settings → SMTP & API → SMTP tab**, then **Generate a new SMTP key**.

- **Name it** after the integration, for example `supabase-auth`. One key per integration means a single compromised key can be revoked without taking everything else down.
- **Variant: Standard** (64 characters). The Short variant exists only for clients that cannot handle long passwords; Supabase can.
- **Expiry: no expiration.** An expiry date on a credential that gates signup produces a silent outage on a date nobody remembers. If you prefer an expiry, set a calendar reminder to match it.

The full key is displayed **once**. Copy it straight into a password manager. Afterwards only the last few characters are visible and there is no way to recover it, only to generate a replacement.

Two values matter, and **they are not what you would guess**:

| Field | Where it comes from |
|---|---|
| SMTP login | The **Login** field on that same page. Looks like `xxxxxx@smtp-brevo.com`. It is **not** your Brevo account email. |
| SMTP password | The **SMTP key** you just generated. It is **not** an API key, and the two are listed side by side on the same screen. |

### 4. Point Supabase at it

Supabase dashboard, Project Settings, Authentication, SMTP Settings. Enable custom SMTP:

| Setting | Value |
|---|---|
| Host | `smtp-relay.brevo.com` |
| Port | `587` |
| Username | the `xxxxxx@smtp-brevo.com` login |
| Password | the SMTP key |
| Sender email | the address you verified in step 2 |
| Sender name | `Solarity` |

Leave encryption unset on port 587. Port 465 exists and needs SSL/TLS selected; 587 is the simpler path.

### 5. Raise the rate limit

Supabase, Authentication, Rate Limits. With custom SMTP enabled, Supabase applies its own cap of **30 new users per hour** by default. That is a separate limit from Brevo's 300 per day, and it is the one that will bite first. Raise it deliberately rather than discovering it.

### 6. Confirm it works

Two separate questions, and conflating them wastes time:

- **A. Are the Brevo credentials right?**
- **B. Is Supabase configured to send anything at all?**

Test A first, because it is unambiguous and does not involve Supabase.

#### A. Test the credentials directly

Add to `.env.local` (server-only, never `NEXT_PUBLIC_`):

```
BREVO_SMTP_LOGIN=xxxxxx@smtp-brevo.com
BREVO_SMTP_KEY=<the SMTP key>
BREVO_SENDER=<the verified sender address>
```

Then:

```bash
npm i -D nodemailer
node --env-file=.env.local scripts/test-email.mjs you@example.com
```

The script authenticates first and sends second, so a failure names which half broke. Check the inbox, the **spam folder**, and **Brevo → Transactional → Logs**, which distinguishes "never sent" from "sent and filtered".

#### B. Why Supabase sends nothing

**Supabase only sends auth email when an auth flow asks it to.** This project is Google-only, and Google accounts arrive pre-confirmed, so no confirmation, magic link or reset email has ever been generated. Correct SMTP settings change nothing on their own.

The dashboard's **Add user** form does not help either: it has an **Auto Confirm User** toggle that is on by default, which creates the account already confirmed and sends nothing.

To force a real send:

1. Authentication → Providers → enable **Email**.
2. Authentication → Users → **Add user**, with **Auto Confirm User unchecked**.
3. A confirmation email is generated. Delete the test user afterwards.
4. Turn the Email provider back off if you do not want it live yet. Nothing can reach it regardless, since no signup UI exists.

Confirmation that a send was attempted, rather than trusting the inbox:

```sql
select left(email,3) || '***' as who, created_at,
       confirmation_sent_at, email_confirmed_at,
       raw_app_meta_data ->> 'provider' as provider
from auth.users order by created_at desc limit 5;
```

`confirmation_sent_at` stays null when nothing was sent. A `provider` of `google` with `email_confirmed_at` matching `created_at` is a pre-confirmed OAuth account, which never triggers mail.

#### Failure table

| Symptom | Cause |
|---|---|
| Script fails at authentication | Account email used instead of the `@smtp-brevo.com` login, or an API key used instead of an SMTP key |
| Script authenticates, refuses the message | `BREVO_SENDER` does not exactly match a verified sender |
| Script succeeds, Supabase sends nothing | No auth flow is generating email. See B. |
| Brevo logs show delivered, inbox empty | Filtered. See below. |

### The spam problem, and what to do about it

Without a custom domain, the two records that prove an email is legitimate (SPF and DKIM) cannot be aligned with the address it claims to come from. Receiving servers apply extra suspicion, and confirmation emails may land in spam.

That failure is **silent**: nothing errors, the person simply never gets in and assumes the product is broken.

Accepted mitigation for now: **the check-email page carries an explicit "check your spam folder" line**, treated as real copy rather than a footnote, and the resend button sits directly beneath it.

The real fix is a domain, roughly $10 to $15 a year, which also unlocks Resend's larger free tier and removes the last obstacle to Apple Sign In. Revisit at launch.

### Environment note

No new application environment variable is needed. The credentials live in Supabase's dashboard, exactly like the Google OAuth client secret.

The **contact form** is different: it sends mail directly rather than through Supabase Auth, so it will need `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY` and `BREVO_SENDER` as server-only variables when that gets built. Not yet. Generate it a **separate** SMTP key named for that integration, so revoking one does not break auth.

### Tripwires to remember

- **Inactive SMTP keys expire after 90 days.** The monthly heartbeat workflow prevents this and alerts if it happens anyway. If email stops working after a long gap and the heartbeat was disabled, regenerate the key before debugging anything else.
- **"Minimum interval per user" is set to 60 seconds** in Supabase's SMTP settings. That is the floor between two emails to the same address, so a resend button pressed twice inside a minute is silently refused. The check-email page must disable resend for 60 seconds and say why, or it looks broken.
- The sender address is public. Changing it later means re-verifying in Brevo and updating Supabase.
- Brevo's 300/day and Supabase's 30 new users/hour are **separate** limits. Supabase's binds first.

---

## Track 2 — The core loop

**Chosen path: finish the loop before the public surface.** The backend for every step is already built and tested, so this is UI over a known-good foundation. It is also the only work that tests the product's actual premise, and it settles the shape of onboarding before signup is built on top of it.

Ordered so the app is usable **alone** before it is usable **together**. Single-player first means streaks can be tested without a second account.

**1. Verify the skeleton in a browser.** ✅ **Done, 12 August.** All six tests passed; results in the change log, procedure retained below as a regression checklist. Found and fixed the `first_name` bug that became migration 58.

**2. `app/actions/circles.ts` and Circle creation.** Wrap `create_circle` with the `createCircle` rate limit and the profanity filter on the Circle name. A form on the dashboard; a Circle appears in the list.
*Done when:* you can create a Circle and see it listed.

**3. `app/actions/goals.ts` and goal management.** Create and archive. Category is required at creation, so the form needs the seeded `goal_categories`, fetched **by `slug`, never by hardcoded id**. The 10-active-goal cap lives in the database and its error needs a readable message.
*Done when:* you can add three goals, archive one, and an eleventh is rejected cleanly.

**4. The check-in write and today's panel.** The one screen the product exists for. `check_in_date` is computed server-side, so the client sends no date. "Already checked in today" arrives as a unique-constraint violation and should read as a normal state, not an error.
*Done when:* checking off every goal for a day flips `daily_completion.all_completed` to true.

**5. Milestone.** Sign in, username, Circle, goal, check it off, and after the next rollover the streak reads 1. Streaks lag a day by design: to show today, compute `current_streak + (1 if today complete)` at display time.

**6. `/circles/[id]`, the Circle detail page.** Members, current deadline, cycle stats, Overview from `digest_snapshots`. Prioritised because `public/sw.js` already deep-links here, so every digest notification currently opens a 404.

**7. Invites and joining.** `create_invite_link`, the `/join/[token]` preview via `circle_preview`, and `join_circle`. Branch on the machine codes in the HINT, never on message text. The app becomes multiplayer here, and a second test account starts earning its keep.

**8. Real dashboard.** Check-in panel, Circles list with archived beneath, Overview subtab, notifications subtab.

**9. Install nudge, then the notification permission prompt**, appended to onboarding in that order. Last of the loop work, deliberately: this is what reshapes the end of onboarding, and it is the reason signup was deferred.

**10. Security headers.** CSP with a nonce-based `script-src`, HSTS, `nosniff`, `Referrer-Policy`.

### Running in parallel, whenever convenient

`/privacy` and `/terms` as static pages, plus `app/robots.ts` and `app/sitemap.ts`. Google's OAuth consent screen wants a privacy policy URL regardless, and none of it depends on anything above. `sitemap.ts` must exclude `/join/*`: invite tokens are bearer credentials and have no business in a crawler log.

Copy to be drafted from the architecture, so it describes what the system actually does: 90-day photo retention, check-ins anonymized rather than deleted on account deletion, what `export_user_data` returns. Not legal advice; review before real users.

---

## Track 3 — Public surface and email signup

Deferred until track 2 works end to end. All of the design thinking is settled; what follows is the sequence and the traps.

### Sequence

1. **Terms columns migration**, then the `complete_onboarding` migration. Regenerate types.
2. **`/support`** with the contact form, once you know what the FAQ needs to answer.
3. **Landing page** sections.
4. **Signup flow**: `/auth/sign-up`, `/auth/check-email`, `/auth/confirm`. Supabase email settings and templates first, since the flow cannot be tested without them.
5. **Password reset**: `/auth/forgot-password`, `/auth/reset-password`.
6. **IP-keyed rate limits**, and correct the `lib/ratelimit.ts` doc comment.
7. **Turnstile wiring**, then enable it in the dashboard.
8. **Gate update** and `PUBLIC_PREFIXES` extraction.

### Decisions already taken

| Decision | Rationale |
|---|---|
| Signup collects email, password, **username** | Username is the only field the product cannot run without: it appears in every roster and digest. Google users still set theirs in `/onboarding`, so both paths need the same validation. Factor it once. |
| Plus an optional **display name** | `signUp({ options: { data: { display_name } } })` writes to `raw_user_meta_data`, which `handle_new_user` already reads first. No migration, no trigger change. Optional, because `coalesce(display_name, username)` always renders something. Needs the same profanity screening as username. |
| Plus **terms acceptance**, versioned | Two new columns. "They agreed" is worth little once terms change; storing *which version* lets a future change target only who needs to re-accept. |
| **Email confirmation required** | Blocks throwaway addresses and guarantees password reset works. Costs three screens. |
| **Enumeration protection stays on** | Signup never reveals whether an address is already registered. See below. |
| Public pages: **privacy, terms, support** | No separate "How it works" page, so the landing page carries that job. |
| Contact via **form that emails you** | Needs Turnstile and its own IP rate limit. No new schema: the message goes to email and nowhere else, so it cannot become a queue nobody reads. |
| Declined: **date of birth** | Photos plus free text plus private groups normally wants an age floor, and Google will never supply one. Not a v1 blocker, but it gets more expensive with every signup. |

### How the two paths converge

Google and email signup do not run in parallel. Both create the same `auth.users` row, both fire `handle_new_user`, and both hit the same gate in `app/(app)/layout.tsx`, which checks four things in order:

```
!user                      → /auth/sign-in
!user.email_confirmed_at   → /auth/check-email
!profile.username          → /onboarding
!profile.terms_accepted_at → /onboarding
```

Google users pass the confirmation check on arrival and fail the last two. Email users do the reverse.

**Why a gate rather than the flow.** Any signup can be abandoned midway: close the tab after `signUp` succeeds and you have a real account, a real profile row, a username, and an unconfirmed address. Only something evaluated on every protected navigation catches that. `email_confirmed_at` comes off the object `getUser()` already returns, so it costs no extra query.

### Schema changes

```sql
alter table public.users
  add column terms_accepted_at timestamptz,
  add column terms_version     text;
```

Both nullable: existing rows predate the requirement. Pin the current version as a constant in `lib/legal.ts` so the value written and the document rendered cannot disagree.

**The trap.** Terms acceptance has to be recorded for Google users too, and their only touchpoint is `complete_onboarding`. That means a new parameter, and **adding a parameter to a Postgres function does not modify it, it creates an overload**. `create or replace` only matches an identical signature, so the two-argument version would survive and PostgREST would see two candidates for `/rpc/complete_onboarding` and fail with an ambiguity error. The migration must `drop function public.complete_onboarding(text, text)` first, in the same migration as the create.

Inside the function, record acceptance idempotently:

```sql
terms_accepted_at = coalesce(terms_accepted_at, now()),
terms_version     = coalesce(terms_version, p_terms_version)
```

`complete_onboarding` doubles as the username rename path. Without the `coalesce`, renaming your username two months from now silently restamps your acceptance date to today, destroying the only record of when you actually agreed.

Land it as two migrations: columns, then function. A failure in the function body then does not roll back the columns.

### Turnstile stops being decorative

`architecture.md` records Turnstile as configured but inert, because Supabase's CAPTCHA guards only endpoints that take a `captchaToken`: signup, password sign-in, OTP, password reset. A Google-only app calls none of them.

Password auth adds all four. The keys are already in the environment, so this is wiring:

1. Render the widget on sign-up, sign-in and forgot-password using `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
2. Pass `options: { captchaToken }` to `signUp`, `signInWithPassword`, `resetPasswordForEmail`.
3. **Then** enable CAPTCHA in Supabase. Enabling before the forms send tokens breaks every password endpoint at once.

### Rate limiting has an assumption that breaks

`lib/ratelimit.ts` documents its limits as keyed by user id, which is coherent because every current action requires a session. **Signup and password reset have no session**, so both key on client IP from the forwarded header. That is a weaker key, since it groups a household together, so the limits should be generous:

| Action | Limit | Key |
|---|---|---|
| `signUp` | 10/hour | IP |
| `signInWithPassword` | 20/hour | IP |
| `resetPasswordForEmail` | 5/hour | IP, **and** 3/hour per email address |
| Contact form | 3/hour | IP |

The per-email limit on password reset is not abuse control. Without it, anyone can use your product to repeatedly email a stranger, which is how a sending domain gets flagged.

### Enumeration, and the copy that covers for it

If signup said "that email is already registered", anyone could type addresses in and learn who uses Solarity. For a private goal app used with friends, that is real information about real people.

So it never says it. Whatever you type, you get "check your email".

The cost: someone who already signed up with Google, then tries a password account with the same address, gets that message and no email ever arrives. Two things carry the weight:

- **The check-email page must show "Already have an account? Sign in", with the Google button.** It is the only thing that rescues them, because the form is not allowed to explain.
- **`/auth/forgot-password` must behave identically for real and unknown addresses**, including roughly the same response time. A timing difference reintroduces the leak the setting exists to prevent.

### Landing page contents

Declining a "How it works" page moves the burden here. A visitor needs to understand Circles, check-ins, the streak rule and the digest before "sign up" means anything.

1. **Hero.** The one sentence, plus Create an account / Sign in.
2. **The premise.** Why a small private group beats a solo habit tracker.
3. **How it works, in three steps.** Start a Circle and invite up to nine people, everyone sets their own daily goals, check in once a day.
4. **What a day looks like.** A rendered example digest. The daily-batched model is the least obvious thing about the product and much weaker in prose than shown.
5. **Streaks, honestly.** The group streak holds only if everyone completes everything. Better stated up front than discovered on day three.
6. **Install prompt.** It is a PWA, and on iOS that is the only route to notifications.
7. **Footer.** Privacy, Terms, Support, contact.

### Support page contents

Not decoration. The backend implements all of this and nothing links to any of it:

- How to delete your account, and what survives (check-ins anonymized and retained; `architecture.md` section 11).
- How to export your data. `export_user_data` exists and nothing calls it.
- What happens to check-in photos (90-day retention).
- How to report content, and what follows.
- How blocking differs from kicking.
- Why an iPhone needs the app installed to receive notifications.

### Supabase dashboard steps for track 3

None of these live in `config.toml`, which configures the local stack only.

| Setting | Value | Why |
|---|---|---|
| Email provider | enabled | Off by default on a Google-only project. |
| Confirm email | on | The decision above. |
| Minimum password length | 8 or more | Supabase defaults to 6, below current guidance. |
| Password requirements | letters and digits minimum | |
| Leaked password protection | on **if available** | HaveIBeenPwned check. **Pro plan and above**, so a launch-time item, not a prerequisite. |
| CAPTCHA | Turnstile, enabled **last** | See above. |
| Email templates | point at `/auth/confirm?token_hash={{ .TokenHash }}&type=email` | The default template uses an implicit-flow link that does not work with the SSR client. Confirmation appears broken until changed, and the failure looks like a code bug. **Most likely to cost an afternoon.** |

### Tests that actually catch things

- Abandon signup after submitting. The account must be stuck at `/auth/check-email` and unable to reach `/dashboard` by typing the URL.
- Click a confirmation link twice. The second reaches `/auth/error` with a comprehensible message.
- Let a link expire, then use resend.
- Sign up with an address that already has a Google account. Verify the copy makes sense given enumeration protection is on.
- Rename a username two months after signup, then check `terms_accepted_at` has not moved. This is the `coalesce`, and it fails silently.
- Password reset for an address that does not exist. Identical response and timing.
- Force `email_confirmed_at` to null in SQL and try to reach `/dashboard`.
- `db diff` after the migrations. A drop-and-recreate replays differently than it applied.

---

## Route map

Every route the app will have, and where each stands. **Orphaned** means the backend implements it and nothing in the app links to it.

### Public

| Route | Status | Notes |
|---|---|---|
| `/` | built, placeholder | Landing. Redirects signed-in visitors to `/dashboard`. Needs real content: see track 3. |
| `/auth/sign-in` | built | Google only so far. Gains a password form. |
| `/auth/callback` | built | OAuth code exchange. |
| `/auth/error` | built | Gains cases for expired and reused confirmation links. |
| `/auth/sign-up` | track 3 | Email, password, username, name, terms, Turnstile. |
| `/auth/check-email` | track 3 | Post-signup holding screen. Resend, spam-folder line, and a route back to sign-in. |
| `/auth/confirm` | track 3 | Route handler calling `verifyOtp`. |
| `/auth/forgot-password` | track 3 | Always reports success. |
| `/auth/reset-password` | track 3 | Reached only with a recovery session. |
| `/privacy` | parallel | **Required** for the Google OAuth consent screen. |
| `/terms` | parallel | Versioned. |
| `/support` | track 3 | FAQ plus contact form. |
| `/join/[token]` | track 2, step 7 | Invite preview via `circle_preview`. Excluded from `sitemap.xml`. |
| `robots.txt`, `sitemap.xml` | parallel | `app/robots.ts`, `app/sitemap.ts`. |

### Signed in

| Route | Status | Backed by |
|---|---|---|
| `/onboarding` | built | `complete_onboarding`. Gains the terms checkbox, then the install nudge and push prompt. |
| `/dashboard` | built, placeholder | Needs the check-in panel, Overview and notifications. |
| `/circles/[id]` | **orphaned** | `group_members`, `group_cycles`, `digest_snapshots`. **`public/sw.js` already deep-links here**, so a notification tap lands on a 404 today. Highest-priority orphan. |
| `/circles/[id]/settings` | orphaned | `transfer_ownership`, `create_invite_link`, `set_circle_deadline`, role updates. Hosts the kick flow's "also block?" step. |
| `/notifications` | orphaned | `notifications`. The durable channel; push is best-effort. |
| `/profile/[username]` | orphaned | `user_lifetime_stats.visible_on_profile`. Where blocking lives. |
| `/settings/profile` | orphaned | Rename path. Must surface *when* the next rename is allowed, not just refuse. |
| `/settings/notifications` | orphaned | `push_subscriptions`. Per-device list; natural home for the push opt-in. |
| `/settings/account` | orphaned | `export-data` and `delete-account` Edge Functions. Both deployed and verified, neither has UI. Self-serve deletion is an Apple requirement for any future store submission. |

### Protection

`lib/supabase/proxy.ts` currently treats `/auth`, `/_next`, `/`, and `/join` as public. Three more public prefixes are coming, so extract a `PUBLIC_PREFIXES` constant rather than growing the inline boolean.

Keep the posture deny-by-default: enumerate what is *public*, so a forgotten route fails closed as a redirect to sign-in. Enumerating what is protected means a forgotten route fails open, silently.

---

## Regression checklist

Passed in full on 12 August 2026. Retained because these are the checks worth repeating after any change to auth, the proxy, the gate, or the PWA layer. Work through them in order; each fails distinctively, so an early failure tells you where to look.

### 1. Sign-in round trip

`npm run dev`, then visit `/`.

| Check | Expected |
|---|---|
| `/` while signed out | landing page with a Sign in link |
| Sign in with Google | returns to `/onboarding`, not an error page |
| `/dashboard` while signed out | redirects to `/auth/sign-in?next=/dashboard` |
| Sign in from that redirect | lands on `/dashboard`, not `/` |
| `/auth/sign-in` while signed in | redirects straight through |

If the callback fails, read the message on `/auth/error`; it carries the actual reason. A redirect-URL mismatch is by far the most likely cause.

### 2. Open-redirect guard

Visit `/auth/sign-in?next=https://example.com`, then `?next=//example.com`, then `?next=/\example.com`. Each must sign in and land on `/dashboard`, never on an external host. This is the one security-relevant piece of new code, and it is worth confirming by hand rather than by reading.

### 3. Onboarding

| Input | Expected |
|---|---|
| `ab` | rejected, 3 to 30 characters |
| `has space` or `has-dash` | rejected by the pattern |
| A profane word | rejected with a neutral message |
| A name already taken | "That username is taken." |
| A valid name | redirects to `/dashboard` |

Then confirm the row, timezone in particular, since the entire rollover keys off it:

```sql
select username, checkin_timezone, checkin_day_started_at
from public.users where id = '<your-uid>';
```

`checkin_timezone` must be your real IANA zone, not `UTC`. `UTC` means the hidden field submitted empty and client-side detection is not running.

Then visit `/onboarding` again directly. It should redirect to `/dashboard` rather than offering the form.

### 4. Gate behaviour

Every path under `(app)` must redirect to `/onboarding` when the username is null. Force the state:

```sql
update public.users set username = null where id = '<your-uid>';
```

Visit `/dashboard`, then restore the username.

### 5. PWA install

Deploy to Vercel first. Service workers require HTTPS, so this cannot be tested on `localhost` in a way that reflects production.

- Chrome DevTools, Application, Manifest: no icon errors, `display: standalone`.
- Application, Service Workers: `sw.js` activated, not redirected.
- On an iPhone: Share, Add to Home Screen, then open from the home screen. It must open without browser chrome. If Safari chrome appears, `appleWebApp` metadata is not reaching the page, and push will never work on iOS.

### 6. Regressions

```bash
npx tsc --noEmit
npx eslint .
npm run build
npx supabase db diff        # should print nothing
```

### Still unverified after this pass

- **Rate limiting.** Wired but never triggered; it takes 15 onboarding attempts in an hour.
- **Every RPC except `complete_onboarding`.** Circles, goals, check-ins and invites have all been tested in SQL and none of them through the app.
- **Email deliverability to a stranger.** Brevo delivers to the sender's own Gmail, which proves nothing about another provider.
- **Push notifications end to end.** The service worker registers, but nothing has ever sent a push to a real device.
- The profanity filter has false positives on innocent substrings. Intended, but worth knowing before someone reports it as a bug.

---

## Bug patterns in this codebase

Every real bug found so far fell into one of six shapes. Probe for these specifically after any change.

| Pattern | Example found |
|---|---|
| **Setter with no resolver** | `streak_grace` set on join, never cleared, so the group streak ignored that member forever |
| **Declared with no writer** | `admin_promoted`, `invite_link_toggled`, `kicked`, `group_locked_renewal` all existed but nothing produced them |
| **Guarded on one path, not its inverse** | owner succession guarded departures; joining an empty archived Circle recreated the ownerless state |
| **Unreachable code** | `service_role` had no grants; `private` is not addressable by PostgREST |
| **Locked column, no writer** | `username` and `checkin_timezone` blocked with nothing able to set them, making onboarding impossible |
| **Relying on the environment, not the migrations** | no migration enabled RLS, the dashboard's event trigger did. A rebuild produced an open database. |

**A replay into a shadow database is its own category of test.** `supabase db diff` builds a fresh Postgres and runs all 57 migrations, which is the only thing that catches a history depending on state it never creates. Run it after any batch of schema work, not only before a rebuild.

---

## Standing checks

Re-run both after any migration. Architecture records the expected result; these produce it.

**Function posture.** Should show 41 functions, none `anon`-executable, none with a mutable path.

```sql
select n.nspname, p.proname,
       case when p.prosecdef then 'DEFINER' else 'invoker' end as mode,
       case when p.proconfig::text like '%search_path%' then 'pinned' else 'MUTABLE' end as sp,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','private') order by 1, 2;
```

**Every enum value has a producer.** Should return nothing.

```sql
with agg as (
  select string_agg(pg_get_functiondef(p.oid), E'\n') as s
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
)
select t.typname, e.enumlabel
from pg_type t join pg_enum e on e.enumtypid=t.oid, agg
where t.typname in ('notification_type','audit_action_type')
  and agg.s not like '%''' || e.enumlabel || '''%';
```

Also run both Supabase advisors until clean. Fixing one finding can create another. Expected permanent output is listed in `architecture.md` section 4; anything beyond it is real.

---

## Schema change routine

Six stages, in order. Each catches a class of problem the previous one cannot.

1. **Apply** one logical group of objects, not the whole schema. Small steps mean a failure points at a specific cause.
2. **Verify structurally**: query `information_schema`, `pg_indexes`, `pg_constraint`. A migration succeeding only proves the SQL parsed.
3. **Test behaviourally** in a `DO` block: insert real rows, attempt what should fail, assert each rejection, then `RAISE` a sentinel to roll back. For RLS, `SET LOCAL ROLE authenticated` plus `set_config('request.jwt.claims', …)`; testing as the owner bypasses RLS and proves nothing.
   - **Know which error each defence raises.** An RLS violation and a missing column grant both raise `insufficient_privilege` (42501); a CHECK or trigger raises `check_violation` (23514). BEFORE triggers fire *before* `WITH CHECK`, so where both guard a rule, the trigger's error wins.
4. **Probe for gaps.** Steps 1 to 3 verify what you intended; they cannot tell you what you failed to think of. Write a block that attempts plausible abuses and *reports* which succeeded instead of asserting. This caught check-ins being accepted on archived and achieved goals: every assertion passed, because none asked that question.
5. **Run the standing checks and both advisors** until clean.
6. **Update the docs**, including deviations and why. Record confirmed-correct behaviour too. Behaviour emerging from a language subtlety, such as anonymized rows being invisible because `NULL = auth.uid()` is NULL rather than true, is exactly what a later refactor breaks by accident.

---

## config.toml

`supabase/config.toml` exists with `project_id = "wyuadcnrxisqmzygzhzd"`. It is committed for one reason above all: it is the only version-controlled record of which Supabase project this checkout points at. The link state lives in `supabase/.temp/`, which is gitignored.

**What it does and does not govern.** It configures the *local* stack that `supabase start` would run. The hosted project is configured through the dashboard, and nothing in this file has been reconciled against it.

**Do not run `supabase config push`.** It applies the *resolved* configuration, so every value still at a CLI default would overwrite the corresponding dashboard setting rather than being left alone. The generated `[auth]` block is entirely stock, with a `127.0.0.1` site URL and no Google provider section. Pushing it would disable Google sign-in. The file carries this warning at the top and above `[auth]`.

**What `link` actually checks.** It compares the local `[db] major_version` against the remote server. A quiet "Finished supabase link" means it matched. It is not a full config diff, so silence is not evidence that the rest of the file agrees with the dashboard.

---

## Daily workflow

```bash
npm run dev
```

The app talks to the **hosted** Supabase project through `.env.local`. `npx supabase start` is not needed; that runs a full local Postgres, Auth and Storage stack in Docker, worth doing once real users exist. Docker is required only for `db diff`, `db reset` and `supabase start`.

| Command | When |
|---|---|
| `npm run dev` | always |
| `npx supabase db diff` | after schema changes, to prove migrations rebuild |
| `npx supabase gen types typescript --project-id wyuadcnrxisqmzygzhzd > lib/database.types.ts` | after schema changes |
| `npx supabase functions deploy <name>` | after editing an Edge Function |

---

## Open items

### Blocking

- **Migration workflow, undecided.** Schema changes currently go straight to the project, which drifts from the repo. Either continue and re-run `npx supabase migration fetch` afterwards, or write files into `supabase/migrations/` and `npx supabase db push`. The second gives review over schema changes, and track 3 adds two migrations, so this wants deciding before then.

### Before launch

- Security headers.
- Wire rate limits into each new action as it is written.
- `pushsubscriptionchange` handler, a TODO in `components/service-worker-registrar.tsx`. Without it a device silently stops receiving push.
- A custom domain, if email deliverability from a personal sender proves to be a problem.

### Deferred to v2

- Replace the placeholder icons.
- All visual design. See `product-and-design.md`.

### Undecided copy

- Digest wording per Circle size.
- "Digest" versus "Daily Recap", the Group Streak label, the leaderboard label. Better decided against real screens.

### Carry into the UI

- Show the current deadline on the Circle page. `deadline_changed` covers the moment of change; a persistent display is what stops "when is this due again?" being a question.
- Invite failures return machine codes (`INVITE_EXPIRED`, `CIRCLE_FULL`, and so on). Branch on those, not message text. `architecture.md` section 10.
- Streaks lag a day by design. Display `current_streak + (1 if today complete)`.

---

## Gotchas

- `.rpc()` is lint-banned outside `app/actions/`. A direct call skips rate limiting and the profanity filter.
- Never hand-trim `lib/database.types.ts`. Dropping the `Relationships` arrays makes every embedded join a type error.
- Rollover runs hourly and takes **no argument**. An explicit date bypasses the idempotency guards and double-counts streaks.
- A new notification type needs three things: the enum value in its own migration, a writer, and a teaser case in `send-digest-push`.
- A new table needs an explicit `enable row level security` in the same migration. The dashboard setting does it live; no migration does.
- A new enum value and its first use must be separate migrations.
- Adding a parameter to a Postgres function creates an overload rather than replacing it. Drop first.
- Never order by or compare an enum. Postgres uses declaration order, an accident of how the type was written.
- Reference `goal_categories` by `slug`, never by hardcoded id. The UUIDs are per-environment.
- Regenerate types after any schema change.
- The root file is `proxy.ts` exporting `proxy`. Next.js 16 deprecated the `middleware` name; do not recreate it.
- Never request notification permission on page load. Browsers allow one ask and a denial is permanent.
- Brevo's SMTP login is `xxxxxx@smtp-brevo.com`, not your account email, and the SMTP key is not an API key.
