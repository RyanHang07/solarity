# Part 4: the Circle galaxy

**Many suns in one sky, above the roster on the Circle's Today tab. This is what the project is for.**

Everything before it is preparation. Part 1 makes the module safe to copy, part 2 gives it data, part 3 proves the lifecycle on one sun. This part is the only one that requires code the module does not have.

---

## The honest size of it

**The renderer has exactly one sun, at the centre, and this is not a configuration flag.**

`Galaxy.ts` is a scene orchestrator built around a single system: one `Sun`, one set of `OrbitPaths`, one `OrbitSystem` laying planets on radii returned by `orbitRadiiForCount`, one `Nebula`, one `Starfield`. `GalaxySnapshot` has `sun` as an object, not an array. **A binary/cluster arrangement — suns near each other with planets shared between them — is new scene topology, and it is the most novel of the four options considered.** That was chosen with the cost named, and the cost is real: this is renderer work in the module, not adapter work in Solarity.

**Which is why it is worth doing in the galaxy repo, not in Solarity.** That repo has 74 tests, a playground with fake state, and a `npm run dev` that shows the thing. Solarity has none of that for a canvas. **Build the multi-sun topology in `pixijs-galaxy` against the playground, with its own tests, then copy it in** — the same path the single-sun version took, and the reason the module is portable in the first place.

---

## The shape to design, and the questions inside it

These are not settled, and part 4 does not start until they are. They are listed as questions rather than answered here because they are design decisions, and the module's playground is the right place to answer them.

| Question | Why it is load-bearing |
|---|---|
| **How many suns, and how are they placed?** | A Circle holds up to **ten** people. "Binary" reads as two; ten suns in a cluster is a different picture, and the layout has to be stable — a member joining must not reshuffle everyone's position, or the Circle looks different every day for no reason |
| **What does "planets shared between" mean?** | The most interesting phrase in the brief and the least defined. Planets orbiting a barycentre between two suns? Planets that pass between suns? A goal both people have? Each is a different system, and only the first is close to the existing `OrbitSystem` |
| **Whose sun is at the centre — yours?** | The roster already orders `is_self` first. Putting the viewer's sun somewhere consistent is what makes the picture readable; putting it in the middle makes every member see a different Circle |
| **What is the picture when everybody finished?** | `dayClosed` exists per person; **the Circle equivalent already exists in the database** as `group_daily_completion.all_completed`, which is what the group streak is built on. This is the single strongest moment the Circle galaxy has, and it needs no new data |
| **What does a Circle streak look like?** | `group_cycle_stats` holds it. The personal galaxy has no equivalent, so this is the one visual that is genuinely about the Circle rather than about ten people next to each other |

**One constraint that decides more than it looks like it should:** ten members × ten goals is **up to 100 planets, plus everyone's achievement stars**, in one canvas, on a phone. The single-sun galaxy is bounded at ten planets. Whatever the topology, it has to degrade — fewer stars per member, smaller planets, or a cap — and finding that out on hardware late is expensive. Measure it in the playground with 10 × 10 before committing to a layout.

---

## The data, which is mostly already there

**`circle_roster` is the source, not ten separate galaxy queries.** It already answers, per member, in one call: `user_id`, `username`, `display_name`, `avatar_url`, `role`, `checkin_date`, `checked_count`, `total_count`, `streak_grace`, `is_self`, `circle_status`, and a `goals` array with id, title, hidden, checked, note and photo per goal.

It needs **one addition, from part 2's migration 108**: `category_slug` per goal. Without it there is no colour for any planet but your own.

| Galaxy input | From the roster |
|---|---|
| A sun per member | One row per member. **The avatar is already there** — the glossary calls the Sun "user avatar at centre", and migration 90 put `avatar_url` on the roster unmasked, for exactly the reason it argues: an avatar is not about a goal |
| Planets per member | `goals[]`, filtered to active ones |
| `shine` | `goals[].checked` — **already computed against that member's own check-in date**, which is the hardest thing here and is done |
| Colour | `category_slug` (migration 108) |
| Hidden goals | `hidden` is in the payload. Coloured, untitled — see below |
| Achievement stars | **Not in the roster.** An achieved goal is not an active goal, so it is not in `goals[]`. Either a second query, or the Circle galaxy has no stars in v1 |

**Prefer no stars in the Circle galaxy for v1.** They are per-person history rendered into a shared sky, they are the largest object count in the scene, and the roster does not carry them. Adding a second RPC to fetch ten people's achievement history — which is a per-person fact, on a screen about today — is a decision that deserves its own reasoning rather than being inherited.

**Two states the roster already handles that the galaxy must not lose:**

- **`circle_status`** — an archived Circle's roster is frozen at the instant it was archived (migrations 68 and 69). A galaxy that kept animating a frozen Circle would be showing motion for data that stopped.
- **`streak_grace`** — a member joined mid-cycle and does not count against the streak yet. Whatever the Circle-complete visual is, this member is not blocking it.

---

## Hidden goals: the decision, recorded

**Hidden goals render in their category colour, without a title, to everyone.** Confirmed twice, including against a middle option that would have coloured only your own.

**What it widens.** Nine categories, nine fixed hexes — **the colour is the category**, not a fuzzy signal. A coloured, untitled planet tells the Circle you have a hidden goal in "Mindfulness & Mental Health". Migration 64 masks title, note and photo for hidden goals precisely to prevent this class of inference, and this is a deliberate step back from that line.

**What it does not widen.** Circle-mates already know a hidden goal exists and whether it was checked — both are in the roster today, because the day's fraction has to be honest. Title, note and photo stay masked.

**It is cheap to revisit.** `is_self` is already in scope in the roster RPC, so neutral-for-others is a change to one `case` expression and nothing in the renderer.

---

## Placement

**Above the roster on the Today tab**, and the roster stays.

That is what keeps the rule at the top of part 3 true: the canvas is additive, and the text list underneath remains the accessible, complete, always-works source of truth. It also means **the Circle page gets long on a phone** — the galaxy pushes the roster below the fold, on the screen people open to see who has checked in. Worth deciding the compact height against a real phone rather than a desktop window.

**Liveness: on load and on tab return**, matching what the roster has done since step 8g. One refresh path for both, so the canvas and the list can never disagree.

---

## Steps

| | Step | Done when |
|---|---|---|
| 4a | **Answer the design questions above**, in the playground | A picture exists that ten people fit into and that does not reshuffle when one joins |
| 4b | **Multi-sun topology in `pixijs-galaxy`**, with tests | `npm test` green in that repo; the playground renders 10 suns × 10 planets at an acceptable frame rate on a phone |
| 4c | Snapshot contract extended — `suns[]` rather than `sun` | The single-sun case is the one-element case, so part 3 keeps working unchanged |
| 4d | Copy into Solarity | `npm run build` passes, and the bundle check from part 1 still holds |
| 4e | Roster → snapshot mapper, in `lib/galaxy/solarity/` | Unit tests, including a hidden goal, a `streak_grace` member, and an archived Circle |
| 4f | The panel above the roster | **`roster.spec.ts` and `masking.spec.ts` pass untouched**, which is the proof it stayed additive and that masking did not move |
| 4g | The Circle-complete moment, from `group_daily_completion` | Two accounts, both finished, on real hardware |
