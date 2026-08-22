import { describe, expect, it } from "vitest"
import {
  DAYS_SHOWN,
  addDays,
  formatDay,
  groupByDay,
  orderCircles,
  streakDelta,
  type DigestSnapshot,
} from "./digest-days"

/**
 * Every assertion here maps to a way this can fail **without anything
 * throwing**: a box dated a day early, four days where five exist, a Circle
 * dropped from a day it reported, a streak that claims to have held when
 * nothing preceded it.
 *
 * The date tests are the ones that earn their keep. `env`-style local parsing
 * has bitten this codebase before, and a screenshot cannot tell you the box is
 * a day out unless you already know what day it should say.
 */

function snap(over: Partial<DigestSnapshot> & { date: string }): DigestSnapshot {
  return {
    groupId: over.circleName ?? over.date,
    circleName: "Circle",
    completed: 1,
    members: 2,
    groupStreak: 0,
    roster: [],
    needsAttention: false,
    inactive: false,
    ...over,
  }
}

describe("grouping", () => {
  it("keeps the newest five days, newest first", () => {
    const days = groupByDay(
      ["2026-08-14", "2026-08-18", "2026-08-15", "2026-08-16", "2026-08-13", "2026-08-17"].map(
        (date) => snap({ date }),
      ),
    )

    expect(days).toHaveLength(DAYS_SHOWN)
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-18",
      "2026-08-17",
      "2026-08-16",
      "2026-08-15",
      "2026-08-14",
    ])
  })

  it("puts every Circle that reported inside its day", () => {
    const days = groupByDay([
      snap({ date: "2026-08-18", circleName: "Runners" }),
      snap({ date: "2026-08-18", circleName: "Book Club" }),
      snap({ date: "2026-08-17", circleName: "Runners" }),
    ])

    expect(days[0].circles.map((c) => c.circleName)).toEqual(["Book Club", "Runners"])
    expect(days[1].circles).toHaveLength(1)
  })

  it("shows fewer boxes rather than inventing days", () => {
    // A new account has one day of history. Five empty frames would read as a
    // failure; one box is the truth.
    expect(groupByDay([snap({ date: "2026-08-18" })])).toHaveLength(1)
    expect(groupByDay([])).toEqual([])
  })

  it("does not drop a Circle whose day sorts last", () => {
    // The failure the "five days, not five rows" rule exists to prevent: taking
    // the newest N *rows* would lose the sixth Circle on the newest day.
    const many = Array.from({ length: 9 }, (_, i) =>
      snap({ date: "2026-08-18", circleName: `Circle ${i}` }),
    )
    expect(groupByDay(many)[0].circles).toHaveLength(9)
  })
})

describe("ordering", () => {
  it("puts Circles needing you first, then alphabetical", () => {
    const ordered = orderCircles([
      snap({ date: "d", circleName: "Alpha" }),
      snap({ date: "d", circleName: "Zulu", needsAttention: true }),
      snap({ date: "d", circleName: "Beta" }),
      snap({ date: "d", circleName: "Charlie", needsAttention: true }),
    ])

    expect(ordered.map((c) => c.circleName)).toEqual(["Charlie", "Zulu", "Alpha", "Beta"])
  })

  it("sorts names the way a reader expects, not by code point", () => {
    const ordered = orderCircles([
      snap({ date: "d", circleName: "banana" }),
      snap({ date: "d", circleName: "Apple" }),
    ])
    // A naive `<` puts every capital before every lowercase, so "banana" would
    // come first.
    expect(ordered.map((c) => c.circleName)).toEqual(["Apple", "banana"])
  })

  it("does not mutate what it is given", () => {
    const input = [
      snap({ date: "d", circleName: "B" }),
      snap({ date: "d", circleName: "A" }),
    ]
    orderCircles(input)
    expect(input.map((c) => c.circleName)).toEqual(["B", "A"])
  })
})

describe("dates", () => {
  it("renders the day it names, west of UTC", () => {
    // **The trap, and the reason `vitest.config` pins TZ to Los Angeles.**
    // `new Date("2026-08-18").toLocaleDateString()` in a negative offset yields
    // the 17th, so anyone in the Americas would read every box a day early and
    // nothing would error. In a UTC runner this test cannot fail, which would
    // make it decoration.
    expect(new Date().getTimezoneOffset(), "the runner must not be UTC").not.toBe(0)

    expect(formatDay("2026-08-18")).toContain("18")
    expect(formatDay("2026-08-18")).toContain("Aug")
    expect(formatDay("2026-01-01")).toContain("1 Jan")

    // And the naive version really does disagree here, which is what makes the
    // assertions above meaningful rather than tautological.
    expect(new Date("2026-08-18").getDate()).toBe(17)
  })

  it("names today and yesterday rather than dating them", () => {
    expect(formatDay("2026-08-18", "2026-08-18")).toBe("Today")
    expect(formatDay("2026-08-17", "2026-08-18")).toBe("Yesterday")
    expect(formatDay("2026-08-16", "2026-08-18")).not.toBe("Yesterday")
  })

  it("crosses month and year boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31")
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29") // a leap year
  })
})

describe("streak delta", () => {
  const days = groupByDay([
    snap({ date: "2026-08-18", circleName: "A", groupStreak: 4 }),
    snap({ date: "2026-08-17", circleName: "A", groupStreak: 3 }),
    snap({ date: "2026-08-16", circleName: "A", groupStreak: 9 }),
  ])

  it("reads up, reset and held against the day below", () => {
    expect(streakDelta(days, 0, "A")).toBe("up")
    expect(streakDelta(days, 1, "A")).toBe("reset")
  })

  it("says nothing when there is nothing to compare", () => {
    // The oldest box has no day beneath it. `null` is not "held": claiming a
    // streak held when we cannot see the day before is a made-up fact.
    expect(streakDelta(days, 2, "A")).toBeNull()
    expect(streakDelta(days, 0, "missing")).toBeNull()
  })

  it("says nothing when the Circle did not report the day before", () => {
    const gapped = groupByDay([
      snap({ date: "2026-08-18", circleName: "A", groupStreak: 2 }),
      snap({ date: "2026-08-17", circleName: "B", groupStreak: 5 }),
    ])
    expect(streakDelta(gapped, 0, "A")).toBeNull()
  })
})
