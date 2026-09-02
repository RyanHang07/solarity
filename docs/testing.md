# Solarity: Testing & Local Workflow

How to run it, how to verify it, and the rules the suite follows.

| | |
|---|---|
| `npm run dev` | The app, against the **hosted** Supabase project via `.env.local`. `npx supabase start` is not needed |
| `npm run typecheck` | `next typegen && tsc --noEmit`. **Use this, not bare `tsc`** |
| `npm test -- --run` | 66 Vitest unit tests, in the **`node`** environment and **pinned to a non-UTC timezone**. Error hints, push copy, digest grouping, the CSP, violation-report parsing, image sniffing and photo URL signing |
| `npm run test:e2e` | 96 Playwright tests in Chromium, 15 spec files, one worker. Two of them skip unless `E2E_PROD` |
| `npm run test:e2e:ios` | 7 more in WebKit at iPhone size (10 listed, 3 of them the shared setup). Needs `npx playwright install webkit`. **Both step 12 CSP bugs were WebKit-only and production-only.** Chromium was green through all of it |
| `npm run test:e2e:clean` | Removes what a crashed run left: Circles, goals, and any parked goals |
| `E2E_PROD=1 npm run test:e2e` | Against `next build && next start`. Reach for it when a failure looks like infrastructure, and **always before a deploy since step 12**: the dev CSP is not the one that ships |

**Docker is only needed** for `db diff`, `db reset` and `supabase start`.

**Running less than everything.** A full pass is three minutes and a chunk of the auth budget, so narrow it while iterating:

| | |
|---|---|
| One spec | `npx playwright test e2e/digests.spec.ts` |
| One test | `npx playwright test -g "sorts to the top"` |
| Only last run's failures | `npx playwright test --last-failed` |
| One vitest file | `npm test -- --run lib/digest-days.test.ts` |
| Compile every spec, run none | `npx playwright test --list` |
| The WebKit project alone | `npm run test:e2e:ios` |
| WebKit against a production build | PowerShell: `$env:E2E_PROD=1; npm run test:e2e:ios`. **The only combination that has caught a CSP bug** |
| The headers | `npx playwright test e2e/headers.spec.ts` |

The `setup` project always runs first — every spec depends on it for storage states — so a filtered run still mints sessions and `global-teardown` still restores `today_screen_mode`. A narrow run cannot leave your account with the check-in screen switched off.

**Four things no command here can check**: a real permission dialog, a real push delivery, a safe-area inset, and whether HSTS is actually being served (a dev server on plain http will not send it, and a browser would ignore it if it did). Headless browsers report the permission denied, never draw the dialog, and resolve `env(safe-area-inset-*)` to 0. Step 10's manual pass covered the first three once — the eight flows are kept in `history.md`, because a permission dialog is one-shot per browser and the next device will need the same procedure.

**Two things step 9 changed about every run**

- **Both accounts are forced to `today_screen_mode = 'never'`** by `auth.setup.ts`, because an unfinished day would otherwise divert every `goto("/dashboard")` in `invite`, `roster` and `dashboard` and fail assertions in files that never mention check-ins. `gates.spec.ts` turns it on per test.
- **`global-teardown.ts` puts it back.** The previous value is recorded before the run forces it, in `e2e/.auth/today-modes.json`. These are the accounts used for manual testing, and a suite that leaves a feature switched off is a suite that costs you an afternoon wondering why.

---

## End-to-end tests

Playwright, in `e2e/`, run with `npm run test:e2e`. Vitest keeps `npm test` and is told to ignore `e2e/`, because both runners default to collecting `*.spec.ts` and the split is by directory rather than by name.

**First run, on your machine and not in the sandbox:**

```
npm install
npx playwright install chromium webkit
```

`webkit` is only needed for `e2e/ios.spec.ts`; the default run does not touch it.

Then set `E2E_OWNER_EMAIL` and `E2E_JOINER_EMAIL` in `.env.local`. Both must be real accounts that already exist and have finished onboarding.

**`e2e/env.ts` loads `.env.local` itself.** Next.js does that for the app, which makes it easy to assume everything does; Playwright's runner is a plain Node process and loads nothing, so without this every spec fails with `NEXT_PUBLIC_SUPABASE_URL is not set` while the dev server three terminals over reads it fine.

It is called from `playwright.config.ts`, which workers re-import, and again from `e2e/db.ts`, because `npm run test:e2e:clean` runs under tsx and never loads the Playwright config. Existing environment variables win over the file, so `E2E_BASE_URL=… npm run test:e2e` still overrides, and a missing file is not an error, because CI has none.

It deliberately does not support multi-line values, `export` prefixes, or `${VAR}` interpolation. If `.env.local` grows one of those, swap in `dotenv` rather than extending the parser.

### Supabase auth requests are their own budget

**This is the one that cost the most, because every symptom pointed somewhere else.**

`verifyOtp` and `generateLink` spend from Supabase's hourly **auth** rate limit, which is entirely separate from `lib/ratelimit.ts` and cannot be cleared by `clearRateLimits`. A suite that mints a session per context, per test, or per API client burns through it partway and then fails in two different ways at once:

- the mint itself returns `Request rate limit reached`, which at least names the cause
- **token refreshes start getting 429s**, and `@supabase/ssr` responds by dropping the session, so pages quietly render signed-out several tests downstream with no error anywhere

The second is what sent this suite through four wrong diagnoses. A page showing the landing screen looks like a broken redirect, a dead session, or a rate limit in the app; it is none of those.

**So sessions are minted once per account per worker and cached**, in `e2e/session.ts` and `sessionFor` in `e2e/db.ts`. Roughly four auth requests a run instead of thirty. The cache holds the *promise*, so concurrent callers wait on one mint rather than racing into several.

**Reuse is safe here for a specific reason**, not by luck: an access token outlives a three-minute suite, so nothing triggers a refresh and nothing rotates the refresh token. A much longer run would need a different answer.

### A session per context, not a shared file

**Supabase rotates refresh tokens**, so a stored storage state is single-use in practice. The first context to refresh consumes the token and gets a replacement in memory; the next context starts from the file, presents the spent token, and is signed out.

The symptom is brutal to diagnose: a page renders the landing screen partway through a run, with no error anywhere and nothing wrong with the app. It cost two rounds of guessing before the page snapshot in `test-results/*/error-context.md` showed a sign-in button where the dashboard should have been.

`e2e/session.ts` mints a fresh session per context. `auth.setup.ts` still writes the files, which remain fine for anything holding exactly one context for its whole life.

**This also rules out `test.use({ storageState })`**, which takes a fixed value and therefore hands every test in the block the same token. Those tests build their own context instead.

**Reuse does not merely fail, it revokes.** Presented with an already-consumed refresh token, Supabase treats it as a compromise and revokes the **whole session family**, not just that token. So one stale reuse anywhere signs the account out everywhere, and the page that shows it may be several tests downstream from the cause.

The evidence was a session count: 3 for one account against 45 for the other, with the survivor's oldest 28 minutes old and the victim's 14 seconds. Sessions accumulate; they do not expire that fast. Something was deleting them.

**So sessions are minted as late as possible and held as briefly as possible.** A context opened at the top of a long test and used at the bottom has spent the whole test being revocable for reasons that have nothing to do with it.

**Superseded in part.** Minting per context traded this problem for a worse one, the auth rate limit above. Sessions are now cached per account; the "hold it briefly" instinct was right, the "mint another" conclusion was not.

**The lesson is general:** anything a test reuses across contexts has to be idempotent, and an auth token is not.

### A gate test has to own its unfinished day

`hasUnfinishedDay` needs an active goal and an incomplete day. For months both were simply true of the real accounts, so nine tests asserted on them without establishing them, and six failed at once the day every goal was checked off by hand.

`ensureUnfinishedDay` seeds one unchecked goal in a `beforeEach` and returns its undo. A goal nobody has checked off is the entire fixture.

**Deleting a goal recounts nothing**, which is how the row goes stale: `goals_maintain_completion` fires on INSERT and UPDATE only, correctly, because production has no DELETE grant on `goals` and the suite is the only thing that removes them. `recountToday` forces the recount by writing `archived_at` back to itself — `UPDATE OF` fires on assignment, not on change — and both `deleteE2EGoals` and the seeder call it.

### The roster's goals are conditionally rendered, not collapsed

`today-roster.tsx` draws a member's goals as `{open ? … : null}`, so a **closed row has no goals in the DOM at all**. A photo, a title or a note asserted against a shut row reports "element(s) not found", which reads like the feature is broken rather than like the row is shut.

Open it first, and after any `reload()`, which closes it again. Asserting `toHaveCount(0)` on a shut row passes whatever the masking rule does — so pair every absence assertion with a presence assertion that proves the row is open.

### `assertOk` needs a `.select()`, and a write without one proves nothing

A bare `.update()` or `.insert()` through PostgREST returns `data: null`, and `assertOk` treats that as a failure — so the first symptom is a test dying on a line that worked.

The deeper reason to add `.select("id")` anyway: **RLS filters silently**. A write that matched no rows succeeds, so without asking for the affected rows there is nothing to tell it apart from one that landed. `setNoteSharing` in `app/actions/` has always done it this way; specs should too.

### `.upsert()` needs UPDATE on every column in the payload

PostgREST compiles it to `ON CONFLICT DO UPDATE SET <every column you sent>`. `goal_group_visibility` grants `authenticated` UPDATE on `hidden` alone, so `.upsert({ goal_id, group_id, hidden })` fails with a bare **`42501` naming the table** — which reads like a missing policy and is really a missing *column* grant.

Use `.insert()` when the row cannot already exist, which in a test that creates its own fixture is always.

### `npx playwright test --list` before a run, when a spec is new

It compiles every spec and runs nothing, in about two seconds. That is the only cheap check for a **load-time** error, which takes a whole file out of the run rather than failing one test.

The one that cost a run: `import.meta.url` in `photos.spec.ts`. There is no `"type": "module"` here, so Playwright compiles specs to CommonJS and `import.meta` is a syntax error before any test starts. `tsc` and ESLint both pass on it. **`env.ts` and `auth-state.ts` already resolve paths from `process.cwd()`**, which is the convention — Playwright's cwd is the directory holding the config.

### Never run `npm install` against this `node_modules` from a different OS

Native bindings are **optional dependencies chosen by platform**. `npm install` reconciles the entire tree, so running it from Linux against a Windows checkout prunes the `win32` binaries it thinks are unnecessary. The symptom lands later and elsewhere:

```
Error: Cannot find native binding.
Cannot find module '@rolldown/binding-wasm32-wasi'
```

which is `vitest` failing to start with an error naming a package nobody installed on purpose. `@tailwindcss/oxide`, `@next/swc`, `lightningcss` and `@rolldown/binding` all have the same shape.

**The fix is `npm ci`**, which wipes `node_modules` and installs exactly the lockfile. **Not** what npm's own error message suggests — deleting `package-lock.json` re-resolves every version in the project to work around one missing binary.

**To run the build or the tests from a Linux sandbox**, fetch the binary with `npm pack` and unpack it into `node_modules/` by hand. That adds a directory without touching the tree. `npm install --no-save` is *not* safe here: `--no-save` only protects `package.json`, not `node_modules`.

### `npm run build` is not optional, and neither typecheck nor lint replaces it

A `"use client"` component importing a **value** from a module puts that whole module in the browser bundle. If the module later grows `server-only`, the build fails — correctly, and with an error naming a file nobody edited. `tsc --noEmit` and `npx eslint .` both pass on it, before and after, because it is a bundler constraint rather than a type one.

CI runs the build for exactly this reason, **with no environment variables**: every page is server-rendered on demand and the Upstash client is built lazily, so a build that needs a secret is a bug worth failing on there rather than discovering on Vercel.

### The unit tests run in `node`, not `jsdom`

Not one of them touches the DOM: error hints, push copy, digest grouping, the CSP, violation-report parsing, all pure functions. `jsdom` was in the scaffold on the assumption that component tests would follow, and they did not — anything needing a real browser is a Playwright spec, because that is where a real browser is.

It stopped being free. `jsdom` 30 pulls in `undici`, which calls a Node API newer than the runtime CI was pinned to, and **all five test files failed to start**. Not one assertion ran, and the error named `cachestorage.js`. A dependency the tests do not use should not be able to stop them running.

CI now runs Node 22 and `.nvmrc` says the same, so the next dependency wanting a newer runtime says so at install time rather than as five unhandled worker errors.

**If a component test is ever written**, it opts in per file:

```ts
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest"
```

Both packages are still installed. There is no longer a global setup file.

### Playwright's text engine cannot see inside a `<script>`

`filter({ hasText })` and `getByText` deliberately skip `<script>` and `<style>` contents. A locator that tries to find the app's inline install script by its source does not fail, it waits out the full timeout and reports the assertion that follows it — so a missing *locator* reads as a missing nonce. Reach for `page.evaluate` and query the DOM directly.

The nonce itself has a second trap on top of that: once a nonced element is inserted, browsers move the value into an internal slot and blank the content attribute, so that a CSS attribute selector cannot exfiltrate it. `getAttribute("nonce")` returns `""`; only the `.nonce` IDL property still holds it.

### Ask what edit would turn a test red

Three assertions in steps 10 and 11 could not fail, and none of them looked wrong:

| | Why it was inert |
|---|---|
| "day six is absent" | It searched for the **ISO date**, which the panel never renders |
| Five install tests | Each planted `beforeinstallprompt` itself, so deleting the root layout's listener would still pass |
| Any date test in UTC | The correct code and the offset-shifting code agree there |

All three were found by reading, not by running. The habit that catches them: name the edit that should make this red, then check the test would notice.

### The test runner is deliberately not in UTC

`vitest.config.mts` sets `TZ` to `America/Los_Angeles`. Check-in dates are `YYYY-MM-DD` strings that have **already** had a timezone applied by `current_checkin_date()`, so `new Date(date)` re-applies an offset and shifts the day. In a UTC runner the correct code and the broken code agree, and the test becomes decoration.

`lib/digest-days.test.ts` asserts the runner is not UTC before trusting its own date assertions, and pins the trap directly: `new Date("2026-08-18").getDate()` is 17 there.

### Push copy is unit-tested, because nothing else can see it

The e2e suite cannot deliver a push and the sender runs on Deno, so the words that reach a lock screen had no reader at all. Copy fails silently: a body reading "undefined", or one naming a Circle somebody asked to keep private, looks fine in every log.

`teaser()` was split into `supabase/functions/send-digest-push/teaser.ts`, which imports nothing, so `lib/teaser.test.ts` can import it directly. **Without the `.ts` extension**, unlike `index.ts` beside it: Deno requires the extension and `tsc` refuses it, and the two coexist only because `supabase/functions` is excluded from the project's compilation while an import still pulls that one file in.

### The streak is not in the table the streak tests park

`getTodayData` reads `user_lifetime_stats.current_streak` and adds today; `daily_completion` is only what `lastStreak` walks. So `parkCompletionHistory` clearing history left the header still reporting a stored streak, and two tests passed for months purely because the owner's stat happened to be zero.

They failed the morning the **rollover cron** settled a completed day and made it 1. Same pattern as the unfinished day, with a new trigger: not another test's cleanup, but a scheduled job that runs whether the suite is running or not.

`parkCompletionHistory` now parks the stat as well and restores it last, unconditionally. These are real accounts, and a streak the suite silently zeroed is exactly the kind of thing that costs an afternoon.

### `tsc --noEmit` on its own fails on a clean checkout

`LayoutProps<"/">` and its siblings are **generated**, not shipped. Next writes them into `.next/types` during dev or build, so they exist on any machine that has run the app and on none that has not. CI checked out, installed, and ran `tsc` before building: "Cannot find name 'LayoutProps'" on a file that is correct.

`npm run typecheck` runs `next typegen` first, which writes the types without paying for a full build. CI uses that script, so the two cannot drift apart again.

### The iPhone gets its own project, not a second full run

`e2e/ios.spec.ts` runs under the `mobile-safari` project in WebKit; the Chromium project ignores it. Doubling the whole suite across engines would also double the Supabase auth requests, which is the budget the section above exists to protect.

**Playwright's WebKit is not iOS Safari.** Same engine, different shell, and it never installs a PWA, so it cannot show that push works from the home screen. It can show the branch an iPhone in a browser tab actually gets, which is the case most people meet first. Where the engines legitimately differ, those tests accept either honest answer and fail only on the thing that is wrong in every case: a screen with no way forward.

### Granting `notifications` does not grant notifications

`browser.newContext({ permissions: ["notifications"] })` succeeds, and headless Chromium still reports `Notification.permission === "denied"`. A test written around the granted path therefore renders the *blocked* branch, and times out looking for a button the app was right not to draw.

The permission dialog does not exist in a headless browser, so the honest split is: stub the **answer** with an init script, and let everything after it run for real, including `pushManager` and the write. `e2e/push.spec.ts` does that. Whether the dialog reads well enough to earn a yes is the manual pass, and always was.

### Four locator rules, all learned expensively

**`getByRole("button")` is not a list of your buttons in development.** Next injects an "Open Next.js Dev Tools" control, so a broad role query plus `.first()` can click something the app never rendered. The click succeeds, nothing expands, and the failure reports as a missing element several assertions later. Anchor on something the app owns: a member's name, a count, a test id.

**A locator used after an interaction must not describe the state that interaction changes.** `getByRole("button", { expanded: false })` stops matching the instant the click succeeds, so any follow-up assertion on the same locator resolves to nothing and reports as a different failure entirely.

**And assert the interaction landed, not just its consequence.** A click that silently misses looks exactly like a feature that silently broke. One `toHaveAttribute("aria-expanded", "true")` separates them, and its absence is what let a mis-aimed click masquerade as four different bugs across four runs.

**Never `getByRole("alert")`. Use `errorAlert` from `e2e/ui.ts`.** The dev overlay keeps an *empty* alert node on every page, and it is attached before the app does anything. So `getByRole("alert").textContent()` resolves against the decoy instantly and returns `""` — `textContent()` waits for attachment, which the decoy already satisfies. The sign-in spec failed with "no error shown for a wrong password" over a screenshot showing the error on screen. Worse, the decoy matched *alone* precisely when the real alert had not rendered, so the ambiguity never surfaced as a strict-mode violation: the query was least safe exactly when it looked least suspicious. `errorAlert` names the paragraph the app renders and requires it to say something.

**Check the computed accessible name before trusting `{ exact: true }`.** A `<label>` contributes all of its text to the name, so a hint or an error rendered *inside* the label becomes part of what the field is called: the password field was really named "Password At least 8 characters, with a letter and a number." and no exact match could reach it. A non-matching locator waits out the whole timeout rather than failing, so seven tests reported a form that would not enable. The failure snapshot prints the computed name — read it before changing the test, because the fix is usually the markup.

### Authenticating without Google

Solarity is Google OAuth only. Playwright cannot drive Google's consent screen, and automating it would be testing Google.

So `e2e/auth.setup.ts` asks the admin API for a magic-link token, redeems it with an ordinary anon client, and writes the resulting cookies as a Playwright storage state. No user is modified, no password is set, and nothing in the flow exists in production.

**The cookies are built by `createServerClient`, not by hand.** The session cookie is base64-prefixed, URI-encoded and chunked at 3180 characters, all three of which are `@supabase/ssr` internals that have changed before. Handing the library a cookie adapter that records instead of writing means it produces exactly what the app will later read, and an upgrade changes both sides at once.

### What the specs cover

| Spec | Flow |
|---|---|
| `invite.spec.ts` | generate, regenerate behind its warning, revoke, and that a superseded link reads as dead rather than 404ing |
| | archive a Circle, then confirm its pre-archive link takes the dead-link path |
| | signed-out preview, and that `next=` survives to the sign-in page |
| | a made-up token lands on `/`, not `/dashboard`, and reveals nothing |
| | a second account joins, and joining twice is harmless |
| `streak-decision.spec.ts` | the "settling in" marker is visible to the joiner as well as the owner |
| | owner keeps the streak; banner clears, grace ends |
| | reset asks first, cancelling leaves the decision pending, confirming resolves it |
| `rate-limit.spec.ts` | the per-IP invite limit trips, says why, and clearing it restores access |
| `install.spec.ts` | the nudge falls back to instructions when no install event exists, and skipping always continues |
| | a planted `beforeinstallprompt` becomes a real button; a dismissal leaves a way forward rather than an error |
| | an iPhone user agent gets the Share-sheet steps; signed out, the screen is behind sign-in |
| `push.spec.ts` | the permission screen never asks on render, only on a tap: the one thing a browser grants once |
| | a blocked browser gets the help links and no dead switch; a dismissal says nothing changed and re-offers |
| | a real grant either writes a row **or** says why, and the success heading never appears without the row |
| | settings offers the switch without asking on render; a blocked browser gets the explanation there too |
| | the toggle reports the **row**, not the permission, so a stale local subscription cannot read as "on" |
| | turning it on from settings says what happened, and the database agrees either way |
| `goals.spec.ts` | a goal can be created and archived from the dashboard, asserted on the screen **and** in the database |
| | archiving something already archived is refused in words, not silently |
| | a rotated subscription repairs itself **without ever prompting**: the ask count stays at zero |
| | the nudge offers notifications to someone who never decided, and links rather than asking |
| | dismissing it sticks across a reload, cookie and all |
| | it stays away from a blocked browser, and from one already subscribed, without ever prompting |
| `masking.spec.ts` | **no browser.** A circle-mate reads nothing of another member's goals or notes through the API; the roster returns them masked |
| `boundaries.spec.ts` | **no browser.** Rules the database enforces that no screen exposes |

**`boundaries.spec.ts` was written by walking the bug list rather than the feature list**, and every test in it is an instance of pattern five, *guarded on one path, not its inverse*:

| Covered | The inverse nobody had checked |
|---|---|
| Check-ins are dated by the database | Backdating **and** postdating are both refused, and nothing is written |
| A goal belongs to its owner | You cannot check in against someone else's goal, nor impersonate them writing it. Migration 64 changed what the trigger sees here, so it needed re-proving |
| Joining grants visibility | **Leaving revokes it.** The roster refuses a former member |
| Members can leave | **The owner cannot**, which is what made the solo-owner trap real and why `archive_circle` exists |
| A revoked link is refused | An **expired** one is a different branch, reached only by time passing, and had never run |
| The goal cap holds on INSERT | It also holds on **UPDATE**: un-archiving cannot take you to eleven |

That last one guards the test suite as much as the product, since `restoreGoalSlots` depends on it.

### Rules these tests follow

**Seed with the service key, assert through the UI.** `e2e/db.ts` fabricates exactly one thing, a 14-day group streak, because there is no way to earn one inside a test. Everything else goes through the browser. A test that seeds *and* asserts via the admin client proves the database works, which SQL already proved, rather than proving a person could get there.

**They run against the real project.** There is no local Supabase stack, so every spec cleans up after itself and names its Circles `E2E …`. A crashed run leaves rows: `npm run test:e2e:clean` removes them, matching on that prefix only.

**Cleanup deletes in a specific order, and the order is load-bearing.** Memberships first, then the notifications that deleting them produces, then the Circles.

Deleting `groups` first cascades into `group_members`, which fires `handle_membership_removal`, which inserts an `audit_log` row referencing `old.group_id`. Postgres removes the parent before cascading to children, so that row no longer exists and the insert fails on `audit_log_group_id_fkey` with `23503`. The whole delete rolls back, and every subsequent run inherits the mess: one failed run left 7 Circles and 11 memberships behind.

`audit_log.group_id` is `ON DELETE SET NULL` rather than `CASCADE`, which is why the FK cannot absorb this. It tolerates a group disappearing *later*, not a row written for a group that has already gone.

The notification step is not optional either. Because the service role has no `auth.uid()`, the trigger classifies the removal as a **kick** and writes a `kicked` notification per member. Those hang off `users`, not `groups`, so deleting the Circle leaves them in a real account's feed permanently. Three per Circle, measured.

**A route that 404s in `dev` is a stale `.next`, not a missing page.** Both `invite.spec.ts` lifecycle tests failed for a run with "waiting for getByRole('button', { name: 'Generate link' })" and a 30-second timeout. The trace's network log said what the assertion could not: `404 GET /circles/<id>/settings`, from the server, for a route that exists in the repo and had not been touched in that batch. Every other route in the same run served fine. `rm -rf .next` and a restart fixed it.

Two things ruled out on the way, both worth not re-deriving: `public/sw.js` has no `fetch` handler, so the service worker never intercepts navigations, and `proxy.ts`'s matcher excludes only static assets. The settings page's own guards are `redirect()` calls, which are 302s and never a 404.

**`generateLink` now asserts the "Circle settings" heading before reaching for a button on that page.** A control that is missing because the page never loaded should say so, rather than spending the test timeout blaming the control. The general form: before interacting with a page, assert you are on it.

**Dev-server flakiness has its own escape hatch.** `E2E_PROD=1 npm run test:e2e` runs against `next build && next start` instead of `next dev`. Worth reaching for when a failure looks like infrastructure: `dev` streams responses and compiles routes on first visit, so a server action can be interrupted and show up as "The destination stream closed early" in the log with a button stuck on its pending label. A test that fails under `dev` and passes under `E2E_PROD=1` found a dev-server artefact; one that fails under both found a bug.

**`e2e/diagnose.ts` exists because server actions fail invisibly.** When one does, the button keeps its pending label, the URL never changes, and Playwright reports only the timed-out assertion. Attaching it before an interaction records console errors, uncaught exceptions, failed requests and any non-200 on the action's POST, and folds them into the failure message.

**Serial, one worker.** The specs share two real accounts and Circle creation is capped at 5 a day per user, so parallel workers would race into a rate limit rather than into a bug.

**One Circle per run comes from the form. The rest come from the API.** `enforce("createCircle")` lives in the server action, not in the `create_circle` RPC, so `createCircleViaApi` spends nothing from the 5-a-day budget. Every spec that merely *needs* a Circle in order to assert something else uses it; only `invite.spec.ts`, whose subject is the form, pays. The suite used to create nine through the form against a cap of five, and clearing the budget mid-file was papering over that.

**The general form:** a test that needs state should not re-test the flow that produces it, and should not pay a production quota to do so. Ask which flow the test is actually about.

**`clearRateLimits()` still runs where a limit is genuinely in play** — `invite.spec.ts` for the form, `rate-limit.spec.ts` for the per-IP invite bound it deliberately exhausts. It scopes the reset to the two test accounts by user id, unlike `scripts/reset-ratelimit.mjs`, which clears everyone and is a development convenience.

**Sessions are minted once per account per run, not per context.** `auth.setup.ts` writes both to `e2e/.auth`, and `storageStateFor` reads them, minting only if a file is missing or older than 30 minutes. Every `verifyOtp` spends from Supabase's *auth* rate limit, which is hourly and shared across runs; a context each meant ~30 a run and the failure was not a clean error but 429s on refresh, which `@supabase/ssr` handles by silently dropping the session. Mysterious mid-run sign-outs were that, and nothing else. The age check matters because the files outlive an access token and `--project=chromium` skips the setup project.

**A fixture that asserts a count has to own the whole list.** `parkActiveGoals` archives every other active goal of the account under test for the duration, because "1 of 2" is a claim about the account and not about the seed. It is journalled to `e2e/.auth/parked-goals.json` *before* the write, and restored in three places: the test's `finally`, the file's `afterAll`, and `npm run test:e2e:clean`. Three, because a Playwright timeout kills a test without running its `finally`, and leaving a real person's goals archived is the worst thing this suite can do.

**Raising the limit was the wrong fix.** 5 a day is a product decision in `lib/ratelimit.ts`. A suite that quietly widens a production control to suit itself stops testing the product; clearing a budget is visible and scoped, changing the number is neither.

**The two accounts are interchangeable.** Nothing hardcodes a user id, email or username. `roster.spec.ts` reads a member's rendered name from the database rather than hardcoding it, and reads it with the same `coalesce(username, display_name)` the page uses. Swapping `E2E_OWNER_EMAIL` and `E2E_JOINER_EMAIL` only moves which account bears the Circle-creation load, which the reset above already handles.

### Playwright MCP

`.mcp.json` configures `@playwright/mcp` for driving a browser interactively, which is a different job from the suite above: one-off "what does this actually look like" checks rather than anything repeatable. It needs no install of its own; `npx` fetches it.

---

## Clearing test data

**Development only.** Nothing in the app does this, and nothing should: it is `postgres` bypassing RLS to erase rows the product deliberately gives no way to erase.

Deleting a Circle is **not** archiving. Archiving retires a Circle and keeps its history; deleting removes every trace it existed. Real users get archive, once it is built. Deleting exists here purely so a pile of Circles named "test" does not follow you around.

```sql
-- Look first.
select id, name, group_status, created_at from public.groups order by created_at;

-- Then remove by name, or by id if the names collide.
delete from public.groups where name in ('test', 'Morning crew');
```

What goes with it, all automatically:

| Table | What happens |
|---|---|
| `group_members` | deleted |
| `group_cycles` | deleted |
| `group_member_category_stats` | deleted |
| `digest_snapshots` | deleted |
| `invite_links` | deleted |
| `goal_group_visibility` | deleted |
| `audit_log` | **kept**, with `group_id` set to null |

`group_cycle_stats` and `group_daily_completion` hang off `group_cycles`, so they go when the cycle does.

`audit_log` is the deliberate exception. An audit trail that erases itself when the thing it describes is deleted is not an audit trail, so the rows survive with the reference cleared. Architecture section 3.

**Your own goals, check-ins and streaks are untouched.** They belong to you, not to any Circle.

---

## Forcing a rollover in development

**The hourly job finalizes *yesterday*, not today.** It selects users where

```
last_rollover_date < private.checkin_date_for(user) - 1
```

so a check-in made today only becomes eligible once the user's 2 AM boundary passes and today becomes yesterday. Waiting for the next `:05` after checking in does nothing, which is a slow and confusing way to learn that. Check first:

```sql
select left(u.username,8) as who,
       private.checkin_date_for(u.id)      as their_today,
       u.last_rollover_date,
       (u.last_rollover_date < private.checkin_date_for(u.id) - 1) as would_process_now
from public.users u;
```

`would_process_now = false` on every row means the scheduler has nothing to do and waiting is pointless.

### Forcing it

`run_daily_rollover(p_date)` bypasses the guard, which is the documented testing path. **It also advances `last_rollover_date` to the date passed**, so the later automatic run correctly skips that day. The scheduler will not double-count behind you.

What *will* double-count is running it twice by hand. The block below refuses to do that:

```sql
do $$
declare
  v_target date := '2026-08-12';   -- the day you checked in, in YOUR timezone
  v_already int;
  r record;
begin
  select count(*) into v_already
  from public.users where last_rollover_date >= v_target;

  if v_already > 0 then
    raise exception 'Refusing: % user(s) already rolled over through %. '
                    'Running again would double-count streaks.', v_already, v_target;
  end if;

  for r in select * from public.run_daily_rollover(v_target) loop
    raise notice 'users=% cycles=% locked=%',
      r.users_processed, r.cycles_processed, r.circles_locked;
  end loop;
end $$;
```

Then read the result:

```sql
select left(u.username,8) as who, s.current_streak,
       s.longest_streak_ever, s.total_days_completed
from public.user_lifetime_stats s
join public.users u on u.id = s.user_id;
```

An account that completed every active goal reads `1`. An account that did not reads `0`, which is the correct answer rather than a failure.

### Why not just wait

Waiting is the honest test and worth doing once, since it exercises the scheduler rather than a manual call. It is only unhelpful as a development loop: the wait is up to 24 hours, and nothing distinguishes "not yet eligible" from "broken".

---

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

---

---

## config.toml

`supabase/config.toml` exists with `project_id = "wyuadcnrxisqmzygzhzd"`. It is committed for one reason above all: it is the only version-controlled record of which Supabase project this checkout points at. The link state lives in `supabase/.temp/`, which is gitignored.

**What it does and does not govern.** It configures the *local* stack that `supabase start` would run. The hosted project is configured through the dashboard, and nothing in this file has been reconciled against it.

**Do not run `supabase config push`.** It applies the *resolved* configuration, so every value still at a CLI default would overwrite the corresponding dashboard setting rather than being left alone. The generated `[auth]` block is entirely stock, with a `127.0.0.1` site URL and no Google provider section. Pushing it would disable Google sign-in. The file carries this warning at the top and above `[auth]`.

**What `link` actually checks.** It compares the local `[db] major_version` against the remote server. A quiet "Finished supabase link" means it matched. It is not a full config diff, so silence is not evidence that the rest of the file agrees with the dashboard.

---

---

## Brevo & email ✅ configured 12 August

The walkthrough is gone; it was a one-time task. What survives is where things live and what will bite.

| Setting | Value |
|---|---|
| Host, port | `smtp-relay.brevo.com`, 587 |
| Username | the generated `…@smtp-brevo.com` login: a generated login, **not** the account email |
| Password | an SMTP key, **not** an API key |
| Sender | the project address, verified by 6-digit code |
| Configured in | Supabase → Project Settings → Authentication → SMTP Settings |

**Two caps, independent.** Brevo allows 300/day. Supabase separately caps 30 new users/hour under Auth → Rate Limits, and that one binds first.

**Minimum interval per user is 60 seconds.** A resend button pressed twice inside a minute is silently refused, so `/auth/check-email` needs a visible cooldown.

**Inactive SMTP keys expire after 90 days.** `.github/workflows/email-heartbeat.yml` sends monthly to prevent that and fails loudly if the credential dies. Needs four repository secrets: `BREVO_SMTP_LOGIN`, `BREVO_SMTP_KEY`, `BREVO_SENDER`, `BREVO_ALERT_TO`.

**Deliverability is unproven.** Delivered to the sender's own Gmail, which is the easiest case there is. Without a custom domain, SPF and DKIM cannot align, so mail to a stranger on another provider may be filtered: silently. `/auth/check-email` carries spam-folder copy as required text, not a nicety.

```bash
node --env-file=.env.local scripts/test-email.mjs you@example.com
```

### What `auth.setup.ts` guarantees before any spec runs

Three preconditions, each of which broke a large part of the suite once:

| Precondition | Why it exists |
|---|---|
| A session for all three accounts | Google OAuth cannot be driven by Playwright. `generateLink` + `@supabase/ssr` produce cookies the app will actually read |
| `today_screen_mode = "never"` | Step 9's gate diverts an unfinished day to `/today`, and neither test account finishes its goals |
| `terms_accepted_at` set | Step 20c's gate diverts to `/onboarding/terms`. Ten tests across four files failed on this once, every one of them reporting a missing landmark rather than a redirect |

**The shape to remember: a gate in `app/(app)/layout.tsx` is a precondition for every signed-in spec in the suite.** Adding one means adding a line here in the same commit, or a dozen tests fail somewhere that never mentions the gate.

Only the middle one is restored afterwards, by `global-teardown.ts`. Acceptance only moves forwards, and restoring null would make the three accounts used for manual testing meet the interstitial after every run.

### Testing the auth email flow locally (step 20)

**One project, one Site URL, two environments.** Supabase Auth has a single `Site URL`, and the email templates build their links from it. There is no per-environment value, so **an email triggered from `localhost:3000` still arrives with a link pointing at production**, where your local changes do not exist. The link works; it just tests the wrong build, which is worse than failing.

Three ways round it, in the order they are worth reaching for:

1. **Point Site URL at `http://localhost:3000` while working on the flow, and put it back when done.** One field, reversible, already permitted by the Redirect URLs list. This is the recommended habit and the reason `https://solarity-five.vercel.app/**` and `http://localhost:3000/**` are both allowlisted.
2. Pass `emailRedirectTo` on `signUp` and switch the templates to `{{ .RedirectTo }}`. Correct per environment, and `.RedirectTo` is **empty** for invites sent from the dashboard, which silently produces a broken link in the one flow used to smoke-test the setup.
3. Copy the `token_hash` out of the email and open `http://localhost:3000/auth/confirm?token_hash=…&type=email` by hand. Fine once, tedious as a habit, and it does prove the route in isolation.

**Whichever you choose, put Site URL back before deploying.** A production build whose confirmation links point at localhost is indistinguishable from working, right up until somebody who is not you signs up.

**The 60-second minimum interval above is the other thing that will look like a bug.** Testing signup twice inside a minute silently sends nothing: no error, no email. Wait, or use a different address.

---
