# Solarity — Architecture

**What the system is.** Schema, security model, server behaviour, and environment configuration — the current state of the app, and the reasoning behind the decisions that produced it.

This doc does not track work. Next steps, open decisions, known bugs, gotchas and the change log live in `build-plan.md`. Naming, screen inventory, build phases and the deferred visual design live in `product-and-design.md`.

**Where this doc and the live database disagree, the database is authoritative and this doc is the bug.**

---

# Current state

## What exists

| Area | State |
|---|---|
| Schema — 21 tables, constraints, caps | built |
| RLS — 41 table policies, 8 storage policies | built |
| RPCs — 12 client-callable | built |
| Derived data — triggers + rollover | built |
| Digest — SQL builder + push sender | built |
| Retention sweep, photo purge | built |
| Edge Functions — 4 deployed | built, verified 200 end to end |
| Storage buckets + policies | built |
| Realtime publication | built |
| Job scheduling — 5 pg_cron jobs | built, Vault secrets confirmed |
| TypeScript types | generated → `lib/database.types.ts` |
| Supabase clients, proxy, rate limiters, lint rules | in repo |
| Migrations + Edge Functions in version control | 57 + 4, `db diff` clean |
| PWA — manifest, service worker, registrar, icons | built |
| Auth — sign-in, callback, sign-out, route guard | built |
| Onboarding — username + timezone | built |
| Application — Circles, goals, check-ins, dashboard panels | not built |

## Standing invariants

Verified after the last audit. Any deviation is a real finding, not noise.

- 0 tables without RLS enabled
- 0 `anon`-callable functions; 0 functions with a mutable `search_path`
- 0 `anon` DML grants; 0 public storage buckets
- Every `notification_type` and `audit_action_type` value has a writer
- Expected linter output is listed in section 4 — anything beyond it is real

The queries that check these live in `build-plan.md`.

## Caveats on what is built

- **The application layer has never run in a browser.** Auth, onboarding and the dashboard shell are committed as the "oauth skeleton" and pass `tsc`, `eslint` and `next build`; nothing more. Browser verification is the first item in `build-plan.md`, track 2.
- **Rate limiting is wired but has never been triggered.**
- **Turnstile is inert.** It is configured in Supabase Auth, but Supabase's CAPTCHA guards only endpoints that accept a `captchaToken` — signup, password sign-in, OTP, password reset. This app is Google-only and calls none of them, so `signInWithOAuth` has no token to attach. It becomes live the moment email/password auth is added, which is planned. The real bot defence today is Google OAuth plus Upstash rate limiting.
- **Email is capped at 2 messages per hour** by Supabase's built-in sender. Latent, since nothing sends email yet. See section 14.
- **The retention sweep and photo purge are scheduled but have never run against real volume.**
- **The icon set is a generated placeholder mark** — correct dimensions, replaceable in v2.

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
| Auth | Google only (v1) | Apple deferred pending a developer account — adding it later is a provider toggle, not a schema change |
| Cache / rate limit | Upstash Redis (REST) | Serverless-friendly |
| Hosting | Vercel | Native Next.js, cron support |
| Scheduled jobs | pg_cron (+ pg_net for Edge Functions) | Runs inside Postgres, so the SQL jobs need no network hop, no shared secret, and no deployed app |
| Testing | Vitest + Testing Library | |
| PWA | hand-rolled — no dependency | See "PWA & push delivery" below. `next-pwa` was the original choice and was reversed. |

**Redis is always a fast path, never the source of truth.** Every Redis-backed read falls back to a live Postgres query on a miss or outage. Without that rule a Redis outage takes down whatever screen depends on it — unacceptable for the home dashboard.

---

## 2b. Application structure

```
app/
  (app)/            signed-in screens; layout.tsx is the onboarding gate
  actions/          server actions — the only place .rpc() may appear
  auth/             sign-in page, OAuth callback route, error page
  onboarding/       username + timezone
  manifest.ts       web app manifest
components/         client components
lib/
  supabase/         browser client, server client, admin client, proxy helper
  ratelimit.ts      Upstash limiters
  errors.ts         SQLSTATE → user-facing message
  profanity.ts      obscenity matcher
  safe-redirect.ts  open-redirect guard for the `next=` parameter
proxy.ts            session refresh + anonymous redirect
```

### Three enforcement points, in order

1. **`proxy.ts`** refreshes the auth session and redirects anonymous requests to sign-in. It uses `getUser()`, not `getSession()` — the latter reads the cookie without verifying it, which is not a basis for an authorization decision. It deliberately does **not** check onboarding: that would be a database round trip on every request, including prefetches and asset fetches.
2. **`app/(app)/layout.tsx`** checks that a username exists and redirects to onboarding otherwise. One query per protected navigation, and the same query the header needs anyway.
3. **`app/actions/*`** wrap each RPC with rate limiting, profanity screening, and error mapping. RLS still protects the data if this layer is bypassed; what is lost is throttling.

The service-role client is confined to work no user can be the actor of — currently the username-availability check, which must read rows RLS hides. An ESLint rule blocks importing it into components, and a second rule blocks `.rpc(` outside `app/actions/`.

### Redirect handling

The `next=` parameter survives the whole OAuth round trip so an invite link resolves after sign-in (section 10). It is therefore attacker-controllable, and `safeRedirect()` constrains it to a single-leading-slash relative path — rejecting `//host` and any backslash — so the sign-in page cannot be turned into an open redirect.

### Rate limits

Keyed by user id, enforced in server actions via `lib/ratelimit.ts`.

| Action | Limit |
|---|---|
| Onboarding / rename | 15 / hour |
| Create Circle | 5 / day |
| Join Circle | 10 / hour |
| Create goal | 20 / hour |
| Check in | 60 / hour |
| Photo upload | 20 / hour |
| Create invite link | 10 / hour |
| Submit report | 10 / day |

This is the app's primary abuse control, not Turnstile. A Google account is already a higher barrier than a CAPTCHA; what needs bounding is a signed-in user hammering the RPCs.

Limiters are constructed on first use rather than at module scope. `Redis.fromEnv()` throws when the Upstash variables are absent, and `lib/ratelimit.ts` sits in the import graph of every server action, so building them eagerly turned a missing runtime variable into a failed `next build`.

### Error mapping

`lib/errors.ts` maps SQLSTATE to a message: `23505` unique violation, `23514` check violation, `22023` the RPCs' own `invalid_parameter_value` raises, `42501` RLS or a missing grant. Anything unrecognised returns a generic message, since raw Postgres errors disclose table and column names. Mapping by code rather than message text means renaming a constraint does not silently change what users see.

Server actions return `{ ok: true } | { ok: false, error }` rather than throwing. A thrown error in a server action reaches production as an opaque "An error occurred", which is useless in a form.

---

## 3. Schema

### `users`
Populated by the `on_auth_user_created` trigger off `auth.users`.

- `id` (uuid PK, matches `auth.users.id`)
- `first_name`, `last_name` (nullable) — from structured OAuth claims (`given_name`/`family_name`) only, left null otherwise. **No whitespace-splitting fallback**: it mis-parses compound surnames, multiple given names, and family-name-first orders, producing data that looks real but is wrong. A null is more honest than a bad guess.
- `username` (nullable, **case-insensitively unique** via a unique index on `lower(username)`) — the public identity everywhere. Case-insensitive because a plain constraint would allow both `Ryan` and `ryan`, a cheaper impersonation route than unicode lookalikes. **Lookups must query `lower(username) = lower($1)` to hit the index.** Nullable because OAuth can't supply one; onboarding sets it.
- `avatar_url`
- `checkin_timezone` (IANA name), `checkin_day_started_at` — frozen at each 2 AM rollover, not read live. See check-in dates below.
- `created_at`, `updated_at`

**Renames**: once per 14 days, enforced by `complete_onboarding()`, which also writes a `username_history` row. `username_history` (`user_id`, `old_username`, `changed_at`) is a support/moderation trail, never surfaced.

Live views resolve the current username via FK. The exception is `notifications.payload` and `digest_snapshots.summary` — both jsonb written once, so the username must be **denormalized in at write time**. Joining live would let a March entry silently start crediting a name that person didn't have in March.

### `goals`
User-owned, never group-owned. Goals stay constant across every Circle a user belongs to.

- `id`, `user_id` (FK → users), `title`
- `category_id` (FK → goal_categories, **required**, `ON DELETE RESTRICT`) — no uncategorized state
- `deadline` (nullable, **unconstrained**) — personal and informational; recording a missed or historical deadline is legitimate, so a constraint here would fight the user
- `achieved_at` (nullable, CHECK `<= now()`) — the goal itself is done, distinct from a daily check-in
- `archived_at` (nullable, CHECK `<= now()`) — dropped rather than completed
- `created_at`, `updated_at`

Achieving doesn't touch `daily_completion` or streak history. After achieving, the user is prompted to archive, edit into a new goal, or keep it active.

### `goal_categories`
Fixed preset, seeded. Not user-customizable.

- `id`, `slug` (unique), `name` (unique), `color_hex` (CHECK `^#[0-9A-Fa-f]{6}$`)

**Reference categories by `slug`, never by `id`.** The UUIDs are generated per-environment by the seed, so a hardcoded id works in one database and silently breaks in another.

Seeded: Fitness `#FF3131`, Hobbies `#FF8A00`, Career & Professional `#FFD500`, Health & Wellness `#6EE62E`, Finances `#00D9A3`, Productivity & Habits `#1EC8FF`, Mindfulness & Mental Health `#8A4FFF`, Social & Relationships `#F730A8`, Other `#3355FF`.

Colours are bright rather than muted because they eventually render as glowing tints against a dark background, spaced ~40° apart on the wheel so all nine stay distinguishable. Adding a category later is a data insert. **Avoid changing an existing `color_hex`** once goals reference it — `category_id` is a live FK, so a change retroactively recolours everything using it.

### `groups`
- `id`, `name`, `group_status` (enum: `active`, `locked`, `archived`)
- `streak_decision_pending` (bool), `pending_streak_joiners` (jsonb array) — see section 13
- `leaderboard_persists_across_cycles` (bool, default `false`), `default_stats_view` (enum) — owner-configurable
- `created_at`, `updated_at`

**No `owner_id`, no `deadline`.** Ownership lives only in `group_members` where `role = 'owner'`, guaranteed unique per group by a partial unique index. The active deadline lives on the open `group_cycles` row. Both columns existed and were removed as duplicated state with nothing keeping the copies in sync.

**Owner succession** (added because removing `owner_id` removed its `ON DELETE RESTRICT`, the only thing preventing an ownerless circle). When an `owner` row is removed, `handle_membership_removal` promotes the **longest-tenured remaining member**, or archives the circle if nobody remains. RLS blocks a normal owner departure, so this fires mainly on account deletion — written defensively because an ownerless circle is unrecoverable and there's no second chance to notice.

### `group_members`
- PK `(group_id, user_id)` — a relationship, so the pair is the identity and duplicates are impossible by construction
- `role` (enum: `owner`, `admin`, `member`), `streak_grace` (bool), `joined_at`, `updated_at`
- Partial unique index on `(group_id) where role = 'owner'` — one owner, structurally
- Separate index on `user_id`: the composite PK serves "who's in this circle" but not "which circles am I in", which is the entire home dashboard

Feed and digest queries join through **current** rows. Someone kicked or departed is structurally excluded from future reads; their `progress_entries` remain for data integrity but nothing surfaces them.

### `group_cycles`
One run of a Circle's challenge, from creation or reset to its deadline.

- `id`, `group_id`, `started_at`, `ended_at` (null while active), `deadline` (null = open-ended, never locks)
- `current_streak`, `longest_streak` — the group streak
- Partial unique index on `(group_id) where ended_at is null` — exactly one active cycle, structurally
- CHECK: streaks non-negative; `ended_at >= started_at`

A circle always has exactly one active cycle; there's no "no cycle yet" state. `create_circle()` inserts the group, the owner's membership, and the first cycle in one transaction.

**On reset**: the current cycle closes (`ended_at` set) and a new row opens. `group_cycle_stats` rows are scoped to `cycle_id`, so new rows start at zero without touching history.

**A member joining mid-cycle** gets a fresh `group_cycle_stats` row for the current cycle, starting at zero — never retroactively scored. **Rejoining the same cycle** reuses the old row, so their streak reflects the gap like any lapse.

### `invite_links`
- `id`, `group_id`, `token` (unique), `enabled` (bool), `expires_at` (nullable), `created_at`
- `created_by` (nullable FK → users, `ON DELETE SET NULL`) — the row outlives its creator's account, since it's audit data

Tokens are **server-generated only** — 32 CSPRNG bytes, URL-safe base64 (43 chars), via `create_invite_link()`. Clients hold no insert grant. **Default expiry is 7 days.** Regenerating disables the previous link rather than deleting it.

### `goal_group_visibility`
Hides one goal from one Circle while keeping it visible in others.

- PK `(goal_id, group_id)`, `hidden` (bool, default `false`)

**Sparse: a missing row means visible.** Reads must `LEFT JOIN` and `coalesce(hidden, false)` — a plain lookup returns nothing for the common case, which is easy to mistake for an error. `private.is_goal_hidden_in_group()` encodes this once so nothing else has to remember.

Hiding is display-only. The goal still counts toward daily completion; the accountability math is unaffected.

**Not enforceable in the schema**: nothing prevents a row pairing a goal with a Circle its owner doesn't belong to. Foreign keys can't reach across tables like that, so RLS covers it.

### `progress_entries`
One check-in per goal per day. Daily habits, not arbitrary logging.

- `id`, `check_in_date` (date), `note`, `photo_url`, `created_at`
- `goal_id`, `user_id` — both **nullable**, `ON DELETE SET NULL`
- Unique `(goal_id, check_in_date)`
- CHECK: `note` ≤ 500 chars

`user_id` is denormalized from `goals.user_id` so RLS and rollups filter by user without joining `goals` on the hottest read path. The `validate_progress_entry_owner` trigger rejects any row whose `user_id` doesn't match the parent goal's owner, so the duplication can't drift.

**Why both FKs are nullable**: section 11 requires check-ins to survive account deletion in anonymized form, since other members' historical stats are computed against them. Nullable means "anonymized", never "a live check-in without a goal".

**Anonymized rows are invisible to clients through NULL semantics.** Both RLS predicates evaluate to NULL/false when `user_id` is null, so deleted-account rows are hidden from every client while remaining available to `service_role`. This emerges from three-valued logic rather than an explicit rule — a future rewrite adding a `coalesce` or `IS NOT DISTINCT FROM` would expose them. NULLs also being distinct means anonymized rows never collide under the unique constraint.

**`check_in_date` is computed server-side, not sent by the client.** `private.current_checkin_date()` derives it from the user's frozen `checkin_timezone` under a 2 AM boundary (subtract 2 hours, cast to date), so 01:30 Tuesday resolves to Monday. The INSERT policy requires an exact match and the column is excluded from the UPDATE grant. Without this a client could post backdated check-ins and fabricate an unbroken streak.

**Timezone travel is closed by freezing.** Reading the device's live timezone per request would let a mid-day flight grant a second check-in or skip a day. `checkin_timezone` updates only at a natural rollover via `sync_checkin_timezone()`, which is a **no-op mid-day**. A mid-flight check-in may feel a few hours off until the next boundary, but exactly one window per day is guaranteed.

### `daily_completion`
Derived. Whether a user completed **all** active goals (visible and hidden) that day — the binary the whole streak system rests on.

- PK `(user_id, date)`, `all_completed` (bool)

**Zero-goal days are `false`, not vacuously true and not skipped.** There's no point being in the product without a goal, so a goal-less day is a real failure for both individual and group streaks.

### `group_cycle_stats`
Per-cycle, per-member streaks.

- PK `(cycle_id, user_id)` — **no `group_id`**: `group_cycles` already determines it. Reach the group through the cycle.
- `current_streak`, `longest_streak_in_cycle`, `updated_at`
- CHECK: non-negative; `longest >= current`

### `group_daily_completion`
Derived, backs the group streak.

- PK `(cycle_id, date)` — **no `group_id`**, same reasoning
- `all_members_completed` (bool) — true only if every current non-grace member completed everything

### `group_member_category_stats`
Backs the leaderboard.

- PK `(group_id, user_id, category_id)` — `group_id` **is** load-bearing here; nothing else in the row determines it
- `total_completions`, `total_possible`, `current_streak`, `longest_streak`, `updated_at`
- CHECK: non-negative; **`total_completions <= total_possible`** (a rate above 100% is meaningless, so this catches double-counting at the source); `longest >= current`

### `user_lifetime_stats`
Persists across every cycle and Circle.

- `user_id` (PK), `current_streak`, `longest_streak_ever`, `total_days_completed`, `total_goals_achieved`
- `visible_on_profile` (bool, default `false`) — opt-in, and the **only** client-writable column
- CHECK: non-negative; `longest_streak_ever >= current_streak`; `longest_streak_ever <= total_days_completed`

**One row per user, created at signup** by `handle_new_user()`, so no read path has to distinguish "no row yet" from "all zeroes".

### `notifications`
- `id`, `user_id`, `type` (enum), `payload` (jsonb), `read_at`, `created_at`
- Indexes: `(user_id, created_at desc)` for the feed; **partial** on `(user_id) where read_at is null` for the unread badge, since unread stays a small slice of a table that grows forever; `(created_at)` for the retention sweep

| Type | Written by | When |
|---|---|---|
| `digest` | `build_daily_digests()` | daily, one per member per Circle |
| `kicked` | `handle_membership_removal` | on a genuine kick, never on leaving or account deletion |
| `invite_accepted` | `join_circle()` | to every existing member when someone joins |
| `group_locked_renewal` | `run_daily_rollover()` | to the owner, once, on the lock transition |
| `deadline_changed` | `set_circle_deadline()` | to every member except whoever made the change |

Every value has a writer. `cosmetic_unlocked` is deliberately absent until the galaxy ships — add the value in one migration, use it in the next.

**`admin_transfer_request` was dropped from this enum.** It implied transfer required the recipient's acceptance, but `transfer_ownership` completes immediately, and automatic succession already assigns ownership without consent when an owner deletes their account — so requiring consent on one path and not the other would have been inconsistent. Removing it meant rewriting the type, which Postgres can't avoid; doing it pre-launch with zero rows was as cheap as it will ever be.

`payload` is an **immutable snapshot** — see the denormalization rule under `users`.

### `push_subscriptions`
- `id`, `user_id`, `endpoint` (**globally** unique — registering twice would double-deliver), `p256dh`, `auth`, `device_label`, `created_at`
- CHECK: `endpoint` matches `^https://`

Jobs fan out to every subscription for a user, covering multi-device installs.

**iOS gap**: web push only works for a PWA added to the home screen (16.4+), and iOS offers no native install prompt. A user who skips it silently gets nothing. Notifications persist in the table regardless, so nothing is lost — but push is what pulls people back, so onboarding must include an explicit add-to-home-screen step.

### `digest_snapshots`
- PK `(group_id, date)`, `summary` (jsonb, immutable snapshot), `created_at`

The Overview subtab and the push notification read the same row, so they can't disagree.

### `content_reports`
- `id`, `content_type` (enum), `content_reference`, `reason` (≤500), `status` (enum), `created_at`, `reviewed_at`, `reviewed_by`
- `reporter_user_id`, `reported_user_id` — nullable, `ON DELETE SET NULL`: a report must outlive the accounts involved
- CHECK: `reviewed_at >= created_at`; **status/review consistency** — `pending` must have null `reviewed_at`, non-pending must have one. Makes "resolved but no record of when" unrepresentable.
- CHECK: `reporter_user_id <> reported_user_id`
- Index: partial on `(created_at) where status = 'pending'` — the moderation queue

`content_reference` snapshots the flagged content at report time so later edits can't undermine a pending review. Review happens via Supabase dashboard at v1 scale.

### `user_blocks`
- PK `(blocker_user_id, blocked_user_id)`, both `ON DELETE CASCADE` — a block is meaningless once either party is gone
- CHECK: no self-blocking
- Index on `blocked_user_id` for the "who blocked me" lookup that filters invite joins

**Directional.** A→B and B→A are separate rows. Blocking prevents viewing the blocker's profile stats and joining via a link the blocker administers. It does **not** remove anyone from a shared Circle — that's kick's job.

### `audit_log`
**Append-only.** Every FK is `ON DELETE SET NULL`, never cascade: an audit trail that deletes itself when the actor leaves isn't an audit trail. A record with both names nulled still proves the event happened and carries its timestamp.

- `id`, `actor_user_id`, `group_id`, `target_user_id` (all nullable FKs), `action_type` (enum), `metadata` (jsonb), `created_at`
- Index: `(group_id, created_at desc)`

Actions: `member_joined`, `member_left`, `member_kicked`, `ownership_transferred`, `admin_promoted`, `admin_demoted`, `invite_link_toggled`, `invite_link_regenerated`, `group_deadline_changed`, `group_cycle_reset`, `group_cycle_extended`, `group_streak_continued`, `group_streak_reset`. **All thirteen have a writer.**

**Role changes and invite toggles are audited by trigger, not by RPC**, because both happen through a direct `UPDATE` that no function mediates. Without those triggers, `admin_promoted`, `admin_demoted`, and `invite_link_toggled` had no writer at all — a promotion left no trace. The invite trigger fires only on a deliberate toggle: regeneration also disables the old row, but `create_invite_link` already logs that as `invite_link_regenerated`, and double-logging one action makes a trail misleading rather than complete.

`member_joined`/`member_left` were added after noticing only *kicks* were audited. `group_members.joined_at` answers "when did they join" only while they're still a member and vanishes when they leave, so membership history has to outlive membership.

Deliberately **not** duplicated here: `content_reports` resolution (that table carries its own `status`/`reviewed_at`/`reviewed_by`) and username changes (`username_history`).

### Cross-cutting conventions

- **`updated_at`** on every mutable table, maintained by a shared `set_updated_at()` BEFORE UPDATE trigger so it can't be forgotten at a call site. Append-only tables have `created_at` only.
- **Trigger functions are not API endpoints.** Anything in `public` is published at `/rest/v1/rpc/<name>`. Trigger functions have `EXECUTE` revoked from `anon`, `authenticated`, and `public`; triggers run as the table owner and ignore grants, so revoking costs nothing.
- **Every function pins `search_path = ''`** and fully qualifies references. `SECURITY DEFINER` only where genuinely required.
- **Never compare or order by an enum.** Postgres allows it, using *declaration order*, which is an accident of how the type was written — and `ADD VALUE` appends, so `member_joined` now sorts after `group_streak_reset`. If a status ever needs meaningful ordering, that's the signal it should be a lookup table with an explicit `sort_order`, like `goal_categories`.
- **Adding an enum value and using it must be separate migrations.** Postgres rejects using a new value in the transaction that added it.
- **Every `CREATE TABLE` must be followed by an explicit `ENABLE ROW LEVEL SECURITY` in the same migration.** The project's "Enable automatic RLS" setting does this via an event trigger, but that trigger is created by the dashboard and exists in no migration. For 56 migrations nothing enabled RLS explicitly — a rebuild into a fresh database produced 21 tables with RLS **off** and all 41 policies present but inert, which with `authenticated` holding real grants meant a wide-open database. Found the first time `supabase db diff` replayed the history into a shadow database. The dashboard setting stays on as a safety net; the migration history has to stand alone.

- **Never depend on a platform-created object without guarding it.** Migration 17 revoked `EXECUTE` on `public.rls_auto_enable()`, which the dashboard creates. In a shadow database that function doesn't exist and the unconditional `REVOKE` aborted the whole replay. It's now wrapped in an existence check. Anything owned by Supabase rather than by this history — `rls_auto_enable`, vault secrets, project settings — needs the same treatment.

- **Count-based caps lock the parent row first.** The 10-member and 10-active-goal caps can't be CHECK constraints since they require counting other rows. A naive count-then-decide trigger is racy: two simultaneous joins to a 9-member circle both read 9 and both insert. Each cap does `SELECT ... FOR UPDATE` on the parent (the group, or the user) before counting, serializing writes *for that parent only* so different circles never block each other.

### Length and format constraints

| Field | Rule |
|---|---|
| `users.username` | 3–30 chars, `^[A-Za-z0-9_]+$` — ASCII only, blocking unicode-lookalike impersonation |
| `users.first_name` / `last_name` | ≤ 100 |
| `goals.title` | 1–100 |
| `progress_entries.note` | ≤ 500 |
| `groups.name` | 1–50 |
| `content_reports.reason` | ≤ 500 |
| `push_subscriptions.device_label` | ≤ 50 |

The `obscenity` profanity filter for usernames and Circle names stays in the app layer — it needs a maintained wordlist and obfuscation detection that doesn't belong in a CHECK. These constraints are the floor beneath it, not a replacement.

---

## 4. Security model

### Grants come first

**Postgres checks table grants before evaluating any policy.** A perfect policy with no grant returns nothing. Because "Automatically expose new tables" is disabled on this project, no role — including `service_role` — holds DML by default. Every table needs an **explicit grant paired with its policy in the same migration** so they can't drift.

This is the stronger posture: access is an allowlist, and a forgotten grant fails closed.

- **`anon` holds no grant on any table.** The product is invite-only and unauthenticated visitors are routed through sign-in before anything is read.
- **Column-scoped `UPDATE` grants** where a table has immutable columns. A column that was never granted can't be targeted at all, which is stronger than a `WITH CHECK` expression someone has to write correctly.
- **`TRUNCATE` is revoked** from all client roles, with default privileges altered so new tables don't reacquire it. **TRUNCATE bypasses RLS entirely** — policies are never consulted — so the grant would have undercut every rule here. Not reachable through PostgREST today, but relying on the API surface staying narrow forever isn't a security argument.
- `REFERENCES` and `TRIGGER` remain: both need ownership-level access and neither reads data.
- **`service_role` bypasses RLS but still needs grants.** When grants were rebuilt as an explicit allowlist, everything went to `authenticated` and nothing to `service_role`, so every Edge Function query returned a 500 — grants are checked *before* RLS, and bypassing RLS does not help a role that cannot touch the table. This went unnoticed because pg_cron runs as the table owner; only the Edge Functions exercise the path. `service_role` now holds blanket DML deliberately: it already bypasses RLS, so per-table grants add no real restriction and only produce failures of this kind. Its real control is that the key never leaves server-side contexts. `TRUNCATE` stays revoked even here, since it bypasses RLS *and* skips triggers.
- **PostgREST cannot address the `private` schema, so job helpers live in `public`.** Edge Functions calling `.schema("private").rpc(...)` fail: PostgREST honours a schema header only for schemas in its exposed list, and `private` deliberately is not one — exposing it would hand clients the RLS-bypassing helpers it exists to hide. The three job-only functions (`job_list_expired_photos`, `job_mark_photos_purged`, `job_scrub_and_list_user_media`) therefore sit in `public` with `EXECUTE` granted to **`service_role` alone**. PostgREST resolves them, Postgres refuses any other caller, and they stay off the linter's report, which flags only what `anon` and `authenticated` can call.

### Access matrix (`authenticated`)

| Table | Read | Insert | Update (columns) | Delete |
|---|---|---|---|---|
| `users` | self + circle-mates | — | `first_name, last_name, avatar_url` | — |
| `user_lifetime_stats` | self; circle-mate if opted-in and not blocking you | — | `visible_on_profile` | — |
| `goal_categories` | all | — | — | — |
| `goals` | self + circle-mates | own | `title, category_id, deadline, achieved_at, archived_at` | — |
| `progress_entries` | self + circle-mates | own, **active** goal, **today only** | `note, photo_url` | own |
| `daily_completion` | self + circle-mates | — | — | — |
| `goal_group_visibility` | goal owner or circle member | own goal + member | `hidden` (member only) | own goal |
| `groups` | members | — | `name` (admin); leaderboard settings (owner, via trigger) | — |
| `group_members` | circle-mates | — | `role` (owner only, never targeting owner) | self or admin-kick, never the owner |
| `group_cycles` | members | — | — | — |
| `invite_links` | admins | — (RPC only) | `enabled` | — |
| `group_cycle_stats` / `group_daily_completion` | cycle members | — | — | — |
| `group_member_category_stats` / `digest_snapshots` | circle members | — | — | — |
| `notifications` | self | — | `read_at` | own |
| `push_subscriptions` | self | own | `device_label` | own |
| `user_blocks` | blocker only | own | — | own |
| `content_reports` | own submissions | own, circle-mate target | — | — |
| `audit_log`, `username_history` | — | — | — | — |

### Policy mechanics

- `USING` filters existing rows (`SELECT`/`UPDATE`/`DELETE`); `WITH CHECK` validates rows being written (`INSERT`/`UPDATE`). An `UPDATE` needs both, and they differ — `USING` says which rows you may edit, `WITH CHECK` what they may become, which is what stops editing your row into someone else's.
- Multiple policies on the same operation are **OR-ed**. Each grants a reason; they never narrow each other.
- **`(select auth.uid())`, not bare `auth.uid()`** — the wrapped form evaluates once per query rather than once per row.
- **RLS filters silently.** An `UPDATE` on an invisible row affects zero rows without erroring, unlike a missing column grant which raises `insufficient_privilege`. Code that assumes success because nothing threw needs to check the affected row count.

### The `private` schema

Shared policy predicates live in `private`, resolving a genuine conflict: a policy is evaluated with the privileges of whoever runs the query, so these **must** be `EXECUTE`-able by `authenticated` — but anything in `public` is published as an RPC endpoint, and these are `SECURITY DEFINER` functions that bypass RLS. PostgREST doesn't expose `private`, so policies can call them and HTTP clients can't reach them.

They also solve a recursion problem: the natural policy on `group_members` ("you can see rows for groups you belong to") queries `group_members` to decide, which Postgres rejects as infinite recursion. `SECURITY DEFINER` runs the lookup with RLS bypassed so it never re-enters.

| Function | Purpose |
|---|---|
| `is_group_member(group_id)` | caller belongs to the circle |
| `is_group_admin(group_id)` | caller is owner or admin |
| `is_group_owner(group_id)` | caller is owner |
| `is_cycle_member(cycle_id)` | reaches the circle through `group_cycles` |
| `shares_group_with(user_id)` | the core visibility rule; symmetric |
| `is_blocked_by(user_id)` | has that user blocked the caller — **directional** |
| `is_goal_hidden_in_group(goal_id, group_id)` | encodes the sparse-table coalesce once |
| `owns_goal(goal_id)` | caller owns it |
| `owns_active_goal(goal_id)` | owns it **and** it's neither achieved nor archived |
| `current_checkin_date()` | today under the caller's frozen timezone and 2 AM rule |

Not client-granted (jobs and triggers only): `checkin_date_for`, `recompute_daily_completion`, `rollover_user_day`, `rollover_group_day`, `list_expired_photos`, `mark_photos_purged`, `scrub_and_list_user_media`.

**`ALTER DEFAULT PRIVILEGES` is a convenience, not a guarantee.** A default revoking `EXECUTE` from `PUBLIC` in `private` was set early, yet five helpers created afterwards still came out `anon`-executable. The linter did not flag it because `anon` lacked schema `USAGE`, so one barrier stood where two were intended. Currently **41 functions, 0 anon-executable, 0 with a mutable `search_path`**. The query that verifies this is in `build-plan.md`; re-run it after any migration that adds a function.

### Notable policy decisions

**Check-ins require an ACTIVE goal.** Without this a user could check in on archived goals — the 10-goal cap bounds only *active* ones, so someone could accumulate unlimited archived goals and check into all of them daily, inflating the raw `total_completions` the leaderboard ranks on while `total_possible` stayed flat, until the `completions <= possible` invariant started rejecting legitimate writes. The cap was meant to bound exactly this; check-ins were routing around it.

**Goals have no `DELETE`.** `archived_at` is the retirement path, keeping check-in history intact where a delete would strand entries with a null `goal_id`.

**`daily_completion` has no client write access at all.** The entire streak system is built on it.

**Hidden goals stay readable.** RLS returns the row because aggregate completion counts need it; the API masks `title`/`note`/`photo_url`. Circle-mates can also read the visibility flag, which is what lets the UI render the placeholder. Hiding is a display rule, never an access rule.

**Blocking doesn't hide the `users` row or a circle-mate's goals.** It hides `user_lifetime_stats`. Hiding identity would leave a member in a roster with no name to render, which advertises the block rather than concealing it; hiding goals would break the accountability the Circle exists for.

**`group_members` `DELETE` covers leaving and kicking in one policy**: `role <> 'owner' AND (user_id = auth.uid() OR is_group_admin(group_id))`. The owner is unreachable as a target of either, so an owner can't leave without transferring and no admin can remove them — enforced in the policy, not the app layer.

**Owner-only Circle settings use a trigger, not a grant.** Column grants are per-*role*, so they can't distinguish owner from admin. `guard_group_owner_only_settings` compares old and new rows to see which columns actually changed and who changed them.

**Onboarding can't be a client query.** Since a user only reads rows for people they share a Circle with, the "is this username taken?" check runs server-side under `service_role` — which is also where the profanity filter and rate limiting belong.

### RPCs

Some operations span multiple tables and can't be made safe by a policy:

| Operation | Why not a policy |
|---|---|
| Create a circle | group + owner membership + first cycle must be atomic, or a failure halfway leaves an ownerless circle nobody can clean up |
| Join via invite | RLS can't see the token; also needs capacity, block check, and an audit write |
| Transfer ownership | demote-then-promote must be ordered inside one transaction, since the one-owner index forbids two owners existing even momentarily |
| Cycle continue / reset | closes one cycle, opens another, zeroes stats |

These are `SECURITY DEFINER` functions in `public`. A function body *is* a transaction, so atomicity is free, and the logic sits next to the constraints it depends on.

| Function | Returns | Checks |
|---|---|---|
| `create_circle(name, deadline)` | `group_id` | authenticated |
| `circle_preview(token)` | `status, circle_name, member_count, is_full` | authenticated |
| `join_circle(token)` | `group_id` | token valid, circle active, not blocked, under 10, has an owner. Idempotent. |
| `transfer_ownership(group_id, new_owner)` | void | caller is owner; target is a member |
| `cycle_continue(group_id, new_deadline)` | void | owner or admin; deadline may only extend or clear |
| `cycle_reset(group_id, new_deadline)` | `cycle_id` | owner or admin |
| `create_invite_link(group_id, expires_at, use_default_expiry)` | token | owner or admin; circle active and under 10 |
| `complete_onboarding(username, timezone)` | void | validates timezone against `pg_timezone_names`; enforces the 14-day rename limit |
| `sync_checkin_timezone(timezone)` | void | **no-op unless the check-in day has elapsed** |
| `resolve_streak_decision(group_id, continue)` | void | owner only; requires a pending decision |
| `set_circle_deadline(group_id, deadline)` | void | owner or admin; Circle active; deadline ≥ next day or NULL |
| `export_user_data()` | jsonb | **`SECURITY INVOKER`** — RLS applies, so it can't return another user's rows |

**Unlike the `private` helpers, these are intentional API surface.** Each validates its caller in its own body — `SECURITY DEFINER` gets no RLS for free. All pin `search_path` and are granted only to `authenticated`.

**Invoked from Next.js server actions, not the browser.** A browser calling `supabase.rpc()` goes straight to Supabase and never touches the app, so Upstash rate limiting, Turnstile, and the profanity filter would have nowhere to run — circle creation and joins would be entirely unthrottled.

**Enforced by lint, not by the database.** A stray `supabase.rpc()` in a component works fine and silently skips all three protections. The database cannot enforce the boundary: revoking `EXECUTE` from `authenticated` would force calls through the server, but the RPCs check `auth.uid()` internally and `service_role` has none, so every call would raise "Not authenticated". An ESLint rule therefore bans `.rpc(` outside `app/actions/`.

Trade-off accepted: PL/pgSQL is harder to unit-test under Vitest. These are tested with `DO` blocks in SQL instead.

### Expected, permanent linter output

Anything beyond this list is a real finding.

- `rls_enabled_no_policy` on `audit_log` and `username_history` — deliberately client-inaccessible.
- `authenticated_security_definer_function_executable` on the 12 client-callable `public` RPCs — deliberately callable; `anon` is excluded.
- `unused_index` on everything, until there's real traffic.

**A replay into a shadow database is its own category of test.** `supabase db diff` builds a fresh Postgres and runs all 57 migrations, which is the only way to catch a history that depends on state it never creates. The recurring bug patterns this schema has produced, and the checks that find them, are catalogued in `build-plan.md`.

---

## 5. Derived data

Split into a **live layer** (triggers) and a **rollover layer** (scheduled). The line: anything the dashboard shows *today* is a trigger; anything only knowable once a day has ended is the job.

### Live layer

| Trigger | Fires on | Effect |
|---|---|---|
| `progress_entries_maintain_completion` | check-in insert or **delete** | recomputes `daily_completion` for that date |
| `goals_maintain_completion` | goal insert, or `achieved_at`/`archived_at` change | recomputes today, since the denominator moved |
| `goals_count_achievement` | `achieved_at` null → non-null | increments `total_goals_achieved` once |

`recompute_daily_completion()` writes `all_completed = (active > 0 AND checked_in >= active)`. Adding a goal mid-day reopens a completed day; archiving one can re-complete it.

**Deliberate limitation**: it evaluates active goals as of *now*, not as of the target date. Correct for today, the only date it's called with, but it must never backfill history — a goal archived since would be wrongly excluded from a past day it was part of.

### Rollover — `run_daily_rollover(date)`

Not client-callable. Anyone who could invoke it could advance their own streaks.

Per user, for the day just ended: finalize `daily_completion` (creating the row for someone who never checked in), extend or reset `current_streak`, raise `longest_streak_ever`, increment `total_days_completed`, update `group_cycle_stats` for every active cycle.

Per active cycle: `group_daily_completion` holds only if every **non-grace** member completed everything.

**Leaderboard counters move only here, and always together** — each active goal adds 1 to `total_possible`, and 1 to `total_completions` only if checked in. That's why `completions <= possible` can never be transiently violated; incrementing completions live on check-in would break it on a user's first day.

Finally, circles past their deadline flip to `locked`.

**Streaks lag one day by design** — a day is not final until it is over. To include today, compute `current_streak + (1 if today is complete)` at display time rather than storing it.

**Not idempotent for streaks.** `daily_completion` and `group_daily_completion` recompute identically, but streak counters are incremental — running twice for the same date double-counts. **The scheduler must not retry blindly.**

---

## 6. Realtime

Deliberately **not** used for the progress feed — the daily digest is the design, and live pushes would contradict it and add load.

`notifications` is published to `supabase_realtime`; nothing else is. Reserved for the immediate types (`kicked`, `group_locked_renewal`) and any future presence feature.

Realtime respects RLS, so `notifications_select_own` governs the socket too — one access model, not two. **Corollary**: a missing or wrong policy produces *silence*, not an error, so "realtime is broken" and "RLS is filtering everything" look identical from the client.

---

## 7. Daily digest

Split into two independently retryable halves, because they need different runtimes and have different failure modes.

**`build_daily_digests()` (SQL)** computes each Circle's summary for its own previous day, writes `digest_snapshots`, and inserts one `notifications` row per member. This alone makes the Overview subtab and the in-app feed work. Idempotent: it skips any Circle already holding a digest for the target date, so an extra run neither duplicates snapshots nor re-notifies.

**`send-digest-push` (Edge Function)** delivers web push. VAPID signing needs the `web-push` package, so it can't live in Postgres.

Separating them means a push outage never blocks the in-app digest, and either half can be re-run without corrupting the other.

**`notifications.pushed_at`** tracks delivery, distinct from `read_at` — one is our action, the other the user's.

**Teaser payloads only.** iOS truncates long bodies, and a detailed body risks surfacing hidden-goal-adjacent information on a lock screen, outside the app's access controls entirely. Circle names are deliberately kept out of push *bodies* for the same reason, even though the payload carries them for in-app rendering. One notification per Circle per user, never one combined across Circles.

The sender has a teaser per notification type, with a generic fallback. **Adding a notification type means adding a teaser case**, or it silently ships as "You have a new notification".

**A user with no push subscription is not a failure.** On iOS push works only for an installed PWA, so many users legitimately have none. Those notifications are marked delivered rather than retried forever; the in-app row is the durable channel regardless.

**Dead subscriptions are pruned.** A 404 or 410 from the push service means the browser permanently discarded that subscription. Deleting those rows is required maintenance, not an optimization — otherwise they accumulate and every future send retries them.

---

## 7b. PWA & push delivery

Notifications are the app's re-engagement loop, and on iOS they only work for an installed PWA. That makes the PWA layer functional infrastructure, not polish.

**Files**: `app/manifest.ts` (Next.js native), `public/sw.js` (plain JS — served statically, not compiled), `components/service-worker-registrar.tsx` (mounted in the root layout).

**No PWA library.** `next-pwa` was the original choice and was reversed: it's unmaintained, pulls a high-severity build-time advisory that fails `npm audit` in CI, and its actual value is Workbox caching this app barely benefits from — the product needs the network to do anything meaningful, TanStack Query handles client caching, and Redis handles the server side. Crucially, **no PWA library writes the push handlers**; those are the same ~40 lines either way. If real offline support is ever wanted (viewing goals with no signal, queuing check-ins to sync later), Serwist is the migration target and the manifest and handlers port over unchanged.

**iOS needs more than the manifest.** iOS ignores the web manifest for standalone display and reads `apple-mobile-web-app-capable` instead, set via `metadata.appleWebApp` in the root layout. Without it, "Add to Home Screen" produces a browser-chrome window rather than an installed app — and push only fires for the installed case. The manifest alone is not enough.

**The worker claims control immediately** (`skipWaiting` + `clients.claim`). Otherwise someone who has just installed the PWA receives no push until they fully quit and reopen it.

**Notifications are tagged per Circle** (`circle-{group_id}`). A phone replaces a notification carrying the same tag rather than stacking another beneath it, so someone who ignores the app for a week returns to one notification per Circle instead of seven. The tradeoff is losing the "I missed several days" signal — reversible by dropping the tag if that turns out to matter more.

**Registration deliberately does NOT request notification permission.** Browsers effectively allow one ask: a denial is sticky and cannot be re-prompted, only reversed by the user digging through settings. Asking on first page load, before anyone knows what Solarity is, mostly buys a permanent no. The prompt belongs in onboarding, **after** the add-to-home-screen step, once the reason is obvious.

**Icons are in place** — sizes and constraints are tabulated in section 14. They are load-bearing rather than decorative: without at least 192 and 512 a phone will not offer installation, and on iOS no installation means no notifications at all. The current set is a generated placeholder mark, correct in dimensions and replaceable in v2.

**Outstanding:**

- **`pushsubscriptionchange` handling.** A push service can invalidate a device's subscription and issue a new one; that device then stops receiving notifications **silently** — nothing errors. The worker detects it and posts `RESUBSCRIBE_PUSH` to any open window, but nothing acts on it yet. The handler needs the VAPID public key and an authenticated call, so it lands with the push opt-in flow in onboarding. Until then, `send-digest-push` prunes the dead subscription on the next 404/410, which stops the retries but doesn't restore delivery.

## 8. Group lifecycle

- A Circle with no deadline never locks.
- **The deadline date is the last playable day.** A deadline of March 15 means March 15 is fully playable and the Circle locks at the 2 AM rollover on the 16th, evaluated by the same job as everything else rather than at an arbitrary wall-clock moment.
- **Changing a deadline mid-cycle**: `set_circle_deadline(group_id, deadline)`, owner or admin. Sets, moves, or clears the active cycle's deadline. **Minimum is the next day in the Circle's timezone**; `NULL` goes open-ended, which is always allowed since it only ever gives people more time. Evaluated against `circle_checkin_date()`, the same basis as locking, so a deadline can never land on a day already underway.

  This replaces an earlier two-day-notice rule that was specified but never implemented. Under it an open-ended Circle could **never** gain a deadline, and shortening one required a cycle reset that wipes every member's per-cycle stats. The next-day floor keeps the protection that mattered — an owner cannot end a cycle out from under people mid-day — without the rest.

  **Every other member is notified** (`deadline_changed`), with the actor excluded: the notice rule protected against surprise through delay, and this restores that protection through information. Re-submitting the same value neither audits nor notifies, so a double-tap does not spam the Circle.

  `cycle_continue` still only extends or clears, since it exists for the renewal prompt rather than general editing.
- On lock, check-ins stop and members see a summary screen. The owner or an admin chooses:
  - **Continue** — keep history, extend or clear the deadline.
  - **Reset** — close the cycle, open a new one, zero `group_cycle_stats`. `user_lifetime_stats` is unaffected.

**Group list display**: `locked` and `archived` Circles move to an Archived section rather than disappearing. A user setting toggles whether that section shows at all, defaulting to on. The two states differ — `locked` awaits a renewal decision, `archived` is retired — and only freshly locked Circles get the summary screen.

---

## 9. Photo check-ins

- Accepts HEIC, JPG, PNG. HEIC is converted client-side; nothing stores raw HEIC since it doesn't render reliably outside Safari.
- Normalized to **WebP**, max ~1600px, 75–80% quality, compressed in-browser before upload.
- Max pre-compression upload: 10MB.
- Upload endpoint rate-limited via Upstash (~20/hour).
- **Validate magic bytes, not the extension or MIME type** — stops a renamed executable posing as a `.jpg`. Cap decompression dimensions against decompression bombs. **Strip EXIF during re-encode** as an explicit requirement, or a check-in photo leaks the poster's GPS location to the Circle.

### Storage buckets

**Path convention — fixed. Changing it later means migrating objects.**

```
checkin-photos : {user_id}/{goal_id}/{entry_id}.webp
avatars        : {user_id}/{filename}
```

The check-in path encodes owner **and** goal so the policy evaluates both the shared-Circle rule and the not-hidden rule from the path alone, without joining `progress_entries` on every object read.

Both buckets are private, capped (`checkin-photos` 10MB, `avatars` 2MB), and restricted to `image/webp`. Since everything is normalized to WebP client-side, that restriction means a client skipping conversion is rejected by Storage rather than silently storing an unrenderable HEIC.

**The read rule is "at least one", not "this Circle".** Hiding is per-Circle and a viewer may share several Circles with the owner, so a photo is readable if **there exists at least one shared Circle where the goal isn't hidden**. Evaluating a single Circle would hide a photo that's legitimately visible elsewhere — verified by test: a user sharing two Circles with the owner, with the goal hidden in one, still sees it.

Enforced as a Storage policy rather than only API-layer masking, so the restriction holds even against a direct object URL. Writes are owner-only, scoped by the first path folder.

**Retention: fixed 90 days**, via the `purge-expired-photos` Edge Function. The row and all derived statistics survive; only the image goes.

*Not cycle-based, as originally specified*: a check-in belongs to a user-owned goal visible in every Circle that user is in, so "the cycle this photo belongs to" is not a question the schema can answer. A fixed age is predictable and unaffected by membership churn.

*Ordering matters*: objects are removed from Storage **before** `photo_url` is nulled. Reversed, a crash between the steps leaves rows claiming no photo while the objects linger unreferenced.

---

## 10. Circles, invites & roles

- Invite-only, via a shareable link or direct invite.
- Unauthenticated visitors are routed through Google sign-in first, with the token held through the redirect so they land back on the join confirmation.
- **Join confirmation shows name and member count only.** A link may have been forwarded to anyone, including a previously kicked member who kept the URL. Name and size are what the inviter implicitly shared; the roster is not.
- **10-member hard cap**, enforced at the DB level, re-checked at join time since membership changes between link creation and use.
- No max-use count on links; capacity checks cover it.

**Roles**: `owner` (one, can transfer but not leave without transferring), `admin` (kick members, manage links), `member`. No cap on admins — the 10-member cap already bounds the risk.

**Admins cannot act on the owner.** Kicking and demoting target only `member` or `admin`. Only the owner demotes an admin, and only the owner changes their own role via transfer. This stops a promoted member removing the person who promoted them.

**Kicking does not block.** Nothing prevents re-invitation unless a block is separately in place, so the kick flow should surface "also block this user?" as a deliberate second step.

### Invite links respect the Circle's lifecycle

Originally they checked only the token, which meant an archived Circle still accepted joins — and joining an archived *empty* Circle produced a member with no owner, the same unrecoverable state that owner succession fixes, reached from the opposite direction. Succession guards departures; nothing guarded arrivals.

Now: both entry points require `group_status = 'active'`; `join_circle` additionally refuses a Circle with zero owners; a trigger disables outstanding links when a Circle leaves `active`; and `create_invite_link` will not mint a link for a non-active Circle.

**Links expire after 7 days by default.** A link is a bearer credential, so a permanent one means a forwarded message or screenshot keeps a way in open indefinitely. Callers may set a longer window or opt out explicitly.

### Failure states

Each error carries a machine code in the **HINT**, so clients branch on the code rather than the prose.

| Situation | `circle_preview.status` | `join_circle` HINT | Name shown |
|---|---|---|---|
| Valid | `ok` | — | yes |
| Token doesn't exist | `not_found` | `INVITE_INVALID` | **no** |
| **Blocked** | previews normally | `INVITE_INVALID` | — |
| Revoked | `revoked` | `INVITE_REVOKED` | yes |
| Expired | `expired` | `INVITE_EXPIRED` | yes |
| Cycle ended | `circle_locked` | `CIRCLE_LOCKED` | yes |
| Archived | `circle_archived` | `CIRCLE_ARCHIVED` | yes |
| Full | `circle_full` | `CIRCLE_FULL` | yes |
| Already a member | `ok` | — (idempotent) | yes |

**Two stay generic on purpose.** A nonexistent token must be indistinguishable or the endpoint becomes an oracle for guessing tokens. A blocked user gets the *same* message — naming the block confirms it and points at whoever administers the Circle.

**The rest are safe to name** because the caller demonstrably held a real token, so nothing is revealed they couldn't already infer.

**UI asymmetry to expect**: a blocked user's preview succeeds and only the join fails. Mildly confusing by design; the alternative leaks the block.

---

## 11. Account lifecycle

Self-serve in-app deletion, not a support ticket — Apple requires it for apps offering account creation.

### Edge Functions

| Function | `verify_jwt` | Auth | Notes |
|---|---|---|---|
| `delete-account` | yes | caller's JWT | user id comes from the token, **never** the body |
| `export-data` | yes | caller's JWT | runs as the user; RLS enforces isolation |
| `purge-expired-photos` | no | `x-cron-secret` | scheduler-invoked; **fails closed** if the secret is unset |

**`delete-account` ordering is load-bearing:**

1. Identify the caller from their own JWT.
2. Scrub note text and collect Storage paths — **before** the user row is gone, since afterwards the rows can't be located.
3. Delete Storage objects (check-in photos, avatar).
4. Delete the auth user, cascading into `public.users` → `group_members`, firing owner succession and audit.

`progress_entries` survive, anonymized: the FKs null attribution automatically, and the function additionally scrubs the free-text `note`, which a foreign key can't reach. Hard-deleting them would retroactively corrupt other members' stats for cycles they shared.

**Export returns JSON directly** rather than a signed Storage URL — at v1 volumes a user's history is small, and an export artifact would need its own retention and access rules, which is attack surface for no benefit.

**Removal is classified three ways**, decided by whether the *target user row still exists* rather than by comparing `auth.uid()`:

| Situation | Recorded as | Leaderboard |
|---|---|---|
| Account deleted | `member_left`, `via: account_deletion`, actor and target nulled | untouched |
| Left voluntarily | `member_left`, `via: left` | **kept** |
| Removed by someone else | `member_kicked`, `via: kicked` | **zeroed** |

An earlier version compared `auth.uid()`, which recorded account deletion as a *kick* — wrongly implying moderation and applying the stat penalty to someone who just closed their account.

---

## 12. Scheduled jobs

Scheduled with **pg_cron**, which runs inside Postgres: no network hop, no shared secret, and no deployed app needed for the SQL jobs.

| Job | Schedule | Kind |
|---|---|---|
| `solarity-rollover-hourly` | `5 * * * *` | SQL — `run_daily_rollover()` |
| `solarity-digest-daily` | `20 * * * *` | SQL — `build_daily_digests()` |
| `solarity-push-delivery` | `25 * * * *` | Edge — `send-digest-push` |
| `solarity-retention-daily` | `30 4 * * *` | SQL — `run_retention_sweep()` |
| `solarity-photo-purge-daily` | `45 4 * * *` | Edge — `purge-expired-photos` |

The digest and push jobs run hourly despite being "daily" work: both are idempotent and self-skipping, and hourly means a Circle's digest lands soon after *its own* day ends rather than at one global moment. Push delivery is hourly regardless, since notifications also come from immediate events (kicks, renewals), not just the digest.

**Edge Function jobs read their secret from Vault, not from the job command.** A secret in `cron.job` sits in plaintext for anyone with database access. `private.invoke_edge_function()` pulls `cron_secret` and `project_url` from `vault.decrypted_secrets` and calls via `pg_net`. If either is missing it logs a warning and no-ops rather than hammering the endpoint with unauthenticated requests — and the functions themselves also fail closed, so that's two independent guards.

**Vault setup required before the two Edge jobs do anything:**

```sql
select vault.create_secret('<your CRON_SECRET>', 'cron_secret');
select vault.create_secret('https://wyuadcnrxisqmzygzhzd.supabase.co', 'project_url');
```

**The rollover must run hourly, not daily.** "2 AM local" happens at 24 different UTC moments, so a single daily run would process most users at the wrong time.

**A Circle's day follows its owner's timezone**, via `private.circle_checkin_date()`. Members can span timezones and there's no single correct "yesterday" otherwise. Quirk worth knowing: transferring ownership across timezones shifts the Circle's boundary. Rare and harmless, but it's a real consequence of the rule.

**Idempotency is guarded by `users.last_rollover_date` and `group_cycles.last_rollover_date`.** Running hourly guarantees repeat visits, and streak counters are incremental, so without these a user would be counted multiple times per day. Repeat runs now process zero rows — verified across three consecutive invocations.

**Passing an explicit date bypasses both guards.** That's deliberate, for backfill and testing, and it *will* double-count if that date was already processed. Scheduled invocations must pass no argument.

---

## 13. Group streak & leaderboard

The group streak holds only when **every current member completes every one of their active goals** that day. One member with no goals breaks it for everyone — the same principle as the zero-goal rule.

### New-member grace

A brand-new member almost certainly has zero goals on day one, so joining an active streak would break it immediately and make joining feel punishing.

- Joining a Circle with `current_streak > 0` sets `group_members.streak_grace`. While flagged they're excluded from evaluation entirely — neither breaking nor extending the streak.
- The Circle is flagged `streak_decision_pending`, with `pending_streak_joiners` accumulating everyone who joins meanwhile, so multiple joins produce one decision rather than one prompt each.
- The **owner** (not an admin — it's a judgment call about the Circle's standards) calls `resolve_streak_decision(group_id, continue)`: **continue** clears grace and leaves the streak, **reset** zeroes the streak and clears grace so there's no punitive gap. Either way grace ends and the joiners count from then on. Logged as `group_streak_continued` or `group_streak_reset`.
- If the owner never decides, grace persists with no penalty and the streak keeps accruing on everyone else.

**This flow had no implementation until an audit found it.** `join_circle` set both flags and nothing cleared either, so a member flagged on join was excluded from the group streak **permanently** — no error, no visible symptom. It is the clearest instance of the pattern this schema is most prone to: a state with a setter and no resolver.

### Leaderboard

Three ranking dimensions from `group_member_category_stats`:

- **Completion rate** — `total_completions / total_possible`, both accruing from `joined_at` rather than Circle creation.
- **Group streak** — a single value for the whole Circle, shown alongside the per-user breakdown.
- **Daily goals completed** — raw `total_completions`, sortable independently of rate.

**Persistence across cycles**: `leaderboard_persists_across_cycles`, owner-configurable, **default `false`**. When true, stats and the group streak survive a reset; when false, both zero out.

**Reset on kick**: a kicked member's stats zero out entirely, and stay zero if they rejoin. Being kicked costs standing. Their `progress_entries` are untouched.

---

## 14. Environment & external services

Everything here is already configured — these are the notes worth keeping, not the steps.

### Environment variables

Client-exposed (`NEXT_PUBLIC_*` is bundled into the browser — anything here is public):

| Var | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same (now labelled "publishable") |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `npx web-push generate-vapid-keys` |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile |

Server-only — never `NEXT_PUBLIC_`, never imported into a component:

| Var | Notes |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | bypasses RLS entirely. Only `createAdminClient` touches it, and lint bans importing that into components. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | regional database; global costs more and buys nothing yet |
| `VAPID_PRIVATE_KEY` | |
| `TURNSTILE_SECRET_KEY` | |
| `CRON_SECRET` | **Set as a Supabase Edge Function secret, not only a Vercel env var** — the functions read it from the Supabase runtime. Also mirrored into Vault as `cron_secret` so `cron.job` doesn't hold it in plaintext. |

Vercel needs all of them under Project Settings → Environment Variables. `.env*` is gitignored.

**`supabase/config.toml` is committed and holds no secrets.** It is the only version-controlled record of which Supabase project this checkout points at, since the link state lives in the gitignored `supabase/.temp/`. It configures the local stack only; its `[auth]` block is stock and does **not** describe the hosted project. `supabase config push` would therefore reset the dashboard's auth settings — see `build-plan.md`, "config.toml".

### Google OAuth

Client ID and secret live in **Supabase's dashboard** (Auth → Providers → Google), not in app env vars. The authorized redirect URI registered in Google Cloud Console is Supabase's callback, not the app's:

```
https://wyuadcnrxisqmzygzhzd.supabase.co/auth/v1/callback
```

The app's own `/auth/callback` route is where Supabase redirects *after* that, and must be listed in Supabase → Auth → URL Configuration → Redirect URLs. Add both `http://localhost:3000/**` and the Vercel URL.

### Email delivery

The project currently sends through **Supabase's built-in sender, which is capped at 2 messages per hour** and documented as demonstration-grade with best-effort availability.

Nothing in the app relies on email today: authentication is Google-only, so no confirmation, reset or magic-link mail is ever sent. The cap is therefore latent rather than active, and it is recorded here because it becomes load-bearing the moment any email-shaped feature exists. On the built-in sender, the third person to sign up within an hour never receives a link, with no error and nothing to debug.

Replacement is **Brevo SMTP** (free tier, 300/day), configured in Supabase → Project Settings → Authentication → SMTP Settings rather than in application environment variables, exactly like the Google OAuth client secret. Two credential traps: the SMTP login is a generated `xxxxxx@smtp-brevo.com` address rather than the account email, and an SMTP key is not the same thing as an API key.

With custom SMTP enabled, Supabase applies a **separate** cap of 30 new users per hour by default, adjustable under Auth → Rate Limits. That secondary limit binds before Brevo's does.

**Deliverability is the real constraint, not volume.** Without a custom domain, SPF and DKIM cannot align with the From address, so mail is more likely to be filtered. That failure is silent: the recipient simply never gets in. Setup steps and the accepted mitigation are in `build-plan.md`, track 1.

### Deferred, with reasons

- **Apple Sign In** — needs an Apple Developer membership ($99/yr). Adding it later is a provider toggle plus a Services ID; no schema or app changes. Google-only is enough to ship v1.
- **Custom domain** — a PWA needs HTTPS and a valid manifest, both of which `*.vercel.app` provides. Two things want one and neither is a v1 blocker: Apple Sign In's domain verification, and email deliverability (above). Its cost has grown from "nothing" to "silently degraded email", which is worth revisiting at launch.

### Icons

| File | Size | Notes |
|---|---|---|
| `public/icons/icon-192.png` | 192×192 | manifest, `purpose: any` |
| `public/icons/icon-512.png` | 512×512 | manifest, splash screen source |
| `public/icons/icon-512-maskable.png` | 512×512 | `purpose: maskable`. Artwork inside the centre 80% circle so Android can crop to any shape. |
| `public/icons/badge-72.png` | 72×72 | notification badge, Android status bar. **Monochrome white on transparent** — the OS tints it; colour is discarded. |
| `app/apple-icon.png` | 180×180 | iOS home screen. Opaque, square, no transparency and no pre-rounded corners — iOS applies the mask. Next.js serves it from `app/` automatically. |
| `app/favicon.ico` | multi-size | 16/32/48/64/256 in one file. |

Current set is a placeholder sun mark generated programmatically — correct dimensions, replaceable in v2.

### Other standing config

- **Dependabot** on in GitHub (alerts + version updates).
- **CI**: `.github/workflows/ci.yml` runs Vitest and `npm audit` on every PR.
- **Not installed yet**: `pixi.js` and anything galaxy-specific. No reason to carry the weight before v3.

---
