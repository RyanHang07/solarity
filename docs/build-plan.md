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

## Verify

Cheapest first. **Regenerate the types before anything else** — the last three migrations added functions and an enum value that `lib/database.types.ts` does not know about yet, and typecheck fails until it does. The command and the PowerShell UTF-16 warning are in that file's own header.

```
npx supabase gen types typescript --project-id wyuadcnrxisqmzygzhzd > lib/database.types.ts
rm -rf .next/dev

npm run typecheck
npx eslint .
npm run test:run
npm run build
npx playwright test --list
npm run test:e2e
node scripts/graph-freshness.mjs
```

| Command | Catches what nothing else does |
|---|---|
| `npm run build` | `server-only` in a client bundle. `tsc` and ESLint cannot see bundler constraints |
| `playwright test --list` | Compiles every spec without running one, so a broken spec fails in seconds rather than mid-suite |
| `E2E_PROD=1 npm run test:e2e:ios` | **The only run that sees the CSP that ships.** Both CSP bugs so far were production-only *and* WebKit-only. Before any deploy |
| `graph-freshness.mjs` | Exits non-zero when `graphify-out/` stops matching the repository |

**`rm -rf .next/dev` is not superstition.** `tsconfig.json` includes both `.next/types/**` and `.next/dev/types/**`, and **`next typegen` only writes the first**. The second belongs to the dev server. After moving a route file, typecheck compares a fresh route map against a stale one and reports six errors inside a generated file about paths you just moved. Only needed after a move or rename; harmless otherwise.

---

## The manual pass

**Everything below has failed in a browser while passing headless.** The avatar pipeline is the one piece with no device run at all yet.

### On a real iPhone, installed to the home screen

| | Check | Why it is on this list |
|---|---|---|
| 1 | Settings → **Add a picture** → Take Photo | The picker is opened by a `<label>`; `input.click()` on a hidden input silently returns nothing on iOS |
| 2 | Same, from **Photo Library** with a **portrait** shot | Orientation is applied by `createImageBitmap`, which retries without its options argument on older Safari. A sideways avatar means the retry path ran |
| 3 | Same, with a **HEIC** from the camera roll | HEIC decoding belongs to the browser. Safari can; Chrome on Android cannot, and must say so rather than fail silently |
| 4 | The picture appears on `/profile` and on a Circle roster row | The bucket is private; every render is a signed URL |
| 5 | **Replace** it, then reload twice | One fixed key, overwritten in place. A second object means the key is not fixed |
| 6 | Check in with a photo, add a note | The pipeline that took three device bugs to get right. Regression check |

### In any browser, signed in as two accounts

| | Check | Why |
|---|---|---|
| 7 | Tap all four tabs. The bar must not flash or move | It lives in `(shell)/layout.tsx` and is never unmounted. A flicker means it is being rebuilt |
| 8 | Open a Circle-mate's profile from a roster row | Reached from the expanded panel, not the row |
| 9 | Toggle **Show my streaks and totals** off, then view your own profile | Your own stats show either way; only other people lose them |
| 10 | Block them. Their profile 404s. **Then check from their browser** | Mutual invisibility. The blocker cannot see this half |
| 11 | Unblock from Settings → Blocked | The only route back, because blocking hides the page Block was on |
| 12 | Report a photo, a note, and a profile | Three report types, one of them added by migration 88 |
| 13 | Achieve a goal, set a deadline in the past | Achieving is irreversible and confirms; a past deadline is legitimate and reads as overdue |
| 14 | Open the delete-account panel and **cancel** | Confirm the submit stays disabled until the username matches exactly |

**Still unverified anywhere:** every avatar row above, and a portrait/HEIC check-in photo.

---

## The core loop is closed

**Steps 1 to 14 are built.** Every reason and every bug is in `history.md`; this table is the index.

| # | Step | State |
|---|---|---|
| 1–7 | Auth, Circles, goals, check-ins, the Circle page, invites | ✅ 12–14 Aug |
| 8 | Seeing each other | ✅ 17 Aug, migrations 68–75 |
| 9 | The daily check-in flow | ✅ migration 76. `/today`, the gate, the streak header |
| 10 | Install nudge, then push permission | ✅ migrations 77–78. **Manual pass done on an iPhone**; its eight flows are kept in `history.md`, because a permission dialog is one-shot per browser |
| 11 | Digest boxes on Overview | ✅ no migration. Five day boxes, a per-Circle roll call, digests out of the Notifications tab |
| 12 | Security headers | ✅ no migration. Nonce CSP, HSTS, `Permissions-Policy`. **`E2E_PROD=1 npm run test:e2e:ios` before any deploy**: the dev CSP is not the one that ships |
| 13 | Check-in photos | ✅ migrations 79–82. **Manual pass complete on a real iPhone**, including portrait EXIF orientation and a HEIC from the camera roll. **JPEG, not WebP** — Safari cannot encode WebP |
| 14 | What the loop deferred | ✅ migrations 83–84. Dashboard route segments, the code graph, achieving a goal, goal deadlines, account deletion. Also fixed `/robots.txt` and `/sitemap.xml`, which the proxy had been redirecting to sign-in |
| **15** | **Profiles, and the moderation surface they carry** | **current**. `/profile/[username]`. Brings `user_blocks`, `content_reports` and the `report` rate limit their first caller |

**What that means.** A person can sign in, set goals, check them off with a note and a photo, invite friends into a Circle, see who finished today, keep a streak, get a push when it matters, and read a five-day digest. **The premise the product exists to test is now testable.**

**What it does not mean.** Nothing has shipped to anyone yet. The rest of this file is what stands between here and that.

---

## 15. Profiles, and the moderation surface they carry — **current**

**Named, not planned.** `/profile/[username]` is where four things that already exist in the schema get their first caller:

| | |
|---|---|
| `user_lifetime_stats.visible_on_profile` | A column with no reader |
| `user_blocks` | A table with no writer |
| `content_reports`, and the `report` rate limit | **The last limit in `lib/ratelimit.ts` with no caller.** As built, reporting is a thing you do to *content*, not to a person — see below, the old note here had that backwards |
| `total_goals_achieved` | Written since migration 34, made un-inflatable by migration 83 in step 14c, and still read by nothing. This is the screen that reads it |

That third row is why this is step 15 rather than a loose end: the limit is not missing a caller by oversight, it is waiting for the screen it belongs to.

**The rule step 14e ended on applies here first.** `settings/page.tsx` refuses controls whose backend does not exist; `delete-account` was the mirror image, a finished backend nothing could call. **This step is four of those at once.** Whatever else it does, it should close them rather than add a fifth.

### What was decided

| Question | Answer |
|---|---|
| Who can see a profile | **Any signed-in user.** Not just Circle-mates, and not the public web |
| How that is done | **A masked `SECURITY DEFINER` RPC**, not a widened RLS policy |
| What the toggle controls | The four lifetime stats. Identity is always visible to a signed-in viewer |
| What blocking does | **Mutual profile invisibility**, and nothing else |
| Where reporting lives | **Both**: photos and notes on the roster, and the profile itself, via a new report type |
| Who can report | **Circle-mates only**, on every surface |
| What is on the page | Username, display name, member since, and the four stats |

### The pieces, and what each one turned on

| | Piece | Migration | The decision worth remembering |
|---|---|---|---|
| 15a | `profile_by_username` | 86 | **A masked RPC, not a widened policy.** RLS filters *rows*: relaxing `users_select_self_or_groupmate` would have exposed `checkin_timezone` and two preference columns along with the three profile ones. The function returns `created_at`, which `authenticated` cannot select at all — that is the point of it choosing. Same pattern as `circle_roster` |
| 15b | `/profile`, `/profile/[username]` | — | **Profile is the fourth tab, and that restructured the shell.** `dashboard/` and `profile/` now sit under `app/(app)/(shell)/`; a route group adds nothing to the URL, so all four tabs share one never-unmounted bar. `/today`, `/settings` and `/circles/[id]` stay outside it — `/today` is a full-screen gate a nav bar would undermine |
| 15c | The stats toggle | — | **The narrowest write in the app.** `authenticated` holds `update (visible_on_profile)` and nothing else on that table, because the counters are trigger-maintained. So no RPC: the policy and the column grant already say it |
| 15d | Block, unblock | 87 | **Blocking hides the thing it is undone from.** A blocked profile 404s, so Unblock lives in settings — and needs an RPC, because `users_select_self_or_groupmate` will not return a blocked account's username once you share no Circle |
| 15e | Reporting | 88 | **Reporting is about content, not people** — that is what the enum always said, and the old note in this file had it backwards. `user_profile` was added so a profile can be reported too |
| 15f | Avatars | 85 | **The `avatars` bucket was set to `image/webp`**: migration 82's trap, armed, one bucket over. And `avatar_url` held Google URLs that our own CSP blocks and nobody chose to publish |

### The rules these landed on

**Stats are opt-in; identity is not.** Username, display name, picture and join month are visible to any signed-in user. The toggle governs four numbers, and the copy says so — "hidden" read as "invisible" would be misleading by omission.

**Absent is not zero.** With the toggle off the RPC returns nulls and `stats_visible: false`, and the page says "hasn't shared their stats". Four zeroes would be true of a new account and false of someone withholding.

**You always see your own stats**, whatever the toggle says. Mirrors `user_lifetime_stats_select_visible`'s first clause.

**A blocked profile and a nonexistent one are the same 404.** Anything distinguishable turns "did they block me" into something anyone can probe.

**Blocking is mutual, and `private.is_blocked_by` only answers one direction.** The RPC tests both. Blocking does not remove either of you from a shared Circle — hiding a member from the roster would make the member count and group streak disagree between two people looking at the same Circle.

**Block needs no shared Circle; Report does.** Blocking is how you stop seeing someone. Reporting is a complaint a moderator must be able to act on, and `content_reports_insert_own` keeps that rule.

**A check-in report points at `<user_id>/<goal_id>/<check_in_date>`.** The roster returns `entry_id` for your own rows only, and a photo's signed URL dies in an hour, so neither is a reference a report can keep. `lib/report-reference.ts` owns the format and the resolving query.

**Avatars are one fixed key, `<uid>/avatar.jpg`, overwritten in place.** A timestamped key would orphan the previous image on every change and need the sweep job migration 81 exists for on the other bucket.

### Two traps, written down because they will recur

**A new enum value must land in its own migration.** Postgres allows `add value` inside a transaction and then refuses `unsafe use of new value` the moment anything references it. Migrations apply transactionally, so migration 88 adds the value and stops — no proof block, for exactly that reason.

**Safari cannot encode WebP**, and `canvas.toBlob` falls back to PNG silently while supabase-js sends `blob.type` rather than the `contentType` option. Three facts, none wrong alone. It cost three device bugs in step 13 and was sitting in the avatars bucket ready to cost them again.

### The security and resilience audit, before commit

**One real privacy defect, and it lived in a seam rather than in a file.**

`job_scrub_and_list_user_media` listed the avatar to delete only `where avatar_url is not null`. **"Remove picture" clears the column and deliberately keeps the object** — one fixed key, overwritten in place, nothing orphaned by a replacement. Each decision is defensible alone. Together: remove your picture, then delete your account, and **a photograph of your face outlives the account**.

**Migration 89** derives the key from the user id instead of reading the column. A deletion path must not ask permission of the state it is deleting. `md5(prosrc)` matches the file.

**Two smaller holes in `reportContent`, both from trusting a form:**

- **`content_type` was cast, not checked.** `contentType as ReportType` on a raw string is a lie to the type system; an unrecognised value reached Postgres and came back as `22P02`, which `toMessage` renders as "Something went wrong." Now narrowed against a literal list, which also means **`planet_avatar` cannot be filed** — it is in the enum for a feature that does not exist.
- **`content_reference` has no length CHECK** and is client-supplied `not null` text, so a report could have carried a megabyte of anything. Both valid shapes are exact, so it is validated by comparison rather than by a cap: a profile report must name the account it is about, and a check-in report must parse back through `lib/report-reference.ts`.

**Avatar uploads were unmetered.** `setAvatar` now enforces `photoUpload`, the same limit `attachCheckinPhoto` uses — an avatar and a check-in photo are the same act against the same budget. **It bounds recorded writes, not bytes**: the browser uploads directly to Storage, so the real bounds are the bucket's 2MB cap and `avatars_insert` confining a writer to their own folder. Clearing is not metered; it writes a null.

**What the audit cleared:** every `SECURITY DEFINER` function pins `search_path`, and **`circle_preview` is the only one `anon` can execute**, which is deliberate — `/join/[token]` serves signed-out visitors. `img-src` already covers the Supabase origin, so signed avatar URLs render without a CSP change. No secrets reachable from a client bundle.

### The audit of 14 and 15

Run as checks rather than as reading.

**Clean:** 0 syntax errors across 17 changed files; no `.rpc()` outside `app/actions/`; no `createAdminClient` in anything bundled; no `new Date("YYYY-MM-DD")` anywhere; no `import.meta` in any spec; no `server-only` module reaching a client bundle (four apparent hits were three comments and one erased `import type`). **Every rate limit now has a caller** — `report` and `deleteAccount` were the last two.

**Two real defects, both fixed:**

1. **Blocking left you on a page you had just made invisible.** The block happens on `/profile/[username]`, which needs the **route pattern** — `revalidatePath("/profile/[username]", "page")`. Passing the resolved URL silently revalidates nothing.
2. **A refused report said "You don't have access to that."** A policy refusal is a bare `42501` with no hint, and this policy refuses for one reason a person can act on.

**One gap closed by the audit:** `lib/report-reference.ts` had no unit test. It has one now, including `//2026-08-25` — three segments, two empty uuids, which a length check alone would accept.

### Still open in step 15

- **`content_reports` has a writer and no reader.** A moderation console is deferred to v2; the gap is closed by *documenting the process*, and **the step is not done until `security.md` says how a report reaches a human**.
- **`/privacy` should say a username and display name are visible to any signed-in user.** Enumeration is now possible by design.
- **No device run for avatars.** See the manual pass at the top.

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
| `/dashboard`              | built               | Overview: check-in panel with photos, goals with deadlines, five day boxes.                                                                                                  |
| `/dashboard/circles`, `/dashboard/notifications` | built | Sibling segments under a shared layout since 14a. The bar lives in the layout and is never unmounted; `?tab=` still redirects. Sections are data in `dashboard/sections.ts`. |
| `/circles/[id]`           | built               | Header, deadline, group streak, Members and Overview tabs, owner streak-decision banner. Closes the `sw.js` deep link.                                                      |
| `/circles/[id]/settings`  | built               | Invite link, revoke, regenerate, archive. Still to gain: deadline, roles, and the kick flow's "also block?" step.                                                           |
| `/notifications`          | orphaned            | `notifications`. The durable channel; push is best-effort.                                                                                                                  |
| `/profile/[username]`     | orphaned            | `user_lifetime_stats.visible_on_profile`. Where blocking lives.                                                                                                             |
| `/settings/profile`       | orphaned            | Rename path. Must surface *when* the next rename is allowed, not just refuse.                                                                                               |
| `/settings/notifications` | **partly absorbed** | The per-device push toggle and the Circle-name setting live on `/settings`. A per-device *list* is still unbuilt.                                                           |
| `/settings/account` | **absorbed** | Export and deletion both live on `/settings` and work. Deletion is gated on typing your username, warns which Circles change hands, and lands on `/?notice=account-deleted`. Self-serve deletion is an Apple requirement for any future store submission. |




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
- Wire rate limits into each new action as it is written. **Every limit now has a caller except** `report`, which waits on the content-reporting UI in step 15.
- ~~Regenerate `graphify-out/`~~ — step 14b. Current at 237 files; `node scripts/graph-freshness.mjs` says so and exits non-zero when it stops being true.
- **The legal review.** Still the only unbounded item on this list; the section below says what to hand a reviewer.



### Deferred to v2

- Replace the placeholder icons.
- All visual design. See `product-and-design.md`.
- **A moderation console.** `content_reports` gets its writer in step 15 and its reader is a documented query run by hand. That is honest for a one-person project with an invite-only user base, and it is the thing to replace first if reports ever arrive faster than one person can read them. A console means a review queue, an actioned/dismissed workflow, and an admin role the schema does not have — which is why it is v2 and not a corner of step 15.

