# Solarity: Architecture

Friends in invite-only Circles see each other's daily progress. The database enforces the rules; the app renders them.

| File | Answers |
|---|---|
| [`schema.md`](schema.md) | What tables and columns exist, and what each constraint is for |
| [`security.md`](security.md) | RLS, grants, the error contract, response headers, photos, account lifecycle |
| [`time-and-streaks.md`](time-and-streaks.md) | Check-in dates, the 2 AM boundary, rollover, streaks, digests, scheduled jobs |
| [`app.md`](app.md) | Premise, stack, route and directory structure, Circles and invites, PWA and push, environment |

Sibling documents: `../build-plan.md` (what is left), `../patterns.md` (the forty-nine bug shapes), `../testing.md` (how to run and verify), `../history.md` (why past decisions went that way).

---

## What exists

**Live and proven.** Email-and-password *and* Google sign-in, onboarding, goals with a 10-active cap, check-ins with notes and photos, Circles with invite links and roles, per-member and per-group streaks, daily digests, a notifications feed, per-Circle and global goal hiding, and a settings page.

**Since then**: the `/today` check-in flow (step 9), the install nudge and push permission with a per-device toggle (step 10), day boxes on Overview with a per-Circle roll call (step 11), the security headers (step 12), check-in photos (step 13), and the public surface — `/privacy`, `/terms`, `robots.txt`, `sitemap.xml`.

**And since then**: the dashboard became five route segments under one never-unmounted bar, goals gained deadlines and an achieved state, accounts gained self-serve deletion (step 14); profiles arrived for any signed-in user with avatars, an opt-in stats toggle, blocking and reporting (step 15); a goal record kept every check-in day with its note and photo (step 16); and site roles gave `content_reports` its reader, in an admin dashboard scoped to the reported item and nothing else (step 17).

**And since then**: inviting a *person* by username rather than handing out a link (step 18); four intraday notification types with per-type switches (step 19); the front door — email and password, terms acceptance, a landing page and `/support` (step 20); and **the galaxy** on both surfaces, with a first goal and a sun colour chosen during onboarding (steps 21 to 27, plus migrations 110 to 112).

**112 migrations, and v1 functionality is complete.** The database is the source of truth for every rule: caps, dates, visibility, streaks, who may moderate, and who hears about what. The app cannot bypass one by mistake, because RLS and grants are checked before any query it writes.

**What is left is the design pass**, and nothing blocks it. The whole manual pass is run — thirty rows plus twelve re-checks, on a real phone, finding eight defects no headless test could reach.

---

## Standing invariants

These hold everywhere. Breaking one is a bug even if nothing fails.

| Invariant | Enforced by |
|---|---|
| A check-in's date comes from the **database**, never the client | `current_checkin_date()`, plus an INSERT policy requiring the submitted value to equal it |
| A day belongs to the user's own timezone, offset by 2 hours | `private.checkin_date_for`, from `checkin_timezone` and `now()` alone |
| Goal titles and notes reach only their owner, unless shared | `goals`/`progress_entries` scoped to `user_id = auth.uid()`; `circle_roster` is the only cross-member reader |
| Masking never applies to yourself | `is_self` exemptions in `circle_roster` and `can_view_checkin_photo` |
| Hiding conceals the title, never the commitment | Hidden goals still count in `total_count` and `daily_completion` |
| Every refusal carries a `HINT`, and the app branches on that | **33 raised by the deployed database, 33 resolved in `lib/errors.ts` — verified against `pg_proc` rather than against the migrations, and still 33 on 4 September after migrations 110 to 112** |
| A notification naming a Circle carries `group_id` **and** `circle_name` | `notifications_payload_names_its_circle` |
| Grants are checked **before** RLS | So no policy rescues a missing grant, and a new column needs one deliberately |
| An admin can read only what was **reported**, never a person's account | `admin_report_detail` returns one item, chosen by a third party. `users.role` is in no client grant at all |
| The galaxy is a **reward for using the app, never a way to use it** | Every route is fully usable with the canvas absent, and it removes itself rather than erroring. Nothing is reachable only by tapping a planet |
| A person's sun is the same colour everywhere they appear | One `sunPresetFor` in `snapshots.ts`, read by the personal galaxy and by `circle_roster` alike |

---

## Caveats on what is built

- **The first-goal screen cannot be reached by any e2e test**, and that is structural rather than an oversight. Its gate is "never created a goal", goal rows are never deleted, so no fixture account can be in that state — and minting one leaves an `auth.users` row nothing in the app can clean up. Its snapshot builder is unit-tested; the wiring is a manual row. That unreachability is why it shipped the disabled-`<option>` defect an audit caught rather than a person.
- **The admin surface has no first admin until one is made by SQL.** `/admin` is a 404 to everyone, including you, until `update public.users set role = 'admin'` runs. Nothing in the app can create the first one.
- **Check-in photos work on a real iPhone**, after three device-only bugs the suite could not reach. EXIF orientation on a real portrait shot and HEIC from a camera roll are both confirmed too, on 1 September.
- **A dev run does not test the CSP that ships.** Development relaxes `script-src` so Turbopack works. `E2E_PROD=1` is the run that sees the real policy, and both CSP bugs found so far were production-only *and* WebKit-only. See `security.md` section 3b.

**Resolved since this list was written**

- **Avatars had never run on a device.** Done 1 September, rows 1–6 of the manual pass, on a real iPhone installed to the home screen. The label-opened picker, EXIF rotation, HEIC, all four render sites, the fixed key across two reloads — **it needed no fixes**, which is the outcome the caveat did not predict.
- **The galaxy had never run in a production build, on any device.** PixiJS generates shader plumbing with `new Function`; `script-src` carries `'unsafe-eval'` in development and a nonce in production. Found by reading the reason the mount actually rejected with, off a phone, after three wrong guesses. `pixi.js/unsafe-eval` is the fix and `dashboard.spec.ts` now asserts the canvas renders, which turns that class of failure from silence into red.

- **`archiveGoal` sent a client timestamp** into a `CHECK (archived_at <= now())` evaluated in Postgres, and clock skew was refused with a bare `23514`. Both writers now send the literal `"now"`, so the clock that judges the value is the clock that mints it. **The trigger this once prescribed was rejected**: a trigger that rewrites a caller's timestamp removes the error and keeps the lie.
- **The digest panel was one query per Circle.** Step 11 replaced it with a single `.in("group_id", …)` read across all of them.
- **Switching dashboard tabs re-rendered the whole page.** Each tab was a `<Link>` to `?tab=`, so every switch repeated the entire read — including the two tabs you were not looking at — as a serial waterfall, with no `loading.tsx` to paint meanwhile. Step 14a added the skeletons, split the reads per view, and then made each section its own route segment under a layout that holds the bar. See `app.md` section 6b.
- **Push had a sender and no subscribe flow.** Step 10 added `subscribe_push`, the permission screen, and the per-device toggle.
- **`user_blocks`, `content_reports` and `visible_on_profile` were schema with no UI.** All three got their first caller in step 15: blocking from a profile with the list in settings, reporting from the roster and the profile, and the stats toggle. `content_reports` then had a *writer* and no reader, which step 17 closed with site roles and `/admin` — the same drift from the other direction.
- **`/robots.txt` and `/sitemap.xml` were redirected to sign-in.** Neither was in the proxy's `PUBLIC_PREFIXES`, and the matcher excludes image extensions but not `.txt` or `.xml`, so a crawler — which is by definition signed out — got a 307 to `/auth/sign-in`. Found while running step 14c. **The legal spec passed through all of it**: it asserted the response contained `/privacy` and `/terms` and not `/join`, and the sign-in page satisfies all three because `legal-footer.tsx` is on it. Both tests now assert the content type first, so a redirect cannot masquerade as the document.
