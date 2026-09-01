import { describe, expect, it } from "vitest"
import { SECTIONS, activeSection } from "./sections"

/**
 * Steps 14a and 15b. Which tab lights up.
 *
 * **Worth testing because the failure is silent and permanent.** A wrong answer
 * here does not throw; it draws the wrong tab as selected on every visit, and
 * the bar lives in a layout that does not re-render, so nothing about it looks
 * like a bug that just happened.
 */

describe("activeSection", () => {
  it("prefers the longest matching href", () => {
    // `/dashboard` is a prefix of every other dashboard section, so a plain
    // `startsWith` lights up Overview everywhere. This is the assertion that
    // says longest-match is doing the work.
    expect(activeSection("/dashboard")?.key).toBe("overview")
    expect(activeSection("/dashboard/circles")?.key).toBe("circles")
    expect(activeSection("/dashboard/notifications")?.key).toBe("notifications")
  })

  it("matches a section's children", () => {
    // Sections own everything under them, so a future `/dashboard/circles/new`
    // still highlights Circles.
    expect(activeSection("/dashboard/circles/anything")?.key).toBe("circles")
  })

  it("keeps Goals highlighted on its own children", () => {
    // The counterpart to the Profile case below, and the reason `exact` is a
    // per-entry flag rather than a global rule: `/dashboard/goals/archived` and
    // `/dashboard/goals/<id>` are still *your* goals, so the tab stays lit.
    expect(activeSection("/dashboard/goals")?.key).toBe("goals")
    expect(activeSection("/dashboard/goals/archived")?.key).toBe("goals")
    expect(activeSection("/dashboard/goals/some-uuid")?.key).toBe("goals")
  })

  it("does not highlight Profile for someone else's profile", () => {
    /**
     * **The one entry with `exact`.** `/profile` is your own; `/profile/[username]`
     * is a stranger's. Without the flag, longest-match would light up your
     * Profile tab while you look at somebody else — a small lie the bar would
     * tell on every visit, and the only case in the app where a child route is
     * not part of its parent section.
     */
    expect(activeSection("/profile")?.key).toBe("profile")
    expect(activeSection("/profile/someone")).toBeNull()
  })

  it("returns null rather than guessing", () => {
    // `/settings` and `/today` are outside the shell. A fallback to the first
    // section would draw Overview as selected on a page that is not Overview.
    expect(activeSection("/settings")).toBeNull()
    expect(activeSection("/today")).toBeNull()
    expect(activeSection("/")).toBeNull()
  })

  it("has a section for every path it claims", () => {
    // Guards the pairing this file rests on: every href in the list resolves
    // back to its own entry. An href typo would otherwise show up only as a
    // tab that never highlights.
    for (const section of SECTIONS) {
      expect(activeSection(section.href)?.key, section.href).toBe(section.key)
    }
  })
})
