# Solarity: Build Plan

**Open work only.** Finished steps and their reasoning live in `history.md`; this file is read daily and should stay short.


| You want                          | Read            |
| --------------------------------- | --------------- |
| How it works now                  | `architecture/` |
| What keeps going wrong            | `patterns.md`   |
| How to run or verify it           | `testing.md`    |
| Why a past decision went that way | `history.md`    |



---

## Verify

Cheapest first. `lib/database.types.ts` is **current as of migration 110**, hand-patched as a delta since 106: four RPCs, five enum values and six columns for steps 18 to 20, then `goals.belt_visible` and the roster's new fields for 107 to 109. Migration 110 changed a function body only and needed no delta. Regenerate it properly after the next migration, preserving `graphql_public`, which the MCP generator omits.

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

## What is left: the manual pass

**Everything on this list has failed in a browser while passing headless**, which is why the list exists at all. Rows 1 to 24 are run and written up in `history.md`, along with the six defects they found. **This is the remainder, and it is the whole of what stands before a deploy.** Every item needs a device or a dashboard; none of it is code.

### Getting the app onto the phone

**`npm run preview`** — `next build && next start -H 0.0.0.0`. Then `http://<your-LAN-IP>:3000` in Safari, with the phone on the same Wi-Fi.

**A production build, not `next dev`, and that is not fussiness.** Dev mode double-invokes every effect under StrictMode, ships an unminified bundle, and recompiles on navigation. Measuring frames there measures the dev server. `npm run dev:lan` exists for *iterating* on the phone; every number on this list comes from `preview`.

| Gotcha | |
|---|---|
| Find the IP | `ipconfig` on Windows — the IPv4 address of the Wi-Fi adapter, usually `192.168.…`. Not `127.0.0.1` |
| Windows Firewall | It will ask, or silently block, on the first inbound connection. Allow Node on **private** networks |
| **http, not https, and it works on purpose** | `upgrade-insecure-requests` would rewrite the page's own bundle to `https://192.168.…`, which nothing answers — and WebKit applies it where Chromium exempts localhost. `proxy.ts` derives `secure` from the *connection*, so a plain-http origin never gets the directive. That trap cost a whole debugging session once; it is handled |
| No service worker | An http origin is not a secure context, so the PWA will not install and push will not register. **Rows A1 to A3 below need the installed app**, so those go through the deployed URL |
| **Google sign-in bounces to production** | `signInWithGoogle` builds `redirectTo` from the request's `Origin`, which is correct — but **Supabase silently falls back to the Site URL when a `redirectTo` is not in its allowlist**, so the flow completes on the deployed origin instead of the phone. Not a bug and not fixable in code: an allowlist that trusted whatever the caller asked for would be an open redirect. **Sign in with email and password on the LAN instead** |

### A. Re-verify the fixes from 4 September

**Eleven checks over the day's fixes, none yet seen working on hardware.** Lettered rather than numbered because they are re-checks of rows already run, not new ground.

| | Check | What would fail |
|---|---|---|
| A1 | **Installed to the home screen**, expand the galaxy | The frame clears the Dynamic Island, Close is tappable, and the camera bar clears the home indicator. This is the bug a browser tab cannot show |
| A2 | Same, landscape | The inset moves to the left or right, and the padding is on all four sides for that reason |
| A3 | Same, then rotate while expanded | The canvas re-measures through the `ResizeObserver`; the frame is `fixed`, so nothing else should move |
| A4 | **In the card, on touch**: drag one finger, then two | Neither should move the sky, and the page should scroll in both cases. The camera bar is the whole control set here, deliberately |
| A5 | **Expanded, on touch**: pinch, then two-finger drag | Both should now drive the scene, because nothing behind it can scroll |
| A6 | The `−` and `+` buttons on the touch camera bar | New. They are the only zoom a card has |
| A7 | **A Circle: tap a member's planet, then their sun** | The name appears both times, fades after about two seconds, and does not stick when you tap elsewhere. The sun should also fly the camera |
| A8 | Expand, focus a member, close — **then tap that same member's sun** | Closing returns to the default framing, and that one member must still respond. Before the fix they were silently dead after a reset |
| A9 | Reduce Motion on, then off **without reloading** | A line under the card appears and disappears with the setting |
| A10 | `/onboarding/goal` on a phone | The sun draws alone, choosing a category adds a planet in that colour with no belt ring, and the picker's placeholder is selectable. **Overlaps row 26** and can be done in one sitting |
| A11 | Invite somebody into a **brand-new** Circle without generating a link first | Migration 110. It should simply work |

### B. The five auth screens, never driven on a device

| | Check | Why |
|---|---|---|
| 25 | Sign up with a **new** email, on the phone | The whole front door, step 20, on hardware for the first time |
| 26 | The **first goal** screen: watch the sun draw, then open the category picker and choose one | Two things at once, and the only screen where either can be seen. **iOS draws a `<select>` as a wheel**, and this form shipped with a disabled placeholder — the exact defect step 16 fixed, caught by an audit rather than by use. **And the preview hangs off that same picker.** **No e2e can reach this screen**, and that is structural rather than an oversight: the gate is "never had a goal", goal rows are never deleted, so no fixture account can be in that state, and minting one leaves an `auth.users` row nothing can clean up. The snapshot builder is unit-tested; the wiring is this row |
| 27 | Confirmation email → the confirm link → onboarding | A deep link into an installed PWA behaves differently from a tab |
| 28 | **Forgot password**, all the way through | Never run outside a desktop browser |
| 29 | The landing page and `/support` at 375px | Deliberately plain, and never seen small |
| 30 | `E2E_PROD=1 npm run test:e2e:ios` | The only pass that sees the CSP that ships. **It has already earned its place**: PixiJS needs `new Function`, the dev policy allows it and the shipped one does not, so the galaxy had never run in a production build. `dashboard.spec.ts` now asserts the galaxy renders, which turns that class of failure from silence into red |

### C. The code graph

| | | |
|---|---|---|
| C1 | **Regenerate `graphify-out/`** | `graphify . update`, then `node scripts/graph-freshness.mjs` until it exits clean. Migration 110, `setPageScrollThrough`, `GalaxyPreview` and `buildFirstGoalPreview` are all missing from it |

### The regression pass, before any deploy

**Rows 1 to 15 in `history.md`** — avatars, the tab bar, blocking, reporting, achieving, deletion, the goal record. They passed on 1 September and are kept as a pre-deploy checklist rather than as outstanding work.

---

## The galaxy ✅ built

**Steps 21 to 27 are done and are written up in `history.md`** — the port, three migrations, both surfaces, the viewhole, the controls, a first goal at signup, and the lab that measures ten by ten on a device.

What is left of it is **not code**. It is the manual pass above and the two dials nobody has lived with yet:

| Dial | Where | What to weigh |
|---|---|---|
| `--viewhole-ms`, currently 420ms | `globals.css` — one value, read at runtime by `galaxy-card.tsx` | Long enough to read as a reveal, short enough not to be in the way twice a session |
| The page's 12px drop, and the camera's 1.3 / 0.82 | `globals.css`, `galaxy-card.tsx` | 12px was 24px and read as a second object with its own journey. It may now be too subtle to register |

**And one thing left out rather than ruled out**: tap-to-expand as a gesture. The control is a button because tapping a planet already opens that goal; a gesture is possible with a hit-test that defers to planets.

---

## The design system

**There is no design yet, and nothing is waiting on one.** This section is not a blocked task; it is the brief for when the pass starts, and the constraints below exist so they are known going in rather than discovered halfway. The pass depends on nothing above it and can begin whenever.

### The approach: a mock UI first, then extract, then replace

Three phases, in this order, and the order is the point.

| | Phase | What it produces |
|---|---|---|
| 1 | **Build a model UI**, by hand, off to one side. Buttons in every state, inputs, a select, a card, a list row, a heading scale, a panel, an empty state, an error | The mock. **Not a screen from the app** — a page of specimens, so a decision is made once against the component rather than five times against five screens that happen to use it |
| 2 | **Extract the repeated Tailwind into named classes**, using `@utility` or `@apply` in `globals.css` alongside the existing tokens | The vocabulary. This is the artifact the rest of the pass consumes, and it is derived from something that was drawn rather than guessed at up front |
| 3 | **Replace the placeholder markup systematically**, surface by surface, swapping hand-tuned utility strings for the named classes | The restyle |

**Why the mock comes first and is thrown at nothing.** A design system invented in the abstract produces tokens nobody can picture and classes that fit no real control. Drawing the specimens first means every class in phase 2 already has one correct rendering behind it, and phase 3 becomes substitution rather than judgement — which is what makes it safe to do a screen at a time, and what makes a half-finished pass leave a working app rather than a mixed one.

**Two things to hold onto while doing it**, both learned here already:

- **The mock is a page, so it can live at a route and be looked at on a phone.** `/admin/galaxy-lab` earned its keep exactly this way: the fix for "it looks wrong on mobile" is an instrument, not a guess. An admin-only route costs nothing and is the natural home.
- **Phase 3 is where the e2e suite is most at risk**, and it is also the thing that makes phase 3 safe. Every locator names a role, an accessible name, a label or a landmark, so swapping classes is invisible to it and swapping *markup* is not. Run the suite per surface, not once at the end.

The galaxy's own design question is answered. `--galaxy-sky` is a token in `globals.css`, deliberately outside the light/dark swap, because a galaxy is a night sky in both themes and the nine category colours were seeded to glow on black — `#FFD500` and `#6EE62E` are near-unreadable on white.

**What "unstyled" currently means.** Not that nothing has been styled — that styling was allowed to be provisional, on the explicit understanding that a design pass would come. Three surfaces named that deferral in writing while they were built:

| Surface | What was deliberately left plain |
|---|---|
| `/` | Semantic headings, real sections, readable at 375px, **nothing depending on styling to make sense** — chosen so the design pass is a restyle rather than a rewrite |
| The five auth screens | 20e to 20j. Forms with borders and gaps and no more |
| `/support` | Seven `<Answer>` sections and a `mailto:` |

**The rest of the app is not plain**, and that is the harder half of phase 3: the dashboard, the roster, the Circle page and the goal record all carry hand-written Tailwind tuned per screen. Those are not placeholders to be swapped, they are decisions that were made — so each one is a judgement about whether the system's version is better, and the honest answer will sometimes be no.

### What is already in place, and what it constrains

| Fact | Consequence for the design pass |
|---|---|
| `globals.css` swaps colour **variables** under `prefers-color-scheme`, and sets `color-scheme` | Dark mode exists and is real. Any new token has to be defined in both, and `color-scheme` is what makes native controls draw correctly — it was a bug once |
| The tab bar lives in `(shell)/layout.tsx` and is never unmounted | A restyle must not make it remount. Manual pass row 7 checks exactly this |
| `env(safe-area-inset-*)` is consumed by the header | The layout already pays for `viewport-fit=cover`. New chrome at the top or bottom has to as well |
| **`script-src`** is nonce-based; **`style-src`** deliberately keeps `'unsafe-inline'` | Checked rather than assumed, and it came out the opposite way round to the guess: inline styles are fine, because `next/font` and Tailwind need them and a nonce on `style-src` would switch `'unsafe-inline'` off. So a CSS-in-JS library is not a CSP problem. **A design library that ships a `<script>` is**, and it needs a nonce or an origin in `lib/security-headers.ts`. Also: any new origin must go in both the dev and prod arms, which step 20h's Turnstile entry got wrong once |
| Tailwind v4, configured in CSS rather than a JS config | The vocabulary from phase 2 belongs in `globals.css` beside `--galaxy-sky` and `--viewhole-ms`, as `@theme` tokens and `@utility` classes. There is no `tailwind.config.js` to add to, and adding one back would split the source of truth in two |
| The galaxy needs no CSP change at all | Checked directive by directive. `pixi.js` is bundled so `script-src: 'self'` covers it; textures are canvas-generated and `img-src` already allows `data:` and `blob:`; `worker-src` already allows `blob:`, widened in step 13 for the photo compressor. **Worth knowing before someone widens it just in case** |
| Placeholder icons are still in `public/` | Icons are on the v2 list and belong to this pass |
| The e2e suite locates by role and accessible name | A restyle that changes markup can break locators. `getByLabel` in particular reads **all** of a `<label>`'s text — see `patterns.md`, "a label that names more than the label" |

---

## Route map

Every route that exists, checked against the filesystem on 1 September rather than remembered. **This section was the stalest thing in the docs**: it carried six routes as "deferred" that step 20 shipped, and three as "orphaned" that have been linked for weeks.

### Public

| Route | Notes |
|---|---|
| `/` | The landing page (20i). Redirects signed-in visitors to `/dashboard`, and renders `Notice` because a signed-out visitor with a dead invite link lands here |
| `/auth/sign-in` | Google **and** password, one route. Keeping them together is what stops `next=` losing a hop |
| `/auth/sign-up` | Email and password only. Username moves to `/onboarding` so an unconfirmed account holds no handle |
| `/auth/check-email` | The holding screen. Resend with a visible 60-second cooldown, spam-folder line, and the Google rescue for the one person enumeration protection cannot help |
| `/auth/confirm` | Route handler calling `verifyOtp`. Serves both `type=email` and `type=recovery`; the token never survives the redirect |
| `/auth/error` | Maps `link` and `missing` to sentences; still a passthrough for OAuth messages |
| `/auth/forgot-password` | Always reports the same thing, for any address, including a rate-limited one |
| `/auth/reset-password` | Reached only with a session, because `/auth/confirm` already spent the token |
| `/auth/callback` | OAuth code exchange |
| `/privacy`, `/terms` | Versioned by `lib/legal.ts`. Acceptance **is** recorded as of migration 105 |
| `/support` | Content and a `mailto:`. Seven answers, every one a feature that shipped with nothing linking to it |
| `/join/[token]` | Preview works **signed out**; joining needs sign-in. Shows who is already in the Circle. `robots: noindex`, `Disallow: /join/`, never in the sitemap |
| `robots.txt`, `sitemap.xml` | `/join/` disallowed and absent; `/support` listed. Asserted by `e2e/legal.spec.ts` |

### Signed in

| Route | Notes |
|---|---|
| `/onboarding` | `complete_onboarding`, which now records terms acceptance on a first username set and **not** on a rename |
| `/onboarding/install`, `/onboarding/notifications` | The install nudge, then the one push prompt. Outside `(app)` so neither gate fires during signup |
| `/onboarding/terms` | The interstitial for accounts predating migration 105. Also outside `(app)`, or it would redirect to itself |
| `/dashboard` | Overview: the check-in panel, a right-aligned *View goals*, and five day boxes. No goals list — Today already names them |
| `/dashboard/circles`, `/dashboard/notifications`, `/dashboard/goals` (+ `/archived`, `/[id]`) | Sibling segments under a shared layout since 14a. The bar lives in the layout and is never unmounted; `?tab=` still redirects |
| `/profile`, `/profile/[username]` | Yours and everybody else's. Where blocking and reporting live |
| `/circles/[id]` | Header, deadline, group streak, Members and Overview tabs, owner streak-decision banner |
| `/circles/[id]/settings` | Invite by username, invite link, revoke, regenerate, archive |
| `/settings`, `/settings/export` | Username, timezone, picture, stats visibility, push, **four notification switches**, blocked list, export, deletion |
| `/admin`, `/admin/people`, `/admin/reports/[id]` | A 404 to everybody but a site admin |
| `/today` | The check-in screen and its gate |
| `/api/csp-report` | Early return in the proxy; never reaches the public check |

**Nothing is orphaned any more.** `/support` was the last gap: account deletion, the export, retention, reporting and blocking were all implemented and reachable only by somebody who already knew where to look.

### Protection

`PUBLIC_PREFIXES` in `lib/supabase/proxy.ts`: `/`, `/auth`, `/join`, `/privacy`, `/terms`, `/support`, `/robots.txt`, `/sitemap.xml`, `/_next`.

Keep the posture **deny-by-default**: enumerate what is *public*, so a forgotten route fails closed as a redirect to sign-in. Enumerating what is protected means a forgotten route fails open, silently.

**And the gate is four checks now**, in `app/(app)/layout.tsx`: session, confirmed address, username, terms. Each is a precondition every signed-in e2e spec has to satisfy — see `testing.md`, which is where the last one cost ten tests.

---

---

## Open items

### Blocking

**Nothing is blocking, and every numbered step is built.** The migration workflow was the last entry here and it settled itself in practice over steps 10 to 13:

> Apply through the Supabase MCP, then **write the file under the version the server recorded** and prove `md5(prosrc)` matches. Migration 77 was applied and never committed; 79 and 81 were both recorded under a timestamp different from the filename I chose. The verification is the workflow.

### Before launch

**One thing left, and it is not a feature.** The manual pass — sections A, B and C of "What is left" above. It is one list there rather than three lists in three places.

**Closed since this list was written**

- ~~`npm run build`~~ — **green, 3 September**, with `pixi.js` installed and the renderer behind a dynamic import.
- ~~A green suite~~ — **green again, 4 September**, after the galaxy's touch fixes, migration 110 and the first-goal preview. The run before that had failed in three separate ways and every one was the test rather than the app: the terms gate was a new precondition `auth.setup.ts` did not meet; `getByLabel("Password", { exact: true })` could not match a field whose accessible name had absorbed its own hint; and `getByRole("alert")` was reading Next's empty dev-overlay node instead of the error on screen. All three are in `patterns.md`.
- ~~The galaxy on a phone, rows 16 to 24~~ — **run 4 September.** Worst frame 17ms at 10 × 10, six defects found and fixed, one row skipped on purpose. Written up in `history.md`.
- ~~Security headers~~ — step 12.
- ~~`pushsubscriptionchange` handler~~ — step 10f. `sw.js` listens and `resubscribeIfPermitted` repairs a rotated endpoint without ever prompting.
- ~~Wire rate limits into each new action~~ — **every limit in `lib/ratelimit.ts` now has a caller.** `searchUsers` and `inviteUser` were the last two.
- ~~A custom domain~~ — never needed. `*.vercel.app` is accepted as a Google OAuth authorized domain.
- ~~The first admin, by SQL~~ — done 31 Aug. The statement is kept at the top of this file because it is the only way to make another one from scratch.
- ~~A device pass for avatars~~ — done 1 Sept on a real iPhone, rows 1–6. It needed no fixes.
- ~~The legal review~~ — **accuracy and sufficiency both done, 31 Aug.** Six defects fixed, then the controller, reasons, rights, transfer and cookie sections added. What remains is **exposure**, which is not a writing task: "no guarantees" and "we can close your account" are the two clauses most often unenforceable as written, and a one-person operation with no entity is personally liable for whatever they fail to cover. That is a decision about forming a company, not a paragraph.

**The one standing risk, written down rather than fixed.** Every RPC in the app is reachable directly at `/rest/v1/rpc/` by anyone holding a session, so the rate limits in `lib/ratelimit.ts` bound what the *app* does rather than what a determined caller can. `search_users` is the one where that matters most, because it is the app's only directory. Its real defences are in the database: three characters minimum, escaped wildcards, ten rows, and blocks excluded.

**Leaked-password protection stays off. Decided, not pending.** It is a paid-plan toggle in the Supabase dashboard that checks new passwords against HaveIBeenPwned. Recorded as a decision rather than deleted, so it is not rediscovered as an oversight: what the app does have is Supabase's own length and complexity floor, and the far larger share of accounts arrive through Google, where no password exists here to leak. Revisit if password sign-up becomes the common path.

### After the first design version

Turning Turnstile on, which is configuration in three dashboards and a decision about the six e2e tests it would break. The runbook is at the bottom of this file.

### Deferred to v2

- Replace the placeholder icons — **folded into the design pass above.**
- ~~All visual design~~ — **no longer deferred, and nothing blocks it.** The galaxy is built; the brief and its constraints are in "The design system" above, and in `product-and-design.md`.
- ~~A moderation console~~ — **pulled out of v2 and made step 17.**

---

## Deferred

**Designed, argued, and not built.** Each item keeps its reasoning so the decision does not have to be made twice.

### v3 — turn Turnstile on

**The code is done and shipped; the switch is off.** All three password endpoints render the widget and pass a `captchaToken`, and the CSP allows `challenges.cloudflare.com` in `script-src` and `frame-src`. What is left is configuration and one real trade.

**Why it is not on now.** One Supabase project serves both production and the e2e suite, and Playwright cannot solve a real challenge — so enabling it permanently breaks the six tests covering signup, confirmation and reset, which is the newest code in the app. Cloudflare's always-pass test keys were the third option and are worse than off: the dashboard would report CAPTCHA enabled while every bot passes.

**The order matters, and getting it wrong reproduces a bug already met twice.** Enabling before the deployed forms send tokens refuses every password endpoint with `captcha protection: request disallowed (no captcha_token found)`.

| | Step | Why |
|---|---|---|
| 1 | **Deploy the current code first** | The CSP change ships with the build. Enabling before deploying breaks production exactly as it broke local on 1 Sept |
| 2 | **`NEXT_PUBLIC_TURNSTILE_SITE_KEY` in Vercel**, then rebuild | `NEXT_PUBLIC_` values are inlined at build time. Present in `.env.local` is not present in production, and a missing key renders no widget and no token — the same error, a different cause |
| 3 | **The secret key goes in Supabase**, not the app | Supabase verifies the token. **Nothing in this codebase reads `TURNSTILE_SECRET_KEY`**, so the copy in `.env.local` is inert. Authentication → Attack Protection → CAPTCHA, provider Turnstile, secret from the *same* widget as the site key. A mismatched pair fails verification in a way that reads like a token problem |
| 4 | **Allowed domains in Cloudflare** must list `solarity-five.vercel.app`, plus `localhost` for dev | |
| 5 | **Then** enable the toggle, and test signup in a browser immediately | If it refuses, it is almost certainly step 2 or 3. Turning the toggle off restores everything with no code change |

**And decide what happens to the six tests.** Either accept losing that coverage, or stand up a second Supabase project for the suite — which is the real fix and is a bigger piece of work than this one.

### Digests stop being rows in `notifications`

**Why it is deferred rather than dismissed.** After step 11c a digest row exists only to carry a push: nothing renders it, and `read_at` never applies to it. The clean version is for `send-digest-push` to read `digest_snapshots` directly, leaving `notifications` to the four event types alone.

That would make the separation structural instead of a type filter, and would remove the standing risk that someone counts unread rows without excluding digests.

**The cost** is a rewrite of the sender's query and of how it tracks what it has already delivered — `pushed_at` lives on the notification row, so `digest_snapshots` would need an equivalent, per member rather than per Circle. That is a bigger change than step 11 warranted.
