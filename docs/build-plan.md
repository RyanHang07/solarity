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

Cheapest first. `lib/database.types.ts` is **current as of migration 106**, hand-patched as a delta for steps 18 to 20: four RPCs, five enum values and six columns. Regenerate it properly after the next migration, preserving `graphql_public`, which the MCP generator omits.

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

**Everything below has failed in a browser while passing headless**, which is why the list exists at all. Rows 1 to 15 passed on 1 September; they are kept as the regression pass to repeat before a deploy, not as outstanding work.

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

**Rows 1 to 15 all passed on 1 September, on a real iPhone installed to the home screen.** The avatar pipeline was the last feature shipped with no run on hardware, and it needed no fixes: the label-opened picker, EXIF rotation, HEIC, all four render sites, the fixed key across two reloads.

### The galaxy, and the five new auth screens — **outstanding**

Rows 16 to 30 have never been run. **This is the whole of what is left before a deploy**, and everything on it needs either a device or a dashboard.

#### Getting the app onto the phone in the first place

**`npm run preview`** — `next build && next start -H 0.0.0.0`. Then `http://<your-LAN-IP>:3000` in Safari, with the phone on the same Wi-Fi.

**A production build, not `next dev`, and that is not fussiness.** Dev mode double-invokes every effect under StrictMode, ships an unminified bundle, and recompiles on navigation. Measuring frames there measures the dev server. `npm run dev:lan` exists for *iterating* on the phone; every number on this list comes from `preview`.

| Gotcha | |
|---|---|
| Find the IP | `ipconfig` on Windows — the IPv4 address of the Wi-Fi adapter, usually `192.168.…`. Not `127.0.0.1` |
| Windows Firewall | It will ask, or silently block, on the first inbound connection. Allow Node on **private** networks |
| **http, not https, and it works on purpose** | `upgrade-insecure-requests` would rewrite the page's own bundle to `https://192.168.…`, which nothing answers — and WebKit applies it where Chromium exempts localhost. `proxy.ts` derives `secure` from the *connection*, so a plain-http origin never gets the directive. That trap cost a whole debugging session once; it is handled |
| No service worker | An http origin is not a secure context, so the PWA will not install and push will not register. Irrelevant for the galaxy, and the reason the install flow is tested on the deployed URL instead |

#### The galaxy, on a phone

| | Check | Why it is on this list |
|---|---|---|
| 16 | **`/admin/galaxy-lab` at 10 × 10.** Reset the worst frame, then drag, pinch and step the counts. **Write the worst frame down** | 100 planets, each with a stencil mask, on hardware nothing has measured. 16.7ms is a clean 60; past ~50ms is a hitch a person sees. If it is bad, the fallback is an alpha-shaped albedo instead of the clip mask — measure before reaching for it |
| 17 | Same page: **one finger scrolls the page, two fingers pan the galaxy** | A mouse can never show this. The gesture is undiscoverable by design, and the pan buttons are the discoverable path |
| 18 | Open and close the viewhole **ten times in a row**, watching the worst frame | A view transition snapshots the page into textures, twice, over a live WebGL canvas. Free on a desktop, possibly the whole budget on an old phone |
| 19 | The same on **an iPhone older than iOS 18** | Safari shipped same-document view transitions in 18. Below it `transition()` falls back to an instant change — the honest floor, and worth seeing |
| 20 | Overview: the galaxy panel, then **check off a goal** | The planet lights optimistically, before the write returns |
| 21 | A Circle's Today tab: hover a member's planets on a desktop, then **tap them on a phone** | The name is a mouse affordance and must not stick to a touch screen |
| 22 | An **archived** Circle's sky | Frozen: orbits, backdrop and starfield still. The camera must still pan and focus |
| 23 | A Circle with a member who has **no goals** | An empty sun, and a sky that does not close. The rule the streak already has, shown rather than softened |
| 24 | Turn on **Reduce Motion** in iOS settings, then reload both surfaces | No view transition at all, and a still scene. Not a faster animation |

#### The five auth screens, never driven on a device

| | Check | Why |
|---|---|---|
| 25 | Sign up with a **new** email, on the phone | The whole front door, step 20, on hardware for the first time |
| 26 | The **first goal** screen: open the category picker and choose one | iOS draws a `<select>` as a wheel. This form shipped with a disabled placeholder — the exact defect step 16 fixed — and it was caught by an audit rather than by use |
| 27 | Confirmation email → the confirm link → onboarding | A deep link into an installed PWA behaves differently from a tab |
| 28 | **Forgot password**, all the way through | Never run outside a desktop browser |
| 29 | The landing page and `/support` at 375px | Deliberately plain, and never seen small |
| 30 | `E2E_PROD=1 npm run test:e2e:ios` | The only pass that sees the CSP that ships, and step 20h added two directives to it |

---

## The galaxy ✅ built

**Steps 21 to 27 are done and are written up in `history.md`** — the port, three migrations, both surfaces, the viewhole, the controls, a first goal at signup, and the lab that measures ten by ten on a device.

What is left of it is **not code**. It is the manual pass above, the design system below, and the two dials nobody has lived with yet:

| Dial | Where | What to weigh |
|---|---|---|
| `--viewhole-ms`, currently 420ms | `globals.css` — one value, read at runtime by `galaxy-card.tsx` | Long enough to read as a reveal, short enough not to be in the way twice a session |
| The page's 12px drop, and the camera's 1.3 / 0.82 | `globals.css`, `galaxy-card.tsx` | 12px was 24px and read as a second object with its own journey. It may now be too subtle to register |

**And one thing left out rather than ruled out**: tap-to-expand as a gesture. The control is a button because tapping a planet already opens that goal; a gesture is possible with a hit-test that defers to planets.

---

## The design system, and what still blocks it

**Deferred behind the galaxy, and blocked on one unanswered question:** what form the design system is in — Figma, tokens, references, or nothing yet.

The galaxy's own design question is answered. `--galaxy-sky` is a token in `globals.css`, deliberately outside the light/dark swap, because a galaxy is a night sky in both themes and the nine category colours were seeded to glow on black — `#FFD500` and `#6EE62E` are near-unreadable on white.

**What "unstyled" currently means.** Not that nothing has been styled — that styling was allowed to be provisional, on the explicit understanding that a design pass would come. Three surfaces named that deferral in writing while they were built:

| Surface | What was deliberately left plain |
|---|---|
| `/` | Semantic headings, real sections, readable at 375px, **nothing depending on styling to make sense** — chosen so the design pass is a restyle rather than a rewrite |
| The five auth screens | 20e to 20j. Forms with borders and gaps and no more |
| `/support` | Seven `<Answer>` sections and a `mailto:` |

**The rest of the app is not plain**, and that is the harder half: the dashboard, the roster, the Circle page and the goal record all carry hand-written Tailwind tuned per screen. A design system has to absorb those without regressing them.

### What is already in place, and what it constrains

| Fact | Consequence for the design pass |
|---|---|
| `globals.css` swaps colour **variables** under `prefers-color-scheme`, and sets `color-scheme` | Dark mode exists and is real. Any new token has to be defined in both, and `color-scheme` is what makes native controls draw correctly — it was a bug once |
| The tab bar lives in `(shell)/layout.tsx` and is never unmounted | A restyle must not make it remount. Manual pass row 7 checks exactly this |
| `env(safe-area-inset-*)` is consumed by the header | The layout already pays for `viewport-fit=cover`. New chrome at the top or bottom has to as well |
| **`script-src`** is nonce-based; **`style-src`** deliberately keeps `'unsafe-inline'` | Checked rather than assumed, and it came out the opposite way round to the guess: inline styles are fine, because `next/font` and Tailwind need them and a nonce on `style-src` would switch `'unsafe-inline'` off. So a CSS-in-JS library is not a CSP problem. **A design library that ships a `<script>` is**, and it needs a nonce or an origin in `lib/security-headers.ts`. Also: any new origin must go in both the dev and prod arms, which step 20h's Turnstile entry got wrong once |
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

**Two things left, and neither is a feature.**

| | | |
|---|---|---|
| 1 | **The manual pass, rows 16 to 30** | The galaxy on a phone and the five auth screens. It is one list above rather than three lists in three places |
| 2 | **Regenerate `graphify-out/`** | `graphify . update`, then `node scripts/graph-freshness.mjs` until it exits clean |

**Also worth a run before any deploy:** `E2E_PROD=1 npm run test:e2e:ios`, which is the only pass that sees the CSP that ships — and it matters more now, because step 20h added two directives to it.

**Closed since this list was written**

- ~~`npm run build`~~ — **green, 3 September**, with `pixi.js` installed and the renderer behind a dynamic import.
- ~~A green suite~~ — **green again, 3 September**, after the galaxy, three migrations and two new gates. The last full run had failed in three separate ways and every one was the test rather than the app: the terms gate was a new precondition `auth.setup.ts` did not meet; `getByLabel("Password", { exact: true })` could not match a field whose accessible name had absorbed its own hint; and `getByRole("alert")` was reading Next's empty dev-overlay node instead of the error on screen. All three are in `patterns.md`.
- ~~Security headers~~ — step 12.
- ~~`pushsubscriptionchange` handler~~ — step 10f. `sw.js` listens and `resubscribeIfPermitted` repairs a rotated endpoint without ever prompting.
- ~~Wire rate limits into each new action~~ — **every limit in `lib/ratelimit.ts` now has a caller.** `searchUsers` and `inviteUser` were the last two.
- ~~A custom domain~~ — never needed. `*.vercel.app` is accepted as a Google OAuth authorized domain.
- ~~The first admin, by SQL~~ — done 31 Aug. The statement is kept at the top of this file because it is the only way to make another one from scratch.
- ~~A device pass for avatars~~ — done 1 Sept on a real iPhone, rows 1–6. It needed no fixes.
- ~~The legal review~~ — **accuracy and sufficiency both done, 31 Aug.** Six defects fixed, then the controller, reasons, rights, transfer and cookie sections added. What remains is **exposure**, which is not a writing task: "no guarantees" and "we can close your account" are the two clauses most often unenforceable as written, and a one-person operation with no entity is personally liable for whatever they fail to cover. That is a decision about forming a company, not a paragraph.

**The one standing risk, written down rather than fixed.** Every RPC in the app is reachable directly at `/rest/v1/rpc/` by anyone holding a session, so the rate limits in `lib/ratelimit.ts` bound what the *app* does rather than what a determined caller can. `search_users` is the one where that matters most, because it is the app's only directory. Its real defences are in the database: three characters minimum, escaped wildcards, ten rows, and blocks excluded.

**Leaked-password protection is still off**, and it now matters in a way it did not before step 20: passwords exist. It is a paid-plan toggle in the Supabase dashboard, so it belongs on the launch list rather than in a migration.

### After the first design version

Turning Turnstile on, which is configuration in three dashboards and a decision about the six e2e tests it would break. The runbook is at the bottom of this file.

### Deferred to v2

- Replace the placeholder icons — **folded into the design pass above.**
- ~~All visual design~~ — **no longer deferred. It is the current work.** See the galaxy steps above and `product-and-design.md`.
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
