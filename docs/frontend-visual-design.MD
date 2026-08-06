# Frontend Visual Concept — "Galaxy" System

**Status: deferred, Phase 2.** This entire concept is out of scope for v1 build work, but it's documented in full here because the design work is done and worth preserving. Nothing in this doc should be built until the functional core of the app (users, goals, Circles, check-ins, digest, notifications) is working end to end. See the architecture doc's "V1 scope vs. deferred" note for the reasoning. The v1 home dashboard is a conventional check-in panel + Circles list + digest subtab, not this.

## 1. Core Metaphor

Each user has a personal galaxy that grows as they engage with goals, rather than a conventional list/dashboard UI.

- **Sun** — the user themselves. Chosen once at onboarding (color/style), acts as the fixed center of the visualization.
- **Ring (orbit)** — created per active goal. A new ring appears around the sun when a goal is created.
- **Planet** — sits on a ring, represents that goal's daily state. Shines brightly when the day's check-in for that goal is completed; presumably dims or sits neutral otherwise. Tapping a planet (not its ring) deep-links into that goal's detail view.
- **Ring/planet color** — determined by the goal's `category`, required at goal creation (see architecture doc section 3, palette finalized at nine vivid colors). No uncategorized state exists, so no fallback/default color is needed.
- **Goal achievement** — when a goal is marked `achieved`, its ring/planet **disappears** from orbit (rather than fading/graying) and is replaced by a burst of new stars in that goal's category color, added to the background. This keeps the "always growing" metaphor intact — nothing sits around half-finished, achieving something converts it directly into permanent background progress.
- **Stars (background)** — added when a goal is achieved, in the achieved goal's category color. Layered on top of a minimal base starfield that exists from the start. **Exact rendering logic (cluster size, how streak length or goal count affects star volume, and the nebula-aggregation trigger) is still being worked out — see the dedicated section below.**
- **Progression** — as the galaxy accumulates rings, shining events, and stars over time, crossing defined thresholds unlocks permanent planet styles the user can select as cosmetic rewards. Exact threshold combination (streak milestones, total goals achieved, total days completed) still being finalized — see open item below.

This is a decorative, glanceable visualization layered on top of the functional dashboard described in the architecture doc — it's not a replacement for the check-in UI, more a persistent "state of my galaxy" view of the same underlying data (goals, `daily_completion`, `achieved_at`, `user_lifetime_stats`).

## 2. Decisions Log

- **Rendering engine: PixiJS.** Chosen for its WebGL-backed sprite/particle performance on iOS Safari. Flagging now: you've noted no prior PixiJS experience, so budget time for ramp-up (scene graph model, sprite batching, texture atlases) before deep implementation work starts — this is worth treating as its own mini onboarding task rather than picking it up mid-build.
- **Animation: trigger-once + Page Visibility API pause.** Shine/orbit effects play once on the triggering event (check-in, achievement) and settle static; all animation halts when the tab/app isn't foregrounded.
- **Placement: the galaxy *is* the home dashboard**, not a separate tab. Given this is now the first thing rendered on every app open, it carries the full weight of the "quick to load" requirement — this raises the bar on the caching/initial-load strategy (open item below) and on PixiJS scene startup cost specifically, since there's no secondary-tab budget to lean on anymore.
- **Cross-user galaxy visibility**: opt-in toggle (per user), viewable by other group members through a dedicated, lazy-loaded tab on that user's profile page — not surfaced inline in the group galaxy composite view. Keeps the composite view (section 3) focused on the lightweight LOD summary, while a full peer galaxy view is a deliberate, separately-loaded action.

## 3. Group Galaxy (composite view)

When viewing a group rather than one's own profile, the individual galaxies of each member combine into a single composite scene:

- Each member's full galaxy (their sun, rings, planets, stars) is scaled down and positioned as one node within the shared group view — the group becomes a "galaxy of galaxies," bounded by the existing 10-member hard cap, so this composite never needs to handle more than 10 sub-galaxies at once.
- The user can zoom into any member's scaled-down node to expand it into their full, full-detail individual galaxy view (same rendering as the personal galaxy screen, just entered from a different navigation path).
- Each member's "sun" in the scaled-down view displays their profile picture, dimmed by default (consistent with the base minimal styling before a user has built anything up).
- Optionally, a user can overlay a hand-cropped cutout of their face on top of their sun — a custom shape rather than the standard dimmed circular photo, giving their planet a distinct look in every group they're part of. This is a per-user asset, not per-group, so the same custom sun appears in every group they're in.

**Performance implication specific to this view**: rendering a composite of up to 10 sub-galaxies simultaneously means each one needs a genuinely lightweight representation until zoomed in — this is a level-of-detail (LOD) problem. When zoomed out, each member's node should render a simplified stand-in (sun + maybe a ring count indicator) rather than their full star/planet scene; full detail only renders for whichever galaxy the user has zoomed into. This reinforces the case for a renderer (PixiJS/Canvas) that supports swapping sprite complexity based on zoom level, since a DOM/CSS-based approach would need 10x the individual galaxy's node count rendered at once in the worst case.

## 4. Performance Considerations (initial pass, pending answers below)

Because this is explicitly meant to be fast-loading and the underlying app is a PWA/Next.js-on-Vercel stack optimized for quick iOS first paint, the rendering approach for the galaxy needs to be chosen carefully rather than defaulted to whatever's easiest to build:

- **Rendering technology** — SVG/CSS is simpler to build and more accessible, but scales poorly once star counts grow into the hundreds/thousands over a user's lifetime. Canvas 2D or a lightweight WebGL library (PixiJS is the common choice for this kind of particle/sprite-heavy 2D scene) handles large star counts far better but adds bundle size and complexity.
- **Star field growth is unbounded by default** — every achieved goal adds stars, forever. Without a cap or an aggregation strategy, a long-time user's galaxy becomes a rendering liability. This needs a deliberate strategy (see questions below), not just "render every star that was ever added."
- **Animation cost** — continuously animating (shining pulses, rotating rings) is expensive on mobile Safari/battery compared to animations that only play on load or on interaction. This is one of the biggest performance levers available and should be decided early.
- **Where this lives in the app** — if it's on the home dashboard (loaded every session), it needs to be near-instant; if it's a secondary tab, more rendering budget is acceptable since it's not gating first paint.

## 5. Open Questions

**Still open:**

1. **Planet-style unlock thresholds** — exact tier numbers per track are still TBD (e.g. which streak length unlocks which style), but the structure is resolved: see the Unlock Track System in the architecture doc. Streaks, total days completed, and total goals achieved each drive an **independent track** with its own reward ladder, rather than one shared point system — a user progresses on whichever axis fits how they actually use the app. Remaining open: frequency/spacing of tiers (front-loaded vs evenly spaced) and roughly how many total planet styles to plan for in v1 (a handful vs a longer collection) — worth deciding once the reward art/style pool itself is being scoped.
2. **Star count scaling** — resolved that star *visual traits* (see below) are randomized rather than achievement-linked, but whether the *number* of stars added per achievement still scales with streak length (vs. always being a flat amount) is still open.

**Resolved:**

- **Star visual variation**: stars vary in size/twinkle to create visual richness in the galaxy, but this variation is randomized per star (seeded, so consistent on re-render) rather than tied to the significance of the achievement that generated it — a routine achievement's stars look just as varied as a major one's.
- **Nebula color blending**: clustered nebulas blend up to 3 category colors together, randomly selected from the categories represented in that cluster. This blending only activates once a user has achieved goals across at least 5 different categories — below that threshold, there isn't enough category diversity for blending to look intentional rather than arbitrary, so clusters stay single- or dual-colored until the user crosses that mark.
- **Planet-style unlock structure**: separate tracks per metric (streak, consistency, achievement count), each with independent tiers — see architecture doc section 12.
- **Initial load strategy**: Option A — cached snapshot shown instantly, live data hydrates behind it — implemented via Upstash Redis rather than (or alongside) a client-only cache, consistent with Redis's existing role in this stack. See architecture doc section 13 for the caching mechanism.

- Device performance floor: recent-generation iPhone as the baseline (not SE-class/older chips).
- Group galaxy zoom transition: distinct screen/route transition, for clean separation between the composite view and a full individual galaxy.
- Custom sun cutout moderation: report button + manual review path. Requires moderation tooling — see `content_reports` in the architecture doc.
- Reduced-motion accessibility: auto-detect `prefers-reduced-motion` and fall back automatically.
- Sun customization scope: 4 options offered at onboarding, with more unlockable later via the Consistency Track (see architecture doc section 12 — sun unlocks and planet unlocks run on fully independent tracks, this is now resolved).
- Empty-state assets: rendered by the same PixiJS scene as everything else — a baseline scene is established and built onto over time, rather than swapping from a static placeholder to a live render.
- Equipped styles: unlocking a planet/sun/nebula style makes it available, not automatically active. Each has an equipped-style field (per-goal for planet styles, per-user for sun and nebula styles) — see architecture doc section 12. If nothing is explicitly equipped, the renderer defaults to the **highest-tier unlocked style** on that track, so a fresh unlock is visible immediately without requiring a manual step. Unlocking also fires an immediate `cosmetic_unlocked` notification.
- Check-in gating: one check-in per goal per 24 hours, with the day boundary at **2 AM local time** rather than midnight — see architecture doc section 3 (`progress_entries`).
- Cosmetic asset hosting: static assets served from Vercel's edge network as texture atlases (one per reward category), not Supabase Storage — see architecture doc section 13 for the full reasoning. Only the currently-equipped styles' textures load on initial galaxy render; the full unlocked library loads lazily when a style-selection screen is opened.
- Group composite view caching: a dedicated per-group Redis hash (`group_composite:{group_id}`), incrementally updated per member rather than recomputed from full snapshots — see architecture doc section 14.
- Rendering technology: PixiJS.
- Animation behavior: trigger-once + Page Visibility API pause.
- Placement: the galaxy is the home dashboard.
- Interactivity: tap planet (not ring) to deep-link into goal detail.
- Scope of visibility: opt-in toggle, viewable via a lazy-loaded tab on the viewed user's profile.
- Ring lifecycle: achieved goals' rings/planets disappear and convert into new category-colored stars.
- Category palette: fixed preset, nine vivid colors, finalized in the architecture doc.
