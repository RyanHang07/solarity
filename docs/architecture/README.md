# Solarity: Architecture

Friends in invite-only Circles see each other's daily progress. The database enforces the rules; the app renders them.

| File | Answers |
|---|---|
| [`schema.md`](schema.md) | What tables and columns exist, and what each constraint is for |
| [`security.md`](security.md) | RLS, grants, the error contract, response headers, photos, account lifecycle |
| [`time-and-streaks.md`](time-and-streaks.md) | Check-in dates, the 2 AM boundary, rollover, streaks, digests, scheduled jobs |
| [`app.md`](app.md) | Premise, stack, route and directory structure, Circles and invites, PWA and push, environment |

Sibling documents: `../build-plan.md` (what is left), `../patterns.md` (the twenty-seven bug shapes), `../testing.md` (how to run and verify), `../history.md` (why past decisions went that way).

---

## What exists

**Live and proven.** Google OAuth, onboarding, goals with a 10-active cap, check-ins with notes and photos-in-schema, Circles with invite links and roles, per-member and per-group streaks, daily digests, a notifications feed, per-Circle and global goal hiding, and a settings page.

**Since then**: the `/today` check-in flow (step 9), the install nudge and push permission with a per-device toggle (step 10), day boxes on Overview with a per-Circle roll call (step 11), the security headers (step 12), check-in photos (step 13), and the public surface — `/privacy`, `/terms`, `robots.txt`, `sitemap.xml`.

**82 migrations.** The database is the source of truth for every rule: caps, dates, visibility, streaks. The app cannot bypass one by mistake, because RLS and grants are checked before any query it writes.

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
| Every refusal carries a `HINT`, and the app branches on that | **24 raised by the deployed database, 24 resolved in `lib/errors.ts`, verified against `pg_proc` rather than against the migrations** |
| A notification naming a Circle carries `group_id` **and** `circle_name` | `notifications_payload_names_its_circle` |
| Grants are checked **before** RLS | So no policy rescues a missing grant, and a new column needs one deliberately |

---

## Caveats on what is built

- **`user_blocks`, `content_reports` and `user_lifetime_stats.visible_on_profile`** are schema with no UI. They are moderation and profile surfaces that arrive with `/profile/[username]`.
- **Check-in photos work on a real iPhone**, after three device-only bugs the suite could not reach. EXIF orientation on a real portrait shot and HEIC from a camera roll are still unconfirmed; the flows are in `build-plan.md`.
- **A dev run does not test the CSP that ships.** Development relaxes `script-src` so Turbopack works. `E2E_PROD=1` is the run that sees the real policy, and both CSP bugs found so far were production-only *and* WebKit-only. See `security.md` section 3b.

**Resolved since this list was written**

- **`archiveGoal` sent a client timestamp** into a `CHECK (archived_at <= now())` evaluated in Postgres, and clock skew was refused with a bare `23514`. Both writers now send the literal `"now"`, so the clock that judges the value is the clock that mints it. **The trigger this once prescribed was rejected**: a trigger that rewrites a caller's timestamp removes the error and keeps the lie.
- **The digest panel was one query per Circle.** Step 11 replaced it with a single `.in("group_id", …)` read across all of them.
- **Switching dashboard tabs re-rendered the whole page.** Each tab was a `<Link>` to `?tab=`, so every switch repeated the entire read — including the two tabs you were not looking at — as a serial waterfall, with no `loading.tsx` to paint meanwhile. Step 14a added the skeletons, split the reads per view, and then made each section its own route segment under a layout that holds the bar. See `app.md` section 6b.
- **Push had a sender and no subscribe flow.** Step 10 added `subscribe_push`, the permission screen, and the per-device toggle.
- **`/robots.txt` and `/sitemap.xml` were redirected to sign-in.** Neither was in the proxy's `PUBLIC_PREFIXES`, and the matcher excludes image extensions but not `.txt` or `.xml`, so a crawler — which is by definition signed out — got a 307 to `/auth/sign-in`. Found while running step 14c. **The legal spec passed through all of it**: it asserted the response contained `/privacy` and `/terms` and not `/join`, and the sign-in page satisfies all three because `legal-footer.tsx` is on it. Both tests now assert the content type first, so a redirect cannot masquerade as the document.
