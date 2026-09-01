import { SkeletonLine, SkeletonRegion } from "@/components/skeleton"

/**
 * The skeleton for the three dashboard sections.
 *
 * **This file exists a second time, and the manual pass is why.** 14a put a
 * `loading.tsx` at `dashboard/`; 15b moved it up to `(shell)/` when `profile/`
 * became a sibling, on the assumption that one boundary above both would cover
 * everything below it. It does not.
 *
 * **A loading boundary only shows for a navigation that changes the segment it
 * sits in.** `(shell)/loading.tsx` sits above `dashboard/` and `profile/`, so
 * it renders when you move *between* those two — and not when you move from
 * `/dashboard` to `/dashboard/circles`, which changes a segment underneath it.
 * The result was a skeleton on the one transition that already felt fast and
 * none on the three that step 14a existed to fix.
 *
 * So both files are needed, and they are not duplicates: this one covers
 * switching sections, the one above covers arriving in the shell.
 *
 * The bar is not drawn in either. It lives in `(shell)/layout.tsx`, stays
 * mounted across the navigation, and shows the correct section the instant you
 * tap.
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
