# Naming & Vision

Lightweight reference doc — not architecture, just what to call things so code, copy, and future docs stay consistent. Items marked TBD are open for debate; everything else is either already settled elsewhere or a low-stakes default worth confirming rather than agonizing over.

## App identity

- **App name: Solarity** (Solar + Solidarity). Settled. The "sun as self" framing lines up directly with the galaxy concept (sun/ring/planet/star/nebula) — each user's own sun is the center of their galaxy, and "-arity" carries the togetherness/friends-motivating-friends premise the app is built around.
- **One-line vision**: "Friends who see each other's progress toward their goals motivate each other to keep going." (pulled straight from the original premise — worth keeping close to this rather than drifting into generic habit-tracker language.)

## Core concepts — functional term → user-facing name

| Functional (schema/architecture) | Current user-facing term | Alternatives worth considering |
|---|---|---|
| `groups` | **Circles** | resolved |
| `group_cycles` | **Cycles** | resolved |
| `progress_entries` / check-in | "Check-in" | Keep — clear, no reason to rename |
| individual streak | "Streak" | Keep — universally understood term for this |
| group streak (section 21) | "Group Streak" | "Collective Streak," "Group Momentum," "Unity Streak" |
| `digest_snapshots` / daily digest | "Digest" | "Daily Recap," "Roundup" — "digest" is accurate but a little clinical for something meant to feel motivating |
| leaderboard (section 21) | "Leaderboard" | Keep, or a themed alternative once the galaxy ships (e.g. tie it to the star/category language) |
| groups-at-a-glance subtab | **Overview** | resolved |
| `achieved_at` (goal permanently done) | "Achieved" | "Completed," "Conquered" — "Achieved" already reads well and matches `total_goals_achieved`, `Achievement Track`; probably keep |

## Galaxy system (Phase 2) — naming settled again

Sun, Ring, Planet, Star, Nebula are the locked-in vocabulary — they're doing real conceptual work (the metaphor only holds together if the vocabulary is consistent). A few items from that system are still open:

- **Unlock Track System** name itself — currently just descriptive ("Unlock Track System"). Could stay purely functional, or lean into the metaphor (e.g. "Constellation Paths," "Orbit Paths").
- **Streak Track / Consistency Track / Achievement Track** — functional names, work fine as-is, but could go thematic (e.g. tying Streak Track to "orbit," Consistency Track to "radiance," Achievement Track to "constellation") if you want the reward system's naming to feel as designed as the visuals it unlocks.
- **"Flagship" tier** (top reward per track) — functional placeholder name, could use something more evocative once the actual art exists.

## Screens / flows

- **Home dashboard** (v1: check-in panel + Circles list + digest subtab + notifications) — functional name, probably doesn't need a marketing name since it's just "home."
- **Circle page**, **Profile page**, **Notifications** — all fine as plain, functional names; no reason to get cute with primary navigation labels.
- **Onboarding "add to home screen" nudge** (section 3, `push_subscriptions`) — needs actual copy/framing at some point, not urgent now.

## What this doc deliberately skips

Table and field names in the architecture doc stay as-is regardless of what's decided here — this is about user-facing language and marketing/product vocabulary, not a request to rename schema. `groups` stays `groups` and `group_cycles` stays `group_cycles` in the database even though they display as "Circles" and "Cycles."
