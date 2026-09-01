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

    /**
     * Step 18b. **The inviter is named under the same setting as the Circle.**
     *
     * This shipped naming nobody, on the reasoning that the setting governs a
     * group's name rather than a person's. That made one setting mean two
     * things depending on which notification arrived, and made the only
     * notification that asks for a decision indistinguishable from spam.
     */
    expect(
      teaser("invited", { circle_name: "Runners", inviter_username: "ryahn" }, true)
        .body,
    ).toBe("ryahn invited you to Runners")

    // Each half degrades on its own. `inviter_username` has no CHECK behind it
    // the way `circle_name` does, so a payload missing one is reachable.
    expect(teaser("invited", { inviter_username: "ryahn" }, true).body).toBe(
      "ryahn invited you to a circle",
    )
    expect(teaser("invited", { circle_name: "Runners" }, true).body).toBe(
      "You've been invited to Runners",
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
      "invited",
      "kicked",
    ]) {
      const { title, body } = teaser(
        type,
        { ...digest, circle_name: "Rehab Group", inviter_username: "ryahn" },
        false,
      )
      expect(body, type).not.toContain("Rehab Group")
      // **And no handle either.** Withholding lock-screen detail has to mean
      // both names or it means nothing: "ryahn invited you to a circle" tells
      // whoever is holding the phone who is contacting this person, which is
      // the disclosure the setting exists to prevent.
      expect(body, type).not.toContain("ryahn")
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
    expect(
      teaser("invited", { ...digest, inviter_username: "ryahn" }, false).body,
    ).toBe("You've been invited to a circle — tap to see")
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

/**
 * Step 18f. The copy varies, and varies the same way every time.
 *
 * **The whole reason the seed is the notification's id** rather than
 * `Math.random()` is that these assertions can exist at all. A random pick
 * would make every equality check in this file flaky, and would let a
 * redelivered push say something different from the first attempt.
 */
describe("copy variance", () => {
  /**
   * **Real uuids, and the first draft of this test used generated ones that
   * differed in two characters.** Twelve of those produced only two of the four
   * variants and looked like a broken hash; the hash was fine and the sample
   * was not. Measured properly, 40,000 random v4 uuids land 25.2 / 25.1 / 25.0
   * / 24.7 across a four-set.
   *
   * These eight are fixed rather than generated, and chosen to cover all four
   * variants of every set below, so the assertions can be exact. A change to
   * `pick` fails here loudly instead of shifting a distribution nobody is
   * watching.
   */
  const ids = [
    "27c66519-ac7d-4850-8ddd-855fc42d3783",
    "52086678-3969-4d05-a446-c653a8ec0318",
    "3508ef9f-815e-4043-a12c-cbe32da232eb",
    "9153eeaf-b5a6-4753-b9c3-a5f88e186382",
    "14273b6e-0bf7-429b-8627-df4d2ede77d6",
    "efee7600-9269-408b-a7cf-5db18feb5d8b",
    "865e5ab9-1def-4e2d-aac1-fc52992754f3",
    "660bc4cc-2eed-4b36-ae34-2bb68a68dc8c",
  ]

  const EVERYONE = (name: string, total: number) => [
    `${name}: everyone checked in yesterday`,
    `Clean sweep in ${name} yesterday`,
    `All of ${name} finished yesterday`,
    `${name} went ${total} for ${total} yesterday`,
  ]

  it("says the same thing for the same notification, every time", () => {
    // The property a retry depends on. Asserted over several ids rather than
    // one, so a hash that collapsed to a constant would still pass this and
    // fail the next test.
    for (const id of ids) {
      const first = teaser("digest", digest, true, id).body
      for (let i = 0; i < 5; i++) {
        expect(teaser("digest", digest, true, id).body).toBe(first)
      }
    }
  })

  it("says different things for different notifications", () => {
    const seen = new Set(ids.map((id) => teaser("digest", digest, true, id).body))
    /**
     * **Exactly four, not "more than one".** The failure mode this guards has
     * no other symptom: `pick` returning index 0 forever looks exactly like the
     * copy that shipped, and a hash that mixes badly looks like copy that
     * varies. Only an exact count catches the second one.
     */
    expect(seen, "the eight seeds did not cover all four variants").toEqual(
      new Set([
        "Morning Club: 2 of 3 checked in yesterday",
        "2 of 3 finished in Morning Club",
        "Morning Club came in at 2 of 3",
        "2 of 3 made it in Morning Club",
      ]),
    )
  })

  it("only ever produces sentences from the set", () => {
    const allowed = new Set(EVERYONE("Morning Club", 3))
    for (const id of ids) {
      const body = teaser("digest", { ...digest, completed_count: 3 }, true, id).body
      expect(allowed.has(body), `unexpected variant: ${body}`).toBe(true)
    }
  })

  it("offers the streak variant only when there is a streak worth naming", () => {
    const withStreak = { ...digest, completed_count: 3, group_streak: 9 }
    const seen = new Set(ids.map((id) => teaser("digest", withStreak, true, id).body))
    expect(
      [...seen].some((b) => b === "Morning Club: everyone finished, 9 days running"),
      "the streak variant never appeared",
    ).toBe(true)

    /**
     * **0 and 1 are both excluded, and 1 is the interesting one.** A Circle's
     * first perfect day has a streak of 0, and the day after a reset has 1;
     * "everyone finished, 1 days running" is both ungrammatical and pointless.
     * The variant is skipped rather than pluralised.
     */
    for (const streak of [0, 1]) {
      const bodies = ids.map(
        (id) => teaser("digest", { ...digest, completed_count: 3, group_streak: streak }, true, id).body,
      )
      for (const body of bodies) {
        expect(body, `streak ${streak} leaked into the copy`).not.toContain("days running")
        expect(EVERYONE("Morning Club", 3)).toContain(body)
      }
    }
  })

  it("varies the nameless fallbacks too, and still names nothing", () => {
    const seen = new Set(
      ids.map((id) => teaser("digest", { ...digest, completed_count: 0 }, false, id).body),
    )
    expect(seen.size, "the withheld-name copy is the same sentence forever").toBe(4)

    for (const body of seen) {
      expect(body).not.toContain("Morning Club")
      // Without a name there is no reason to open the app, which is the job
      // this tail does and the reason it survives only on these variants.
      expect(body, `no prompt on: ${body}`).toContain("tap to see")
    }
  })

  it("gives the sentence that shipped when nothing seeds it", () => {
    /**
     * **Not a formality.** FNV's offset basis is 1 modulo 4, so without the
     * empty-seed guard in `pick` an unseeded call would land on the *second*
     * variant: deterministic, arbitrary, and quietly different from the copy
     * this file has always asserted. Every test above that omits an id depends
     * on this.
     */
    expect(teaser("digest", digest, true).body).toBe(
      "Morning Club: 2 of 3 checked in yesterday",
    )
    expect(teaser("digest", digest, true, "").body).toBe(
      "Morning Club: 2 of 3 checked in yesterday",
    )
  })
})

/**
 * Step 19. The four types a Circle talks with during the day.
 *
 * **The plural agreement is the one worth a test.** `circle_activity` is the
 * only body in the app with three grammatical forms, and "Ryan and 2 others is
 * off the mark" is a bug that ships silently: it reads fine in a diff and wrong
 * on a lock screen.
 */
describe("intraday circle notifications", () => {
  const ids = [
    "27c66519-ac7d-4850-8ddd-855fc42d3783",
    "52086678-3969-4d05-a446-c653a8ec0318",
    "3508ef9f-815e-4043-a12c-cbe32da232eb",
    "9153eeaf-b5a6-4753-b9c3-a5f88e186382",
    "14273b6e-0bf7-429b-8627-df4d2ede77d6",
    "efee7600-9269-408b-a7cf-5db18feb5d8b",
    "865e5ab9-1def-4e2d-aac1-fc52992754f3",
    "660bc4cc-2eed-4b36-ae34-2bb68a68dc8c",
  ]
  const circle = { circle_name: "Runners" }

  it("never names a goal, whatever the payload carries", () => {
    // The rule `send-digest-push` has kept since step 13, now with a type that
    // is *about* a goal and so is the first one tempted to break it. The title
    // is not in the payload at all, which is the structural half; this is the
    // half that fails if somebody adds it.
    for (const id of ids) {
      const body = teaser(
        "goal_achieved",
        { ...circle, who: "ryahn", goal_title: "Quit smoking" },
        true,
        id,
      ).body
      expect(body).not.toContain("Quit smoking")
      expect(body).toBe("ryahn achieved a goal in Runners")
    }
  })

  it("agrees with itself about plurals", () => {
    const singular = new Set(
      ids.map((id) => teaser("circle_activity", { ...circle, names: ["ryahn"] }, true, id).body),
    )
    expect(singular).toEqual(
      new Set([
        "ryahn got started in Runners",
        "ryahn is off the mark in Runners",
        "ryahn has begun in Runners",
      ]),
    )

    const pair = new Set(
      ids.map(
        (id) =>
          teaser("circle_activity", { ...circle, names: ["ryahn", "alice"] }, true, id).body,
      ),
    )
    expect(pair).toEqual(
      new Set([
        "ryahn and alice got started in Runners",
        "ryahn and alice are off the mark in Runners",
        "ryahn and alice have begun in Runners",
      ]),
    )

    // Three or more collapses to a count. `{n}` is the others, not the total,
    // so four names read as "and 3 others".
    const many = new Set(
      ids.map(
        (id) =>
          teaser(
            "circle_activity",
            { ...circle, names: ["ryahn", "alice", "bo", "cy"] },
            true,
            id,
          ).body,
      ),
    )
    for (const body of many) {
      expect(body).toContain("ryahn and 3 others")
      expect(body, `singular verb with a plural subject: ${body}`).not.toMatch(
        / is | has /,
      )
    }
  })

  it("varies the two that repeat and leaves the rare one alone", () => {
    const finisher = new Set(
      ids.map(
        (id) => teaser("circle_first_finisher", { ...circle, who: "ryahn" }, true, id).body,
      ),
    )
    expect(finisher.size, "first finisher does not vary").toBe(4)

    const waiting = new Set(
      ids.map((id) => teaser("last_one_left", circle, true, id).body),
    )
    expect(waiting.size, "last one left does not vary").toBe(4)

    // Rare by construction, so one line. Three phrasings of something seen
    // twice a year is an inconsistent voice for no gain.
    const achieved = new Set(
      ids.map((id) => teaser("goal_achieved", { ...circle, who: "ryahn" }, true, id).body),
    )
    expect(achieved.size, "a rare message was given variants").toBe(1)
  })

  it("withholds both names, not just the Circle", () => {
    for (const [type, payload] of [
      ["goal_achieved", { ...circle, who: "ryahn" }],
      ["circle_first_finisher", { ...circle, who: "ryahn" }],
      ["last_one_left", circle],
      ["circle_activity", { ...circle, names: ["ryahn", "alice"] }],
    ] as const) {
      for (const id of ids) {
        const body = teaser(type, payload, false, id).body
        expect(body, type).not.toContain("Runners")
        // The rule settled for `invited`: withholding lock-screen detail has to
        // mean both names or it means nothing.
        expect(body, type).not.toContain("ryahn")
        expect(body, type).not.toContain("alice")
      }
    }
  })

  it("says something dull rather than nothing when the payload is empty", () => {
    // The trigger always writes at least one name, so this branch guards a
    // future writer rather than today's.
    expect(teaser("circle_activity", { ...circle, names: [] }, true, ids[0]).body).toBe(
      "There's movement in one of your circles — tap to see",
    )
    expect(teaser("goal_achieved", circle, true, ids[0]).body).toBe(
      "Somebody achieved a goal in Runners",
    )
  })
})
