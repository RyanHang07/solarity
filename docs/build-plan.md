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


| #   | Step                                                      | State                                                                                                                                                 |
| --- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–7 | Auth, Circles, goals, check-ins, the Circle page, invites | ✅ 12–14 Aug                                                                                                                                           |
| 8   | Seeing each other                                         | ✅ 17 Aug, migrations 68–75                                                                                                                            |
| 9   | The daily check-in flow                                   | ✅ 18 Aug, migration 76. `/today`, the gate, the streak header                                                                                         |
| 10  | Install nudge, then push permission                       | ✅ migrations 77–78. **Manual pass done on an iPhone**; its eight flows are kept in `history.md`, because a permission dialog is one-shot per browser  |
| 11  | Digest boxes on Overview                                  | ✅ no migration. Five day boxes, a per-Circle roll call, digests out of the Notifications tab                                                          |
| 12  | Security headers                                          | ✅ no migration. Nonce CSP, HSTS, `Permissions-Policy`. `E2E_PROD=1 npm run test:e2e:ios` **before any deploy**: the dev CSP is not the one that ships |
| 13  | Check-in photos                                           | ✅ migrations 79–81. Upload, roster display, signed URLs, and a sweep for both kinds of orphan. **One manual pass outstanding**, below                 |


**What that means.** A person can sign in, set goals, check them off with a note and a photo, invite friends into a Circle, see who finished today, keep a streak, get a push when it matters, and read a five-day digest. **The premise the product exists to test is now testable.**

**What it does not mean.** Nothing below has shipped to anyone. The rest of this file is what stands between here and that.

---



## The one thing owed to a device

Step 13's manual pass. Four things no headless browser can reach: the iOS share sheet, EXIF orientation on a real portrait photo, a HEIC straight from a camera roll, and whether a roster of thumbnails feels fast on mobile data.


| #   | Flow                                                                       |
| --- | -------------------------------------------------------------------------- |
| 1   | iPhone, installed PWA. Check off a goal.                                   |
| 2   | Tap `+ photo`. **Sheet offers Take Photo, Photo Library, Choose File.**    |
| 3   | Take Photo. Shoot **in portrait**. Confirm.                                |
| 4   | **The photo is upright, not sideways.** This is the EXIF check.            |
| 5   | Photo Library. Pick a **HEIC** shot from the camera roll.                  |
| 6   | It uploads, or says to try a JPEG. Never a silent nothing.                 |
| 7   | Second account, same Circle. Open the Circle, open the member's row.       |
| 8   | Thumbnail appears. Tap it. It grows to the full image.                     |
| 9   | Scroll a roster with several photos. **Does it feel fast on mobile data?** |
| 10  | Owner: hide the goal in that Circle. Reload the other account. Photo gone. |
| 11  | Owner: `Remove photo`. Check-in survives, day still counts.                |
| 12  | Owner: add a photo, then `Undo`. **Dialog warns before deleting it.**      |
| 13  | Undo a goal with **no** photo. **No dialog.**                              |


**Step 4 is the one to be careful about**, because a sideways photo looks like a working feature and nothing will report it. **Step 2 is where** `Permissions-Policy: camera=()` **would surface** if the reasoning about `capture` versus `getUserMedia` is wrong.

---



## The public surface ✅ **done**

`/privacy`, `/terms`, `robots.txt`, `sitemap.xml`, and links from `/`, `/auth/sign-in` and `/settings`. **This was the gate on the Google OAuth consent screen** — until a privacy URL was publicly reachable, nobody outside the test accounts could sign in.


|                              |                                                                                                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/legal.ts`               | Every number the pages assert, annotated with the job that enforces it. `TERMS_VERSION` is a dated constant; **nothing records acceptance**, because Google sign-in never shows a checkbox and a column now would be declared with no writer |
| `components/policy-page.tsx` | One frame, so the two pages cannot drift apart                                                                                                                                                                                               |
| `lib/site-url.ts`            | The only place in the app that needs to know its own hostname. `NEXT_PUBLIC_SITE_URL`, then Vercel's, then localhost — the fallback is what keeps CI's **env-less** build working                                                            |
| `PUBLIC_PREFIXES`            | Extracted from the inline boolean in `proxy.ts`, matched as whole segments so `/termsomething` does not become public because `/terms` is                                                                                                    |


**The copy describes only what exists.** Account deletion is a deployed Edge Function with no UI, so the page gives an address rather than promising a button. That sentence becomes a link when `/settings/account` ships.

**Decisions:** individual rather than a company, contact `ryanhang07@gmail.com`, **18+**, dated version constant with no acceptance tracking.

**The assertion the whole spec exists for:** the sitemap must never contain `/join`. An invite token is a bearer credential, so enumerating them would publish every Circle. `sitemap.ts` cannot reach the database today and must never gain the ability — the test fails the moment somebody adds a helpful-looking `groups.map(...)`.

**Still open here:** the copy has not been reviewed by a lawyer, and it says so.

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
- **No** `min` **attribute.** Architecture section 3 keeps this deliberately unconstrained, since recording a missed or historical deadline is legitimate.

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
| `/settings/account`       | orphaned            | `export-data` and `delete-account` Edge Functions. Both deployed and verified, neither has UI. Self-serve deletion is an Apple requirement for any future store submission. |




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
- A custom domain, if email deliverability from a personal sender proves to be a problem.
- **Regenerate** `graphify-out/`**.** It was built at `e69212e` and is missing 13 tracked files: all of steps 11 and 12, and everything step 13 added.



### Deferred to v2

- Replace the placeholder icons.
- All visual design. See `product-and-design.md`.

