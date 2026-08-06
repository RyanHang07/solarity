# Goal Accountability App — Architecture Doc

## 1. Product Premise

Friends who see each other's daily progress toward personal goals motivate each other to stay consistent. The app centers on small, invite-only groups (max 10 members) where each member tracks their own daily goals and checks in once per day. Progress is surfaced to the group as a daily batched digest rather than live noise.

### V1 scope vs. deferred (Phase 2)

The galaxy visualization and its entire cosmetics/unlock system (sections 11-15 below) are **deferred, not in scope for v1**. They stay documented in full — the design work is done and worth preserving — but nothing in those sections should be built until the functional core is working end to end. This includes: the rendering engine, planet/sun/nebula styles, the unlock track system, cosmetic asset hosting, the group composite galaxy view, and the galaxy-specific Redis caching layer.

Reasoning for deferring: this system is the single most novel and hardest-to-estimate piece of the whole build (a rendering engine with no prior team experience, driving a level-of-detail composite view and a 28-tier reward system that needs real art). Building the functional app first — users, goals, groups, check-ins, digest, notifications, and the security/robustness hardening — de-risks the whole project and gives something shippable and testable before the highest-risk feature is attempted.

**V1 home dashboard**, in place of the galaxy: today's check-in panel (the user's goals across all groups, with checkbox/note/photo controls), a groups list (active groups first, archived section beneath), a groups-at-a-glance subtab (Overview — reading from `digest_snapshots`), and a notifications subtab. This is the dashboard described in the product's original "theoretical screens" discussion, before the galaxy was decided as the home surface — it's the fallback and the actual v1 target now.

`goals.category` and `goal_categories` remain in v1 scope even though their primary consumer (the galaxy) is deferred — category is required at goal creation regardless (see section 3), and it's useful independently for filtering/stats even before any visualization consumes it.

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | Next.js (App Router) | Server rendering / streaming for fast first paint on iOS Safari; tight native integration with Vercel (edge rendering, ISR, image optimization) |
| Language | TypeScript, strict mode | Type safety across a schema-heavy app |
| Data fetching / cache | TanStack Query | Client-side cache layer on top of Supabase, works well alongside Next.js server components |
| Client state | Zustand | Lightweight, avoids Redux overhead |
| Styling | Tailwind CSS | Fast iteration, no design system decisions needed yet |
| Backend | Supabase (Postgres, Auth, Realtime, Storage, Edge Functions) | Single vendor for DB + auth + realtime + storage; Postgres gives full SQL control and RLS |
| Auth providers | Supabase Auth — Google (v1). Apple (Sign in with Apple) deferred until an Apple Developer Program membership is set up — adding it later is a provider toggle in Supabase, not a schema or code change. | Native-feeling auth, avoids password friction |
| Caching / rate limiting | Upstash Redis (REST-based) | Serverless-friendly, no persistent connection issues on Vercel functions; used for feed caching, visibility-set caching, and rate limiting. **Redis is always a fast-path cache, never the sole source of truth**: every read path backed by Redis (visibility sets, digest reads, and the galaxy snapshot once built) falls back to a live Postgres query on a cache miss or Redis outage. This is a deliberate resilience rule, not an optimization detail — without it, a Redis outage would take down whatever screen depends on it entirely, which is an unacceptable single point of failure for something as central as the home dashboard. |
| Hosting | Vercel | Native Next.js integration, edge caching, cron support |
| Scheduled jobs | Supabase pg_cron or Vercel Cron → Edge Functions | Daily digest computation, photo cleanup sweep |
| Testing | Vitest + Testing Library | Standard for Vite/Next React stacks |
| PWA / service worker | `next-pwa` | Maintained wrapper around Workbox — faster to get manifest + service worker + push-event handling working than a hand-written service worker, with less code to get wrong early in the build |

## 3. Core Entities & Schema

### `users`
Populated via a Postgres trigger (`on_auth_user_created`) off `auth.users`, not read directly from Supabase Auth's table.
- `id` (uuid, PK, matches `auth.users.id`)
- `first_name`, `last_name` (from OAuth provider at signup, editable)
- `username` (unique, user-chosen, indexed) — this is what's shown across the app (group rosters, feeds, digests) by default rather than the real name
- `avatar_url`
- `checkin_timezone` (text, IANA timezone name, set at signup and updated only at each 2 AM rollover — see the Timezone travel note under `progress_entries` below)
- `checkin_day_started_at` (timestamp — when the current `checkin_timezone`-based day began, paired with the field above)
- `created_at`

Real name is captured for account-recovery/identity purposes but username is the public-facing identity throughout the product. Uniqueness on `username` enforced at the DB level.

**Username changes**: allowed, but rate-limited to once every 14 days to reduce impersonation/confusion risk inside small groups (someone renaming right after a conflict or right before a kick, for instance). A `username_history` table (`user_id`, `old_username`, `changed_at`) is kept for support/moderation lookups even though it's never surfaced in the UI. Live views (group rosters, active member lists, the galaxy itself) always resolve to the **current** username via the live FK — there's no reason to freeze those, since they're read fresh on every load anyway. The one place this needs explicit handling is `notifications.payload` and `digest_snapshots.summary`: both are jsonb written once at generation time, so the digest job must denormalize the username into the payload at write time rather than joining live — otherwise a past digest could silently relabel itself if the person referenced later changes their name, which would be confusing in a chronological notification feed.

### `goals`
Owned by the user, **not** by a group. A user's goals stay constant across every group they belong to — group membership doesn't fork or duplicate goals.
- `id` (uuid, PK)
- `user_id` (FK → users)
- `title`
- `deadline` (nullable timestamp — independent of any group's deadline)
- `created_at`
- `category` (FK → `goal_categories`, **required**) — collected at goal creation alongside the title, not optional. There's no "uncategorized" state and no neutral-default color to fall back to — every goal has a category from the moment it's created.
- `achieved_at` (nullable timestamp) — set when the user manually flags the goal as achieved, distinct from a daily check-in. This marks the goal itself as done (e.g. "run a marathon" achieved once actually run), not just a single day's completion.
- `archived_at` (nullable) — separate from `achieved_at`: archiving without achieving means the goal was dropped/abandoned, not completed.

Marking a goal achieved doesn't retroactively touch `daily_completion` or streak history — it's a distinct, one-time event layered on top of the daily tracking. After flagging achieved, the user is prompted to either archive the goal, edit it into a new one, or keep it active (e.g. a recurring habit they've hit a milestone on but still want to track).

### `goal_categories`
**Moved into v1 scope** — required at goal creation (see above), so this table has to exist and be seeded before goal creation works at all, regardless of whether the eventual visualization ever consumes `color_hex`. Fixed preset list, not user-customizable.
- `id` (uuid, PK)
- `name` (e.g. "Fitness", "Learning", "Career", "Health")
- `color_hex` — currently unused by any v1 UI (no visualization consumes it yet), kept populated anyway so it can be turned on later without a data migration.

**Launch seed data:**

| Category | Hex |
|---|---|
| Fitness | `#FF3131` |
| Hobbies | `#FF8A00` |
| Career & Professional | `#FFD500` |
| Health & Wellness | `#6EE62E` |
| Finances | `#00D9A3` |
| Productivity & Habits | `#1EC8FF` |
| Mindfulness & Mental Health | `#8A4FFF` |
| Social & Relationships | `#F730A8` |
| Other | `#3355FF` |

Full color rationale and color-wheel spacing reasoning is preserved in section 11 (deferred visualization docs) since that's where it actually matters — this table just needs the rows to exist for v1. Adding a new category later is a data insert, not a migration. Avoid changing an existing category's `color_hex` once goals reference it, for the same reason noted in section 11.

### `content_reports`
**Moved into v1 scope** — item 8 in the earlier gap audit resolved that check-in photos and notes need a report path, which makes this a v1 table, not a galaxy-dependent one. The sun-cutout use case (`planet_avatar`) stays deferred with the rest of the galaxy, but the table and its `checkin_photo`/`checkin_note` values are needed now.
- `id` (uuid, PK)
- `reporter_user_id` (FK → users)
- `reported_user_id` (FK → users)
- `content_type` (enum: `checkin_photo`, `checkin_note`, `planet_avatar` — the last one unused until the galaxy ships)
- `content_reference` (the Storage path/URL, or for notes the entry's text, captured explicitly at time of report so later edits don't undermine a pending review)
- `reason` (text, nullable, ~500 char cap per the input-validation policy)
- `status` (enum: `pending`, `reviewed`, `actioned`, `dismissed`)
- `created_at`, `reviewed_at` (nullable), `reviewed_by` (nullable, FK → users)

Reviewing `pending` reports via a direct Supabase dashboard query is sufficient for v1 scale — no dedicated admin UI needed yet.

### `groups`
- `id` (uuid, PK)
- `name`
- `owner_id` (FK → users)
- `deadline` (nullable timestamp)
- `group_status` (enum: `active`, `locked`, `archived`)
- `streak_decision_pending` (bool, default `false`) — set when a new member joins mid-streak and the owner hasn't yet decided continue/reset (see section 21)
- `pending_streak_joiners` (jsonb array of user ids, default `[]`) — accumulates joiners awaiting that decision
- `leaderboard_persists_across_cycles` (bool, owner-configurable, default `false`) — see section 21
- `default_stats_view` (enum: `cycle_stats`, `leaderboard`, default `cycle_stats`) — see section 21
- `created_at`

Membership hard-capped at 10 via a trigger on `group_members` insert (`count(*) where group_id = X` must be < 10 before allowing insert).

### `group_members`
Many-to-many. Users may belong to multiple groups simultaneously; there is no cap on groups-per-user, only members-per-group.
- `group_id` (FK → groups)
- `user_id` (FK → users)
- `role` (enum: `owner`, `admin`, `member`)
- `streak_grace` (bool, default `false`) — set when a member joins while `groups.current_streak > 0`; excludes them from `group_daily_completion` evaluation until the owner resolves the pending decision (see section 21)
- `joined_at`

Feed and digest queries always join through **current** `group_members` rows. A user who is kicked or leaves is structurally excluded from future reads — their historical `progress_entries` remain untouched in Postgres for data integrity, but nothing in the frontend surfaces them once membership ends.

### `group_cycles`
Represents one deadline period for a group. Enables reset-without-data-loss and keeps historical cycles queryable.
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `started_at`
- `ended_at` (nullable — null while active)
- `deadline` (nullable — null means open-ended, never locks)
- `current_streak`, `longest_streak` (ints, default 0) — the group streak, see section 21

**In plain terms**: think of a "cycle" as one run of a group's challenge, from creation (or reset) to its deadline. A group always has exactly one *active* cycle (`ended_at IS NULL`) at a time, plus zero or more *past* cycles once it's been reset at least once.

- **On group creation**: the group-creation flow inserts the group's row *and* its first `group_cycles` row in the same transaction — `started_at = now()`, `deadline` set to whatever the creator chose (or null for open-ended). A group is never left without an active cycle; there's no "no cycle yet" state to handle.
- **Walking through a reset**: say a group's deadline passes. `group_status` flips to `locked` (section 7). The admin picks "Reset." That closes the current cycle (`ended_at = now()` on that row) and inserts a brand-new `group_cycles` row (`started_at = now()`, fresh `deadline` per whatever the admin chose). `group_cycle_stats` for every current member resets to zero *for the new cycle only* — the old cycle's stats rows aren't touched, they just stop being the "current" ones since new `group_cycle_stats` rows are scoped to the new `cycle_id`.
- **A member joining mid-cycle**: `group_cycle_stats` is keyed by `(group_id, cycle_id, user_id)`, so a new member simply gets a fresh row created for the *current* cycle when they join — `current_streak = 0`, starting from their own first check-in going forward. They're not retroactively scored against days before they joined.
- **A member leaving and rejoining the same group**: their `group_cycle_stats` row for that cycle stays in the table when they leave (matches the general "historical data isn't deleted" pattern used elsewhere, e.g. `progress_entries`). If they rejoin the *same* cycle later, that old row is reused rather than duplicated — their streak simply reflects whatever gap exists in their check-in history, the same as anyone with a lapse. If they rejoin *after* the group has since reset into a new cycle, they get a fresh row for that new cycle, same as any other new member.

### `invite_links`
- `id` (uuid, PK)
- `group_id` (FK → groups)
- `token` (unique, indexed)
- `enabled` (bool)
- `created_by` (FK → users, must be owner/admin)
- `expires_at` (nullable)

Regenerating a link creates a new token row and disables the old one (kept for audit trail rather than deleted).

### `goal_group_visibility`
Lets a user hide a specific goal from a specific group while still keeping it visible in others.
- `goal_id` (FK → goals)
- `group_id` (FK → groups)
- `hidden` (bool, default `false`)

When hidden, other group members see a placeholder (rendered italicized as "hidden") in place of the goal's title/detail. The goal still counts toward that user's daily completion total — hiding affects display only, not the accountability math.

Because this is a row per `(goal_id, group_id)` pair, visibility is fully independent per group: a user can hide Goal X in Group A while keeping it visible in Group B, and vice versa for Goal Y. No goal's visibility state is shared across groups.

**In the galaxy specifically**: a hidden goal's ring/planet still renders, including its category color — hiding never removes the object from view, only the detail behind it. Tapping/hovering the planet as anyone other than the owner reveals nothing beyond its color; title, note, and photo stay masked exactly as they are elsewhere in the product.

### `progress_entries`
One check-in per goal per day — this app tracks daily habits, not arbitrary-frequency logging.
- `id` (uuid, PK)
- `goal_id` (FK → goals)
- `user_id` (FK → users)
- `check_in_date` (date, not timestamp)
- `note` (text, nullable)
- `photo_url` (nullable, Supabase Storage path)
- `created_at`

Unique constraint on `(goal_id, check_in_date)` enforced at the DB level — one entry per goal per day, not just a UI restriction.

`check_in_date` is computed against the user's **local device timezone**, not a fixed UTC cutoff — "today" should match what the day actually feels like to that person, especially since groups may span timezones. This means the client sends the local date (or a timezone offset) at check-in time rather than the server deriving it from a UTC timestamp; store the resolved date, not the timezone itself, to keep downstream queries simple.

**Check-in gating**: a user can check in on a given goal once every 24 hours, with the day boundary at **2 AM local time** rather than midnight — so "today" for check-in purposes runs 2 AM to 2 AM, not midnight to midnight. This accommodates people checking in late at night without it counting as "tomorrow." `check_in_date` is derived using this 2 AM cutoff (i.e. a check-in at 1:30 AM Tuesday still resolves to Monday's date). Enforced the same way as before — DB-level unique constraint on `(goal_id, check_in_date)` — just with the date computed against a 2 AM boundary instead of a midnight one.

**Timezone travel**: reading the device's *live* timezone on every check-in request would let a mid-day timezone change (e.g. flying) either grant a second same-day check-in or skip a day's eligibility, depending on direction of travel. Recommended fix: freeze the timezone used for boundary calculation at each rollover, rather than re-reading it live per request. Concretely, store `users.checkin_timezone` (the timezone active at the most recent 2 AM rollover for that user) alongside a `checkin_day_started_at` timestamp; `check_in_date` for the current cycle is computed against `checkin_timezone`, not whatever timezone the device currently reports. The stored timezone only updates at the *next* natural rollover, computed from wherever the device is at that moment — so a mid-flight check-in might feel slightly off by a few hours until the next boundary, but exactly one 24-hour window is guaranteed per cycle regardless of travel, closing off both the double-check-in and skipped-day cases.

### `daily_completion`
Derived table, populated by a trigger after each check-in. Tracks whether a user completed **all** of their active goals (visible and hidden) on a given day — this is the binary the streak system is built on.
- `user_id` (FK → users)
- `date`
- `all_completed` (bool)

**Zero-goal days break the streak.** `all_completed` evaluates currently-active goals (`archived_at IS NULL AND achieved_at IS NULL`); if a user has **zero** active goals on a given day, `all_completed` is written as `false` — it does **not** count as vacuously complete, and it does **not** get skipped as neutral. Reasoning: there's no point using the product or being in a group without at least one active goal, so a goal-less day is a real failure state, not an exempt one, for both individual streaks and the group streak (see the Group Streak section below, which is built on this same principle). Practically, "active goals on that day" is evaluated at the day's rollover boundary (2 AM local, per the check-in gating rule above).

### `group_cycle_stats`
Per-group, per-cycle streaks. Resets to zero whenever a group cycle resets.
- `group_id`, `cycle_id`, `user_id`
- `current_streak`
- `longest_streak_in_cycle`

### `user_lifetime_stats`
Persists across every cycle and every group — independent of any single group resetting.
- `user_id` (PK)
- `current_streak`
- `longest_streak_ever`
- `total_days_completed`
- `total_goals_achieved` (incremented via trigger when a `goals` row gets `achieved_at` set)
- `visible_on_profile` (bool, default `false`) — user-controlled opt-in. When `true`, these stats are readable by anyone who can view the user's profile (any shared group); when `false`, visible only to the user themselves.

Both stats tables update off the same `daily_completion` trigger, scoped differently. RLS on `user_lifetime_stats` reads follow `visible_on_profile`: owner always sees their own row, others only see it when the flag is on.

### `notifications`
Backs the in-app notifications subtab.
- `id` (uuid, PK)
- `user_id` (FK → users)
- `type` (enum: `digest`, `kicked`, `invite_accepted`, `admin_transfer_request`, `group_locked_renewal`) — `cosmetic_unlocked` deliberately excluded from the v1 enum since the unlock system it belongs to is deferred; re-add it as an enum value when the galaxy ships rather than carrying dead weight now.
- `payload` (jsonb)
- `read_at` (nullable)
- `created_at`

`kicked`, `admin_transfer_request`, and `group_locked_renewal` are immediate/transactional. `digest` is the once-daily batched type, written by the scheduled digest job. (`cosmetic_unlocked` will join this list when the galaxy ships — see section 12.)

### `push_subscriptions`
Standard Web Push (VAPID) subscription storage, keyed by user with support for multiple devices per user.
- `id` (uuid, PK)
- `user_id` (FK → users)
- `endpoint` (unique, the browser-provided push endpoint URL)
- `p256dh`, `auth` (subscription keys required by the Web Push protocol)
- `device_label` (nullable, e.g. "iPhone" vs "Desktop" — cosmetic, helps a user manage their own subscriptions in settings)
- `created_at`

The digest job and immediate-notification triggers (`kicked`, `admin_transfer_request`, `group_locked_renewal`) fan out to every active subscription row for a user, not just one — covers the case of a user with the PWA installed on multiple devices.

**iOS platform gap and onboarding nudge**: Web Push on iOS Safari only works for a PWA added to the home screen (iOS 16.4+) — a user who just uses it as a browser tab gets no push at all, silently. Since notifications (digest, unlocks, kicks, etc.) all persist in the `notifications` table regardless of push delivery, nothing is ever truly lost — but push is the mechanism that pulls a user back into the app, so its absence meaningfully weakens the product's core "friends motivate each other" loop for anyone who skips installing it. Onboarding must include an explicit "add to home screen" step/prompt (with instructions, since iOS doesn't offer a native install prompt the way Android does) rather than leaving this to chance.

### `digest_snapshots`
Cache of each day's computed group summary — the homescreen "your groups at a glance" subtab and the daily push notification both read from this same table, keeping notification content and in-app summary consistent.
- `group_id`, `date`
- `summary` (jsonb — per-member completion status, streak deltas)

### `user_blocks`
Added in section 20 (item 11). Blocks the blocked user from viewing the blocker's profile/galaxy (overriding the opt-in visibility toggle) and from joining any group via an invite link the blocker currently administers.
- `blocker_user_id` (FK → users)
- `blocked_user_id` (FK → users)
- `created_at`

### `group_daily_completion`
Derived table backing the group streak (section 21). Populated at each day's 2 AM rollover.
- `group_id` (FK → groups)
- `cycle_id` (FK → group_cycles)
- `date`
- `all_members_completed` (bool) — `true` only if every **current** member's `daily_completion.all_completed` is `true` for that date. A member who left or was kicked mid-day doesn't factor in; only who's a current member at rollover time counts.

### `group_member_category_stats`
Backs the leaderboard (section 21). Per-user, per-category stats scoped to a group.
- `group_id` (FK → groups)
- `user_id` (FK → users)
- `category_id` (FK → goal_categories)
- `total_completions` (int, default 0)
- `total_possible` (int, default 0)
- `current_streak`, `longest_streak` (ints, default 0)

## 4. Row Level Security

RLS is the primary access-control mechanism, not application-layer checks alone.

- **Goals / progress visibility**: a user can view another user's `progress_entries` only if both share at least one common row in `group_members` (subquery: viewer's groups ∩ target's groups, non-empty). This is more expensive than a flat friend-graph check, so the resulting "visible user ids" set is cached per-user in Redis and invalidated on group join/leave.
- **Hidden goals**: RLS still allows the row to be read (needed for aggregate completion counts), but the API layer masks `title`/`note`/`photo_url` when `goal_group_visibility.hidden = true` for the requesting viewer's context.
- **Group admin actions** (kick, invite link management, deadline changes): restricted to rows where the requesting user's `group_members.role` is `owner` or `admin`. **The owner is exempt as a target**: an admin can kick or otherwise act on any `member`, but never on the `owner`'s own `group_members` row — kicking or demoting the owner is blocked regardless of the actor's role. The only way an owner's role changes is the owner-initiated transfer flow described below.
- **Owner-only actions**: leaving as owner is blocked at the application layer until an ownership transfer completes — the owner must hand off the `owner` role to another admin/member before their own `group_members` row can be deleted.
- **`notifications`**: readable and writable (for `read_at`) only where `user_id = auth.uid()` — strictly private, no other user or group role can read someone else's notifications.
- **`push_subscriptions`**: readable/writable only where `user_id = auth.uid()`.
- **`daily_completion`**: same visibility rule as `progress_entries` — readable by a user who shares a group with the target user, since streak/completion status needs to surface in group-facing UI (digest, member lists).
- **`group_cycle_stats`**: readable by members of that specific group (`group_id` in the viewer's `group_members`) — streak data is inherently group-scoped.
- **`audit_log`**: no client-facing read policy for v1 — there's no admin UI to display it yet, so it's written by trusted server-side triggers and queried directly (e.g. via Supabase dashboard) rather than exposed through the app. Revisit if a UI for it gets built later.
- **`content_reports`**: a reporter can read their own submitted reports (to see status); the `reported_user_id` gets **no** read access to reports made against them — revealing who reported what would undermine the reporting system and could enable retaliation. Review happens via direct Supabase dashboard query per the existing v1 approach, not through a client-facing admin role.
- **`user_blocks`**: a user can read their own outgoing blocks (`blocker_user_id = auth.uid()`) to manage their block list. The blocked user gets no read access to check whether they've been blocked — blocking's effects (hidden profile, blocked invite joins) are enforced server-side in the relevant queries, not by letting the blocked user query the block table directly.
- **`username_history`**: no client read policy at all — never surfaced in the UI, accessed only via service role for support/moderation lookups.

## 5. Realtime Architecture

Real-time updates are deliberately **not** used for the main progress feed — the product uses a daily batched digest instead of live pushes, which avoids notification fatigue and matches the "daily habit" framing rather than a constant-activity feed.

Supabase Realtime is reserved for:
- Immediate notification types (`kicked`, `admin_transfer_request`, `group_locked_renewal`) — these should appear promptly, not wait for the next digest cycle.
- Any future in-app presence features (e.g. "who's currently viewing this group").

## 6. Daily Digest System

1. A scheduled job (pg_cron or Vercel Cron → Edge Function) runs once daily per group.
2. For each group, compute per-member completion status for the prior day from `daily_completion`, plus streak deltas from `group_cycle_stats`.
3. Write the result to `digest_snapshots`.
4. Send one push notification per group per user (not one combined notification across all groups) — **teaser format**: e.g. "3 friends checked in today — tap to see," deep-linking into the homescreen subtab.

Teaser format was chosen over a named/detailed summary for two reasons: iOS truncates long notification bodies, and a detailed payload risks surfacing hidden-goal-adjacent information on a lock screen, outside the app's access controls.

The homescreen subtab and the notification both read from the same `digest_snapshots` row for a given day, so there's no risk of the in-app summary and the notification disagreeing.

## 7. Group Lifecycle: Deadlines, Locking, Renewal

- A group with no deadline never locks.
- **Deadline-notice rule, rescoped**: the 2-day advance notice only applies when a deadline is being *introduced for the first time* or *moved sooner* than it currently is — both of which reduce the time members have to prepare. Extending a deadline further out, or removing it entirely (going open-ended), takes effect immediately with no wait, since that only ever gives people more time, never less. Enforced as `new_deadline >= now() + interval '2 days'` only when `new_deadline` is null→non-null or earlier than the current `deadline`; skipped otherwise. This also resolves what happens during the "Continue" renewal path below, which is always an extension case and so never needs the wait.
- When a cycle's deadline passes, `group_status` flips to `locked`. Check-ins are blocked. Members see a summary/congratulations screen computed from the cycle's aggregated `progress_entries` and `group_cycle_stats`.
- The admin/owner is prompted (immediate notification) to either:
  - **Continue**: keep the same cycle's goals/history intact, extend the deadline or remove it (open-ended) — immediate, no notice period, per the rescoped rule above.
  - **Reset**: close the current `group_cycles` row (`ended_at` set), open a new cycle. `group_cycle_stats` zero out for the new cycle. `user_lifetime_stats` are unaffected — they persist independently of any cycle reset.

### Group streaks & consistency rankings — resolved, see section 21

Raised during an earlier review as an idea worth a dedicated pass, the same way the galaxy got one — now fully designed in section 21 (Group Streak & Leaderboard).

## 8. Photo Check-Ins

- Accepted input formats: HEIC (iPhone default), JPG, PNG.
- HEIC is converted client-side before upload — it isn't reliably renderable outside Safari/iOS, so nothing stores the raw HEIC.
- All uploads are normalized to **WebP**: resized to a max dimension (~1600px, sufficient for a progress photo), compressed to ~75-80% quality, performed in-browser (canvas or a library such as `browser-image-compression`) before hitting Supabase Storage.
- Max pre-compression upload size: 10MB (accounts for large HEIC originals; compression brings the stored file down well below this).
- Rate limiting on the upload endpoint via Upstash's ratelimit package — a sliding window per user (e.g. ~20 uploads/hour), generous for legitimate daily use while blocking abuse.
- **Retention**: photos auto-delete once their `group_cycles.ended_at` passes. The scheduled cleanup job sweeps `progress_entries` for rows tied to an ended cycle, deletes the corresponding Supabase Storage object, and nulls `photo_url` on the row. The entry itself (and its contribution to stats) is preserved — only the photo is dropped.

## 9. Groups & Invites

- Groups are **invite-only**: join via a shareable invite link (`invite_links.token`) or a direct invite.
- Owner/admins can enable, disable, or regenerate the invite link at any time. Enabling a link first checks current `group_members` count — if the group is already at 10, the enable action is blocked with a "group full" state rather than producing a link that can't actually be used.
- A user opening an invite link who isn't authenticated is routed through registration/sign-in (Google) before the join completes — the invite token is held through the auth redirect so they land back on the join confirmation afterward rather than losing the invite context.
- Joining is blocked once a group reaches 10 members — hard cap, enforced at the DB level, not adjustable per-group. This is an intentional product constraint to keep circles small and check-ins socially enforced. Since membership can change between link generation and link use, this check happens again at join time, not just at link-enable time.
- Roles: `owner` (one per group, can transfer but not leave without transferring first), `admin` (can kick members, manage invite links), `member` (can leave at any time, no admin privileges). No cap on the number of admins a group can have — the owner can promote any subset of members. This is left uncapped deliberately since the 10-member hard cap already bounds the risk of over-promotion; enforcing a separate admin limit would add complexity without a clear benefit at this scale.
- **Admins cannot act on the owner**: kicking and demoting are both scoped to targets with role `member` or `admin` — an admin (promoted or otherwise) can never kick or demote the `owner`, regardless of how many admins a group has. Only the owner can change their own role, via the transfer flow, and only the owner can demote another admin back to `member`. This prevents a promoted member from ever removing or downgrading the person who promoted them.
- Kicked members receive an immediate notification and lose access to the group's data going forward; their historical progress rows remain in Postgres but are excluded from all future queries once their `group_members` row is removed.

## 10. Group List Display

- `locked` and `archived` groups are never removed from the user's group list — they move into a distinct "Archived" section rather than disappearing.
- A user setting toggles whether archived groups are shown at all in the main list view — **defaults to on**, so archived groups are visible unless the user turns them off.
- Note the distinction: `locked` (deadline passed, awaiting admin renewal decision) is not the same as `archived` (cycle explicitly ended/reset or group otherwise retired) — both live in the archived section, but the summary/congratulations screen only applies to freshly `locked` groups, not long-archived ones.

Invite links do not use a max-use count; capacity is governed solely by the group-space checks described above (at enable time and again at join time). No separate usage-limit field needed on `invite_links`.

## 11-15. Phase 2 (Deferred) — Galaxy System

**Everything in sections 11 through 15 is deferred, not v1 scope** — see the V1 scope note in section 1. Kept in full below since the design work is done and shouldn't be redone later, but none of it should be built until the functional core (sections 3-10, 16-20) is working end to end.

## 11. Galaxy / Visual Progression Data Model

Backs the frontend "galaxy" visualization (full design discussion lives in `frontend-visual-design.md`) — the following is the data side of it, kept in the core architecture since it's driven by goal completion events, not just a rendering concern.

### `goal_categories` — moved to section 3 (v1 scope)

Full color rationale, moved here for reference since it only matters once the galaxy renders these colors: colors are pitched bright/saturated rather than muted so they work as glowing tints on stars and planets against a dark space background. The palette is respaced around the color wheel at roughly 40° of hue separation between neighbors so all nine stay visually distinct at a glance — granularity was worth keeping over merging when Finance and Health's greens originally clashed. "Fixed at launch" means no self-serve in-app UI for creating categories, not that the table is immutable — adding one later is a data insert. Avoid changing an existing category's `color_hex` once goals reference it: `goals.category` is a live FK (unlike `galaxy_stars`, which denormalizes color at time of achievement), so a change would retroactively recolor every ring/planet using it.

### `galaxy_stars`
A ledger of star-generation events, rather than deriving stars implicitly from `goals` at render time — keeps the frontend query simple (just fetch this table) and gives an explicit, append-only record independent of whether the source goal later gets edited or archived.
- `id` (uuid, PK)
- `user_id` (FK → users)
- `goal_id` (FK → goals)
- `category_id` (FK → goal_categories, denormalized copy of the goal's category **at the time of achievement** — so if a user later changes a goal's category, past stars keep their original color rather than retroactively shifting)
- `color_hex` (denormalized copy of the category's color at time of achievement, same reasoning)
- `star_count` (small int — how many stars this achievement event adds, in case that's tuned later e.g. by streak length rather than always a flat amount)
- `created_at`

Row is inserted by the same trigger/flow that sets `goals.achieved_at` — one `galaxy_stars` row per achievement event. This keeps "stars added" as a discrete, replayable history rather than something computed on the fly from scattered goal states, which matters for the aggregation/nebula-clustering strategy mentioned as an open question in the frontend doc (aggregation can operate on this table by age/count without touching the underlying goals data).

### `users` (additional galaxy fields)
Supports the custom "sun" overlay described in the group galaxy view (see `frontend-visual-design.md`).
- `planet_avatar_url` (nullable) — the user's hand-cropped cutout image, stored in Supabase Storage, used in place of the default dimmed profile photo on their sun.
- `planet_avatar_crop` (jsonb, nullable) — crop/positioning parameters (offset, scale, shape mask reference) kept alongside the cropped asset so the crop can be re-edited later without re-uploading the source photo.

This is per-user, not per-group — the same custom sun renders in every group the user belongs to, consistent with goals being user-owned rather than group-owned elsewhere in this schema.

### `content_reports` — moved to section 3 (v1 scope)

The `planet_avatar` content type (sun cutout reporting) stays unused until the galaxy ships; the table itself and its `checkin_photo`/`checkin_note` values are already live in v1.

## 12. Unlock Track System (Galaxy Cosmetics)

Backs the frontend's permanent planet/sun style rewards (see `frontend-visual-design.md`). Structured as independent tracks per achievement mechanism rather than one combined ladder, so progress on any single axis (streaks, consistency, total achievements) rewards a user regardless of which they lean into.

### `unlock_tracks`
- `id` (uuid, PK)
- `name` (e.g. "Streak Track", "Consistency Track", "Achievement Track")
- `metric` (enum: `longest_streak_ever`, `total_days_completed`, `total_goals_achieved`) — which `user_lifetime_stats` field drives this track's progress.
- `reward_category` (enum: `planet_style`, `sun_style`, `nebula_effect`) — which cosmetic slot this track's unlocks apply to.

### `unlock_tiers`
- `id` (uuid, PK)
- `track_id` (FK → unlock_tracks)
- `threshold_value` (int — the metric value required to reach this tier)
- `tier_order` (int, for display ordering)
- `reward_reference` (identifier for the specific style asset unlocked)

### `user_unlocks`
- `user_id` (FK → users)
- `tier_id` (FK → unlock_tiers)
- `unlocked_at`

Populated by a trigger watching `user_lifetime_stats` updates — whenever a tracked metric crosses a tier's `threshold_value`, insert the corresponding `user_unlocks` row. Deliberately keyed off `longest_streak_ever` rather than `current_streak` for the Streak Track, since these are permanent rewards — a broken streak shouldn't retroactively revoke something already earned.

Adding a new tier or an entirely new track later is a data insert into these tables, not a code change or migration, consistent with how `goal_categories` is managed.

### Equipped styles
Unlocking a tier (via `user_unlocks`) makes a style *available*, not automatically active — a user can have multiple unlocked planet styles, for instance, and choose which one is currently showing.
- `users.equipped_sun_style_id` (nullable FK → `unlock_tiers`, filtered to `reward_category = sun_style`)
- `goals.equipped_planet_style_id` (nullable FK → `unlock_tiers`, filtered to `reward_category = planet_style`) — planet styles are equipped per-goal, not globally, since each goal has its own ring/planet
- `users.equipped_nebula_style_id` (nullable FK → `unlock_tiers`, filtered to `reward_category = nebula_effect`)

**Default when unequipped**: if any of these fields is null (e.g. right after a fresh unlock, before the user has made an active choice), the renderer falls back to the **highest-tier unlocked style** on that track — not the very first/lowest one. This means a new unlock is visible immediately without requiring the user to go equip it manually, while still respecting an explicit choice if they've set one.

**Unlock notifications**: unlocking a tier fires a `cosmetic_unlocked` notification (see the `notifications` table above), separate from and in addition to inserting the `user_unlocks` row — the trigger that writes `user_unlocks` also writes the notification, so a user is told what they earned rather than discovering it silently next time they open the galaxy.

**Launch seed data** — each track maps to one reward category, chosen for thematic fit: streaks are about sticking with one thing (→ planet styles), total days completed is a whole-person cross-goal metric (→ sun styles, layered on top of the 4 free onboarding sun choices), and total goals achieved already drives star/nebula generation (→ nebula effect variants).

| Track | Metric | Reward | Tier thresholds |
|---|---|---|---|
| Streak Track | `longest_streak_ever` (days) | Planet styles | 3, 7, 14, 30, 60, 100, 180, 365 |
| Consistency Track | `total_days_completed` | Sun styles | 3, 7, 14, 25, 50, 75, 100, 200, 365, 500, 750, 1000 |
| Achievement Track | `total_goals_achieved` | Nebula effects | 1, 3, 7, 15, 30, 50, 100, 200 |

Spacing is deliberately front-loaded — tight early tiers for a fast first reward, wider gaps later for long-term retention. The final tier on each track (365-day streak, 1000 days, 200 goals) is a "flagship" prestige reward, visually distinct from earlier tiers in the same track (e.g. an animated trail, a corona effect, or — for the top nebula tier specifically — an effect that breaks the normal 3-color/5-category blend rule as a deliberate rarity signal). The baseline nebula color-blending behavior (up to 3 categories, gated behind 5 categories achieved) stays universal for every user regardless of tier; Achievement Track rewards add shape/effect variants on top of it, not new colors. Exact visual assets for each tier are deferred — this table fixes the progression structure and thresholds only.

## 13. Galaxy Cosmetic Asset Hosting

Planet styles, sun styles, and nebula effect variants are a small, fixed set of assets identical for every user — fundamentally different from check-in photos or avatar cutouts, which are per-user, dynamic, and access-controlled. That difference should drive where they live.

**Recommendation: static assets served from Vercel's edge network (Next.js `public/` or a dedicated asset build step), not Supabase Storage.**

Reasoning: Supabase Storage is built for dynamic, access-controlled, user-generated content — every read goes through Supabase's infrastructure and (where applicable) RLS-equivalent bucket policies. Cosmetic assets need none of that: they're the same for everyone, never change per-request, and aren't sensitive. Routing them through Storage adds a network hop and infrastructure that doesn't buy anything here. Static assets on Vercel's CDN, by contrast, can be served with long-lived, immutable `Cache-Control` headers — once a device has fetched a style texture, it never needs to fetch it again, which matters directly for the "quick to load" priority on repeat visits.

**Format**: pack styles into texture atlases/spritesheets (one atlas per `reward_category`, e.g. all planet styles in one image) rather than individual files per style. PixiJS batches draw calls far more efficiently from a shared atlas than from many separate textures, and it collapses what could be dozens of HTTP requests into a handful.

**Loading strategy**: only load the atlas for a style category when it's actually needed. The initial galaxy load only needs the *currently equipped* styles' textures (one planet style per active goal, one sun style, one nebula style) — not the full library of everything the user has unlocked. The full atlas of unlocked-but-inactive options only needs to load when the user opens a style-selection/customization screen. This keeps the home dashboard's initial payload as small as possible, consistent with the galaxy now being the first thing rendered on every app open.

**Versioning**: filename/path includes a content hash or version number (standard practice, and something Next.js's build pipeline does automatically for bundled assets) so that updating or adding a style doesn't require invalidating the cache for existing ones.

## 14. Group Composite Galaxy View — Performance Approach

The composite view (up to 10 member sub-galaxies at once) has different data needs than an individual galaxy load, and reusing the per-user full snapshot (section 15 below) for all 10 members would fetch far more data than the composite actually renders — it only needs lightweight LOD stand-ins, not each member's full star field and ring set.

**Recommendation: a dedicated, incrementally-updated Redis structure per group, separate from the per-user galaxy snapshot.**

Use a Redis hash keyed by group: `HSET group_composite:{group_id} {user_id} {compact_json}`, where each member's value is a small payload with only what the LOD view renders — username, equipped sun style/avatar reference, active goal count (ring count), today's overall completion status, and a rough category-color summary for a mini nebula preview. No individual star lists, no per-goal detail.

This structure has two performance advantages over recomputing from the per-user snapshots on every group view load. First, reading the whole composite is a single `HGETALL`, bounded at 10 entries — cheap and fast regardless of how large any individual member's actual galaxy has grown. Second, updates are incremental: when a member checks in, achieves a goal, or unlocks a cosmetic, only their one hash field needs to be rewritten (`HSET group_composite:{group_id} {user_id} {new_json}`) — not the whole group's payload. Extend the same event handlers that already update the per-user Redis snapshot (section 15) to also loop over that user's `group_members` rows and patch each relevant group's composite hash — cheap fan-out, since a user is realistically in a handful of groups at most.

**On the rendering side**: the composite scene should never instantiate full individual galaxy scene graphs for all 10 members — only the lightweight LOD stand-ins (matching the recommendation already in the frontend doc). When the user zooms into one member, that's a distinct route transition (already decided) into the normal individual galaxy screen, which fetches that member's full per-user Redis snapshot fresh at that point — there's no need to preload or keep full-detail data warm for members who haven't been zoomed into.

## 15. Galaxy Initial Load Caching (Redis)

Resolves the frontend doc's initial-load-strategy question: **Option A**, a cached snapshot shown instantly while live data hydrates behind it — implemented via Upstash Redis rather than a client-only service worker cache, consistent with Redis's existing role elsewhere in this doc (feed caching, visibility-set caching).

- On any write that changes a user's galaxy state (check-in, achievement, star generation, unlock), the API recomputes and writes a compact JSON snapshot of that user's galaxy (rings, planet states, recent stars, unlock status) to Redis, keyed by `user_id`.
- On galaxy load, the client fetches from this Redis-backed endpoint first — a fast key lookup, not a live Postgres join across `goals`, `daily_completion`, `galaxy_stars`, and `user_unlocks` — so the initial payload arrives fast enough to render near-instantly. **On a cache miss or Redis error, the endpoint falls back to running the live Postgres join directly** (slower, but correct) rather than failing the request — per the fast-path-not-source-of-truth rule stated in section 2.
- This complements, rather than replaces, client-side caching (e.g. a service worker holding the last-rendered frame for the very first paint before any network round-trip completes) — Redis solves the "server response is slow because of complex joins" problem, client caching solves the "network round-trip itself takes time" problem. Both apply.

## 16. Account Lifecycle: Deletion & Export

- Self-serve, in-app deletion flow — not a support-ticket process. Apple's App Store review expects apps offering account creation to also offer in-app account deletion, and given OAuth sign-in plus stored photos/notes, a manual-only path isn't a great experience anyway.
- Deletion triggers a cascade job (Edge Function, not a raw `ON DELETE CASCADE` at the schema level, since some data needs different handling): remove the user's `push_subscriptions`, `goals`, `progress_entries` photos from Storage, `planet_avatar_url`/`planet_avatar_crop` assets, and their `group_members` rows. `progress_entries` rows themselves are anonymized (user reference nulled or replaced with a "deleted user" placeholder) rather than hard-deleted where they're load-bearing for other members' historical group stats, rather than outright removed — deleting them entirely would retroactively corrupt other members' `group_cycle_stats` for cycles they shared.
- Data export: a simple on-demand job that compiles the user's own `goals`, `progress_entries`, `user_lifetime_stats`, and profile data into a downloadable JSON, delivered via a signed Storage URL. Lower priority than deletion, but straightforward to build on the same job infrastructure.

## 17. Deferred / Future Work

- Exact digest notification copy/format per group size (e.g. behavior when only 1-2 members checked in vs the whole group) — to be designed later, not a blocking architectural decision.

## 18. Security & Gap Audit — Resolved

All items from the architecture/frontend gap audit, resolved:

1. Hidden goals in the galaxy — a hidden goal's ring/planet **still renders** in the galaxy, including its category color, even to other group members. What's suppressed is only the detail on interaction: tapping/hovering the planet as anyone other than the owner reveals nothing beyond its color — no title, note, or photo. This keeps the galaxy visually honest (progress is perceptible) while preserving the same content-hiding guarantee used everywhere else in the product.
2. Daily shine reset — purely derived, no scheduled job. "Shining" was never a stored state; the frontend just checks whether a `progress_entries` row exists for the current `check_in_date` (2 AM-boundary local day) on each render. If a session stays open across the 2 AM boundary, this re-derives naturally next time the relevant state is read, rather than needing an explicit reset trigger.

3. Storage bucket policies — two buckets, two rules. Check-in photos: readable only by a user who (a) shares a group with the photo's owner **and** (b) the underlying goal is not hidden (`goal_group_visibility.hidden`) in that shared group — enforced directly as a Storage RLS policy (not just API-layer masking as originally scoped in section 4), so the restriction holds even if a client somehow obtains a direct Storage URL. Writes restricted to the owning user, path scoped by `user_id`. Sun cutouts/avatars: read open to any authenticated user, write restricted to owner — lower sensitivity, consistent with how a profile picture behaves generally.
4. Rate limiting — extended via the existing Upstash sliding-window pattern: goal creation (~20/hour), group creation (~5/day), invite-link join attempts (per-token, not just per-user, since brute-forcing a single token is the actual risk), report submissions (~10/day), and a light rate limit added to the check-in endpoint itself even though the DB unique constraint already caps successful check-ins to one per day — this blunts repeated failed-attempt hammering.

5. Input validation/sanitization — length caps enforced at the DB level, not just client-side: goal `title` ~100 chars, `progress_entries.note` ~500 chars, `groups.name` ~50 chars, `content_reports.reason` ~500 chars, `username` ~20-30 chars restricted to alphanumeric + underscore (no unicode lookalikes, closes off a cheap impersonation trick). Usernames and group names additionally run through a profanity/distasteful-language filter at creation/rename time, rejected synchronously with a friendly error rather than allowed through and moderated after the fact, since these are high-visibility identity fields. Recommended package: **`obscenity`** — actively maintained, TypeScript-native (fits the existing strict-TS stack), and detects common obfuscation (leetspeak, character substitution) that older wordlist libraries like `bad-words` miss. Sanitization note: nothing in the schema currently needs rich text/markdown, so React/JSX's default escaping at render time is sufficient as long as no field is ever rendered via `dangerouslySetInnerHTML` — worth stating as an explicit rule now. If a rich-text field is ever added later, sanitize with DOMPurify at that point rather than pre-building for a need that doesn't exist yet.
6. Image upload risk — validate uploaded files are genuinely images by inspecting content/magic bytes rather than trusting the client-reported extension or MIME type (stops a renamed executable posing as a `.jpg`). Cap decompression dimensions during the existing client-side compression step to prevent a decompression-bomb image from ballooning memory. Strip EXIF metadata during the WebP re-encode as an explicit requirement, not just an incidental side effect — otherwise a check-in photo could unintentionally leak the poster's GPS location to the group.

7. Invite link token security — tokens generated from a CSPRNG, 24+ bytes, base62/URL-safe encoded (not sequential or otherwise guessable). Join attempts rate-limited per-token (~10/hour), separate from any per-user rate limit, since brute-forcing a single token is the actual risk.
8. Moderation asymmetry — `content_reports.content_type` extended to cover check-in photos and notes, not just the sun cutout (`planet_avatar`, `checkin_photo`, `checkin_note`). Same report → manual-review flow applies to all three; `content_reference` continues to capture the flagged content's location/value at time of report so later edits don't undermine a pending review.
9. Secrets management — stated explicitly: the Supabase service-role key, VAPID private key, and Upstash token are used only in server-side contexts (Edge Functions, Next.js server actions/API routes) and are never bundled into client code or exposed via `NEXT_PUBLIC_*` environment variables.

## 19. Audit Log

Reviewing the full doc for every privileged action surfaced one small gap: there's currently a path to **promote** a member to admin, but no explicit path to **demote** an admin back to member without fully kicking them — added here as `admin_demoted`, since it's a natural companion to `admin_promoted` and the only alternative today is removing someone from the group entirely just to revoke admin rights.

### `audit_log`
- `id` (uuid, PK)
- `actor_user_id` (FK → users — who performed the action)
- `group_id` (nullable FK → groups — most actions are group-scoped; nullable since not all are)
- `target_user_id` (nullable FK → users — who the action was performed on, where applicable)
- `action_type` (enum: `member_kicked`, `ownership_transferred`, `admin_promoted`, `admin_demoted`, `invite_link_toggled`, `invite_link_regenerated`, `group_deadline_changed`, `group_cycle_reset`, `group_cycle_extended`, `group_streak_continued`, `group_streak_reset` — the last two added alongside the Group Streak feature in section 21)
- `metadata` (jsonb — action-specific detail, e.g. old/new deadline values on a `group_deadline_changed` row)
- `created_at`

Covers every privileged action currently defined across sections 7 and 9 (group roles, invites, lifecycle). `content_reports` resolution is deliberately **not** duplicated here — that table already carries `status`, `reviewed_at`, and `reviewed_by`, so a separate audit row would be redundant; `audit_log` is for actions that don't already carry their own history elsewhere (username changes are similarly excluded, already covered by `username_history`).

## 20. Remaining Security / Robustness Gaps — Resolved

**11. User-level blocking.** `user_blocks` table, defined in section 3. Doesn't retroactively remove someone from a group you're already both in — that stays kick's job.

Important gap this closes: kicking someone today does **not** block them — nothing stops them from being re-invited later (by anyone with a valid invite link, including a link generated after the kick) unless a block is separately in place. Blocking is presented as a distinct follow-up step after a kick, not bundled into it automatically — the kick flow should surface a prompt like "also block this user?" immediately after the kick completes, so it's a deliberate second action rather than an assumption.

**12. Cap on goals per user.** A hard cap of **10 active goals** per user (archived and achieved goals don't count against it), enforced via a trigger on `goals` insert, the same pattern used for the group member cap.

**13. CSP/headers, dependency scanning, bot defenses.**
- Security headers via Next.js middleware/`next.config`: Content-Security-Policy (nonce-based `script-src`, restricted to `self` plus the specific CDNs actually used), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- Dependency scanning: GitHub Dependabot as the baseline, `npm audit` as a CI check on top.
- Bot/fake-account defenses: **CAPTCHA added preemptively at signup** (Cloudflare Turnstile — privacy-friendly, free tier, low-friction compared to traditional CAPTCHA) rather than waiting for observed abuse, layered on top of the existing OAuth-only friction (Google, no password form).

## 21. Group Streak & Leaderboard

New v1 feature, raised during the final review pass. Builds directly on the reversed zero-goal rule above: the group streak only holds when **every current member completes every one of their own active goals** on a given day — one member with no goals, or an incomplete goal, breaks it for everyone.

### Group streak mechanics

Fields live on `group_cycles` and the derived `group_daily_completion` table — both defined in section 3. `group_cycles.current_streak` increments on a day where `group_daily_completion.all_members_completed = true`, resets to 0 on a `false` day; `longest_streak` tracks the running maximum, same pattern as every other streak field in this doc.

### New-member join handling

Since a brand-new member almost certainly has zero goals on day one, joining an existing streak would otherwise break it immediately by the rule above — which would make joining an active group feel punishing rather than welcoming. Handled with a grace-and-decide flow rather than an automatic exemption:

- When a user joins a group where `current_streak > 0`, that member is flagged with `group_members.streak_grace = true`. While flagged, they're excluded from `group_daily_completion` evaluation entirely — their goal-less days neither break nor extend the group streak, effectively pausing the "everyone" requirement around them until a decision is made.
- The group is flagged `groups.streak_decision_pending = true`, with `groups.pending_streak_joiners` accumulating anyone who joins while a decision is outstanding — so multiple joins before the owner next visits are handled by a single decision, not one popup per person.
- Next time the **owner** (not any admin) opens the group, they see a popup: continue the streak, or reset it. This is owner-only since it's a judgment call about the group's culture/standards, not a routine admin action.
  - **Continue**: `streak_grace` clears for all pending joiners, they're now fully counted going forward, `current_streak` is untouched throughout.
  - **Reset**: `current_streak` set to 0 immediately, `streak_grace` clears the same way — new members are now counted from a streak of zero, so there's no punitive gap to worry about.
- If the owner never opens the app, grace simply persists indefinitely for that member with no penalty — the group streak keeps accruing based on everyone else, unaffected by the pending decision.
- Logged to `audit_log` as `group_streak_continued` or `group_streak_reset`, both added to the `action_type` enum (section 19).

### Leaderboard

Per-user, per-category stats scoped to a group, in `group_member_category_stats` (defined in section 3). Three ranking dimensions:

- **Completion rate** — `total_completions / total_possible`. `total_possible` increments whenever a goal in that category was active and eligible for check-in on a given day; `total_completions` increments on an actual check-in. Both counters start accruing from the user's `joined_at`, not the group's creation — matches "user stats start when they join."
- **Consecutive streak #** — this is the **group streak** described above (a single value for the whole group, not a separate per-user-per-category streak), surfaced on the leaderboard tab alongside the per-user category breakdown.
- **Daily goals completed** — `total_completions`, the raw count, usable as its own sort column independent of rate.

**Persistence across cycles**: `groups.leaderboard_persists_across_cycles` (bool, owner-configurable, default your call). When `true`, `group_member_category_stats` and the group streak survive a cycle reset (a true "since group inception" metric). When `false`, both reset alongside `group_cycle_stats` on reset — kept as a toggle since you flagged this as optional rather than fixed either way.

**Display**: `groups.default_stats_view` (enum: `cycle_stats`, `leaderboard`) — owner sets which tab is the primary/default view; both remain accessible regardless.

**Reset on kick**: on kick, a member's `group_member_category_stats` rows for that group are zeroed/deleted outright (not just excluded from queries like `progress_entries` elsewhere in this doc). If they're re-invited and rejoin later, they start over at zero — being kicked costs standing on the leaderboard, even for a returning member. Their raw `progress_entries` history stays untouched in Postgres either way, consistent with how deletion/anonymization is handled everywhere else in this doc.
