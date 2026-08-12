# Solarity — Product & Design

**What the product is meant to be.** Build phases, naming, screens, and the deferred visual concept. `architecture.md` owns the schema, security model and server behaviour; `build-plan.md` owns the work queue.

**Scope rule**: this doc governs *build phasing*, *user-facing language* and *visual design*. It never renames schema. `groups` and `group_cycles` stay as they are in the database even though they display as "Circles" and "Cycles."

> **Only sections 1–3 apply to v1.** Naming affects copy and schema mapping, so it is live now. Everything about appearance waits for v2, and the galaxy waits for v3.

---

## 1. Build phases & identity

### Phases

| Phase | Scope |
|---|---|
| **v1 — functional** | Every feature works. **No visual design at all**: unstyled or near-unstyled markup, default Tailwind, no layout polish, no animation. The goal is proving the product works end to end. |
| **v2 — design** | Visual identity, layout, polish, responsive behaviour, empty states, transitions. Applied to screens whose behaviour is already settled. |
| **v3 — galaxy** | The visualization and its cosmetics system (section 5). |

**Why design is deferred past v1.** Styling a screen whose behaviour is still moving means doing it twice. The functional core is large — Circles, check-ins, streaks, digests, invites, moderation — and every one of those screens will change shape as it meets real use. Design applied afterwards is applied once, to something that has stopped moving. v1 is therefore judged on "does the streak increment correctly", not "does it look right". **Ugly and correct is the target.**

### Identity

**Solarity** — Solar + Solidarity. Each user is their own sun; the "-arity" carries the friends-motivating-friends premise.

**Vision**: friends who see each other's progress toward their goals motivate each other to keep going.

Copy should stay close to that sentence rather than drift into generic habit-tracker language.

---

## 2. Vocabulary

| Schema | User-facing | Status |
|---|---|---|
| `groups` | **Circle** | settled |
| `group_cycles` | **Cycle** | settled |
| groups-at-a-glance subtab | **Overview** | settled |
| `progress_entries` | **Check-in** | settled |
| individual streak | **Streak** | settled |
| `achieved_at` | **Achieved** | settled — matches `total_goals_achieved` and Achievement Track |
| group streak | **Group Streak** | open — alternatives: Collective Streak, Group Momentum |
| `digest_snapshots` | **Digest** | open — accurate but clinical for something meant to motivate; alternatives: Daily Recap, Roundup |
| leaderboard | **Leaderboard** | open — could go thematic once the galaxy ships |

Open items are cosmetic and better decided against real screens than in the abstract.

---

## 3. Screens (v1)

Home dashboard, Circle page, Profile page, Notifications. Plain functional names; primary navigation is not the place for invented vocabulary.

**Home dashboard (v1)**: check-in panel, Circles list, Overview subtab, notifications subtab. The galaxy replaces this in v3 — see section 5.

**Onboarding needs an "add to home screen" step.** Not cosmetic: web push on iOS only works for an installed PWA, and iOS offers no native install prompt, so a user who skips it silently gets no notifications at all. Copy still to write.

**Invite failure states need distinct copy.** The database returns machine codes (`INVITE_EXPIRED`, `CIRCLE_FULL`, `CIRCLE_LOCKED`, `CIRCLE_ARCHIVED`, `INVITE_REVOKED`, `INVITE_INVALID`); the UI should branch on those rather than on message text. See `architecture.md` section 10 for which cases are deliberately indistinguishable and why.

---

## 4. Deadline wording

The deadline date is the **last playable day** — a deadline of March 15 means March 15 is fully playable and the circle locks at the 2 AM rollover on the 16th. Wording should make that unambiguous rather than showing a bare date.

---

## 5. Galaxy system — v3, deferred

**Not in v1 or v2 scope.** Documented because the design work is done. Nothing here gets built until the functional core — users, goals, Circles, check-ins, digest, notifications — works end to end.

### Metaphor

| Element | Meaning |
|---|---|
| **Sun** | the user. Chosen once at onboarding, fixed centre of the scene. |
| **Ring** | one per active goal. Appears when a goal is created. |
| **Planet** | that goal's daily state. Shines on check-in, neutral otherwise. Tapping a planet (not its ring) opens the goal. |
| **Star** | permanent background progress. A burst is added when a goal is achieved. |
| **Nebula** | a cluster of stars, blending category colours. |

Ring and planet colour come from the goal's category (`goals.category_id`, required at creation — no uncategorized state, so no fallback colour is needed). The palette is nine vivid colours, fixed in `architecture.md` section 3.

**Achieving a goal removes its ring and planet entirely** and converts them into category-coloured stars. Nothing sits around half-finished; finishing something turns it into permanent background progress. This is what keeps the "always growing" quality of the scene.

This is a decorative layer over the same data the functional dashboard uses (`goals`, `daily_completion`, `achieved_at`, `user_lifetime_stats`), not a replacement for the check-in UI.

### Vocabulary status

Sun, Ring, Planet, Star, Nebula are locked in — the metaphor only holds if the vocabulary is consistent.

Still open: the **Unlock Track System** name itself (could stay functional or go thematic: "Constellation Paths," "Orbit Paths"), the **Streak / Consistency / Achievement Track** names, and the **"Flagship"** tier name. All three are placeholders that can wait until the art exists.

### Settled decisions

- **Renderer: PixiJS.** WebGL-backed sprite and particle performance on iOS Safari. Budget ramp-up time — scene graph, sprite batching, texture atlases — as its own task rather than learning it mid-build.
- **Animation: trigger-once, plus Page Visibility pause.** Effects play on the triggering event and settle static; everything halts when the app isn't foregrounded. This is the single biggest battery/performance lever available.
- **Reduced motion**: auto-detect `prefers-reduced-motion` and fall back without asking.
- **Placement**: the galaxy becomes the home dashboard when it ships, replacing the v1 layout. That means it gates first paint on every open, which is what makes the caching strategy below load-bearing rather than optional.
- **Device floor**: recent-generation iPhone, not SE-class.
- **Sun customization**: 4 options at onboarding, more unlocked via the Consistency Track.
- **Equipped styles**: unlocking makes a style *available*, not active. If nothing is equipped, render the **highest-tier unlocked** style so a new unlock is visible immediately. Per-goal for planets, per-user for sun and nebula.
- **Star visual variation**: size and twinkle vary per star, seeded so it's stable across renders, and deliberately **not** tied to the significance of the achievement that produced it.
- **Nebula blending**: up to 3 category colours, randomly chosen from those present in the cluster, and only once the user has achieved goals in **5+ different categories**. Below that there isn't enough diversity for blending to look intentional.
- **Cross-user visibility**: opt-in per user, viewable through a lazy-loaded tab on that person's profile — not inline in the composite view.
- **Initial load**: cached snapshot renders instantly, live data hydrates behind it, via Upstash Redis. See the data model below.
- **Asset hosting**: texture atlases on Vercel's edge network, one per reward category, not Supabase Storage. Only equipped styles load on first render; the full library loads when a style-picker opens. See the data model below.
- **Custom sun cutouts**: a user may overlay a hand-cropped face cutout on their sun. Per-user, so it appears in every Circle they're in. Needs a report button and manual review path (`content_reports.planet_avatar`).

### Group composite view

Members' galaxies combine into one scene — a galaxy of galaxies, bounded at 10 by the member cap. Zooming into a member expands to their full galaxy via a **distinct route transition**, for clean separation.

**This is a level-of-detail problem, and it's the main performance risk.** Zoomed out, each member renders a lightweight stand-in (sun, maybe a ring count), never their full star field. Full detail renders only for the galaxy being zoomed into. A DOM/CSS approach would need 10× the node count of a single galaxy rendered at once, which is the concrete reason the renderer needs sprite-complexity swapping.

Caching: a per-group Redis hash (`group_composite:{group_id}`), patched per member rather than recomputed. See the data model below.

### Open questions

1. **Unlock tier spacing and count.** Structure is settled (independent tracks per metric, see the data model below); what's open is whether tiers are front-loaded or evenly spaced, and how many planet styles to plan for. Decide when the art pool is being scoped.
2. **Star count scaling.** Visual traits are randomized rather than achievement-linked — settled. Whether the *number* of stars per achievement scales with streak length, or stays flat, is not.
3. **Unbounded star growth.** Every achievement adds stars, forever. A long-lived account eventually becomes a rendering liability, and there is currently no cap or aggregation strategy. The nebula clustering is the obvious hook for one, but the trigger and thresholds aren't defined.

### Data model

Deferred with the rest of the galaxy, but designed. Nothing below exists in the database yet.

#### `galaxy_stars`
An append-only ledger of star-generation events rather than deriving stars from `goals` at render time — keeps the frontend query to a single table and survives the source goal being edited or archived.

- `id`, `user_id`, `goal_id`, `created_at`
- `category_id`, `color_hex` — **denormalized at time of achievement**, so changing a goal's category later doesn't retroactively recolour past stars
- `star_count` (small int, in case volume is tuned by streak length later)

Inserted by the same flow that sets `goals.achieved_at`. Being a discrete replayable history is what makes nebula aggregation possible without touching goals data.

#### `users` additions
`planet_avatar_url`, `planet_avatar_crop` (jsonb) — the hand-cropped sun overlay, per-user so it appears in every Circle. Crop params are kept so it can be re-edited without re-uploading.

#### Unlock tracks
`unlock_tracks` (`name`, `metric`, `reward_category`), `unlock_tiers` (`track_id`, `threshold_value`, `tier_order`, `reward_reference`), `user_unlocks` (`user_id`, `tier_id`, `unlocked_at`).

Populated by a trigger on `user_lifetime_stats`. **Keyed off `longest_streak_ever`, not `current_streak`** — these are permanent rewards, so a broken streak shouldn't revoke something already earned. Adding tiers later is a data insert.

| Track | Metric | Reward | Thresholds |
|---|---|---|---|
| Streak | `longest_streak_ever` | Planet styles | 3, 7, 14, 30, 60, 100, 180, 365 |
| Consistency | `total_days_completed` | Sun styles | 3, 7, 14, 25, 50, 75, 100, 200, 365, 500, 750, 1000 |
| Achievement | `total_goals_achieved` | Nebula effects | 1, 3, 7, 15, 30, 50, 100, 200 |

Front-loaded deliberately — a fast first reward, wider gaps for long-term retention. The final tier on each is a prestige reward.

**Equipped styles**: `users.equipped_sun_style_id`, `users.equipped_nebula_style_id`, `goals.equipped_planet_style_id` (per-goal, since each goal has its own planet). When null, render the **highest-tier unlocked** style so a fresh unlock is visible without a manual step.

#### Caching
Per-user snapshot in Redis keyed by `user_id`, rewritten on any galaxy-affecting write, with a live Postgres fallback on miss. Per-group composite in a separate Redis hash (`group_composite:{group_id}`), patched per member — a single `HGETALL` bounded at 10 entries, rather than recomputing from full snapshots.

#### Assets
Texture atlases on Vercel's edge network, one per reward category, with content-hashed filenames. Not Supabase Storage: these are identical for every user and need no access control, so Storage adds a hop and buys nothing. Only equipped styles load initially.

### Prerequisites when this ships

- Add `cosmetic_unlocked` to the `notification_type` enum — deliberately excluded from v1. Adding an enum value and *using* it must be separate migrations (Postgres rejects using a new value in the transaction that added it).
- Add the galaxy tables described above (`galaxy_stars`, `unlock_tracks`, `unlock_tiers`, `user_unlocks`), plus the equipped-style columns on `users` and `goals`.
- Install `pixi.js`. It's deliberately absent from the dependency list until then.
