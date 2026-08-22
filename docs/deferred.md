# Solarity: Deferred

Designed, argued, and **not built**. Nothing here blocks the core loop. Each item keeps its reasoning so the decision does not have to be made twice.

---

## Public surface and email signup

Deferred until the core loop works end to end. All of the design thinking is settled; what follows is the sequence and the traps.

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

`architecture/` records Turnstile as configured but inert, because Supabase's CAPTCHA guards only endpoints that take a `captchaToken`: signup, password sign-in, OTP, password reset. A Google-only app calls none of them.

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

- How to delete your account, and what survives (check-ins anonymized and retained; `architecture/security.md` section 11).
- How to export your data. `export_user_data` exists and nothing calls it.
- What happens to check-in photos (90-day retention).
- How to report content, and what follows.
- How blocking differs from kicking.
- Why an iPhone needs the app installed to receive notifications.

### Supabase dashboard steps

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

The invite, join, archive and streak-decision flows are now covered by Playwright rather than by hand. See "End-to-end tests" in Reference.

---

---

### Digests stop being rows in `notifications`

**Why it is deferred rather than dismissed.** After step 11c a digest row exists only to carry a push: nothing renders it, and `read_at` never applies to it. The clean version is for `send-digest-push` to read `digest_snapshots` directly, leaving `notifications` to the four event types alone.

That would make the separation structural instead of a type filter, and would remove the standing risk that someone counts unread rows without excluding digests.

**The cost** is a rewrite of the sender's query and of how it tracks what it has already delivered — `pushed_at` lives on the notification row, so `digest_snapshots` would need an equivalent, per member rather than per Circle. That is a bigger change than step 11 warranted.
