import { describe, expect, it } from "vitest"
import type { RosterMember } from "@/lib/roster"
import {
  GOAL_CATEGORIES,
  SUN_COLOR_PRESETS,
  sunPresetIdForMember,
} from "../data"
import {
  buildCircleSnapshot,
  buildFirstGoalPreview,
  buildPersonalSnapshot,
} from "./snapshots"

/**
 * **Ids are uuid-shaped, and that is not decoration.**
 *
 * The shape of an id has already caused a shipped bug in this module: an FNV-1a
 * hash taken `% 6` distributes evenly over short strings like `member-3` and
 * reaches only three of six buckets over uuids, so three planet surfaces were
 * unreachable in production and invisible in every test that used friendly ids.
 */
const uuid = (n: number) =>
  `0000000${n}-0000-4000-8000-00000000000${n}`.slice(0, 36)

const member = (over: Partial<RosterMember> = {}): RosterMember => ({
  user_id: uuid(1),
  username: "ana",
  display_name: "Ana",
  avatarUrl: null,
  role: "member",
  is_self: false,
  streak_grace: false,
  circle_status: "active",
  as_of: null,
  checkin_date: "2026-09-03",
  joined_at: "2026-01-01T00:00:00Z",
  checked_count: 1,
  total_count: 1,
  all_completed: true,
  sky_closed: false,
  achievement_count: 0,
  sun_preset_id: null,
  goals: [
    {
      id: uuid(9),
      title: "Run",
      hidden: false,
      checked: true,
      category_slug: "health",
      belt_visible: false,
      note: null,
      entry_id: null,
      note_shared: false,
      photoUrl: null,
    },
  ],
  ...over,
})

describe("the categories both sides agree on", () => {
  it("is exactly the nine the database seeds", () => {
    /**
     * Migration 4 seeded `goal_categories` with a `color_hex` column three
     * weeks before this renderer existed, and all nine slugs and all nine hex
     * values still match — which is why the galaxy needs no mapping table.
     *
     * **The database cannot be reached from a unit test**, so this pins the
     * TypeScript half against the seed written out by hand. If someone adds a
     * tenth category on either side, this fails and names it, instead of one
     * planet quietly turning grey in production.
     */
    expect(GOAL_CATEGORIES.map((c) => c.slug).sort()).toEqual([
      "career",
      "finances",
      "fitness",
      "health",
      "hobbies",
      "mindfulness",
      "other",
      "productivity",
      "social",
    ])
  })
})

describe("a Circle's snapshot", () => {
  it("orders systems by join time, not by the order the roster returned", () => {
    // The roster puts the viewer first. If that order reached the layout, every
    // member would see a different Circle and two people looking at one phone
    // would disagree about where somebody is.
    const snapshot = buildCircleSnapshot([
      member({
        user_id: uuid(3),
        is_self: true,
        joined_at: "2026-03-01T00:00:00Z",
      }),
      member({ user_id: uuid(1), joined_at: "2026-01-01T00:00:00Z" }),
      member({ user_id: uuid(2), joined_at: "2026-02-01T00:00:00Z" }),
    ])

    expect(snapshot.systems.map((s) => s.id)).toEqual([
      uuid(1),
      uuid(2),
      uuid(3),
    ])
  })

  it("gives a member the same slot when somebody else joins later", () => {
    // The layout's one promise. Asserted on the *index*, because that is what
    // the cluster layout consumes.
    const first = member({ user_id: uuid(1), joined_at: "2026-01-01T00:00:00Z" })
    const second = member({ user_id: uuid(2), joined_at: "2026-02-01T00:00:00Z" })
    const late = member({ user_id: uuid(3), joined_at: "2026-06-01T00:00:00Z" })

    const before = buildCircleSnapshot([first, second])
    const after = buildCircleSnapshot([first, second, late])

    expect(after.systems.slice(0, 2).map((s) => s.id)).toEqual(
      before.systems.map((s) => s.id),
    )
  })

  it("gives each member a different sun", () => {
    // Without this every sun falls to the same default, and a picture whose
    // whole subject is who is doing what draws ten identical suns.
    const snapshot = buildCircleSnapshot([
      member({ user_id: uuid(1), joined_at: "2026-01-01T00:00:00Z" }),
      member({ user_id: uuid(2), joined_at: "2026-02-01T00:00:00Z" }),
    ])

    const [a, b] = snapshot.systems
    expect(a?.sun.color).not.toBe(b?.sun.color)
  })

  it("keeps a hidden goal's planet, colour and belt", () => {
    // A hidden goal arrives with a null title and a real category. Dropping it
    // would put "1 of 3" beside two planets.
    const snapshot = buildCircleSnapshot([
      member({
        checked_count: 1,
        total_count: 2,
        goals: [
          ...member().goals,
          {
            id: uuid(8),
            title: null,
            hidden: true,
            checked: false,
            category_slug: "mindfulness",
            belt_visible: true,
            note: null,
            entry_id: null,
            note_shared: false,
            photoUrl: null,
          },
        ],
      }),
    ])

    const planets = snapshot.systems[0]?.planets ?? []
    expect(planets).toHaveLength(2)
    const hidden = planets.find((p) => p.id === uuid(8))
    // `belt` is always built; `beltVisible` is the flag that decides. Asserting
    // on `belt` passed for both values and proved nothing.
    expect(hidden?.beltVisible).toBe(true)
    // Two categories, two colours. The colour *is* the category, which is the
    // cost migration 109 accepted.
    expect(hidden?.color).not.toBe(planets[0]?.color)
  })

  it("carries the Circle's own facts, and never derives them", () => {
    // `sky_closed` accounts for members in grace; `systems.every(dayClosed)`
    // does not. This member has closed their day and the Circle has not.
    const snapshot = buildCircleSnapshot([
      member({ all_completed: true, sky_closed: false, achievement_count: 40 }),
    ])

    expect(snapshot.systems[0]?.dayClosed).toBe(true)
    expect(snapshot.skyClosed).toBe(false)
    expect(snapshot.ambienceTier).toBeGreaterThan(0)
  })

  it("has no stars, whatever the Circle has achieved", () => {
    // Star coordinates are canvas-normalised, so nothing would tie a star to
    // the person who earned it.
    const snapshot = buildCircleSnapshot([member({ achievement_count: 500 })])
    expect(snapshot.stars).toEqual([])
  })

  it("survives a category the renderer has never heard of", () => {
    // One planet the wrong colour beats a canvas that fails to build.
    const snapshot = buildCircleSnapshot([
      member({
        goals: [{ ...member().goals[0]!, category_slug: "underwater-basketry" }],
      }),
    ])
    expect(snapshot.systems[0]?.planets).toHaveLength(1)
  })

  it("draws an empty sun for a member with no goals", () => {
    // Zero active goals is written `all_completed = false`, deliberately, and
    // it stops the whole Circle closing. The sky shows that rather than
    // softening it.
    const snapshot = buildCircleSnapshot([
      member({ goals: [], checked_count: 0, total_count: 0, all_completed: false }),
    ])
    expect(snapshot.systems[0]?.planets).toEqual([])
    expect(snapshot.systems[0]?.dayClosed).toBe(false)
  })
})

describe("a personal snapshot", () => {
  it("takes dayClosed from the caller rather than deriving it", () => {
    // A day with zero goals is stored as false, never vacuously true, and the
    // stored value is what the streak is built on.
    const empty = buildPersonalSnapshot({
      userId: uuid(1),
      sunPresetId: null,
      goals: [],
      achievements: [],
      dayClosed: false,
    })
    expect(empty.systems[0]?.dayClosed).toBe(false)

    const closed = buildPersonalSnapshot({
      userId: uuid(1),
      sunPresetId: null,
      goals: [
        {
          id: uuid(9),
          categorySlug: "health",
          shine: true,
          beltVisible: true,
        },
      ],
      achievements: [],
      dayClosed: true,
    })
    expect(closed.systems[0]?.dayClosed).toBe(true)
  })

  it("turns achievements into stars, which a Circle never does", () => {
    const snapshot = buildPersonalSnapshot({
      userId: uuid(1),
      sunPresetId: null,
      goals: [],
      achievements: [
        { id: uuid(4), categorySlug: "health" },
        { id: uuid(5), categorySlug: "productivity" },
      ],
      dayClosed: false,
    })
    expect(snapshot.stars.length).toBeGreaterThan(0)
  })

  it("honours the stored belt roll in both directions", () => {
    // `beltMode: "auto"` means "use the roll". Passing the roll through and
    // then ignoring it would be invisible in a snapshot test that only ever
    // checked the true case.
    const withBelt = buildPersonalSnapshot({
      userId: uuid(1),
      sunPresetId: null,
      goals: [
        { id: uuid(9), categorySlug: "health", shine: false, beltVisible: true },
      ],
      achievements: [],
      dayClosed: false,
    })
    const without = buildPersonalSnapshot({
      userId: uuid(1),
      sunPresetId: null,
      goals: [
        { id: uuid(9), categorySlug: "health", shine: false, beltVisible: false },
      ],
      achievements: [],
      dayClosed: false,
    })

    expect(withBelt.systems[0]?.planets[0]?.beltVisible).toBe(true)
    expect(without.systems[0]?.planets[0]?.beltVisible).toBe(false)
  })
})

describe("the first-goal preview", () => {
  it("draws a sun with nothing around it before a category is chosen", () => {
    // The honest picture of an account with no goals, and the reason choosing
    // one is visible: a preview that showed a placeholder planet would make
    // the picker's only effect a colour change nobody was watching for.
    const snapshot = buildFirstGoalPreview({
      userId: uuid(1),
      sunPresetId: null,
      categorySlug: null,
    })
    expect(snapshot.systems).toHaveLength(1)
    expect(snapshot.systems[0]?.planets).toHaveLength(0)
    expect(snapshot.systems[0]?.sun).toBeTruthy()
  })

  it("gives the planet the category's own colour", () => {
    const health = GOAL_CATEGORIES.find((c) => c.slug === "health")
    const snapshot = buildFirstGoalPreview({
      userId: uuid(1),
      sunPresetId: null,
      categorySlug: "health",
    })
    expect(snapshot.systems[0]?.planets).toHaveLength(1)
    expect(snapshot.systems[0]?.planets[0]?.color).toBe(health?.color)
  })

  it("survives a category the renderer has never heard of", () => {
    // The tenth category, added in SQL and not in TypeScript. One planet the
    // wrong colour rather than a screen nobody can skip failing to render.
    const snapshot = buildFirstGoalPreview({
      userId: uuid(1),
      sunPresetId: null,
      categorySlug: "nonexistent-category",
    })
    expect(snapshot.systems[0]?.planets).toHaveLength(1)
  })

  it("shows the sun this account actually gets, not a default", () => {
    /**
     * **The whole claim the screen makes.** The copy says "your sun", and it is
     * only true if this is the same colour the Circle draws for them. Compared
     * against `buildCircleSnapshot` rather than against a hardcoded hex,
     * because the thing being asserted is that the two agree.
     */
    const id = uuid(1)
    const preview = buildFirstGoalPreview({ userId: id, sunPresetId: null, categorySlug: null })
    const inACircle = buildCircleSnapshot([member({ user_id: id })])

    expect(preview.systems[0]?.sun.color).toBe(inACircle.systems[0]?.sun.color)

    // The control: a different account gets a different sun, so the assertion
    // above is not two calls to one constant.
    const other = buildFirstGoalPreview({ userId: uuid(4), sunPresetId: null, categorySlug: null })
    expect(other.systems[0]?.sun.color).not.toBe(preview.systems[0]?.sun.color)
  })

  it("never shows a belt, because the real one is a coin flip at insert", () => {
    // `belt_visible` is rolled by migration 107's column default. `auto` here
    // would show a ring the goal has a four-in-five chance of not getting.
    for (const slug of GOAL_CATEGORIES.map((c) => c.slug)) {
      const snapshot = buildFirstGoalPreview({
        userId: uuid(1),
        sunPresetId: null,
        categorySlug: slug,
      })
      expect(snapshot.systems[0]?.planets[0]?.beltVisible).toBe(false)
    }
  })

  it("does not shine, on a day nobody has checked anything off", () => {
    const snapshot = buildFirstGoalPreview({
      userId: uuid(1),
      sunPresetId: null,
      categorySlug: "health",
    })
    expect(snapshot.systems[0]?.planets[0]?.shine).toBe(false)
    expect(snapshot.skyClosed).toBe(false)
  })
})

describe("the sun somebody chose", () => {
  /**
   * The derived colour for `uuid(1)`, read from the module rather than written
   * down: a literal here would pass while `pickIndex` was broken, which is the
   * exact bug this hash already shipped once.
   */
  const derivedFor = (id: string) =>
    SUN_COLOR_PRESETS.find((p) => p.id === sunPresetIdForMember(id))?.color

  it("prefers the stored preset over the hashed one, in both galaxies", () => {
    /**
     * **One assertion covering two files, deliberately.** Your sun on Overview
     * and your sun in a Circle are the same claim about you, and they are built
     * by different functions from different rows — so the thing worth asserting
     * is that they agree, not that either one works.
     */
    const id = uuid(1)
    const chosen = SUN_COLOR_PRESETS.find(
      (p) => p.id !== sunPresetIdForMember(id),
    )
    expect(chosen, "every preset is the derived one, so nothing is proven").toBeTruthy()

    const personal = buildPersonalSnapshot({
      userId: id,
      sunPresetId: chosen!.id,
      goals: [],
      achievements: [],
      dayClosed: false,
    })
    const circle = buildCircleSnapshot([
      member({ user_id: id, sun_preset_id: chosen!.id }),
    ])

    expect(personal.systems[0]?.sun.color).toBe(chosen!.color)
    expect(circle.systems[0]?.sun.color).toBe(chosen!.color)

    // The control: without a stored value they both fall back to the hash, so
    // the assertions above are about the column rather than about a constant.
    expect(
      buildPersonalSnapshot({
        userId: id,
        sunPresetId: null,
        goals: [],
        achievements: [],
        dayClosed: false,
      }).systems[0]?.sun.color,
    ).toBe(derivedFor(id))
  })

  it("falls back to the hash when the stored value is not a preset", () => {
    /**
     * Migration 111's check constraint restates the six ids in SQL, so this is
     * the case where that duplication has already failed. **The fallback has to
     * be the hash rather than the default**: `sunPresetById` answers
     * `undefined` for an unknown id and lands everybody on amber, which would
     * turn one bad row into a Circle of identical suns — the exact picture
     * `memberSun.ts` exists to prevent.
     */
    const id = uuid(2)
    const snapshot = buildPersonalSnapshot({
      userId: id,
      sunPresetId: "chartreuse",
      goals: [],
      achievements: [],
      dayClosed: false,
    })
    expect(snapshot.systems[0]?.sun.color).toBe(derivedFor(id))
  })

  it("lets two members who chose the same colour have it", () => {
    // The hash guarantees difference; a choice does not, and must not. Two
    // people picking gold is a thing people are allowed to do.
    const circle = buildCircleSnapshot([
      member({ user_id: uuid(1), username: "ana", sun_preset_id: "gold" }),
      member({
        user_id: uuid(2),
        username: "ben",
        joined_at: "2026-01-02T00:00:00Z",
        sun_preset_id: "gold",
      }),
    ])
    expect(circle.systems).toHaveLength(2)
    expect(circle.systems[0]?.sun.color).toBe(circle.systems[1]?.sun.color)
  })

  it("drives the first-goal preview from the picker, not from the id", () => {
    const id = uuid(1)
    const chosen = SUN_COLOR_PRESETS.find(
      (p) => p.id !== sunPresetIdForMember(id),
    )!
    const snapshot = buildFirstGoalPreview({
      userId: id,
      sunPresetId: chosen.id,
      categorySlug: null,
    })
    expect(snapshot.systems[0]?.sun.color).toBe(chosen.color)
  })
})
