import { describe, expect, it } from "vitest"
import { teaser } from "../supabase/functions/send-digest-push/teaser"

/**
 * The words that reach a lock screen.
 *
 * **Worth a unit test precisely because nothing else can reach them.** The
 * e2e suite cannot deliver a push, the edge function runs on Deno, and copy
 * fails silently: a body that says "undefined" or names a Circle someone asked
 * to keep private looks fine in every log.
 *
 * `teaser.ts` imports nothing, which is why it could be split out of a Deno
 * module and tested here at all.
 *
 * **Imported without the `.ts` extension**, unlike `index.ts` next to it. Deno
 * requires the extension and `tsc` refuses it, and the two only coexist because
 * `supabase/functions` is excluded from the project's own compilation — an
 * import still pulls this one file in, which is what makes the test type-safe.
 */

const digest = { circle_name: "Morning Club", completed_count: 2, member_count: 3 }

describe("with names allowed", () => {
  it("names the Circle in every digest shape", () => {
    expect(teaser("digest", digest, true).body).toBe(
      "Morning Club: 2 of 3 checked in yesterday",
    )
    expect(
      teaser("digest", { ...digest, completed_count: 0 }, true).body,
    ).toBe("Morning Club: nobody checked in yesterday")
    expect(
      teaser("digest", { ...digest, completed_count: 3 }, true).body,
    ).toBe("Morning Club: everyone checked in yesterday")
  })

  it("names the Circle in the other three types that carry one", () => {
    expect(teaser("deadline_changed", { circle_name: "Runners" }, true).body).toBe(
      "Runners changed its deadline",
    )
    expect(
      teaser("deadline_changed", { circle_name: "Runners", cleared: true }, true).body,
    ).toBe("Runners is now open-ended")
    expect(teaser("group_locked_renewal", { circle_name: "Runners" }, true).body).toBe(
      "Runners has finished its cycle — tap to decide what's next",
    )
    expect(teaser("invite_accepted", { circle_name: "Runners" }, true).body).toBe(
      "Someone joined your circle, Runners",
    )
  })

  it("still says nothing specific about being removed", () => {
    // The one type that stays vague even with names on: its subject might be
    // read by the person who removed you.
    expect(teaser("kicked", { circle_name: "Runners" }, true).body).not.toContain(
      "Runners",
    )
  })

  it("drops 'tap to see' once the name carries the message", () => {
    expect(teaser("digest", digest, true).body).not.toContain("tap to see")
  })
})

describe("with names withheld", () => {
  it("never leaks the Circle, whatever the type", () => {
    for (const type of [
      "digest",
      "deadline_changed",
      "group_locked_renewal",
      "invite_accepted",
      "kicked",
    ]) {
      const { title, body } = teaser(type, { ...digest, circle_name: "Rehab Group" }, false)
      expect(body, type).not.toContain("Rehab Group")
      expect(title, type).toBe("Solarity")
    }
  })

  it("falls back to wording that still works without a name", () => {
    expect(teaser("digest", digest, false).body).toBe(
      "2 of 3 checked in yesterday — tap to see",
    )
    expect(teaser("invite_accepted", digest, false).body).toBe(
      "Someone joined your circle",
    )
  })
})

describe("bad or missing input", () => {
  it("degrades rather than printing undefined", () => {
    // A future notification type that forgets `circle_name`. Migration 73's
    // CHECK means this cannot happen today, which is exactly why it needs a
    // test rather than a comment.
    for (const payload of [{}, { circle_name: "" }, { circle_name: "   " }]) {
      const body = teaser("digest", { ...payload, completed_count: 1, member_count: 2 }, true)
        .body
      expect(body).toBe("1 of 2 checked in yesterday — tap to see")
      expect(body).not.toContain("undefined")
    }
  })

  it("keeps an unknown type dull", () => {
    expect(teaser("something_new", digest, true).body).toBe(
      "You have a new notification",
    )
  })

  it("never names a goal, whatever the payload carries", () => {
    // Goal titles are masked per Circle and a lock screen is outside all of it.
    // Nothing should echo a payload key this function does not know about.
    const body = teaser(
      "digest",
      { ...digest, goal_title: "Quit drinking" },
      true,
    ).body
    expect(body).not.toContain("Quit drinking")
  })
})
