# Part 6: verification

**Almost nothing in the suite can prove the galaxy.** That is the whole content of this part: a headless browser has no GPU, so the tests that look like galaxy tests would be green, slow, and about nothing.

---

## The standing sequence

**Run it after each part, not at the end.** The galaxy is additive on every surface, so a spec going red means it stopped being additive — which is the one thing this whole plan is built on.

From `../build-plan.md`:

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

**`npm run build` is the one that matters most in this pass**, and the one most likely to be skipped because the app looked fine in dev. It is the only thing that sees the import-graph defect in part 1 — `tsc` and ESLint both pass with PixiJS wired into the server bundle.

**`E2E_PROD=1 npm run test:e2e:ios` before any deploy.** The only run that sees the CSP that ships. Both CSP bugs so far were production-only *and* WebKit-only.

---

## The galaxy: what a headless browser can and cannot see

**Playwright's Chromium has no GPU in the default configuration**, so `mountGalaxy` either fails or falls back to a software path that is not what anyone runs. Writing e2e tests that drive the canvas produces the worst kind of coverage: green, slow, and about nothing.

### What to test, and where

| Layer | Where | Why it works there |
|---|---|---|
| **The row mapping** — goals → planets, achieved → stars, `shine` against a per-user check-in date | Vitest, `lib/galaxy/solarity/` | Pure functions over rows. This is where the real product logic is, and it is the half most likely to be wrong |
| **The migrations** | Rolled-back SQL proofs, **each with a negative control** | Part 4 lists them |
| **The route renders and stays usable** | Playwright | Assert the *page*, never the canvas: the goals list is there, the digest is there, the roster is there, the headings are right |
| **The canvas mounted at all** | Playwright, one assertion | `expect(host.locator("canvas")).toHaveCount(1)` — and **skip it rather than fake it if headless has no GPU**. A test that asserts a canvas exists when the mount silently failed is worse than no test |
| **Reduced motion** | Playwright, `{ reducedMotion: "reduce" }` context option | Does not need a GPU to prove the option reaches `mountGalaxy` |
| **Everything visual** | The device pass | There is no substitute and pretending otherwise is the mistake |

### The one e2e assertion that is worth real effort

**That the page works with the canvas absent.** It is the claim part 5 is built on, it needs no GPU, and it is exactly what a real user gets after a WebGL context loss.

Drive it by mounting the route in a context where the galaxy fails — a stubbed `mountGalaxy`, or simply the headless default — and assert every existing test still passes. **If `dashboard.spec.ts` survives part 3 untouched, and `roster.spec.ts` and `masking.spec.ts` survive part 4 untouched, that is the proof.** Masking especially: part 2 changes what the roster returns, and `masking.spec.ts` is what stops that becoming a leak.

---

## The device pass

**Everything on this list has failed in a browser while passing headless.** Rows 1–15 in `../build-plan.md` are the existing regression pass. These are the new ones.

### The personal galaxy, part 3

| | Check | Why |
|---|---|---|
| G1 | **Scroll past the compact galaxy with a thumb** | Pixi's pointer handling can swallow vertical drags. A mouse in a desktop browser will never show this |
| G2 | Check in → the planet shines, **no remount** | The whole point of `setSnapshot` over a re-render |
| G3 | Check in *immediately* after navigating to `/dashboard` | The dropped-update race, part 1 fix 4. If it was fixed this is boring; if not, the shine never appears |
| G4 | Achieve a goal → planet leaves, stars appear | Irreversible, so use a goal you are willing to lose |
| G5 | Achieve the 5th → the sky tier changes. The 6th → it does not | The two-systems trap. Both outcomes are the assertion |
| G6 | Navigate away and back ten times, watch memory | `destroy()` on unmount. A leaked WebGL context per navigation is the classic failure |
| G7 | **Background the installed PWA for minutes, return** | Context loss. There is no handler today, so this establishes whether it is a real problem before deciding to build one |
| G8 | Turn on Reduce Motion in iOS settings, reload | Thirteen call sites should go quiet |
| G9 | A brand-new account with zero goals | The empty galaxy. The most likely thing to render as a black rectangle and look broken |
| G10 | Both colour schemes, whatever 3a decided | A black panel in a light app is the decision; this is where you find out if it was the right one |

### The Circle galaxy, part 4

| | Check | Why |
|---|---|---|
| C1 | **A full Circle: ten members, ten goals each** | Up to 100 planets on a phone. The single-sun galaxy is bounded at ten and this is not. Measure it in the playground first, then confirm on hardware |
| C2 | A member joins → nobody else's position moves | A layout that reshuffles makes the Circle look different every day for no reason |
| C3 | **Two accounts, both finished** → the Circle-complete moment | Driven from `group_daily_completion`, which the group streak already depends on |
| C4 | A circle-mate's hidden goal | Coloured, no title. Confirm the title is genuinely absent rather than transparent |
| C5 | A `streak_grace` member | Joined mid-cycle, does not count against the streak. Must not block the complete state |
| C6 | An **archived** Circle | The roster is frozen at the instant of archiving. The galaxy must not animate data that stopped |
| C7 | Scroll to the roster underneath, on a phone | The galaxy pushes it below the fold on the screen people open to see who checked in |
| C8 | Return to the tab after some time | On-load and on-tab-return refresh. The canvas and the list must never disagree |

### The restyle, part 6 — when it happens

| | Check | Why |
|---|---|---|
| R1 | All six auth screens, on a phone | Never driven outside a desktop browser |
| R2 | Dark mode, every public screen | Tokens are defined in two arms and only one gets looked at |
| R3 | The date picker on `/dashboard/goals/[id]` in dark mode | Text was invisible once and the calendar glyph needed `invert(1)`. A fixed image, not a themed control |
| R4 | The tab bar, tapping all five | Must not flash or move. It is never unmounted; a flicker means a rebuild |
| R5 | A notched iPhone, header and any new bottom chrome | `env(safe-area-inset-*)`. The request and the compensation live in different files, which is why it broke before |

---

## Definition of done

| Part | Done when |
|---|---|
| 1 | `npm run build` passes **and** the client bundle for a route with no galaxy does not contain PixiJS. Read the build output; do not assume |
| 2 | Migrations 107 and 108 applied, files committed under the recorded versions, `md5(prosrc)` proven, backfill run and its row count recorded in `history.md` |
| 3 | The panel ships; `dashboard.spec.ts` passes **untouched**; G1–G10 on a real iPhone, installed |
| 4 | The topology has tests in `pixijs-galaxy`; `roster.spec.ts` and `masking.spec.ts` pass **untouched**; C1–C8 on hardware with two real accounts |
| 5 | This file |
| 6 | Deferred. R1–R5 when it happens |

**And then the standing items**: regenerate `graphify-out/`, `node scripts/graph-freshness.mjs` clean, and a new row in `patterns.md` for anything this pass finds — which, on the evidence of every previous step, it will.
