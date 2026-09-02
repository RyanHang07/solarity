# Part 6: the design system and the app restyle

**Deferred behind the galaxy, deliberately.** The scope question was asked directly on 1 September and the answer was "galaxy first, restyle later" — so this part is kept whole rather than cut, and nothing in parts 1 to 5 waits on it.

**One decision is needed early**, and only one: the galaxy's background in light mode. Part 3, step 3a. Everything else here can sit.

**Why keeping it is right rather than tidy.** The app is provisionally styled on an explicit understanding that a design pass would come, and three surfaces say so in their own source comments. Deleting the plan would not un-defer the work; it would just mean rediscovering the constraints below the next time somebody opens `globals.css`.

---

**This half is blocked on one answer, and the restyle below cannot start without it.**

---

## The question

**What form is the design system in?** Four answers, four different first tasks:

| Answer | The first task becomes |
|---|---|
| **A Figma file** | Translating it into tokens and components. The file is the source of truth and this document defers to it |
| **Tokens or a palette** — colours, type scale, spacing, radii | Defining them in `globals.css` and sweeping utility classes onto them. The shortest path, and everything below assumes it |
| **Screenshots or references** | Deriving a system before applying one. Add a step 0 |
| **Nothing yet** | Deciding the system, which is a design job before it is a code one. `product-and-design.md` section 4 is the existing brief and may already be enough to work from |

Everything below is written for the second answer, because it is the one that can be specified against. If the answer is the first, the token names change and the sequence does not.

---

## What already exists, and is not a blank slate

**Solarity is not unstyled.** It is *provisionally* styled, and the difference matters: there is no screen to invent from nothing, and every screen has a working layout that a token sweep can improve without redesigning.

| Fact | Consequence |
|---|---|
| **Tailwind v4**, via `@tailwindcss/postcss` | Tokens go in `globals.css` as CSS variables under `@theme`, not in a `tailwind.config.js` that no longer exists |
| `globals.css` swaps colour **variables** under `prefers-color-scheme` and sets `color-scheme: light dark` | Dark mode is real and already correct. **Every new token needs a value in both arms**, and `color-scheme` is what makes native controls (date pickers, scrollbars) draw in the right palette. It was a bug once |
| Chromium's calendar indicator needs `invert(1)` in dark mode | A fixed image rather than a themed control. Do not remove it while tidying |
| `env(safe-area-inset-*)` is consumed by the header | The layout already pays for `viewport-fit=cover`. New chrome at top or bottom must consume it too, or it loses its edge on a notched iPhone |
| **`script-src` is nonce-based; `style-src` deliberately keeps `'unsafe-inline'`** | Checked, and it came out opposite to the guess. Inline styles are fine — `next/font` needs them and every React `style={}` is one. **A design library that ships a `<script>` is the problem**, and needs a nonce or an origin in `lib/security-headers.ts`, in *both* the dev and prod arms |
| The tab bar lives in `(shell)/layout.tsx` and is never unmounted | Restyling it must not make it remount. Manual pass row 7 is the check |

---

## Where the tokens come from, if they are being derived

**Nine colours already exist and are load-bearing.** `goal_categories` was seeded in migration 4 with a slug, a name and a `color_hex`, and its column comment says why:

> Unused by v1 UI. Populated now so the deferred galaxy visualization can consume it later without a data migration.

So the category palette is **already fixed, already in the database, and already what the galaxy renders**. A design system that invents a second palette for categories creates two sources of truth for the same nine things, and the galaxy will keep using the first one.

| Slug | Name | Hex |
|---|---|---|
| `fitness` | Fitness | `#FF3131` |
| `hobbies` | Hobbies | `#FF8A00` |
| `career` | Career & Professional | `#FFD500` |
| `health` | Health & Wellness | `#6EE62E` |
| `finances` | Finances | `#00D9A3` |
| `productivity` | Productivity & Habits | `#1EC8FF` |
| `mindfulness` | Mindfulness & Mental Health | `#8A4FFF` |
| `social` | Social & Relationships | `#F730A8` |
| `other` | Other | `#3355FF` |

**These are saturated and were chosen to glow on black.** That is right for a galaxy and is a real question for the rest of the app: `#FFD500` on white is close to unreadable as text, and `#6EE62E` is not far behind. **The decision to take, rather than discover:** whether the app's category colour is the same value as the galaxy's, or a derived, contrast-corrected variant of it — a token like `--category-fitness-ink` beside `--category-fitness`.

The database value must not change to solve this. The column comment warns against it, and every goal already references the category.

---

## Steps: the design system

| | Step | Done when |
|---|---|---|
| 1a | **Answer the question above** | The remaining steps are written against a real source |
| 1b | **Define the token set** in `globals.css` under `@theme`, in both colour-scheme arms | `npm run build` passes and no screen has changed yet, which is the point |
| 1c | **Decide the category-colour question** — same values, or contrast-corrected pair | Written down here, with the contrast ratios that decided it |
| 1d | **One pilot screen, end to end** | Pick `/support` or `/auth/sign-in`: small, public, no state, and both are on the device-pass list anyway. Prove the tokens survive contact before sweeping twenty screens with them |
| 1e | **Icons** | The placeholder set in `public/` is on the v2 list and is part of this, not a follow-up. `manifest.webmanifest` references them |

**1d exists because of a pattern this codebase has hit twice**: a decision that looks settled on paper and is wrong in contact with one real screen. A pilot costs an hour and a sweep costs a day.


---

## The restyle

**Thirty routes and twelve shared components**, counted against the filesystem on 1 September rather than remembered.

---

### The rule the restyle holds itself to

**A restyle must not change what anything is called.**

Every locator in the e2e suite names a heading, a role, a label or a landmark, so the suite is exactly the check that a visual change stayed visual. If a spec goes red during this part, one of two things is true, and both are worth stopping for:

- the markup lost something a person needed, or
- the test was naming a class of thing it should never have named.

**One trap in particular**, because it cost seven tests on 1 September: a `<label>` contributes **all** of its text to the accessible name. Wrapping a field and its hint in one `<label>` is the shortest way to lay a form out, and it silently renames the field — the password input was really called "Password At least 8 characters, with a letter and a number.". If a restyle moves a hint inside a label to make it lay out better, it has renamed a control. `patterns.md` has the full shape.

**Run `npm run test:e2e` after each surface, not at the end.** The failure is cheap to read when one screen changed and expensive when twenty did.

---

## The surfaces, in order

Ordered by how much they are seen and how little they can break, so the tokens are proven on cheap screens before they touch the daily loop.

### Group A — public, stateless, already deliberately plain

These were built plain on the explicit understanding that this pass would come, and they carry that note in their own source comments.

| Route | Notes |
|---|---|
| `/` | Semantic headings, real sections, readable at 375px, **nothing depending on styling to make sense** — chosen so this is a restyle rather than a rewrite. It also has `<ExampleDigest />`, which is a component rather than a screenshot so it cannot go stale |
| `/support` | Seven `<Answer>` sections and a `mailto:` |
| `/privacy`, `/terms` | Both render through `components/policy-page.tsx`. **One component, two pages** |
| `/auth/sign-in`, `/auth/sign-up`, `/auth/check-email`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/error` | The five new screens plus the error page. **These are also the device-pass list in `../build-plan.md`**, so restyling them and running that pass once is strictly cheaper than doing it twice |
| `/join/[token]` | The first thing an invited person sees. Carries `robots: noindex` — do not lose it |

**`components/password-fields.tsx` and `components/legal-footer.tsx` are shared across most of this group.** Two files cover six screens.

### Group B — onboarding, seen exactly once per person

| Route | Notes |
|---|---|
| `/onboarding` | Username. `getByLabel("Pick a username")` — the label is not "Username" |
| `/onboarding/terms` | The interstitial. A dead end once accepted |
| `/onboarding/install` | Sits between account creation and the push ask, because push is the only reason installing matters |
| `/onboarding/notifications` | `components/push-toggle.tsx`, which has three states and not two — on, off, and **unknown**. The unknown state draws as a sentence and a "Check again" button. Do not restyle it into a switch |

### Group C — the daily loop, where care is highest

| Route | Notes |
|---|---|
| `/today` | The check-in screen and the gate |
| `/dashboard` | Overview: today's goals with their controls, a right-aligned *View goals* link, and the daily digest. The summary that used to restate the goals is gone — **do not reintroduce it while making the page look fuller** |
| `/dashboard/circles`, `/circles/[id]`, `/circles/[id]/settings` | The roster, the tabs, the streak header. Goals on the roster are **conditionally rendered, not collapsed** (`testing.md`) |
| `/dashboard/goals`, `/goals/archived`, `/goals/[id]` | The goal record. A row per check-in day, and a photo that may be gone to retention — the page says so rather than showing a broken frame |
| `/dashboard/notifications` | `lib/notification-types.ts` decides what appears here. `circle_activity` is push-only and must stay invisible |
| `/profile`, `/profile/[username]` | Your own stats show even with the toggle off; only other people lose them |
| `/settings` | The largest form surface in the app |

### Group D — admin, last and lightest

| Route | Notes |
|---|---|
| `/admin`, `/admin/people`, `/admin/reports/[id]` | Seen by one person. Legible beats designed |

---

## Shared components, which are the actual leverage

Restyling these twelve covers most of the thirty routes:

`avatar.tsx` · `checkin-photo.tsx` · `legal-footer.tsx` · `notice.tsx` · `password-fields.tsx` · `policy-page.tsx` · `push-denied.tsx` · `push-nudge.tsx` · `push-toggle.tsx` · `service-worker-registrar.tsx` · `skeleton.tsx` · `turnstile.tsx`

**Two of them are not decoration.**

- **`skeleton.tsx`** is the loading state, and there are two boundaries on purpose: `dashboard/loading.tsx` and `(shell)/loading.tsx`. A loading boundary only fires for a navigation that changes the segment it sits in, and collapsing them to one covered the transition that already felt fast and none of the three that needed it. **Both files are needed.**
- **`turnstile.tsx`** renders `null` with no site key, which is the current production state. It becomes visible in v3. Style it anyway, or the day the switch flips is the day it looks wrong.

---

## Steps: the restyle

| | Step | Done when |
|---|---|---|
| 2a | Group A, plus `policy-page.tsx`, `legal-footer.tsx`, `password-fields.tsx` | `npm run test:e2e` green; `legal.spec.ts` untouched |
| 2b | Group B, plus `push-toggle.tsx`, `push-nudge.tsx`, `push-denied.tsx` | `gates.spec.ts` and `sign-up.spec.ts` green |
| 2c | Group C — **one route per commit** | `dashboard`, `roster`, `goals`, `streak-decision`, `masking` specs green after each |
| 2d | Group D | `admin.spec.ts` green |
| 2e | `skeleton.tsx` and the two loading boundaries | Both transitions still show a skeleton, checked by hand — no test covers this |
| 2f | **The device pass**, rows 1–15 plus the six new auth screens | On a real iPhone, installed. Everything on that list has failed in a browser while passing headless. R1–R5 in part 5 |
