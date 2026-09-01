import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

export type CirclePreview = {
  status: string
  circle_name: string | null
  member_count: number | null
  is_full: boolean | null
}

/**
 * What an invite token points at, for a visitor who may not be signed in.
 *
 * **The second exemption from the "RPCs only in `app/actions/`" lint rule**,
 * and the justification is narrower than `checkin-date.ts`'s. That rule exists
 * so a call cannot skip rate limiting; this one genuinely needs it, because
 * granting `circle_preview` to `anon` in migration 63 made it the app's only
 * unauthenticated endpoint.
 *
 * So the exemption is conditional on the caller metering it. `/join/[token]`
 * is the only caller, and step 7f adds the per-IP limit there, at the call
 * site, before this runs. A server action was the alternative and is worse: it
 * would publish a POST endpoint for a value only ever read during render.
 *
 * Returns null rather than throwing. A preview that fails is not worth a 500,
 * and the page treats it the same as an unusable link.
 */
export async function getCirclePreview(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<CirclePreview | null> {
  const { data, error } = await supabase.rpc("circle_preview", {
    p_token: token,
  })

  if (error) {
    console.error("circle_preview failed", error)
    return null
  }

  // Declared `returns table`, so PostgREST hands back an array of one row.
  return (data as CirclePreview[] | null)?.[0] ?? null
}

export type PreviewMember = {
  username: string
  avatar_url: string | null
  role: string
}

/**
 * Step 18c. Who is already in the Circle this token opens.
 *
 * **Same exemption, same condition as `getCirclePreview` above**: it is called
 * from `/join/[token]` only, after that page has already metered the request by
 * IP and by token hash. Adding a second unmetered `anon` RPC would have been
 * the way this exemption stopped being narrow.
 *
 * **The access rule is entirely inside the function.** It returns no rows
 * unless the link is enabled, unexpired and on an active Circle, so a revoked
 * token stops naming members in the same breath it stops working. Nothing here
 * re-checks that, because a second copy of a rule is a second place for it to
 * drift.
 *
 * An empty list on failure, never a throw. The page has already decided whether
 * the link is usable from `circle_preview`; a roster that will not load is a
 * missing section, not a dead invite.
 */
export async function getCirclePreviewMembers(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<PreviewMember[]> {
  const { data, error } = await supabase.rpc("circle_preview_members", {
    p_token: token,
  })

  if (error) {
    console.error("circle_preview_members failed", error)
    return []
  }

  return (data as PreviewMember[] | null) ?? []
}
