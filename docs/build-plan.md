# Solarity: Build Plan

**Open work only.** Finished steps and their reasoning live in `history.md`; this file is read daily and should stay short.


| You want                          | Read            |
| --------------------------------- | --------------- |
| How it works now                  | `architecture/` |
| What keeps going wrong            | `patterns.md`   |
| How to run or verify it           | `testing.md`    |
| Designed but not built            | `deferred.md`   |
| Why a past decision went that way | `history.md`    |


---

## The core loop is closed

**Steps 1 to 13 are built.** Every reason and every bug is in `history.md`; this table is the index.

| # | Step | State |
|---|---|---|
| 1–7 | Auth, Circles, goals, check-ins, the Circle page, invites | ✅ 12–14 Aug |
| 8 | Seeing each other | ✅ 17 Aug, migrations 68–75 |
| 9 | The daily check-in flow | ✅ migration 76. `/today`, the gate, the streak header |
| 10 | Install nudge, then push permission | ✅ migrations 77–78. **Manual pass done on an iPhone**; its eight flows are kept in `history.md`, because a permission dialog is one-shot per browser |
| 11 | Digest boxes on Overview | ✅ no migration. Five day boxes, a per-Circle roll call, digests out of the Notifications tab |
| 12 | Security headers | ✅ no migration. Nonce CSP, HSTS, `Permissions-Policy`. **`E2E_PROD=1 npm run test:e2e:ios` before any deploy**: the dev CSP is not the one that ships |
| 13 | Check-in photos | ✅ migrations 79–82. **Manual pass complete on a real iPhone**, including portrait EXIF orientation and a HEIC from the camera roll. **JPEG, not WebP** — Safari cannot encode WebP |
| **14** | **What the loop deferred** | **current**. Dashboard latency, the stale graph, achieving a goal, goal deadlines, account deletion |
| 15 | Profiles, and the moderation surface they carry | `/profile/[username]`. Brings `user_blocks`, `content_reports` and the `report` rate limit their first caller |

**What that means.** A person can sign in, set goals, check them off with a note and a photo, invite friends into a Circle, see who finished today, keep a streak, get a push when it matters, and read a five-day digest. **The premise the product exists to test is now testable.**

**What it does not mean.** Nothing has shipped to anyone yet. The rest of this file is what stands between here and that.

---

## 14. What the loop deferred — **current**

Four things that were correct to postpone and are now the cheapest work left. In order:

| Piece | |
|---|---|
| ~~14a~~ | ✅ **done.** Dashboard latency: skeletons, per-view reads, route segments |
| 14b | Regenerate `graphify-out/`. Built at `e69212e`, missing 13 tracked files plus everything since |
| ~~14c~~ | ✅ **done.** Achieving a goal, and migration 83 making it one-way |
| ~~14d~~ | ✅ **done.** Goal deadlines, and migration 84 making the column a `date` |
| ~~14e~~ | ✅ **done.** Delete your account, from settings |

---

### 14a. Dashboard tab switching is slow, and it is not the network ✅ done

Reported from the installed PWA. **Every tab is a `<Link>` to `/dashboard?tab=…`**, so a switch is a full server navigation that re-renders the whole page.

**What a switch to Notifications paid for before step 2 below**, measured against the code:

| | |
|---|---|
| `getTodayData` | Four queries **plus a Storage signing round trip** — and `TodayPanel` only renders under `view === "overview"`, so all of it is discarded |
| `goals`, `categories` | Read by `GoalsPanel`, which is also Overview-only |
| `getCheckinDate` | Needed only by the two above |
| `hasUnfinishedDay` | The `/today` gate. This one is deliberate everywhere |

Roughly **seven sequential hops and ten queries, about half of them rendering nothing** — and there was no `loading.tsx`, so none of it was visible and the tap appeared to do nothing.

#### The fix, in three parts

**1. ✅ `loading.tsx`.** One for `/dashboard`, one for the whole `(app)` group, over a shared `SkeletonLine`/`SkeletonRegion`. The work did not get faster; it stopped being invisible, which was most of what "slow" meant. Unanimated on purpose, and announced once through a `role="status"` container rather than once per placeholder.

**2. ✅ Compute per view.** The reads are now three groups, and **exactly one of the last two runs**:

| Group | Contents | When |
|---|---|---|
| Base | memberships, the profile row, the unread count, `getCheckinDate` | Always. Memberships are read by all three tabs; the profile and the date feed the gate; the count renders on a tab *label*, so it cannot wait for its own tab |
| `loadOverview` | `goals`, `categories`, `getTodayData`, `goal_group_visibility`, the digest reads | `view === "overview"` |
| `loadNotifications` | the notification rows, the push-nudge cookie | `view === "notifications"` |

`getCheckinDate` moved **into** the base batch rather than out of the page: it depended on nothing above it and was costing a full sequential round trip of dead time. `Circles` now runs the base group and nothing else.

**Two decisions worth recording.**

The loaders are **nested functions inside the component**, not module-level helpers. They close over `supabase`, `userId`, `today`, `active` and `inactive`, so their return types are inferred — and `GoalsPanel` does not export the shapes it accepts, so the alternative was hand-writing row types for four PostgREST selects, which is exactly how a panel's props and the query feeding it drift apart.

The JSX branches on **`overview ?`, not `view === "overview"`**. The data only exists on the branch that loaded it, so narrowing on the object is what lets TypeScript prove `overview.todayData` is present. Branching on the string would leave it possibly-null and invite a `!`.

**The `/today` gate stays everywhere**, before either loader runs, so a redirect skips the per-view work entirely. It is one query, and moving it would mean a push notification deep-linking to a tab no longer diverts you to an unfinished day.

**3. ✅ Tabs become route segments**, with the shell in a layout:

```
dashboard/
  sections.ts             the list of sections, and nothing else
  tab-bar.tsx             client; owns the active state
  layout.tsx              header row, tab bar, unread badge, the /today gate
  loading.tsx             body-only skeleton
  page.tsx                Overview
  circles/page.tsx
  notifications/page.tsx
  profile/page.tsx        step 15, one folder and one line in sections.ts
```

**Why this and not Suspense or client state.** Next does **partial rendering**: navigating between sibling segments re-renders only the segment that changed and reuses the layout above from the router cache. So the shared reads happen once per visit rather than once per tap, and — the part that matters more — **the nav bar is never unmounted**. It is the same DOM across every switch, which is the requirement, not a side effect.

#### Two constraints this design has to satisfy

**The nav must survive every navigation, in appearance and in identity.** This is the direction the app is heading: a mobile shell with a persistent bar and a body that swaps. A layout gives that for free *provided the bar does not depend on anything the layout computes per navigation*, which leads directly to the trap below.

**Sections must be addable and removable at will.** `profile/` is coming in step 15 and more will follow. So the list of sections lives in `sections.ts` as data — key, label, href, optional badge key — and both the bar and the layout read it. **Adding a section is one entry and one folder.** Nothing else in the dashboard knows how many sections there are.

#### The trap, and it is a good one

**A server-rendered active tab would freeze on whichever tab you arrived on.** The bar belongs in the layout; the layout does *not* re-render on a sibling navigation. So a layout that computes `active` from the URL and hands it to the bar would compute it exactly once, and every tab after the first would render with the wrong one highlighted — a persistent nav that looks broken in precisely the way a non-persistent one does not.

**So the bar is a client component and reads `usePathname()`.** That hook subscribes to the router, so it updates without the layout re-rendering. It also updates *immediately on tap*, before the new segment has finished loading, which makes the tap feel instant even while the body is still a skeleton.

Matching is **longest href wins**, not `startsWith`. `/dashboard` is a prefix of every other section, so a naive prefix test lights up Overview on every page. Longest-match needs no `exact: true` flag on one special entry, which is one less thing for a future section to get wrong.

#### Three more things

**The badge goes stale.** The unread count renders on a section *label*, so it belongs in the layout — and the layout is precisely what does not re-render on a sibling navigation. Opening Notifications marks them read and the badge would keep the old number.

The fix is `router.refresh()` from `MarkRead` after the mark, **not** `revalidatePath`. The action deliberately avoids `revalidatePath` because it would re-run the page, re-mount the component that called it, and call it again. `router.refresh()` preserves client state, so `MarkRead` is not re-mounted and its `fired` ref never re-arms — the loop is structurally impossible rather than merely unlikely.

Badges are passed as a **map keyed by section key**, so a future Profile badge is a key, not a change to the bar.

**`sw.js` does *not* deep-link to a dashboard tab.** I said it did when planning this; that was wrong. Its only `?tab=` is `/circles/<id>?tab=overview`, which is the Circle page and is unaffected. Recorded rather than quietly deleted, because the check that found it is the reason to keep doing it.

**`?tab=` keeps working anyway**, as a redirect from `/dashboard?tab=circles` to `/dashboard/circles`. That costs one line, keeps every bookmark and every existing spec valid, and leaves `?tab=nonsense` falling through to Overview exactly as before.

**`/circles/[id]` stays on `?tab=`.** It has two tabs, no shared reads worth hoisting, and no persistent-nav requirement. That is a decision, not an oversight, and `app.md` says so.

**`Notice` stays in Overview's page**, because layouts do not receive `searchParams` — and every `?notice=` redirect in the codebase targets a bare `/dashboard`, so there is nothing to spread across the other segments.

#### Verified

Typecheck, ESLint, `next build` and the e2e suite all pass. Three of those cannot run in my sandbox, so the claim rests on the run, not on inspection.

Two assertions are worth naming, because they are what makes "the bar is persistent" a fact rather than a hope:

- **The bar is the same DOM node across a click.** Asserted by tagging the element with a property and re-reading it after a client-side navigation — not by "it is still visible", which passes just as happily when the bar has been torn down and rebuilt.
- **The highlight moves.** `aria-current="page"` follows the section, which is what proves the client-side `usePathname` reading works and the layout is not being asked to do it.

`?tab=circles` and `?tab=notifications` are asserted to redirect, so nothing written before this split has been orphaned.

### 14b. Regenerate the code graph — **current**

`graphify-out/` was built at `e69212e`. The step 13 audit worked around it with the TypeScript compiler API, which answered the reader/writer questions but is not what the graph is for.

**The gap, measured against `manifest.json` rather than estimated.** The manifest indexes code and migrations only — 211 entries across `.ts`, `.tsx`, `.mts`, `.mjs`, `.js` and `.sql`, no docs and no assets — so that is the set the comparison uses. **26 files are wrong or absent:**

| | Count | What |
|---|---|---|
| Absent, committed | 10 | The public surface (`privacy`, `terms`, `robots`, `sitemap`, `legal-footer`, `policy-page`, `lib/legal`, `lib/site-url`, `e2e/legal.spec`) and migration 82 |
| Absent, uncommitted | 9 | All of 14a: `sections`, `tab-bar`, `layout`, `memberships`, the two new section pages, both `loading.tsx`, `components/skeleton` |
| Present but stale | 7 | `dashboard/page`, `notifications-panel`, and five specs |

**Nothing is stale in the other direction** — the manifest names no file that no longer exists — so this is purely a catch-up, not a rebuild.

**Two hygiene problems found while measuring, and neither is about staleness. Both fixed.** ✅

- **`graphify-out/.graphify_root` was committed and contains an absolute Windows path.** A machine-local pointer in a shared repository: anyone else cloning this got a path that does not exist on their disk.
- **`graphify-out/cache/` was committed**: 87 content-hashed AST files. It is a build cache keyed by file content, so every regeneration renames a slice of it and produces a large, unreadable diff.

Both are now in `.gitignore` and removed from the index with `git rm --cached`, so **the files stay on disk and the next run is still fast** — they simply stop being repository content. `.graphify_analysis.json` went with them for the same reason. `graph.json` and `manifest.json` remain tracked, because those are what another machine would actually use.

**Verification is a script, not an eyeball:** `node scripts/graph-freshness.mjs`. It reports all four categories and exits non-zero if any is non-empty, so it can gate a commit later if that is ever wanted.

Two things it does deliberately. **It learns which extensions to check from the manifest** rather than hard-coding them, so the day graphify's configuration changes it does not start reporting every `.md` file as missing. And **it detects "changed since" through `git diff`, not through the manifest's stored mtime** — a checkout, a rebase or a `git stash pop` rewrites mtimes without changing a byte, and any of those would otherwise report the entire tree as stale.

The one thing it cannot infer is that `package-lock.json` is not indexed while `package.json` is; that exception is listed in the file rather than guessed.

**The regeneration itself has to be run on the machine graphify is installed on.** Commit 14a first, so the ten currently-untracked files are tracked before the graph indexes them — otherwise the graph describes files git does not know about, which is the confusing direction. Then run graphify, then `node scripts/graph-freshness.mjs` and expect all four categories empty.

### 14c. Achieving a goal ✅ done

Achieving moves the check-in denominator exactly as archiving does. Adding it before the first streak existed would have meant debugging two denominator-movers at once, against a baseline that had never produced a correct number. Streaks work now.

#### The database side is already built, and that is the main finding

Reading the migrations rather than assuming: **every piece of this shipped between migrations 04 and 34, and none of it has ever had a writer.**

| Piece | Where | What it already does |
|---|---|---|
| `goals.achieved_at` | 04 | The column, with its own comment distinguishing it from `archived_at` |
| `grant update (… achieved_at …)` | 25 | `authenticated` may already write it |
| `goals_achieved_not_future` | 26 | `achieved_at <= now()` |
| `enforce_active_goal_cap` | 16 | Fires `on update of achieved_at`; achieving frees a slot |
| `recompute_daily_completion` | 34 | Excludes achieved goals from **both** numerator and denominator |
| `goals_count_achievement` | 34 | Increments `total_goals_achieved` on the null → not-null transition |

So 14c is **a server action and a button**, not a schema change. The one exception is below, and it is worth the migration.

#### `total_goals_achieved` is inflatable, and this is the moment to close it

`authenticated` holds `update (achieved_at)` with no constraint on direction, and `goals_count_achievement` fires on **every** null → not-null transition. So: achieve, set it back to null, achieve again. The counter goes up twice for one goal, through the ordinary API, with no policy violated.

Nothing reads that number yet — `/profile/[username]` is step 15 — which is exactly why it should be fixed **now**, before a stat with a public surface is computed from a column anyone can pump. A CHECK cannot express it, because the illegal thing is a *transition*, not a state. **Migration 83 is a trigger that refuses to clear `achieved_at` once set.**

Archiving deliberately does **not** get the same rule. `archived_at` feeds no counter, and un-archiving is a reasonable thing to want.

#### "Achieved but still active" is not a state, whatever migration 04 says

Migration 04's column comment reads *"a goal can be achieved and kept active"*. **Every consumer disagrees**: the partial index, the cap trigger, `recompute_daily_completion` and `can_check_in_on_goal` all treat `achieved_at is not null` as retired. Achieving *is* retirement.

That kills one third of the follow-up prompt this step was going to ship. The old note said the prompt would offer **archive, edit into a new goal, or keep it active** — and "keep it active" cannot be built without `achieved_at` meaning something different to every reader of it. Dropped, rather than built as a checkbox that quietly does nothing.

What replaces it is honest copy: **achieving stops the goal counting toward your day.** That is the fact people need before they press it, and it is the same denominator move archiving makes.

The migration comment cannot be edited after the fact, so `schema.md` carries the correction.

#### The three things to build

1. ✅ **Migration 83**, applied as `20260825034125`. Proved in a rolled-back transaction: clearing refused, moving refused, **and a negative control** — achieving a fresh goal still works and moves the counter by exactly one. Without that control a trigger that refused everything would pass. `md5(prosrc)` matches the file.
2. ✅ **`achieveGoal`**, mirroring `archiveGoal` exactly: `"now"` rather than a client timestamp, `.is("achieved_at", null)`, `.select("id")` because RLS filters silently and the affected-row count is the only evidence the write landed. That `.is()` filter is load-bearing twice — it makes a second press a no-op *and* it is why this action can never trip migration 83's trigger, since a request that would move an already-set value matches no rows.
3. ✅ **The control**, beside Archive in `GoalsPanel`, with a confirmation. The panel already rendered an "Archived and achieved" group, so the display half needed nothing.

**The confirmation is on Achieve and not on Archive**, following `RowButton`'s rule: a dialog appears only when something cannot be got back. Archiving is reversible; achieving is not. A confirmation people meet on every button is one they stop reading.

#### Tests

Three, in `e2e/goals.spec.ts`, and one helper pair that matters as much as they do.

- **Achieving from the dashboard**: the row leaves the active list, appears under "Archived and achieved", `achieved_at` is set, **`archived_at` is still null**, and the counter moves by exactly one. The archived-column assertion exists because both states retire a goal and the panel groups them together, so setting the wrong one looks identical on screen and is wrong in the counter, the export and the profile.
- **The database refuses to un-achieve**, through PostgREST as a real signed-in user. The migration proves this as the table owner, where grants do not apply and RLS is bypassed; this is the only way to know the trigger, the `update (achieved_at)` grant and the UPDATE policy agree. Asserted on `hint`, never on the message, so copy edits cannot break it.
- Moving the timestamp is refused too, and after both refusals the counter is one ahead rather than three.

**`achievedCount` / `restoreAchievedCount` are the `freeGoalSlots` pair for the counter.** `deleteE2EGoals` removes the goal but nothing walks the counter back — that is precisely what migration 83 guarantees — so without a restore in `finally` every run would inflate a real person's lifetime stat by one, permanently.

**Playwright dismisses dialogs by default.** Without `page.on("dialog", d => d.accept())` registered before the click, the confirmation is cancelled and the test asserts that nothing happened: green for the wrong reason.

#### Verified, and one real bug found on the way

The suite passes. The first run failed three tests, and the three had nothing to do with each other.

**`/robots.txt` and `/sitemap.xml` were being redirected to sign-in.** Neither was in the proxy's `PUBLIC_PREFIXES`, and its matcher excludes `sw.js`, the manifest and image extensions but not `.txt` or `.xml`. A crawler is by definition signed out, so both files — written, routed and served correctly — were unreachable by the only clients that exist for them. Fixed in `proxy.ts`.

**The legal spec passed through all of it, which is the more useful finding.** It asserted the response contained `/privacy` and `/terms` and did not contain `/join`. **A sign-in page satisfies all three**, because `legal-footer.tsx` is on it — three passing assertions against a document that was not a sitemap. `request.get` follows the redirect and reports 200, so the status check could not catch it either. Both tests now assert the **content type** before the content: a redirect can imitate the contents of a document, not its kind.

**The other two failures were transient, and my leading hypothesis about them was wrong.** Both were on `/today`, and I suspected `app/(app)/loading.tsx` from 14a — the only change that touches that screen, and the first Suspense boundary the app has ever had. It was not that: the file is untouched and both tests pass. The evidence pointed elsewhere all along and I under-weighted it. One trace showed the account sitting on `/onboarding` with no username, which is a fixture state only `gates.spec` creates; the other showed a check-in button stuck on its pending label. Both are shared-real-account effects, which this suite has been bitten by before. **Worth watching rather than worth chasing**, since neither reproduced.


### 14d. Goal deadlines ✅ done

`<input type="date">` is native everywhere and needs no library, so the earlier "that's design work" objection was wrong.

#### The column was the obstacle, and it was free to fix

`goals.deadline` was `timestamptz`, and a date input submits `YYYY-MM-DD`, which stores as midnight **UTC**. Someone in `America/Los_Angeles` picks 1 September and reads back 31 August — and it looks like a bug in the picker rather than in the schema.

**Not fixable in the reader.** Every consumer would have to agree on which timezone to un-apply, and any one of them getting it wrong is a date off by one. A goal deadline is a **calendar date, not an instant**; `date` has no timezone semantics, so the error class stops existing.

**Migration 84**, applied as `20260825054058`. Confirmed at the database first: 16 goals, **zero** with a deadline, one SQL reader (`export_user_data`). That mattered — `timestamptz -> date` casts in the session timezone, so with data this would have been a silent decision about whose midnight counts, taken by whichever connection ran the migration. The migration **refuses to run** if a non-null value ever appears, rather than trusting the note above.

Proved rolled back on three claims: the type changed, `authenticated` still holds insert and update on the column (an `alter column ... type` rewrites it, and a lost grant would surface later as a bare `42501` from a form that looks correct), and `2026-09-01` written through the column reads back as `2026-09-01`.

`export_user_data` gets better rather than breaking: the exported value becomes `2026-09-01` instead of `2026-09-01T00:00:00+00:00`, which is what the person chose.

#### What was built

- **Inline on the goal row**, so set, change and remove are one control. Clearing the field removes the deadline; there is no separate button.
- **An explicit Save**, matching every other control in the panel. A date input fires `change` while you are still picking on some platforms, so an auto-submitting field would write intermediate dates and revalidate the page under the picker.
- **Overdue means strictly before today**, matching the rule `/circles/[id]` already states for a Circle's deadline: the deadline day itself is fully playable. Two deadline concepts in one app disagreeing about the last day would be worse than either answer.
- `lib/goal-deadline.ts` holds `isOverdue` and `deadlineLabel` as pure, UTC-pinned functions, unit-tested in the runner pinned to `America/Los_Angeles`.

**"Today" is the check-in date, passed down from the server.** Not `Date.now()` in the component: "is this overdue" and "does today count" have to be the same day, or they disagree for two hours either side of the 2 AM boundary.

**The design notes held.** No default — the column is nullable on purpose, most daily goals have no end date, and defaulting turns an opt-in field into an opt-out one that makes every new goal look overdue tomorrow. And no `min` attribute, because recording a missed or historical deadline is legitimate; a past date renders as overdue, which is a fact about it rather than a complaint.

#### Tests

Unit tests cover the boundary cases that a UTC runner cannot fail: the deadline day is not overdue, month and year boundaries, and a missing `today` producing a date with no claim about it. **Month names are asserted with `toContain`**, following `digest-days.test.ts` — `month: "short"` is ICU data and this runtime renders September as "Sept" where another renders "Sep", so a pinned abbreviation would fail on a version bump and say nothing about the code.

The e2e test sets, changes and clears through the screen. **Its load-bearing assertion is the stored value, not the label**: the owner's timezone is west of UTC, so under the old column the date would be consistently wrong in both the database and the screen, and a UI-only assertion would agree with itself.

---

### 14e. Delete your account ✅ done

**Everything behind this already existed.** `delete-account` is deployed with `verify_jwt` on: it identifies the caller from their own token, scrubs note text, collects and deletes Storage objects, then deletes the auth user and lets the cascade do the rest. `security.md` section 11 documents the ordering and why it is load-bearing. What was missing was a button.

**The rule this step turned out to be about.** `settings/page.tsx` carries a standing rule that it holds only controls whose backend exists, written after 8h spent two migrations removing a table that had policies, grants, two enforcing consumers and no writer. **This was that same failure from the other end**: a complete, deployed, correct backend that nothing could call. Same drift, opposite direction, and only one of the two had a rule watching for it.

#### What was built

| | |
|---|---|
| **The confirmation** | Typing your username. `ArchivePanel` had already drawn this line and said why: *"that ceremony suits deleting an account"*, and archiving destroys no history. This does |
| **Checked twice** | The panel disables the submit until it matches; the action re-checks against the username **read from the database**, never from a hidden field, or the form would be confirming itself. The client check is a courtesy, the server one is the control |
| **Saying what survives** | Photos, notes, goals and the account go; **check-ins stay, anonymised**, because deleting them would rewrite other members' streaks. Someone who learns that afterwards has been misled by omission, so it is in the panel, in the notice, and on `/privacy` |
| **Ownership** | Warned, and **named**. "You own 2 Circles" makes someone go and look; naming them answers it in place. Succession stays automatic, and a Circle with nobody left is archived — `handle_membership_removal`, unchanged |
| **After** | `redirect("/?notice=account-deleted")`. `/` is outside `(app)` and is the only route left that can render anything. Landing on sign-in with no explanation reads as being logged out rather than as having succeeded |
| **Sign-out failure is swallowed** | The account is already gone, so the refresh token belongs to a user that no longer exists and Supabase may answer with an error. Reporting it would tell someone their deletion failed *after* it succeeded, which is the worst wrong answer available here |

**The coupling was honoured.** `/privacy` said to email for deletion, because that was true. That sentence is a link now, in the same change. The email route is kept as an alternative rather than removed, since some people would rather write.

**No migration.** Nothing here touches the schema.

#### The test deliberately does not cover the most important check

`e2e/delete-account.spec.ts` covers the gate a person meets: closed by default, submit disabled until the typed name matches exactly, a prefix and a superset both refused, cancel clearing the field so the next open cannot start with a match already typed. It ends by asserting the account still exists.

**It never submits.** The suite runs against two real accounts, and `E2E_OWNER_EMAIL` owns the storage state every other spec depends on — a successful deletion would end the run, and nothing in this repository could undo it. Covering the server-side check means POSTing a deliberately wrong username, which is safe if the check works and destructive if it does not. **A test whose failure mode is "the thing it was testing already happened" is not a test.** Written down here rather than left as a gap for someone to find.

The honest fix, if this ever needs real coverage, is a disposable account created and destroyed by the spec. That is a change to `auth.setup.ts` and the account model, not to this file.

---

## 15. Profiles, and the moderation surface they carry

**Named, not planned.** `/profile/[username]` is where three things that already exist in the schema get their first caller:

| | |
|---|---|
| `user_lifetime_stats.visible_on_profile` | A column with no reader |
| `user_blocks` | A table with no writer |
| `content_reports`, and the `report` rate limit | **The last limit in `lib/ratelimit.ts` with no caller.** Reporting is a thing you do *to a profile*, so it arrives with the profile rather than before it |

That last row is why this is step 15 rather than a loose end: the limit is not missing a caller by oversight, it is waiting for the screen it belongs to.

---

## The public surface ✅ **done**

`/privacy`, `/terms`, `robots.txt`, `sitemap.xml`, and links from `/`, `/auth/sign-in` and `/settings`. **This was the gate on the Google OAuth consent screen** — until a privacy URL was publicly reachable, nobody outside the test accounts could sign in.


|                              |                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/legal.ts`               | Every number the pages assert, annotated with the job that enforces it. `TERMS_VERSION` is a dated constant; **nothing records acceptance**, because Google sign-in never shows a checkbox and a column now would be declared with no writer |
| `components/policy-page.tsx` | One frame, so the two pages cannot drift apart                                                                                                                                                                                               |
| `lib/site-url.ts`            | The only place in the app that needs to know its own hostname. `NEXT_PUBLIC_SITE_URL`, then Vercel's, then localhost — the fallback is what keeps CI's **env-less** build working                                                            |
| `PUBLIC_PREFIXES`            | Extracted from the inline boolean in `proxy.ts`, matched as whole segments so `/termsomething` does not become public because `/terms` is                                                                                                    |


**The copy describes only what exists.** Account deletion is a deployed Edge Function with no UI, so the page gives an address rather than promising a button. **That sentence becomes a link in 14e's commit**, not later — a policy offering a slower path than the product does is the same drift in the other direction.

**Decisions:** individual rather than a company, contact `ryanhang07@gmail.com`, **18+**, dated version constant with no acceptance tracking.

**The assertion the whole spec exists for:** the sitemap must never contain `/join`. An invite token is a bearer credential, so enumerating them would publish every Circle. `sitemap.ts` cannot reach the database today and must never gain the ability — the test fails the moment somebody adds a helpful-looking `groups.map(...)`.

### The legal review, in more detail than "get it reviewed"

The pages say they are not legal advice. That is honest, and it is also not a plan. What a review is actually for, and when it starts mattering:

**Three different things are bundled under "legal review", and they have different urgency.**

| | What it is | When it bites |
|---|---|---|
| **Accuracy** | Do the pages describe what the code does? | **Now.** This is the part that is your problem rather than a lawyer's, and it is the part most likely to be wrong — every number lives in `lib/legal.ts` for that reason, but nothing enforces that the *prose* keeps up. A policy that describes a different product is worse than none, because it is a written, dated, public misstatement |
| **Sufficiency** | Do they contain what the law requires of you? | **When you have users outside your test accounts**, and sharply if any are in the EU, UK or California. GDPR requires a named controller, a lawful basis per purpose, a retention period, and the rights list; CCPA requires a "do not sell" statement even though you do not sell. The current pages cover most of the *substance* and none of the *ritual* |
| **Exposure** | Do the terms actually protect you? | **When someone is unhappy.** "No guarantees" and "we can close your account" are the two clauses most often unenforceable as written, and both are in there. A one-person operation with no company is personally liable, which is the real reason this matters more here than it would behind an LLC |

**The specific things a reviewer should be pointed at**, rather than handed the pages cold:

- **18+ with no verification.** The terms state it; nothing enforces it, because Google sign-in asks nothing. That gap is normal, but it should be a deliberate position rather than an accident, and it changes if you ever market to students.
- **Photos of other people.** The terms say do not post someone who has not agreed. A product whose whole point is sharing photos with a small group is a product that will eventually host a photo of someone who did not consent, and there is currently no reporting path — that is step 15.
- **Deletion is partial, on purpose.** Check-ins survive anonymised so other members' streaks are not rewritten. This is defensible and unusual, and it is exactly the sentence a regulator would ask about. It is stated plainly on the page, which is the right call, but it is worth confirming that "anonymised" is doing the work you think it is: the row still ties to a Circle and a date.
- **Processors and transfers.** Supabase, Vercel, Upstash, Google and Brevo are named. Whether any of them need a signed DPA, and where the data physically sits, are questions nobody has asked yet.
- **No company.** Everything above lands on you personally. Forming an entity is the single change that alters the whole risk picture, and it is a decision, not a task.

**The cheap version**, if a full review is not proportionate yet: keep the audience to people you know, keep the pages accurate, and revisit before the first stranger signs up. The expensive version is discovering the gap after that.

**And one standing rule:** when the code changes what happens to someone's data, the page changes in the same commit. `lib/legal.ts` exists so the numbers cannot drift; the prose has no such guard and needs the discipline instead.

---



## Route map

Every route the app will have, and where each stands. **Orphaned** means the backend implements it and nothing in the app links to it.

### Public


| Route                       | Status             | Notes                                                                                                                                                                          |
| --------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                         | built, placeholder | Landing. Redirects signed-in visitors to `/dashboard`. Also renders `Notice`, since a signed-out visitor with a dead invite link lands here. Needs real content; see Deferred. |
| `/auth/sign-in`             | built              | Google only so far. Gains a password form.                                                                                                                                     |
| `/auth/callback`            | built              | OAuth code exchange.                                                                                                                                                           |
| `/auth/error`               | built              | Gains cases for expired and reused confirmation links.                                                                                                                         |
| `/auth/sign-up`             | deferred           | Email, password, username, name, terms, Turnstile.                                                                                                                             |
| `/auth/check-email`         | deferred           | Post-signup holding screen. Resend, spam-folder line, and a route back to sign-in.                                                                                             |
| `/auth/confirm`             | deferred           | Route handler calling `verifyOtp`.                                                                                                                                             |
| `/auth/forgot-password`     | deferred           | Always reports success.                                                                                                                                                        |
| `/auth/reset-password`      | deferred           | Reached only with a recovery session.                                                                                                                                          |
| `/privacy`                  | built              | Reachable signed out, which is what the consent screen requires.                                                                                                               |
| `/terms`                    | built              | Versioned by `TERMS_VERSION`; nothing records acceptance until signup exists.                                                                                                  |
| `/support`                  | deferred           | FAQ plus contact form.                                                                                                                                                         |
| `/join/[token]`             | built              | Preview works **signed out**; join requires sign-in. A dead link redirects with a notice rather than 404ing. `robots: noindex`, `Disallow: /join/`, and never in the sitemap.  |
| `robots.txt`, `sitemap.xml` | built              | `/join/` disallowed and absent from the sitemap, asserted by `e2e/legal.spec.ts`.                                                                                              |




### Signed in


| Route                     | Status              | Backed by                                                                                                                                                                   |
| ------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/onboarding`             | built               | `complete_onboarding`, then the install nudge and the one push prompt. Gains the terms checkbox with signup.                                                                |
| `/dashboard`              | built               | Three tabs: Overview with five day boxes, Circles, Notifications. Check-in panel with photos.                                                                               |
| `/circles/[id]`           | built               | Header, deadline, group streak, Members and Overview tabs, owner streak-decision banner. Closes the `sw.js` deep link.                                                      |
| `/circles/[id]/settings`  | built               | Invite link, revoke, regenerate, archive. Still to gain: deadline, roles, and the kick flow's "also block?" step.                                                           |
| `/notifications`          | orphaned            | `notifications`. The durable channel; push is best-effort.                                                                                                                  |
| `/profile/[username]`     | orphaned            | `user_lifetime_stats.visible_on_profile`. Where blocking lives.                                                                                                             |
| `/settings/profile`       | orphaned            | Rename path. Must surface *when* the next rename is allowed, not just refuse.                                                                                               |
| `/settings/notifications` | **partly absorbed** | The per-device push toggle and the Circle-name setting live on `/settings`. A per-device *list* is still unbuilt.                                                           |
| `/settings/account` | **partly absorbed** | Export is on `/settings` and works. **Deletion is 14e** — the function is deployed and verified, only the control is missing. Self-serve deletion is an Apple requirement for any future store submission. |




### Protection

`PUBLIC_PREFIXES` in `lib/supabase/proxy.ts` is the list: `/`, `/auth`, `/join`, `/privacy`, `/terms`, `/_next`, plus an early return for `/api/csp-report` that never reaches the check. The deferred auth routes go under `/auth` and need no new entry.

Keep the posture deny-by-default: enumerate what is *public*, so a forgotten route fails closed as a redirect to sign-in. Enumerating what is protected means a forgotten route fails open, silently.

---

---



## Open items



### Blocking

**Nothing is blocking.** The migration workflow was the last entry here and it settled itself in practice over steps 10 to 13:

> Apply through the Supabase MCP, then **write the file under the version the server recorded** and prove `md5(prosrc)` matches. Migration 77 was applied and never committed; 79 and 81 were both recorded under a timestamp different from the filename I chose. The verification is the workflow.



### Before launch

- ~~Security headers~~ — step 12.
- `pushsubscriptionchange` ~~handler~~ — step 10f. `sw.js` listens and `resubscribeIfPermitted` repairs a rotated endpoint without ever prompting.
- Wire rate limits into each new action as it is written. **Every limit now has a caller except** `report`, which waits on the content-reporting UI.
- A custom domain, if email deliverability from a personal sender proves to be a problem. **Not needed for Google OAuth** — `*.vercel.app` is accepted as an authorized domain, contrary to what this file said before it was tested.
- **Regenerate** `graphify-out/`**.** It was built at `e69212e` and is missing 13 tracked files: all of steps 11 and 12, and everything step 13 added.



### Deferred to v2

- Replace the placeholder icons.
- All visual design. See `product-and-design.md`.

