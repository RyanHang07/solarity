/**
 * Step 14a. **The list of dashboard sections, and nothing else.**
 *
 * The dashboard is heading towards a mobile shape: a bar that never moves and a
 * body that swaps. That only works if adding a section is boring, so the whole
 * definition of "what sections exist" is this array. `profile` arrives in step
 * 15 as one entry here plus one `profile/page.tsx`, and removing a section is
 * deleting the same two things.
 *
 * **No component imports another component to find out what the sections are.**
 * The bar reads this, the layout reads this, and neither knows the count.
 *
 * Deliberately a plain module with no `"use client"` and no server imports, so
 * both sides of the boundary can read it.
 */

/**
 * Named badges rather than a number per section.
 *
 * The layout fetches the counts it can and hands back a map keyed by section;
 * a section with no entry simply has no badge. A future "3 pending requests" on
 * Profile is a key in that map, not an edit to the bar.
 */
export type BadgeKey = string

export type Section = {
  /** Stable id. Used as the badge-map key and as the React key. */
  key: string
  label: string
  /** Absolute path. **Also how the active section is chosen**; see `tab-bar`. */
  href: string
}

export const SECTIONS: readonly Section[] = [
  { key: "overview", label: "Overview", href: "/dashboard" },
  { key: "circles", label: "Circles", href: "/dashboard/circles" },
  { key: "notifications", label: "Notifications", href: "/dashboard/notifications" },
]

/**
 * Which section a path is inside. **Longest matching `href` wins.**
 *
 * `/dashboard` is a prefix of every other section's href, so a plain
 * `startsWith` test lights up Overview on every page in the group. Longest-match
 * gets that right without an `exact: true` flag on one special entry — one less
 * thing for a section added a year from now to get wrong.
 *
 * Returns `null` rather than falling back to the first section, so a page in
 * this group that is not a section (there are none today) draws no highlight
 * instead of a wrong one.
 */
export function activeSection(pathname: string): Section | null {
  let best: Section | null = null
  for (const section of SECTIONS) {
    const matches =
      pathname === section.href || pathname.startsWith(`${section.href}/`)
    if (matches && (!best || section.href.length > best.href.length)) {
      best = section
    }
  }
  return best
}
