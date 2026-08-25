import { describe, expect, it } from "vitest"
import { deadlineLabel, isOverdue } from "./goal-deadline"

/**
 * Step 14d.
 *
 * **The runner is pinned to `America/Los_Angeles`, and that is what makes these
 * worth writing.** A date bug of this kind is invisible in a UTC runner: the
 * wrong code and the right code agree, and the test passes on both. At UTC-8
 * they diverge, so a formatter that parses `2026-09-01` locally renders
 * 31 August and fails here.
 */

const TODAY = "2026-09-15"

describe("isOverdue", () => {
  it("does not treat the deadline day itself as overdue", () => {
    // The rule `/circles/[id]` already states for a Circle's deadline: "a
    // deadline of the 15th means the 15th is fully playable". Two deadline
    // concepts in one app that disagreed about the last day would be worse
    // than either answer.
    expect(isOverdue(TODAY, TODAY)).toBe(false)
  })

  it("is true only strictly before today", () => {
    expect(isOverdue("2026-09-14", TODAY)).toBe(true)
    expect(isOverdue("2026-09-16", TODAY)).toBe(false)
  })

  it("compares across a month and a year boundary, in both directions", () => {
    // String comparison is exact rather than lucky, because `YYYY-MM-DD` is
    // fixed-width and zero-padded. These are the cases that would expose a
    // numeric parse or a naive `split("-")`.
    expect(isOverdue("2026-08-31", "2026-09-01")).toBe(true)
    expect(isOverdue("2025-12-31", "2026-01-01")).toBe(true)

    // **Both directions, or this only proves the function returns `true`.**
    // Reversing each pair must reverse the answer.
    expect(isOverdue("2026-09-01", "2026-08-31")).toBe(false)
    expect(isOverdue("2026-01-01", "2025-12-31")).toBe(false)

    // Zero-padding is what makes `"2026-09-02" < "2026-09-10"` correct rather
    // than a coincidence: unpadded, `"9-2" < "9-10"` is false.
    expect(isOverdue("2026-09-02", "2026-09-10")).toBe(true)
    expect(isOverdue("2026-09-10", "2026-09-02")).toBe(false)
  })

  it("claims nothing when either date is missing", () => {
    // `getCheckinDate` returns null when the RPC fails. Overdue computed from a
    // missing today would be a confident wrong answer on a screen that is
    // otherwise fine.
    expect(isOverdue(null, TODAY)).toBe(false)
    expect(isOverdue("2020-01-01", null)).toBe(false)
  })
})

/**
 * **Month names are asserted with `toContain`, never with an exact string**,
 * which is the convention `digest-days.test.ts` already set. `month: "short"`
 * is ICU data, and it is not stable across runtimes: this Node renders
 * September as "Sept" and a different ICU build renders "Sep". A test that
 * pinned the abbreviation would fail on a version bump and say nothing about
 * the code. `Aug` and `Jan` are the same everywhere, so the exact-day
 * assertions use those.
 */
describe("deadlineLabel", () => {
  it("renders the day that was chosen, not the day before it", () => {
    // **The assertion this file exists for**, and it is a real reproduction:
    // under a local parse at UTC-8, `2026-08-20` formats as 19 Aug.
    expect(deadlineLabel("2026-08-20", "2026-08-01")).toContain("20 Aug 2026")
    expect(deadlineLabel("2026-08-20", "2026-08-01")).not.toContain("19 Aug")

    // The 1st of a month is the case that crosses a boundary when shifted back.
    expect(deadlineLabel("2026-01-01", "2025-12-01")).toContain("1 Jan 2026")
    expect(deadlineLabel("2026-01-01", "2025-12-01")).not.toContain("Dec")
  })

  it("names today, because the last usable day is worth calling out", () => {
    expect(deadlineLabel(TODAY, TODAY)).toBe("Due today")
  })

  it("says overdue with the date, not with a count of days", () => {
    // "Overdue since yesterday" would need a second special case the day after
    // to avoid reading oddly, and the date answers "how late" without arithmetic.
    const label = deadlineLabel("2026-08-14", "2026-08-15")
    expect(label).toContain("Overdue since")
    expect(label).toContain("14 Aug 2026")
  })

  it("states the deadline and claims nothing when today is unknown", () => {
    const label = deadlineLabel("2026-08-14", null)
    expect(label).toContain("Due ")
    expect(label).not.toContain("Overdue")
  })

  it("returns null when there is no deadline, so nothing is rendered", () => {
    expect(deadlineLabel(null, TODAY)).toBeNull()
    expect(deadlineLabel(null, null)).toBeNull()
  })
})
