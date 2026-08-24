import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import type { RosterGoal, RosterMember } from "@/lib/roster"
import { signPhotos } from "./photo-urls"

/**
 * **`server-only` since step 13, and its absence was the bug.** Nothing stopped
 * a client component importing this module, so one did, and the day it grew a
 * Supabase Storage call the build broke somewhere else entirely. The types and
 * `formatProgress` now live in `lib/roster.ts`, which is safe to import from
 * anywhere.
 */

export type { RosterGoal, RosterMember } from "@/lib/roster"

/**
 * Every member of a Circle with their counts for **their own** check-in date.
 *
 * **The third and last exemption from the "RPCs only in `app/actions/`" rule.**
 * That rule exists so a call cannot skip rate limiting; this is a read during
 * render on a page that already reads four other tables unmetered, and metering
 * a page view would be the wrong control anyway. A server action was the
 * alternative and is worse: it would publish a POST endpoint for something
 * never submitted.
 *
 * **All the masking happens inside the function**, which is the point of
 * migration 64. `goals` and `progress_entries` are `user_id = auth.uid()`, so
 * this is the only way to see a circle-mate's progress at all, and a hidden
 * goal's title never leaves the database.
 *
 * Membership is checked by the RPC itself rather than here, because it is
 * `SECURITY DEFINER` and would otherwise hand any Circle's roster to anyone who
 * guessed an id.
 *
 * Returns null rather than throwing. A roster that fails to load is a panel
 * that says so, not a 500 for the whole page.
 */
export async function getCircleRoster(
  supabase: SupabaseClient<Database>,
  groupId: string,
): Promise<RosterMember[] | null> {
  const { data, error } = await supabase.rpc("circle_roster", {
    p_group_id: groupId,
  })

  if (error) {
    console.error("circle_roster failed", error)
    return null
  }

  /**
   * The RPC's own shape: `photo_url` is the Storage object key, not a URL.
   * Named separately so the swap below is visible rather than a cast.
   */
  type RawGoal = Omit<RosterGoal, "photoUrl"> & { photo_url: string | null }
  const raw = (data ?? []) as unknown as (Omit<RosterMember, "goals"> & {
    goals: RawGoal[]
  })[]

  // One request for every photo on the page, signed as the caller. See
  // `photo-urls.ts` for why it is not the service key and not per photo.
  const urls = await signPhotos(
    supabase,
    raw.flatMap((m) => m.goals.map((g) => g.photo_url)),
  )

  return raw.map((m) => ({
    ...m,
    goals: m.goals.map(({ photo_url, ...g }) => ({
      ...g,
      photoUrl: photo_url ? (urls.get(photo_url) ?? null) : null,
    })),
  }))
}
