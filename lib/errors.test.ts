import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { BY_HINT, toMessage } from "./errors"

/**
 * Keeps the database's hints and the app's copy from drifting apart.
 *
 * Two problems this codebase actually shipped, both of which this catches:
 *
 * 1. `set_circle_deadline` raised `CIRCLE_NOT_ACTIVE`, `NO_ACTIVE_CYCLE` and
 *    `DEADLINE_TOO_SOON`, and `lib/errors.ts` knew none of them. They fell
 *    through to the branch that printed the raw Postgres message.
 * 2. Migration 60 invented `CIRCLE_INACTIVE` for a condition migration 53 had
 *    already named `CIRCLE_NOT_ACTIVE`, with byte-identical message text.
 *
 * Runs against the migration files rather than the live database, so it needs
 * no connection and works in CI.
 */

/**
 * Hints a migration file still contains but nothing raises any more.
 *
 * Migrations are history: migration 53's file will hold `CIRCLE_NOT_ACTIVE`
 * forever, even though migration 65 renamed it. Listing them here makes
 * retiring a code a visible act rather than a silent one.
 */
const RETIRED_HINTS = new Set([
  // Renamed to CIRCLE_INACTIVE by migration 65. The two were the same
  // condition, down to the message text, under two names.
  "CIRCLE_NOT_ACTIVE",

  /**
   * **Deleted by migration 95, and this test is the reason it was noticed at
   * all.** Migration 93's `set_role` refused any self-change, which made its own
   * `LAST_ADMIN` guard unreachable and stopped the only administrator from
   * standing down after promoting a successor. 95 replaced the body: self
   * demotion is allowed, and the count is scoped to admin targets.
   *
   * The copy came out of `BY_HINT` in the same change. The literal stays in
   * migration 93's file forever, because migrations are history, so it is
   * retired here rather than resurrected there.
   */
  "ROLE_SELF_CHANGE",
])

/**
 * Codes attached by migration 65, which cannot be found by scanning.
 *
 * That migration rewrites nine function bodies in place rather than retyping
 * them, so the guarantee that only the `using` clauses changed is structural.
 * The cost is that the hints exist as data in a `v_specs` array and are spliced
 * in at apply time, so the literal `hint = 'CODE'` this scanner looks for never
 * appears in the file.
 *
 * Listed here rather than loosening the regex: matching every quoted uppercase
 * token in every migration would drag in enum labels and constants, and a check
 * that reports noise gets ignored. Anything added here should be visible in
 * review, which is the same bargain as RETIRED_HINTS.
 */
const HINTS_APPLIED_DYNAMICALLY = new Set([
  "USERNAME_RENAME_TOO_SOON",
  "TIMEZONE_INVALID",
  "DEADLINE_BACKWARDS",
  "NO_PENDING_DECISION",
  "NOT_A_MEMBER",
  "ALREADY_OWNER",
])

function hintsInMigrations(): Map<string, string[]> {
  const dir = path.join(process.cwd(), "supabase", "migrations")
  const found = new Map<string, string[]>()

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8")
    for (const match of sql.matchAll(/hint = '([A-Z_]+)'/g)) {
      const code = match[1]
      found.set(code, [...(found.get(code) ?? []), file])
    }
  }
  return found
}

describe("hint coverage", () => {
  const raised = hintsInMigrations()

  it("finds hints to check, so a broken parser cannot pass silently", () => {
    expect(raised.size).toBeGreaterThan(15)
  })

  it("every hint raised by a migration has copy or is explicitly retired", () => {
    const orphans = [...raised.keys()].filter(
      (code) => !(code in BY_HINT) && !RETIRED_HINTS.has(code),
    )
    expect(
      orphans,
      `raised by the database, unknown to BY_HINT: ${orphans.join(", ")}. ` +
        `Add copy, or add it to RETIRED_HINTS if nothing raises it any more.`,
    ).toEqual([])
  })

  it("every code with copy is raised somewhere", () => {
    // The other direction. Catches a typo in BY_HINT, which would otherwise be
    // invisible: the key simply never matches and the user gets the generic
    // message, which looks like a database problem rather than a spelling one.
    const unused = Object.keys(BY_HINT).filter(
      (code) => !raised.has(code) && !HINTS_APPLIED_DYNAMICALLY.has(code),
    )
    expect(
      unused,
      `copy exists but nothing raises it: ${unused.join(", ")}. Typo, or a ` +
        `migration that was reverted.`,
    ).toEqual([])
  })

  // Deliberately not tested here: "no retired hint is still raised by the
  // current schema". Only the live database can answer that, because a
  // migration file legitimately mentions a code it is *removing* — migration 65
  // names CIRCLE_NOT_ACTIVE in the rename that retires it. A file-scanning
  // version of that check reports the retirement itself as a violation.
  //
  // The standing SQL check in build-plan.md covers it against the real schema.
})

describe("toMessage", () => {
  it("prefers the hint over the SQLSTATE", () => {
    // 23514 alone would say "That value isn't allowed". The hint is what makes
    // it readable, and it has to win.
    expect(toMessage({ code: "23514", hint: "GOAL_LIMIT", message: "x" })).toBe(
      BY_HINT.GOAL_LIMIT,
    )
  })

  it("never echoes a database message for an unlabelled 22023", () => {
    // The branch that used to return pg.message verbatim. Every raise carries a
    // hint as of migration 65, so this only fires for one written later without
    // one, and trusting that wording is not a bet worth taking.
    expect(
      toMessage({ code: "22023", message: "value too long for column secret_x" }),
    ).toBe("Something went wrong. Please try again.")
  })

  it("does not read 'Not authenticated' out of the message text", () => {
    // The string match deleted in 7g. A 42501 with no hint is now uniformly
    // "no access", because the nine RPCs that needed the special case all carry
    // NOT_AUTHENTICATED.
    expect(toMessage({ code: "42501", message: "Not authenticated" })).toBe(
      "You don't have access to that.",
    )
    expect(toMessage({ code: "42501", hint: "NOT_AUTHENTICATED" })).toBe(
      "Please sign in again.",
    )
  })

  it("falls back to something dull for an unknown hint", () => {
    expect(toMessage({ code: "22023", hint: "SOMETHING_NEW" })).toBe(
      "Something went wrong. Please try again.",
    )
  })
})
