import { SkeletonLine, SkeletonRegion } from "@/components/skeleton"

/**
 * The fallback for every signed-in screen without one of its own.
 *
 * `/today`, `/settings`, `/circles/[id]` and its settings page all read from
 * Supabase before they can render, and all of them were showing the previous
 * screen until they finished. The dashboard has its own because its shape is
 * known; this one is deliberately generic, since a skeleton that mimics the
 * wrong page is worse than one that admits it is a placeholder.
 */
export default function AppLoading() {
  return (
    <SkeletonRegion label="Loading">
      <SkeletonLine className="h-6 w-48" />
      <SkeletonLine className="h-24 w-full" />
      <SkeletonLine className="h-24 w-full" />
    </SkeletonRegion>
  )
}
