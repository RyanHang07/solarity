# Schema

Every table, and what each constraint is for. Section numbers from the original document are kept where other files cite them.

---

## 3. Schema

### `users`
Populated by the `on_auth_user_created` trigger off `auth.users`.

**`authenticated` reads five columns and no more**: `id`, `username`, `display_name`, `avatar_url`, `checkin_timezone`. Migration 75 replaced a table-level SELECT with those, because `users_select_self_or_groupmate` is row-level: any column a signed-in user can read is readable by everyone sharing a Circle with them. A table grant meant every column added here was circle-visible the moment it existed. Add a column, decide its grant.

- `id` (uuid PK, matches `auth.users.id`)
- `display_name` (nullable, **not unique**): cosmetic only. **Render `coalesce(username, display_name)` anywhere one person is named to another**: rosters, member lists, digests, notifications. `display_name` leads only where you are being addressed yourself, which today is the onboarding welcome.

  **The order is deliberate and it used to be the other way round.** `display_name` is not unique, so two members who both set theirs to the same value render as two identical rows in a Circle whose entire job is telling friends apart, and setting yours to match a friend's is a cheaper impersonation than the unicode lookalikes the case-insensitive `username` index already blocks. Recognition has to run on the field with the uniqueness guarantee. Found by an e2e test that could not distinguish two accounts belonging to the same person.

  Replaced a `first_name` / `last_name` pair that had a reader and no writer. `handle_new_user` read `given_name` and `family_name`; Supabase's Google provider supplies neither. Its keys are `avatar_url, email, email_verified, full_name, iss, name, phone_verified, picture, provider_id, sub`. Both columns were null on every account and always would have been.

  The deeper problem was **three overlapping concepts**. A legal-shaped first/last pair earns its place in a product with billing or formal correspondence; Solarity has neither. Two is the conventional split: `username` is identity, `display_name` is cosmetic.

  The trigger now reads `display_name`, then `full_name`, then `name`, truncating to 50. Without that truncation an over-long value would violate the CHECK and abort signup over a decorative field.

  Profanity screening happens in the app layer, as it does for username, since this appears in other people's rosters.
- `username` (nullable, **case-insensitively unique** via a unique index on `lower(username)`): the public identity everywhere. Case-insensitive because a plain constraint would allow both `Ryan` and `ryan`, a cheaper impersonation route than unicode lookalikes. **Lookups must query `lower(username) = lower($1)` to hit the index.** Nullable because OAuth can't supply one; onboarding sets it.
- `avatar_url` (nullable, CHECK `users_avatar_url_is_own_key`): **a Storage key in the `avatars` bucket, never a URL.** Always `<your id>/avatar.jpg`, so the object has exactly one version and nothing is ever orphaned. Written by `setAvatar`; the key is derived server-side and never accepted from a request.

  **The CHECK is migration 80's hole in a second column.** `authenticated` holds `update (avatar_url)`, and without it a client could point the column at `<someone else's id>/avatar.jpg` — the storage policies stop you *writing* into another person's folder, and nothing stopped you *naming* it. With profiles readable by any signed-in user, that renders their face as yours.

  **It held Google profile-picture URLs until migration 85.** `handle_new_user` copied `raw_user_meta_data ->> 'avatar_url'` at signup, and every one of them was unrenderable: `img-src` is `'self' data: blob:` plus Supabase, so `lh3.googleusercontent.com` was blocked. They were also never chosen for publication. The trigger no longer seeds it, and the values were nulled.

  The bucket is **private**, 2MB, `{image/jpeg}`, and read through signed URLs with an hour's TTL. `avatars_select` allows any authenticated reader, which is broader than `checkin_photos_select` and is exactly right now that profiles are open to any signed-in user.
- `checkin_timezone` (IANA name), `checkin_day_started_at`: frozen at each 2 AM rollover, not read live. See check-in dates below.
- `pending_checkin_timezone` (nullable): a zone chosen **deliberately**, adopted by the next rollover.

  **Two paths, and they are not interchangeable.** `sync_checkin_timezone` is the automatic one, called when the client notices you have travelled, and it is a no-op mid-day by design. `set_checkin_timezone` is the deliberate one, from settings, and it queues.

  Neither writes `checkin_timezone` during a day, because `private.checkin_date_for` derives today from that column and `now()` alone — it never reads `checkin_day_started_at`. Writing it directly re-dates the day in progress: check-ins already made sit under a date that is no longer today, and completion reads as nothing done. Migration 74.
- `created_at`, `updated_at`

**Renames**: once per 14 days, enforced by `complete_onboarding()`, which also writes a `username_history` row. `username_history` (`user_id`, `old_username`, `changed_at`) is a support/moderation trail, never surfaced.

Live views resolve the current username via FK.

**The exception is `notifications.payload` and `digest_snapshots.summary`.** Both are jsonb written once, so the username must be denormalized in at write time. Joining live would let a March entry silently start crediting a name that person didn't have in March.

**This applies to people, not to objects.** A Circle rename is the same Circle, so `payload.circle_name` is read **live from `groups`**, with the stored copy used only when the join returns nothing. It has to be stored for that reason and no other: `payload.group_id` is a jsonb value with no foreign key, so deleting a Circle orphans every notification about it, and those rows render as `<name> (no longer available)` rather than blank.

**Enforced, as of migration 73**, by `notifications_payload_names_its_circle`: any payload whose `type` names a Circle must carry both `group_id` and `circle_name`. Keyed on `type` with an `else true` branch, so a sixth notification type is unconstrained until someone designs its shape rather than being unable to insert at all.

**The stored name reaches lock screens as of 10g, behind a setting.** It used to be in-app only: every push body was built from counts alone, which produced four identical notifications for four Circles and was the one real finding of step 10's manual pass. `users.push_shows_circle_name` decides, defaulting to on, and `teaser.ts` falls back to the old countless wording when a name is withheld or absent. **A goal title still never reaches a body, ever** — those are masked per Circle and a lock screen is outside every one of those checks.

### `goals`
User-owned, never group-owned. Goals stay constant across every Circle a user belongs to.

- `id`, `user_id` (FK → users), `title`
- `category_id` (FK → goal_categories, **required**, `ON DELETE RESTRICT`): no uncategorized state
- `deadline` (**`date`**, nullable, **unconstrained**): personal and informational; recording a missed or historical deadline is legitimate, so a constraint here would fight the user

**`date`, not `timestamptz`, since migration 84.** A goal deadline is a calendar date and never an instant. `<input type="date">` submits `YYYY-MM-DD`, which a `timestamptz` column stores as midnight **UTC** — so anyone west of UTC picked 1 September and read back 31 August. That is not fixable in the reader: it would leave every consumer to agree on which timezone to un-apply, and one of them getting it wrong is a date off by one. `date` has no timezone semantics, so the error class stops existing. Changed at zero rows, because `timestamptz -> date` casts in the session timezone and with data it would have been a silent decision about whose midnight counts.

**Overdue means strictly before today**, matching the rule `/circles/[id]` states for a Circle's deadline: the deadline day itself is fully playable. `lib/goal-deadline.ts` holds it as pure functions, and "today" is always the check-in date from `current_checkin_date()` — never the browser's clock, or the two would disagree either side of the 2 AM boundary.
- `achieved_at` (nullable, CHECK `<= now()`, **write-once**): the goal itself is done, distinct from a daily check-in
- `archived_at` (nullable, CHECK `<= now()`): dropped rather than completed

**Achieved means retired, whatever migration 04's column comment says.** That comment reads *"a goal can be achieved and kept active"*, and nothing in the database agrees with it: `goals_active_by_user_idx`, `enforce_active_goal_cap`, `recompute_daily_completion` and `can_check_in_on_goal` all treat a non-null `achieved_at` as inactive. So achieving moves today's denominator exactly as archiving does. A migration comment cannot be edited after it has been applied; this line is the correction.

**Achieving is one-way, and archiving deliberately is not.** `goals_count_achievement` increments `total_goals_achieved` on every null → not-null transition, so clearing the column and setting it again counts one goal twice — reachable through the ordinary API, since `authenticated` holds `update (achieved_at)`. Migration 83's `goals_achievement_is_final` refuses to clear *or move* it once set, raising `check_violation` with `hint = 'ACHIEVEMENT_FINAL'`. `archived_at` feeds no counter and un-archiving is reasonable, so it has no equivalent rule; the asymmetry is the point.
- `created_at`, `updated_at`

Achieving doesn't touch `daily_completion` or streak history. After achieving, the user is prompted to archive, edit into a new goal, or keep it active.

### `goal_categories`
Fixed preset, seeded. Not user-customizable.

- `id`, `slug` (unique), `name` (unique), `color_hex` (CHECK `^#[0-9A-Fa-f]{6}$`)

**Reference categories by `slug`, never by `id`.** The UUIDs are generated per-environment by the seed, so a hardcoded id works in one database and silently breaks in another.

Seeded: Fitness `#FF3131`, Hobbies `#FF8A00`, Career & Professional `#FFD500`, Health & Wellness `#6EE62E`, Finances `#00D9A3`, Productivity & Habits `#1EC8FF`, Mindfulness & Mental Health `#8A4FFF`, Social & Relationships `#F730A8`, Other `#3355FF`.

Colours are bright rather than muted because they eventually render as glowing tints against a dark background, spaced roughly 40° apart on the wheel so all nine stay distinguishable.

Adding a category later is a data insert. **Avoid changing an existing `color_hex`** once goals reference it: `category_id` is a live FK, so a change retroactively recolours everything using it.

### `groups`
- `id`, `name`, `group_status` (enum: `active`, `locked`, `archived`)
- `streak_decision_pending` (bool), `pending_streak_joiners` (jsonb array): see section 13
- `leaderboard_persists_across_cycles` (bool, default `false`), `default_stats_view` (enum): owner-configurable
- `created_at`, `updated_at`

**No `owner_id`, no `deadline`.** Ownership lives only in `group_members` where `role = 'owner'`, guaranteed unique per group by a partial unique index. The active deadline lives on the open `group_cycles` row. Both columns existed and were removed as duplicated state with nothing keeping the copies in sync.

**Archiving is a deliberate act, not only a terminal state.** `archive_circle` is the owner's way out. Before it existed, `'archived'` was written only by `handle_membership_removal` when the last member left, and since the `group_members` DELETE policy is `role <> 'owner'` an owner could never be that last member. A solo owner could not archive, leave, transfer or delete, so every Circle they created and did not fill was permanent.

**Owner succession** (added because removing `owner_id` removed its `ON DELETE RESTRICT`, the only thing preventing an ownerless circle). When an `owner` row is removed, `handle_membership_removal` promotes the **longest-tenured remaining member**, or archives the circle if nobody remains. RLS blocks a normal owner departure, so this fires mainly on account deletion: written defensively because an ownerless circle is unrecoverable and there's no second chance to notice.

### `group_members`
- PK `(group_id, user_id)`: a relationship, so the pair is the identity and duplicates are impossible by construction
- `role` (enum: `owner`, `admin`, `member`), `streak_grace` (bool), `joined_at`, `updated_at`
- Partial unique index on `(group_id) where role = 'owner'`: one owner, structurally
- Separate index on `user_id`: the composite PK serves "who's in this circle" but not "which circles am I in", which is the entire home dashboard

Feed and digest queries join through **current** rows. Someone kicked or departed is structurally excluded from future reads; their `progress_entries` remain for data integrity but nothing surfaces them.

### `group_cycles`
One run of a Circle's challenge, from creation or reset to its deadline.

- `id`, `group_id`, `started_at`, `ended_at` (null while active), `deadline` (null = open-ended, never locks)
- `current_streak`, `longest_streak`: the group streak
- Partial unique index on `(group_id) where ended_at is null`: exactly one active cycle, structurally
- CHECK: streaks non-negative; `ended_at >= started_at`

A circle always has exactly one active cycle; there's no "no cycle yet" state. `create_circle()` inserts the group, the owner's membership, and the first cycle in one transaction.

**On reset**: the current cycle closes (`ended_at` set) and a new row opens. `group_cycle_stats` rows are scoped to `cycle_id`, so new rows start at zero without touching history.

**A member joining mid-cycle** gets a fresh `group_cycle_stats` row for the current cycle, starting at zero: never retroactively scored. **Rejoining the same cycle** reuses the old row, so their streak reflects the gap like any lapse.

### `invite_links`
- `id`, `group_id`, `token` (unique), `enabled` (bool), `expires_at` (nullable), `created_at`
- `created_by` (nullable FK → users, `ON DELETE SET NULL`): the row outlives its creator's account, since it's audit data

Tokens are **server-generated only**: 32 CSPRNG bytes, URL-safe base64 (43 chars), via `create_invite_link()`. Clients hold no insert grant. **Default expiry is 7 days.** Regenerating disables the previous link rather than deleting it.

### `goal_group_visibility`
Hides one goal from one Circle while keeping it visible in others.

- PK `(goal_id, group_id)`, `hidden` (bool, default `false`)

**Sparse: a missing row means visible.** Reads must `LEFT JOIN` and `coalesce(hidden, false)`: a plain lookup returns nothing for the common case, which is easy to mistake for an error.

**`private.is_goal_hidden_in_group()` is the only definition, and both consumers call it.** As of migration 71 it also reads `goals.hidden_everywhere`:

```
hidden(goal, circle) := goals.hidden_everywhere
                        OR coalesce(goal_group_visibility.hidden, false)
```

`circle_roster` returns `photo_url` since **migration 79**, masked like `note` but with no `photo_shared` term, because there is no such flag and there deliberately is not one: a note is a sentence you might not want read, a photo is the proof. **The value is the Storage object key, not a URL** — a boolean would not have worked, since the key is `{user_id}/{goal_id}/{entry_id}` and `entry_id` is returned for your own rows only. A key is a name, not a door: the bucket is private and `checkin_photos_select` still governs every read.

`circle_roster` used to re-implement the sparse join inline. Two copies agreed only while each was one line; adding a term to a rule that lives twice is how a title gets masked on the roster and served with the photo. Do not inline it again.

**`goals.hidden_everywhere` is a column and not a set of rows, and that is forced.** The table is sparse, so "hidden from everyone" written as one row per Circle is only true of the Circles that existed when you said it. Join a new Circle and the goal is visible there, silently, because no row says otherwise.

**Masking never applies to yourself.** Your own row in a roster returns your own titles and notes; `hidden` still reports true so the screen can mark them. Migration 72 fixed this in both consumers, having found `can_view_checkin_photo` hiding a user's own photo from them.

Hiding is display-only. The goal still counts toward daily completion and toward `total_count` on the roster; the accountability math is unaffected. A goal you could hide out of your own denominator is a goal you could quietly abandon.

**Not enforceable in the schema**: nothing prevents a row pairing a goal with a Circle its owner doesn't belong to. Foreign keys can't reach across tables like that, so RLS covers it.

### `progress_entries`
One check-in per goal per day. Daily habits, not arbitrary logging.

- `id`, `check_in_date` (date), `note`, `photo_url`, `created_at`
- `goal_id`, `user_id`: both **nullable**, `ON DELETE SET NULL`
- Unique `(goal_id, check_in_date)`
- CHECK: `note` ≤ 500 chars

`user_id` is denormalized from `goals.user_id` so RLS and rollups filter by user without joining `goals` on the hottest read path. The `validate_progress_entry_owner` trigger rejects any row whose `user_id` doesn't match the parent goal's owner, so the duplication can't drift.

**Why both FKs are nullable**: section 11 requires check-ins to survive account deletion in anonymized form, since other members' historical stats are computed against them. Nullable means "anonymized", never "a live check-in without a goal".

**Anonymized rows are invisible to clients through NULL semantics.** Both RLS predicates evaluate to NULL/false when `user_id` is null, so deleted-account rows are hidden from every client while remaining available to `service_role`. This emerges from three-valued logic rather than an explicit rule: a future rewrite adding a `coalesce` or `IS NOT DISTINCT FROM` would expose them. NULLs also being distinct means anonymized rows never collide under the unique constraint.

**`check_in_date` is computed server-side, not sent by the client.** `private.current_checkin_date()` derives it from the user's frozen `checkin_timezone` under a 2 AM boundary (subtract 2 hours, cast to date), so 01:30 Tuesday resolves to Monday. The INSERT policy requires an exact match and the column is excluded from the UPDATE grant. Without this a client could post backdated check-ins and fabricate an unbroken streak.

**Timezone travel is closed by freezing.** Reading the device's live timezone per request would let a mid-day flight grant a second check-in or skip a day. `checkin_timezone` updates only at a natural rollover via `sync_checkin_timezone()`, which is a **no-op mid-day**. A mid-flight check-in may feel a few hours off until the next boundary, but exactly one window per day is guaranteed.

### `daily_completion`
Derived. Whether a user completed **all** active goals (visible and hidden) that day: the binary the whole streak system rests on.

- PK `(user_id, date)`, `all_completed` (bool)

**Zero-goal days are `false`, not vacuously true and not skipped.** There's no point being in the product without a goal, so a goal-less day is a real failure for both individual and group streaks.

### `group_cycle_stats`
Per-cycle, per-member streaks.

- PK `(cycle_id, user_id)`, with **no `group_id`**: `group_cycles` already determines it. Reach the group through the cycle.
- `current_streak`, `longest_streak_in_cycle`, `updated_at`
- CHECK: non-negative; `longest >= current`

### `group_daily_completion`
Derived, backs the group streak.

- PK `(cycle_id, date)`: **no `group_id`**, same reasoning
- `all_members_completed` (bool): true only if every current non-grace member completed everything

### `group_member_category_stats`
Backs the leaderboard.

- PK `(group_id, user_id, category_id)`: `group_id` **is** load-bearing here; nothing else in the row determines it
- `total_completions`, `total_possible`, `current_streak`, `longest_streak`, `updated_at`
- CHECK: non-negative; **`total_completions <= total_possible`** (a rate above 100% is meaningless, so this catches double-counting at the source); `longest >= current`

### `user_lifetime_stats`
Persists across every cycle and Circle.

- `user_id` (PK), `current_streak`, `longest_streak_ever`, `total_days_completed`, `total_goals_achieved`
- `visible_on_profile` (bool, default `false`): opt-in, and the **only** client-writable column
- `total_goals_achieved` is maintained by `goals_count_achievement` and protected from inflation by migration 83; see `goals.achieved_at` above
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

Every value has a writer. `cosmetic_unlocked` is deliberately absent until the galaxy ships: add the value in one migration, use it in the next.

**`admin_transfer_request` was dropped from this enum.** It implied transfer required the recipient's acceptance, but `transfer_ownership` completes immediately, and automatic succession already assigns ownership without consent when an owner deletes their account, so requiring consent on one path and not the other would have been inconsistent. Removing it meant rewriting the type, which Postgres can't avoid; doing it pre-launch with zero rows was as cheap as it will ever be.

`payload` is an **immutable snapshot**: see the denormalization rule under `users`.

### `push_subscriptions`
- `id`, `user_id`, `endpoint` (**globally** unique: registering twice would double-deliver), `p256dh`, `auth`, `device_label`, `created_at`
- CHECK: `endpoint` matches `^https://`

Jobs fan out to every subscription for a user, covering multi-device installs.

**Written only through `public.subscribe_push` (migration 77).** The global uniqueness that stops double-delivery also makes three ordinary events unreachable from the client: re-subscribing, a second account on a shared browser, and an endpoint rotation. All three need to displace a row, and `authenticated` may UPDATE `device_label` alone and DELETE only its own. The RPC is `SECURITY DEFINER` and takes the endpoint over, which is right: an endpoint identifies a browser, and the browser has just said who is using it. Unsubscribing stays a plain self-scoped delete.

**iOS gap**: web push only works for a PWA added to the home screen (16.4+), and iOS offers no native install prompt. A user who skips it silently gets nothing. Notifications persist in the table regardless, so nothing is lost, but push is what pulls people back, so onboarding must include an explicit add-to-home-screen step.

### `digest_snapshots`
- PK `(group_id, date)`, `summary` (jsonb, immutable snapshot), `created_at`

**This is the record of a day; the notification row is only the envelope.** The day boxes on `/dashboard` read `summary` for the last five days — counts, group streak, and the per-member roll call — and `/circles/[id]?tab=overview` reads the same row for one Circle, so the two cannot disagree.

`summary.members` carries `user_id`, `username`, `completed` and `streak`, **frozen at write time**. A rename does not relabel last Tuesday, which is the point: a digest is a record of how a day went, and on that day that was their name. Every reader parses it defensively — it is jsonb written by a scheduled job, so a shape change would otherwise blank a dashboard silently.

### `content_reports`
- `id`, `content_type` (enum), `content_reference`, `reason` (≤500), `status` (enum), `created_at`, `reviewed_at`, `reviewed_by`
- `reporter_user_id`, `reported_user_id`: nullable, `ON DELETE SET NULL`, because a report must outlive the accounts involved
- CHECK: `reviewed_at >= created_at`; **status/review consistency**: `pending` must have null `reviewed_at`, non-pending must have one. Makes "resolved but no record of when" unrepresentable.
- CHECK: `reporter_user_id <> reported_user_id`
- Index: partial on `(created_at) where status = 'pending'`: the moderation queue

`content_reference` snapshots the flagged content at report time so later edits can't undermine a pending review. Review happens via Supabase dashboard at v1 scale.

### `user_blocks`
- PK `(blocker_user_id, blocked_user_id)`, both `ON DELETE CASCADE`: a block is meaningless once either party is gone
- CHECK: no self-blocking
- Index on `blocked_user_id` for the "who blocked me" lookup that filters invite joins

**Directional.** A→B and B→A are separate rows. Blocking prevents viewing the blocker's profile stats and joining via a link the blocker administers. It does **not** remove anyone from a shared Circle: that's kick's job.

### `audit_log`
**Append-only.** Every FK is `ON DELETE SET NULL`, never cascade: an audit trail that deletes itself when the actor leaves isn't an audit trail. A record with both names nulled still proves the event happened and carries its timestamp.

- `id`, `actor_user_id`, `group_id`, `target_user_id` (all nullable FKs), `action_type` (enum), `metadata` (jsonb), `created_at`
- Index: `(group_id, created_at desc)`

Actions: `member_joined`, `member_left`, `member_kicked`, `ownership_transferred`, `admin_promoted`, `admin_demoted`, `invite_link_toggled`, `invite_link_regenerated`, `group_deadline_changed`, `group_cycle_reset`, `group_cycle_extended`, `group_streak_continued`, `group_streak_reset`, `group_archived`. **All fourteen have a writer**, `group_archived` by `archive_circle` since migration 62.

**Role changes and invite toggles are audited by trigger, not by RPC**, because both happen through a direct `UPDATE` that no function mediates. Without those triggers, `admin_promoted`, `admin_demoted`, and `invite_link_toggled` had no writer at all: a promotion left no trace. **The invite trigger does NOT fire only on a deliberate toggle**, despite what migration 51's comment claims. Its guard is `new.enabled is distinct from old.enabled`, which is also true of the `update ... set enabled = false` inside `create_invite_link`, so a regeneration writes both rows. Confirmed in the audit log on 14 August: two `invite_link_regenerated` rows each carry an `invite_link_toggled` sibling at a byte-identical `created_at`.

**Left as is, because the rows are accurate.** Two things genuinely happened: one link was turned off and another was created. Suppressing the toggle would lose the record of a live credential being killed, which is the more valuable half. What was wrong was the comment.

**So read the trail by timestamp**, not by row. An `invite_link_toggled` with a `invite_link_regenerated` at the same `created_at` is a rotation; one standing alone is a deliberate revoke. Archiving also produces a lone toggle, alongside `group_archived`, because `trg_disable_links_on_status_change` is what kills the link.

`member_joined`/`member_left` were added after noticing only *kicks* were audited. `group_members.joined_at` answers "when did they join" only while they're still a member and vanishes when they leave, so membership history has to outlive membership.

Deliberately **not** duplicated here: `content_reports` resolution (that table carries its own `status`/`reviewed_at`/`reviewed_by`) and username changes (`username_history`).

### Cross-cutting conventions

- **`updated_at`** on every mutable table, maintained by a shared `set_updated_at()` BEFORE UPDATE trigger so it can't be forgotten at a call site. Append-only tables have `created_at` only.
- **Trigger functions are not API endpoints.** Anything in `public` is published at `/rest/v1/rpc/<name>`. Trigger functions have `EXECUTE` revoked from `anon`, `authenticated`, and `public`; triggers run as the table owner and ignore grants, so revoking costs nothing.
- **Every function pins `search_path = ''`** and fully qualifies references. `SECURITY DEFINER` only where genuinely required.
- **Never compare or order by an enum.** Postgres allows it, using *declaration order*, which is an accident of how the type was written, and `ADD VALUE` appends, so `member_joined` now sorts after `group_streak_reset`. If a status ever needs meaningful ordering, that's the signal it should be a lookup table with an explicit `sort_order`, like `goal_categories`.
- **Adding an enum value and using it must be separate migrations.** Postgres rejects using a new value in the transaction that added it.
- **Every `CREATE TABLE` must be followed by an explicit `ENABLE ROW LEVEL SECURITY` in the same migration.** The project's "Enable automatic RLS" setting does this via an event trigger, but that trigger is created by the dashboard and exists in no migration. For 56 migrations nothing enabled RLS explicitly: a rebuild into a fresh database produced 21 tables with RLS **off** and all 41 policies present but inert, which with `authenticated` holding real grants meant a wide-open database. Found the first time `supabase db diff` replayed the history into a shadow database. The dashboard setting stays on as a safety net; the migration history has to stand alone.

- **Never depend on a platform-created object without guarding it.** Migration 17 revoked `EXECUTE` on `public.rls_auto_enable()`, which the dashboard creates. In a shadow database that function doesn't exist and the unconditional `REVOKE` aborted the whole replay. It's now wrapped in an existence check. Anything owned by Supabase rather than by this history: `rls_auto_enable`, vault secrets, project settings: needs the same treatment.

- **Count-based caps lock the parent row first.** The 10-member and 10-active-goal caps can't be CHECK constraints since they require counting other rows. A naive count-then-decide trigger is racy: two simultaneous joins to a 9-member circle both read 9 and both insert. Each cap does `SELECT ... FOR UPDATE` on the parent (the group, or the user) before counting, serializing writes *for that parent only* so different circles never block each other.

### Length and format constraints

| Field | Rule |
|---|---|
| `users.username` | 3–30 chars, `^[A-Za-z0-9_]+$`: ASCII only, blocking unicode-lookalike impersonation |
| `users.display_name` | 1–50 after trimming; whitespace-only rejected |
| `goals.title` | 1–100 |
| `progress_entries.note` | ≤ 500 |
| `groups.name` | 1–50 |
| `content_reports.reason` | ≤ 500 |
| `push_subscriptions.device_label` | ≤ 50 |

The `obscenity` profanity filter for usernames and Circle names stays in the app layer: it needs a maintained wordlist and obfuscation detection that doesn't belong in a CHECK. These constraints are the floor beneath it, not a replacement.

---
