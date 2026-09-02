# v2: the galaxy, then the restyle

**Reordered on 1 September**, after two rounds of questions. The first draft of this plan led with an app-wide restyle and treated the galaxy as one surface inside it. That was wrong in two ways: the restyle is not the near-term work, and **the "Circles implementation" is not a separate project — it is the galaxy in its hardest configuration.**

| Part | What it decides |
|---|---|
| [1. The port](01-galaxy-port.md) | What the handoff actually ships, and the four defects to fix before copying |
| [2. Data and schema](02-galaxy-data.md) | One migration, the row mapping, and the semantics the adapter guessed wrong |
| [3. The personal galaxy](03-personal-galaxy.md) | A compact panel on `/dashboard`. One sun, your own goals |
| [4. The Circle galaxy](04-circle-galaxy.md) | Many suns in one sky, above the roster on the Circle's Today tab. **The goal of the whole project** |
| [5. Verification](05-verification.md) | What proves each part landed, including the things a headless browser cannot see |
| [6. The design system and the restyle](06-design-system-and-restyle.md) | Deferred behind the galaxy. Kept because one token decision is needed in part 3 |

---

## Should the Circle galaxy come first? No.

Asked directly, and the answer is no — **but not because it is less important. It is the point.**

The Circle galaxy is the same module in its most demanding configuration, and it stacks four unproven things on top of each other:

| It needs | Which is only proven by |
|---|---|
| The port's four defects fixed | Part 1 |
| Mount, unmount, `setSnapshot` and touch-scroll working on a phone | Part 3, on one sun |
| **A scene topology that does not exist** — the module renders exactly one sun at the centre | Part 4, and it is real renderer work |
| A roster that carries goal categories, and a masking decision | Part 2's migration |

Doing it first means debugging a brand-new multi-sun topology *and* the copy's import-graph defect *and* an unproven React lifecycle at the same time, on the screen where two accounts have to agree. **The personal galaxy is the same code in its simplest form and de-risks all of it**, on a surface where a mistake affects one person's own view.

**So: parts 1 → 2 → 3 → 4.** They are one project, not two, and part 4 is what the project is for.

---

## What was decided, and by whom

Recorded here so the reasoning survives the decisions.

| Question | Answer |
|---|---|
| Scope | **Galaxy first, restyle later.** Part 6 stays in the plan and moves behind everything else |
| Galaxy v1 | **Cosmetics stored, not editable.** Rolled once at goal creation so planets differ from each other. No settings editor, no `user_galaxy_prefs`, one migration instead of two |
| Personal surface | **A compact panel on `/dashboard` Overview**, in the space the deleted goal summary freed |
| Circle topology | **Binary/cluster** — suns near each other, planets shared between. The most novel option and the most renderer work; named as such |
| Circle liveness | **On load and on tab return**, matching what the roster has done since step 8g |
| Circle placement | **Above the roster on the Today tab.** The roster stays, and stays the text-based source of truth |
| Hidden goals | **Category colour for everyone, no title.** Asked twice, including a middle option using `is_self`; confirmed deliberately. Part 2 records it as a reasoned widening of migration 64 rather than an oversight |

---

## What this pass is not allowed to change

| Not allowed | Why |
|---|---|
| **Schema names** | `groups` and `group_cycles` display as Circles and Cycles and stay as they are in the database |
| **Accessible names** | Every e2e locator names a heading, role, label or landmark. A galaxy added beside existing content must leave that content's names alone |
| **The roster as the source of truth** | Every galaxy surface is additive. No route may become unusable without WebGL |
| **The check-in date rule** | Nothing here computes a date in TypeScript. Per-person, 2 AM boundary, `checkin-date.ts` |
| **The CSP** | Verified compatible in part 1. If something needs it widened, that is a decision with its own reasoning |
