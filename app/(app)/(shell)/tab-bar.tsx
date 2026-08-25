"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { SECTIONS, activeSection } from "./sections"

/**
 * Step 14a. The dashboard's section bar. **Rendered once and never unmounted.**
 *
 * It lives in `dashboard/layout.tsx`, so navigating between sections re-renders
 * only the body beneath it — the bar is the same DOM before and after the tap.
 * That is the requirement, not a side effect: the app is heading towards a
 * mobile shell where the bar is furniture and only the body changes.
 *
 * **This is a client component for one specific reason, and it is the whole
 * reason.** A layout does *not* re-render when you navigate between its
 * children. So if the layout computed the active section from the URL and
 * passed it down, it would compute it exactly once — on the section you first
 * arrived at — and every tab after that would render with the wrong one
 * highlighted. A persistent bar would look broken in precisely the way a
 * non-persistent one does not.
 *
 * `usePathname` subscribes to the router instead, so the highlight updates
 * without the layout being involved. It also updates *immediately on tap*,
 * before the new segment has finished loading, so the press feels answered
 * while the body is still a skeleton.
 *
 * **Nothing here knows how many sections there are.** `sections.ts` is the list;
 * adding Profile in step 15 is one entry there and one folder.
 */
export function TabBar({
  /**
   * Counts to show beside a label, keyed by section key. A section with no
   * entry, or a zero, gets no badge.
   *
   * A map rather than a `unread` prop, so a badge on a future section is a key
   * and not a change to this file.
   */
  badges = {},
}: {
  badges?: Record<string, number | undefined>
}) {
  const pathname = usePathname()
  const active = activeSection(pathname)

  return (
    <nav className="flex items-center justify-between gap-3 border-b text-sm">
      <div className="flex gap-3">
        {SECTIONS.map((section) => {
          const count = badges[section.key]
          return (
            <Link
              key={section.key}
              href={section.href}
              // The accessible statement of the same thing the border says.
              // `page` rather than `true`, which is what the attribute means
              // for navigation that has already happened.
              aria-current={active?.key === section.key ? "page" : undefined}
              className={`px-1 pb-2 ${
                active?.key === section.key ? "border-b-2 font-medium" : "opacity-70"
              }`}
            >
              {count ? `${section.label} (${count})` : section.label}
            </Link>
          )
        })}
      </div>
      <Link
        href="/settings"
        // "Account settings", not "Settings". The Circle page has its own
        // Settings link to a different route, and two links with the same name
        // and different destinations are ambiguous to a screen reader as well
        // as to a test locator.
        aria-label="Account settings"
        title="Account settings"
        className="pb-2 opacity-70"
      >
        {/* Text, not an icon font or an SVG dependency. The gear is the
            conventional glyph and it needs no asset pipeline. */}
        <span aria-hidden>⚙</span>
      </Link>
    </nav>
  )
}
