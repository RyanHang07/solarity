import { describe, expect, it } from "vitest"
import { checkinReference, parseCheckinReference } from "./report-reference"

/**
 * Step 15e.
 *
 * **The format is invented, which is exactly why it needs a test.** A report's
 * whole value is that a moderator can find the thing complained about; a
 * reference that does not round-trip is a report nobody can act on, and nothing
 * about it fails loudly at the time it is written.
 */

const USER = "11111111-1111-1111-1111-111111111111"
const GOAL = "22222222-2222-2222-2222-222222222222"
const DATE = "2026-08-25"

describe("checkinReference", () => {
  it("round-trips into the three things the resolving query needs", () => {
    expect(parseCheckinReference(checkinReference(USER, GOAL, DATE))).toEqual({
      userId: USER,
      goalId: GOAL,
      checkinDate: DATE,
    })
  })

  it("identifies exactly one row", () => {
    // `progress_entries` holds at most one entry per goal per check-in date, so
    // these three columns are the natural key. If that ever stops being true,
    // this reference stops being unique and this comment is where to start.
    expect(checkinReference(USER, GOAL, DATE)).toBe(`${USER}/${GOAL}/${DATE}`)
  })
})

describe("parseCheckinReference", () => {
  it("returns null rather than throwing on anything malformed", () => {
    // This parses data a client sent. A report that cannot be resolved is still
    // a report worth keeping, so nothing here may throw.
    expect(parseCheckinReference("")).toBeNull()
    expect(parseCheckinReference(USER)).toBeNull()
    expect(parseCheckinReference(`${USER}/${GOAL}`)).toBeNull()
    expect(parseCheckinReference(`${USER}/${GOAL}/${DATE}/extra`)).toBeNull()
  })

  it("refuses a reference whose date is not a date", () => {
    // The date is the segment most likely to arrive wrong, because it is the
    // only one not copied verbatim from a uuid.
    expect(parseCheckinReference(`${USER}/${GOAL}/yesterday`)).toBeNull()
    expect(parseCheckinReference(`${USER}/${GOAL}/2026-8-25`)).toBeNull()
  })

  it("refuses empty segments", () => {
    // `"//2026-08-25".split("/")` has length 3, so a length check alone would
    // accept this and hand a moderator two empty uuids.
    expect(parseCheckinReference(`//${DATE}`)).toBeNull()
    expect(parseCheckinReference(`${USER}//${DATE}`)).toBeNull()
  })
})
