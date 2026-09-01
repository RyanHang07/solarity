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

Cheapest first. `lib/database.types.ts` is **current as of migration 95**; regenerate it after the next one.

```
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

## Make yourself an admin

**`/admin` does not exist for anyone until this runs.** Nothing in the app can create the first administrator, because there is nobody to authorise it — and a UI that could would be the highest-value target in the product. One statement, in the Supabase SQL editor:

**By email, which means a join.** `public.users` has no email column — email lives in `auth.users`, and the two share an id.

```sql
update public.users u
   set role = 'admin'
  from auth.users au
 where au.id = u.id
   and au.email = 'edgy.zedmain@gmail.com';
```

Confirm it took, since an email that matches nothing updates nothing and says so in the same way as success:

```sql
select au.email, u.username, u.role
from public.users u join auth.users au on au.id = u.id
where u.role = 'admin';
```

**The account has to have signed in at least once.** The row in `public.users` is created by the `on_auth_user_created` trigger, so an address that has never been through Google has nothing to update.

**Put the same address in `.env.local` as `E2E_ADMIN_EMAIL`.** The suite needs a *real* admin rather than one it makes: `admin.spec.ts` asserts that the last admin cannot be demoted, and a run that promoted a test account would have two admins, so the demotion would be allowed and the assertion would fail. `auth.setup.ts` mints a session for it like the other two, and the spec asserts the role is actually set — so a forgotten `update` fails with a sentence instead of a puzzling 404.

After that: `/admin` appears, a link shows up at the bottom of Settings, and further administrators can be granted from `/admin/people`. **You cannot demote yourself while you are the only one** — promote somebody else first. The column is in no client grant, so nothing but SQL or an existing admin can change it.

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
| 7 | Tap all five tabs. The bar must not flash or move | It lives in `(shell)/layout.tsx` and is never unmounted. A flicker means it is being rebuilt |
| 8 | Open a Circle-mate's profile from a roster row | Reached from the expanded panel, not the row |
| 9 | Toggle **Show my streaks and totals** off, then view your own profile | Your own stats show either way; only other people lose them |
| 10 | Block them. Their profile 404s. **Then check from their browser** | Mutual invisibility. The blocker cannot see this half |
| 11 | Unblock from Settings → Blocked | The only route back, because blocking hides the page Block was on |
| 12 | Report a photo, a note, and a profile | Three report types, one of them added by migration 88 |
| 13 | Achieve a goal, set a deadline in the past | Achieving is irreversible and confirms; a past deadline is legitimate and reads as overdue |
| 14 | Open the delete-account panel and **cancel** | Confirm the submit stays disabled until the username matches exactly |
| 15 | **Goals → a retired goal → its record.** Check a past day shows its note | Step 16. Photos older than 90 days are gone by retention, and the page must say so rather than show a broken frame |

**Still unverified anywhere:** every avatar row above, and a portrait/HEIC check-in photo.

### Found by the first manual pass, and fixed

| Report | Cause |
|---|---|
| Skeleton only appeared moving to and from Profile | **A loading boundary only fires for a navigation that changes the segment it sits in.** 15b moved `dashboard/loading.tsx` up to `(shell)/` on the assumption that one boundary above both covered everything below. It covered the one transition that already felt fast and none of the three 14a existed to fix. Both files are needed |
| Date picker text invisible on iOS; calendar icon black on black | `globals.css` swapped colour *variables* under `prefers-color-scheme` and never set **`color-scheme`**, which is the only thing that tells the UA which palette to draw its own widgets in. Chromium's calendar indicator is a fixed image rather than a themed control, so it needs an `invert(1)` as well |
| Avatar upload refused ordinary photos | The input cap was the **bucket's** 2MB. An iPhone photo is 3–5MB, and what actually gets stored is a 256px JPEG of tens of kilobytes. Two different numbers that had been one constant; the input cap is now 10MB and the bucket is unchanged |
| No photo on a Circle roster row | **Not a bug.** The roster shows *today*; the newest check-in photo in the database is three days old. Attach one today and it appears |
| Avatars were only on the profile | **The plan promised the roster and I built half of it.** Now on the roster row beside the name, in the header beside the username (linking to `/profile`), on the profile and in settings — all four through one `components/avatar.tsx`, down from two hand-rolled copies. **Migration 90** adds `avatar_url` to `circle_roster`, unmasked: an avatar is not about a goal, and it is the same picture any signed-in user can open on the profile. `getCircleRoster` now signs two batches in parallel, one per bucket |

---

## The core loop is closed

**Every numbered step is built.** Every reason and every bug is in `history.md`; this table is the index. What remains is verification and one unbounded item, both under **Open items** at the foot of this file.

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
| 15 | Profiles, and the moderation surface they carry | ✅ migrations 85–90. `/profile`, avatars, the stats toggle, blocking, reporting |
| 16 | The goal record | ✅ **no migration.** A fifth tab: `/dashboard/goals`, `/archived`, `/[id]` — every control, and a row per check-in day |
| 17 | The admin dashboard | ✅ migrations 91–95. Site roles, the report queue, triage, and who may moderate |

**What that means.** A person can sign in, set goals, check them off with a note and a photo, invite friends into a Circle, see who finished today, keep a streak, get a push when it matters, and read a five-day digest. **The premise the product exists to test is now testable.**

**What it does not mean.** Nothing has shipped to anyone yet. The rest of this file is what stands between here and that.

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

**Nothing is blocking, and every numbered step is built.** The migration workflow was the last entry here and it settled itself in practice over steps 10 to 13:

> Apply through the Supabase MCP, then **write the file under the version the server recorded** and prove `md5(prosrc)` matches. Migration 77 was applied and never committed; 79 and 81 were both recorded under a timestamp different from the filename I chose. The verification is the workflow.



### Before launch

**Four things, and only one of them is unbounded.**

| | | |
|---|---|---|
| 1 | **The first admin, by SQL** | Two minutes. `/admin` is unreachable and untestable by hand until it runs; the statement is at the top of this file |
| 2 | **A device pass for avatars** | Rows 1–6 of the manual pass. The only feature shipped with no run on real hardware, in the one pipeline that has failed on a device three times |
| 3 | **Regenerate `graphify-out/`** | Stale since steps 15–17 added roughly thirty files. `graphify . update`, then `node scripts/graph-freshness.mjs` |
| 4 | **The legal review** | The only unbounded item. `/privacy` and `/terms` were rewritten on 28 Aug for profiles, avatars, blocking, reporting and admin access, so a reviewer is reading something current. The section below says what to hand them |

**Also worth a run before any deploy:** `E2E_PROD=1 npm run test:e2e:ios`, which is the only pass that sees the CSP that ships.

**Closed since this list was written**

- ~~Security headers~~ — step 12.
- ~~`pushsubscriptionchange` handler~~ — step 10f. `sw.js` listens and `resubscribeIfPermitted` repairs a rotated endpoint without ever prompting.
- ~~Wire rate limits into each new action~~ — **every limit in `lib/ratelimit.ts` now has a caller.** `report` and `deleteAccount` were the last two, and neither was missing one by oversight.
- ~~A custom domain~~ — never needed. `*.vercel.app` is accepted as a Google OAuth authorized domain.



### Deferred to v2

- Replace the placeholder icons.
- All visual design. See `product-and-design.md`.
- ~~A moderation console~~ — **pulled out of v2 and made step 17.**

