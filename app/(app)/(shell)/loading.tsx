import { SkeletonLine, SkeletonRegion } from "@/components/skeleton"

/**
 * Step 14a. What sits under the section bar while a section is being built.
 *
 * **The cheapest fix for the slowest-feeling thing in the app.** With no loading
 * boundary anywhere, Next held the old screen until the new one was complete, so
 * a tap appeared to do nothing at all. The work did not get faster; it stopped
 * being invisible, and that was most of what "slow" meant here.
 *
 * **The bar is not drawn, and no longer needs to be.** This file predates the
 * route split, when the bar was part of the page and a skeleton could only guess
 * which tab was selected — guess wrong and the wrong tab flickered highlighted
 * for the length of the load. Now the bar lives in `layout.tsx`, stays mounted
 * across the navigation, and shows the correct section the instant you tap. This
 * replaces the body alone because the body is the only thing that changed.
 *
 * **One file for every section, including ones that do not exist yet.** A
 * `loading.tsx` covers its segment and everything beneath it, so `profile/` in
 * step 15 inherits this without adding anything. A section that wants a shape of
 * its own can add its own `loading.tsx` and this stops applying to it.
 */
export default function DashboardLoading() {
  return (
    <SkeletonRegion label="Loading">
      <SkeletonLine className="h-6 w-40" />
      <div className="flex flex-col gap-2">
        <SkeletonLine className="h-14 w-full" />
        <SkeletonLine className="h-14 w-full" />
        <SkeletonLine className="h-14 w-full" />
      </div>
    </SkeletonRegion>
  )
}
