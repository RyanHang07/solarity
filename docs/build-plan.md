# Solarity: Build Plan

**Open work only.** Finished steps and their reasoning live in `history.md`; this file is read daily and should stay short.

| You want | Read |
|---|---|
| How it works now | `architecture/` |
| What keeps going wrong | `patterns.md` |
| How to run or verify it | `testing.md` |
| Designed but not built | `deferred.md` |
| Why a past decision went that way | `history.md` |

---

## The core loop

Finish this before the public surface. The backend for every step is built and tested, so it is UI over a known-good foundation — and it is the only work that tests the product's premise.

Ordered so the app works **alone** before it works **together**: streaks can be proven with one account, invites need two.

| # | Step | State |
|---|---|---|
| 1–7 | Auth, Circles, goals, check-ins, the Circle page, invites | ✅ 12–14 Aug |
| 8 | Seeing each other | ✅ 17 Aug, migrations 68–75 |
| 9 | The daily check-in flow | ✅ 18 Aug, migration 76 |
| **10** | **Install nudge, then push permission** | built and audited. **Open: the manual pass, on a phone** |
| 11 | Digest boxes on Overview | planned in full; starts once the pass is clean |
| 12 | Security headers | |
| 13 | Check-in photos | split out of 9; schema exists since migration 64 |

**Step 8 shipped** the `Today` roster, note sharing, goal hiding, the dashboard tabs, notifications, settings, and refresh-on-return. Eight migrations and six product bugs, all in `history.md`.

---

### 9. The daily check-in flow ✅ **done** — migration 76

`/today` greets an unfinished day with your streak, the goals still open, and nothing else. Detail and reasoning in `history.md`.

| Piece | |
|---|---|
| 9a | `users.today_screen_mode`, and the settings control |
| 9b | The route, the gate on `/dashboard`, and the two cookies |
| 9c | Streak header, including a broken run |
| 9d | Check off goals, reusing `TodayPanel` |
| 9e | Hand-off, and the skip link |

**Audited against all twenty patterns.** Every symbol the step added has both a reader and a writer; `anon` still reaches only `circle_preview`; no orphaned notifications, stray Circles or stray goals. Two things it changed about the suite are recorded in `testing.md`.

### 10. Install nudge, then push permission — built, **awaiting its manual pass**

Onboarding gained two screens after the username: add to home screen, then notifications. Settings gained a per-device toggle, the service worker repairs a rotated subscription, and the notifications tab carries one dismissible line for people who never decided.

**Every piece is built, tested and audited.** The reasoning for each — and the six product bugs found on the way — is in `history.md`.

| Piece | | Migration |
|---|---|---|
| 10a | `subscribe_push`, and the actions that call it | **77** |
| 10b | Install nudge, branching on platform | no |
| 10c | The permission screen, the only place the app asks | no |
| 10d | Settings toggle for this device | no |
| 10e | `RESUBSCRIBE_PUSH` repairing a rotated subscription | no |
| 10f | The dismissible nudge on the notifications tab | no |

**74 Chromium tests and 6 in WebKit at iPhone size.** What they deliberately cannot reach: a real permission dialog, a real push delivery, and anything about a notch. All three are below.

---

#### The manual pass — the open work

**This is the current step.** Everything in 10 is written; none of it has met a real phone.

The permission dialog is the one thing in this codebase that cannot be undone by shipping a fix: one ask per browser, and a denial is permanent until the person changes a browser setting themselves. Playwright can grant a permission to a context and headless Chromium reports it denied anyway, never drawing the dialog, so no test in this suite can tell you whether the moment reads well.

What the pass covers, on an actual device:

| | Check |
|---|---|
| iOS | The Share-sheet instructions match what the current iOS actually shows, and installing then produces a working push subscription |
| Android or desktop | `beforeinstallprompt` fires, the button replays it, and declining the install leaves onboarding finishable |
| Both | The explanation before the prompt is convincing enough to earn a yes, since a reflexive no is permanent |
| Both | Skipping both screens leaves a fully usable account |
| Settings | The toggle turns it on and off, and a denied browser shows the generic sentence with working help links |
| Layout | Nothing sits under the camera housing or the Dynamic Island, portrait **and** landscape, and the home indicator does not overlap the bottom. `env(safe-area-inset-*)` is 0 in every headless browser, so this can only be seen on hardware |
| Goal form | The category wheel commits what it displays, including tapping Done without spinning |

**The checkpoint was originally placed after 10d**, on the reasoning that 10e and 10f were only worth building once the flow read well. They were built first because they are small and because the suite could prove their invariants without a device — but that decision does not move the checkpoint, it only means more code is now resting on an unverified moment.

**Until this pass is done, step 11 waits.** Not because it depends on step 10 — it does not — but because a permission dialog is the one thing in this codebase that shipping a fix cannot undo, and the fastest way to spend that mistake is to move on to the next feature and forget.

---

### 11. Digest boxes on Overview

One box per day, newest first, five days. Each box lists the Circles that reported that day, and each Circle names **who finished and who did not**.

**And digests leave the Notifications tab entirely.** That tab keeps the four types that are events rather than summaries: kicked, invite accepted, cycle finished, deadline changed. Today digests are 69 of the 70 rows there, so the four things that might need a response are buried under a week of routine.

#### The data is already there, which changes the whole shape of this step

`digest_snapshots.summary` has carried a per-member roll call since it was written:

```json
{ "members": [ { "user_id": "…", "username": "ryahn2", "completed": false, "streak": 0 } ],
  "completed_count": 0, "member_count": 1, "group_streak": 0 }
```

**No migration.** Nothing needs a new writer, a new column or a backfill. `summary.members` is denormalised at write time on purpose, so a past day keeps the usernames and streaks it had — a rename does not silently relabel last Tuesday.

Two consequences worth stating before anything is built:

| | |
|---|---|
| Access | `digest_snapshots_select_member` is `is_group_member(group_id)`, and the roster already shows who has checked in. Naming members here exposes nothing new |
| Masking | Completion is a count, never a goal title. `hidden_everywhere` goals still count toward a member's day, and nothing in this view can leak one |

#### Decided

| Question | Decision |
|---|---|
| "Only five" | **Five day boxes.** Every Circle that reported appears inside its day |
| Where digests live | **Overview only.** The existing "latest per Circle" panel becomes this |
| Where the other four live | **Notifications tab only**, as the flat list they already are |
| Progress | **Counted in members**, and named: who finished, who did not |
| How much detail | **All of it, most of it folded away.** Build the whole thing now and hide it, rather than returning to add a field at a time |
| A Circle with no report that day | **Omitted from that box.** "No digest" almost always means no cycle was running |

#### Two levels, and everything is in the markup either way

**Collapsed** is one line per Circle: the name, `2 of 3 finished`, and the Circle's streak.

**Expanded** is a `<details>` in the same row, holding what the snapshot already knows:

| Shown when opened | Source |
|---|---|
| Every member, marked finished or not | `members[].completed` |
| Each member's streak that day | `members[].streak` |
| Your own row, marked as yours | `members[].user_id` against the session |
| Whether the Circle's streak moved since the day before | the adjacent day's snapshot, already loaded |

`<details>` rather than React state, the same choice as the goal visibility panel: it needs no client component, it survives with JavaScript off, and the content is in the document for search and for screen readers rather than conjured on click.

**The streak delta is free and worth having.** Five days are loaded already, so comparing a Circle's `group_streak` against the previous box costs one lookup and answers the question a streak number cannot: whether it went up, held, or reset.

#### The shape of the read

Five *days*, not five rows. `digest_snapshots` is keyed `(group_id, date)`, so five days across N Circles is up to 5N rows.

| Option | Why not |
|---|---|
| One query per Circle, `limit 5` | What the current panel does with `limit 1`. Ten Circles, ten round trips |
| Filter on a date range | A quiet week returns three days rather than five, and the panel silently shows less than it promises |

**One query, `.in("group_id", …).order("date", desc).limit(circles × 5)`, grouped by date in TypeScript, then the first five dates.** At most one row per Circle per date, so `circles × 5` rows guarantee five distinct dates whenever five exist. PostgREST has no `DISTINCT ON`, and this needs no view.

**`summary` is read defensively**, as the current panel already does: it is jsonb written by a job, so a shape change ships silently. A missing `members` array degrades to the counts, not to a blank dashboard.

#### The sharp bit: a badge for rows the tab no longer shows

`markNotificationsRead` marks **everything** unread, and the badge counts everything unread. Move digests off that tab and one of two things breaks quietly:

- the badge counts digests nobody can reach from it, so it never clears
- or the tab marks digests read on open, claiming you read something it deliberately did not show

**Whoever displays a row marks it read.** Overview marks digests once the boxes render; Notifications marks the other four; the badge counts the four. `markNotificationsRead` takes a set of types, and `read_at` stays meaningful for digests rather than becoming a column with a writer and no reader.

#### The trap this must not fall into

`digest_snapshots.date` and `payload.date` are **plain dates**, not timestamps. `new Date("2026-08-18")` parses as UTC midnight and formats in the viewer's zone, so anyone west of UTC reads every box as the day before. Formatting is UTC-pinned, the way `shiftDate` in `lib/supabase/today.ts` already is.

#### Pieces

| | Piece | Migration |
|---|---|---|
| 11a | The five-day read, and `DigestPanel` becomes day boxes with the collapsed line | no |
| 11b | The expanded roll call: members, their streaks, your own row, the streak delta | no |
| 11c | Digests out of the Notifications tab and out of its badge | no |
| 11d | Per-surface mark-read, and Overview marking digests | no |

**11c and 11d ship together.** Either alone leaves the badge lying in one direction or the other.

#### Test plan

- **11a**: boxes are dated, newest first, never more than five; a Circle appears under each day it reported; a renamed Circle shows its **live** name in the heading; no digests at all still says so rather than rendering an empty frame.
- **11a, the date**: seeded rows render the date they name, asserted from a context pinned to a zone behind UTC. The one that catches the parse trap, and it is cheap.
- **11b**: a seeded day with one member finished and one not names both, on the right sides; the viewer's own row is marked; a snapshot with no `members` key still renders its counts.
- **11b, the freeze**: renaming a member after the snapshot leaves the old username in the roll call. That is the denormalisation working, and it is worth a test because it looks like a bug to anyone who has not read `build_daily_digests`.
- **11c**: the Notifications tab lists none of the seeded digests, and does list a seeded `invite_accepted`.
- **11d**: opening Notifications leaves seeded digests unread; opening Overview marks them read; the badge ignores digests.

#### Still open

- Whether the collapsed line gets a progress bar as well as `2 of 3`. Text first: it is the part that has to be right, and a bar is styling over the same two numbers.
- Whether an archived Circle's old digests still appear. They do today, via `[...active, ...inactive]`, and keeping that is the smaller change.

### 12. Security headers

CSP with a nonce-based `script-src`, HSTS, `nosniff`, `Referrer-Policy`.

### 13. Check-in photos

**Split out of step 9**, because it is a subsystem rather than a field and bundling it would mean `/today` shipping only when the hardest part did.

**What already exists:** the storage buckets, their policies, and `private.can_view_checkin_photo` — which since migration 72 also exempts you from your own masking, and since 71 reads `goals.hidden_everywhere`.

**What does not:** any upload UI. `browser-image-compression` has been a dependency since the start and has never been imported. Migration 64 tightened `checkin_photos_insert` to require `owns_active_goal`, so the insert path has narrowed since the policy was written and has never been exercised by a real client.

**Open questions when it starts:** capture versus file picker on mobile, where compression runs, the storage path convention, and what happens to a photo when its goal is archived.

---

## Running in parallel

Independent of everything above, cheap, and it unblocks the Google consent screen.

- `/privacy` and `/terms` as static pages
- `app/robots.ts` and `app/sitemap.ts`

`sitemap.ts` **must exclude `/join/*`**: invite tokens are bearer credentials and have no business in a crawler log.

Copy gets drafted from the architecture, so it describes what the system actually does: 90-day photo retention, check-ins anonymized rather than deleted, what `export_user_data` returns. Not legal advice; review before real users.

---

## Deferred inside the loop

Two things left out of steps 3 and 4 on purpose.

### Achieving a goal → after step 5

Achieving moves the check-in denominator exactly as archiving does. Adding it before the first streak exists means debugging two denominator-movers at once, against a baseline that has never produced a correct number.

It is also unverifiable before then: `goals_count_achievement` feeds `total_goals_achieved`, which nothing reads until `/profile/[username]` exists.

The follow-up prompt (archive, edit into a new goal, or keep it active) lands with the same work.

### Goal deadlines → after a type change

Buildable now. `<input type="date">` is native everywhere and needs no library, so the earlier "that's design work" objection was wrong.

**The column is the obstacle.** `goals.deadline` is `timestamptz` and a date input submits `YYYY-MM-DD`, which stores as midnight **UTC**. Someone in `America/Los_Angeles` picks 1 September and sees 31 August when it renders back, and it looks like a bug in the picker rather than in the schema.

A goal deadline is a **calendar date, not an instant**. Postgres `date` has no timezone semantics, so the error class stops existing rather than being handled.

Cheap: zero rows today, and `export_user_data` is the only reader. Should land before anything writes to the column.

**Two design notes when it is built:**

- **Do not default to today.** The column is nullable on purpose; most daily goals have no end date. Defaulting turns an opt-in field into an opt-out one and produces goals that look overdue tomorrow.
- **No `min` attribute.** Architecture section 3 keeps this deliberately unconstrained, since recording a missed or historical deadline is legitimate.

---

## Route map

Every route the app will have, and where each stands. **Orphaned** means the backend implements it and nothing in the app links to it.

### Public

| Route | Status | Notes |
|---|---|---|
| `/` | built, placeholder | Landing. Redirects signed-in visitors to `/dashboard`. Also renders `Notice`, since a signed-out visitor with a dead invite link lands here. Needs real content; see Deferred. |
| `/auth/sign-in` | built | Google only so far. Gains a password form. |
| `/auth/callback` | built | OAuth code exchange. |
| `/auth/error` | built | Gains cases for expired and reused confirmation links. |
| `/auth/sign-up` | deferred | Email, password, username, name, terms, Turnstile. |
| `/auth/check-email` | deferred | Post-signup holding screen. Resend, spam-folder line, and a route back to sign-in. |
| `/auth/confirm` | deferred | Route handler calling `verifyOtp`. |
| `/auth/forgot-password` | deferred | Always reports success. |
| `/auth/reset-password` | deferred | Reached only with a recovery session. |
| `/privacy` | in parallel | **Required** for the Google OAuth consent screen. |
| `/terms` | in parallel | Versioned. |
| `/support` | deferred | FAQ plus contact form. |
| `/join/[token]` | built | Preview works **signed out**; join requires sign-in. A dead link redirects to `/dashboard` or `/` with a notice rather than 404ing. `robots: noindex`. Still to exclude from `sitemap.xml`. |
| `robots.txt`, `sitemap.xml` | in parallel | `app/robots.ts`, `app/sitemap.ts`. |

### Signed in

| Route | Status | Backed by |
|---|---|---|
| `/onboarding` | built | `complete_onboarding`. Gains the terms checkbox, then the install nudge and push prompt. |
| `/dashboard` | built | Check-in panel, goals, Circles with archived beneath. Still to gain: Overview and notifications subtabs (step 8). |
| `/circles/[id]` | built | Header, deadline, group streak, Members and Overview tabs, owner streak-decision banner. Closes the `sw.js` deep link. |
| `/circles/[id]/settings` | built | Invite link, revoke, regenerate, archive. Still to gain: deadline, roles, and the kick flow's "also block?" step. |
| `/notifications` | orphaned | `notifications`. The durable channel; push is best-effort. |
| `/profile/[username]` | orphaned | `user_lifetime_stats.visible_on_profile`. Where blocking lives. |
| `/settings/profile` | orphaned | Rename path. Must surface *when* the next rename is allowed, not just refuse. |
| `/settings/notifications` | orphaned | `push_subscriptions`. Per-device list; natural home for the push opt-in. |
| `/settings/account` | orphaned | `export-data` and `delete-account` Edge Functions. Both deployed and verified, neither has UI. Self-serve deletion is an Apple requirement for any future store submission. |

### Protection

`lib/supabase/proxy.ts` currently treats `/auth`, `/_next`, `/`, and `/join` as public. Three more public prefixes are coming, so extract a `PUBLIC_PREFIXES` constant rather than growing the inline boolean.

Keep the posture deny-by-default: enumerate what is *public*, so a forgotten route fails closed as a redirect to sign-in. Enumerating what is protected means a forgotten route fails open, silently.

---

---

## Open items

### Blocking

- **Migration workflow, undecided.** Schema changes currently go straight to the project, which drifts from the repo. Either continue and re-run `npx supabase migration fetch` afterwards, or write files into `supabase/migrations/` and `npx supabase db push`. The second gives review over schema changes, and the deferred signup work adds two migrations, so this wants deciding before then.

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
- Invite failures return machine codes (`INVITE_EXPIRED`, `CIRCLE_FULL`, and so on). Branch on those, not message text. `architecture/app.md` section 10.
- Streaks lag a day by design. Display `current_streak + (1 if today complete)`.

---

---

## Gotchas

**A client-generated timestamp can be in the future as far as Postgres is concerned.** `goals` carries `CHECK (archived_at <= now())` and `CHECK (achieved_at <= now())`, evaluated against the **database** clock. `archiveGoal` sends `new Date().toISOString()` from the Next.js server, so any clock skew larger than the network latency is refused with a bare `23514` and no hint, which `toMessage` renders as "That value isn't allowed."

Found by the e2e suite, whose helper hit it with roughly 200ms of skew. The production risk is small, because the write travels *after* the timestamp is taken and latency pushes `now()` forward, so the client has to be ahead by more than the round trip. Small is not zero, and the failure would be baffling in a support conversation.

**The real fix is for the database to set it**, via a trigger on the transition to non-null, so no caller can get it wrong. Deliberately not patched by subtracting a second in the app: that hides the class of bug rather than removing it, and the same mistake is available to every future column with a `<= now()` check.

`archive_circle` is unaffected: it uses `now()` in SQL.


- `.rpc()` is lint-banned outside `app/actions/`. A direct call skips rate limiting and the profanity filter.
- Never hand-trim `lib/database.types.ts`. Dropping the `Relationships` arrays makes every embedded join a type error.
- **Regenerate the types with `Out-File -Encoding utf8`, not `>`.** PowerShell's redirect writes UTF-16LE. `tsc` accepts it silently; ESLint stops dead on `Parsing error: File appears to be binary`, and the header comment at the top of the file disappears without trace. Encoding is the first thing to check when a generated file lints as binary.
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

---
