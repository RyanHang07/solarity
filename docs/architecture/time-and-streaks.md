# Time, streaks and scheduled work

The 2 AM boundary, what is derived versus stored, the daily digest, group lifecycle, and the cron jobs that drive all of it.

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

**Deliberate limitation**: it evaluates active goals as of *now*, not as of the target date. Correct for today, the only date it's called with, but it must never backfill history: a goal archived since would be wrongly excluded from a past day it was part of.

### Rollover: `run_daily_rollover(date)`

Not client-callable. Anyone who could invoke it could advance their own streaks.

Per user, for the day just ended: finalize `daily_completion` (creating the row for someone who never checked in), extend or reset `current_streak`, raise `longest_streak_ever`, increment `total_days_completed`, update `group_cycle_stats` for every active cycle.

Per active cycle: `group_daily_completion` holds only if every **non-grace** member completed everything.

**Leaderboard counters move only here, and always together**: each active goal adds 1 to `total_possible`, and 1 to `total_completions` only if checked in. That's why `completions <= possible` can never be transiently violated; incrementing completions live on check-in would break it on a user's first day.

Finally, circles past their deadline flip to `locked`.

**Streaks lag one day by design**: a day is not final until it is over. To include today, compute `current_streak + (1 if today is complete)` at display time rather than storing it.

**Not idempotent for streaks.** `daily_completion` and `group_daily_completion` recompute identically, but streak counters are incremental: running twice for the same date double-counts. **The scheduler must not retry blindly.**

---

---

## 7. Daily digest

Split into two independently retryable halves, because they need different runtimes and have different failure modes.

**`build_daily_digests()` (SQL)** computes each Circle's summary for its own previous day and writes `digest_snapshots`. That single row is what makes the Overview subtab work. Idempotent: it skips any Circle already holding a digest for the target date, so an extra run duplicates nothing.

**It writes no notification rows, since migration 112.** It used to fan out one `notifications` row per member per Circle — a copy of the snapshot, addressed to a person, so the sender could find it. That row was rendered nowhere after step 11c and existed only to be found.

**`send-digest-push` (Edge Function)** delivers web push, from two sources:

| Source | Delivery record |
|---|---|
| `notifications`, for the event types | `pushed_at` on the row |
| `digest_snapshots`, for digests | a row in `digest_pushes` |

VAPID signing needs the `web-push` package, so it cannot live in Postgres. Separating build from send means a push outage never blocks the in-app digest, and either half can be re-run without corrupting the other.

**`notifications.pushed_at`** tracks delivery, distinct from `read_at`: one is our action, the other the user's.

### What reading snapshots directly changed

**The audience is resolved at delivery time.** The old fan-out froze it when the snapshot was written, so somebody who joined overnight never got that day's digest and somebody who left still had a row addressed to them. The sender reads live membership, so both work now — neither was the point of the change.

**A window had to be invented, and the old design could not have needed one.** A notification row existed or it did not, and retention eventually removed it. Reading snapshots means a Circle whose members all lacked a subscription for a week would deliver seven days of "yesterday" the moment one appeared. `DIGEST_WINDOW_DAYS = 3` covers a scheduler that missed a run or two; older than that is not news.

**The delivery record is written even for accounts with no subscription**, matching what `pushed_at` already did for events. Without it, every member without a device would be reconsidered on every run for three days.

### What did not change

**Teaser payloads only.** iOS truncates long bodies, and a detailed body risks surfacing hidden-goal-adjacent information on a lock screen, outside the app's access controls entirely. One notification per Circle per user, never one combined across Circles.

**Circle names reach lock screens as of 10g, behind a setting**, and the older note here saying they were "deliberately kept out of push bodies" described the state before that. `users.push_shows_circle_name` decides, defaulting to on; without a name, four Circles produce four notifications that read identically, which was step 10's one real manual-pass finding. **A goal title still never reaches a body, ever.**

The sender has a teaser per notification type, with a generic fallback. **Adding a notification type means adding a teaser case**, or it silently ships as "You have a new notification".

**A user with no push subscription is not a failure.** On iOS push works only for an installed PWA, so many users legitimately have none. Those are marked delivered rather than retried forever; the durable channel is the in-app row, or — for a digest — the snapshot, which was always the record.

**Dead subscriptions are pruned.** A 404 or 410 from the push service means the browser permanently discarded that subscription. Deleting those rows is required maintenance, not an optimization: otherwise they accumulate and every future send retries them.

---

## 8. Group lifecycle

- A Circle with no deadline never locks.
- **The deadline date is the last playable day.** A deadline of March 15 means March 15 is fully playable and the Circle locks at the 2 AM rollover on the 16th, evaluated by the same job as everything else rather than at an arbitrary wall-clock moment.
- **Changing a deadline mid-cycle**: `set_circle_deadline(group_id, deadline)`, owner or admin. Sets, moves, or clears the active cycle's deadline. **Minimum is the next day in the Circle's timezone**; `NULL` goes open-ended, which is always allowed since it only ever gives people more time. Evaluated against `circle_checkin_date()`, the same basis as locking, so a deadline can never land on a day already underway.

  This replaces an earlier two-day-notice rule that was specified but never implemented. Under it an open-ended Circle could **never** gain a deadline, and shortening one required a cycle reset that wipes every member's per-cycle stats.

  The next-day floor keeps the protection that mattered, which is that an owner cannot end a cycle out from under people mid-day, without the rest.

  **Every other member is notified** (`deadline_changed`), with the actor excluded: the notice rule protected against surprise through delay, and this restores that protection through information. Re-submitting the same value neither audits nor notifies, so a double-tap does not spam the Circle.

  `cycle_continue` still only extends or clears, since it exists for the renewal prompt rather than general editing.
- On lock, check-ins stop and members see a summary screen. The owner or an admin chooses:
  - **Continue**: keep history, extend or clear the deadline.
  - **Reset**: close the cycle, open a new one, zero `group_cycle_stats`. `user_lifetime_stats` is unaffected.

**Group list display**: `locked` and `archived` Circles move to an Archived section rather than disappearing. A user setting toggles whether that section shows at all, defaulting to on. The two states differ: `locked` awaits a renewal decision, `archived` is retired, and only freshly locked Circles get the summary screen.

---

---

## 13. Group streak & leaderboard

The group streak holds only when **every current member completes every one of their active goals** that day. One member with no goals breaks it for everyone: the same principle as the zero-goal rule.

### New-member grace

A brand-new member almost certainly has zero goals on day one, so joining an active streak would break it immediately and make joining feel punishing.

- Joining a Circle with `current_streak > 0` sets `group_members.streak_grace`. While flagged they're excluded from evaluation entirely: neither breaking nor extending the streak.
- The Circle is flagged `streak_decision_pending`, with `pending_streak_joiners` accumulating everyone who joins meanwhile, so multiple joins produce one decision rather than one prompt each.
- The **owner** (not an admin: it's a judgment call about the Circle's standards) calls `resolve_streak_decision(group_id, continue)`: **continue** clears grace and leaves the streak, **reset** zeroes the streak and clears grace so there's no punitive gap. Either way grace ends and the joiners count from then on. Logged as `group_streak_continued` or `group_streak_reset`.
- If the owner never decides, grace persists with no penalty and the streak keeps accruing on everyone else.

**Grace is the correct default and both alternatives are worse.** Defaulting to counted means a new member with no goals breaks everyone's streak on day one, so joining becomes a punishment. Defaulting to reset destroys a streak nobody agreed to destroy. There is deliberately no timer: grace persisting is harmless, whereas a job that silently reset a streak after N days would be a worse surprise than the decision never being made.

**The state must be visible to everyone, not merely actionable by the owner.** The original bug was not the default, it was that nothing surfaced the state at all. The owner sees the decision and its two buttons; other members see that the joiner is not yet counted. A correct default nobody can see is the same failure wearing different clothes.

**This flow had no implementation until an audit found it.** `join_circle` set both flags and nothing cleared either, so a member flagged on join was excluded from the group streak **permanently**: no error, no visible symptom. It is the clearest instance of the pattern this schema is most prone to: a state with a setter and no resolver.

### Leaderboard

Three ranking dimensions from `group_member_category_stats`:

- **Completion rate**: `total_completions / total_possible`, both accruing from `joined_at` rather than Circle creation.
- **Group streak**: a single value for the whole Circle, shown alongside the per-user breakdown.
- **Daily goals completed**: raw `total_completions`, sortable independently of rate.

**Persistence across cycles**: `leaderboard_persists_across_cycles`, owner-configurable, **default `false`**. When true, stats and the group streak survive a reset; when false, both zero out.

**Reset on kick**: a kicked member's stats zero out entirely, and stay zero if they rejoin. Being kicked costs standing. Their `progress_entries` are untouched.

---

---

## 12. Scheduled jobs

Scheduled with **pg_cron**, which runs inside Postgres: no network hop, no shared secret, and no deployed app needed for the SQL jobs.

| Job | Schedule | Kind |
|---|---|---|
| `solarity-rollover-hourly` | `5 * * * *` | SQL: `run_daily_rollover()` |
| `solarity-digest-daily` | `20 * * * *` | SQL: `build_daily_digests()` |
| `solarity-push-delivery` | `25 * * * *` | Edge: `send-digest-push` |
| `solarity-retention-daily` | `30 4 * * *` | SQL: `run_retention_sweep()` |
| `solarity-photo-purge-daily` | `45 4 * * *` | Edge: `purge-expired-photos` |

The digest and push jobs run hourly despite being "daily" work. Both are idempotent and self-skipping, and hourly means a Circle's digest lands soon after *its own* day ends rather than at one global moment.

Push delivery is hourly regardless, since notifications also come from immediate events like kicks and renewals, not just the digest.

**Edge Function jobs read their secret from Vault, not from the job command.** A secret in `cron.job` sits in plaintext for anyone with database access. `private.invoke_edge_function()` pulls `cron_secret` and `project_url` from `vault.decrypted_secrets` and calls via `pg_net`. If either is missing it logs a warning and no-ops rather than hammering the endpoint with unauthenticated requests, and the functions themselves also fail closed, so that's two independent guards.

**Vault setup required before the two Edge jobs do anything:**

```sql
select vault.create_secret('<your CRON_SECRET>', 'cron_secret');
select vault.create_secret('https://wyuadcnrxisqmzygzhzd.supabase.co', 'project_url');
```

**The rollover must run hourly, not daily.** "2 AM local" happens at 24 different UTC moments, so a single daily run would process most users at the wrong time.

**A Circle's day follows its owner's timezone**, via `private.circle_checkin_date()`. Members can span timezones and there's no single correct "yesterday" otherwise. Quirk worth knowing: transferring ownership across timezones shifts the Circle's boundary. Rare and harmless, but it's a real consequence of the rule.

**Idempotency is guarded by `users.last_rollover_date` and `group_cycles.last_rollover_date`.** Running hourly guarantees repeat visits, and streak counters are incremental, so without these a user would be counted multiple times per day. Repeat runs now process zero rows: verified across three consecutive invocations.

**Passing an explicit date bypasses both guards.** That's deliberate, for backfill and testing, and it *will* double-count if that date was already processed. Scheduled invocations must pass no argument.

---

---

## The check-in screen, and what it derives

`/today` shows an unfinished day. Two facts it needs are **not stored anywhere**, and both are recovered from `daily_completion`:

| Fact | Where it comes from |
|---|---|
| Today's streak | `user_lifetime_stats.current_streak` **plus today**, added at display time. Never stored: today is reversible until the day ends |
| The streak that just broke, and its length | Walked backwards through `daily_completion`, bounded at 400 rows. `current_streak` is already 0 by then and the rollover recorded nothing about what it zeroed |

**Both screens read through `lib/supabase/today.ts`.** `/dashboard` and `/today` render the same panel; two implementations of "what is checked off, and what does that make the streak" would drift.

**Dates are parsed as UTC on both sides of the wire.** A check-in date has already been resolved into the user's timezone by `current_checkin_date()`, so `new Date("2026-08-17")` read as local time re-applies an offset and names the wrong day for anyone west of UTC.

### The gate

Lives on `/dashboard` and nowhere else. `/today` is inside `(app)`, so a condition in that layout would fire on `/today` itself; `/onboarding` escapes the existing gate only because it sits outside the route group.

| `today_screen_mode` | Marker |
|---|---|
| `once_daily` (default) | `solarity_today_seen`, holding the **check-in date** it was set for |
| `every_open` | `solarity_today_session`, no `maxAge` |
| `never` | none written, and none read |

**The day marker stores a date, not a timestamp**, so a skip at 01:00 still holds at 01:30 and releases at the 2 AM rollover rather than at midnight.

**Marked seen on show, not on dismiss.** Cookies cannot be written during a render, so the page paints and a client component fires a server action. Writing it from the skip link instead would let the back button bounce you straight back in.

**The marker is a cookie, not a column**, deliberately: it is a device fact, and a column would mean a write during a page render. The cost is seeing the screen once per device per day.
