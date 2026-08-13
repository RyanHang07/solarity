import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"

/**
 * Today, under the caller's frozen check-in timezone and the 2 AM boundary.
 *
 * **Never compute this client-side.** The rule lives in
 * `private.current_checkin_date()`, the INSERT policy on `progress_entries`
 * independently requires submitted dates to equal it, and a second
 * implementation in TypeScript would drift across DST and fail as an opaque
 * RLS rejection rather than a visibly wrong date.
 *
 * Exempt from the "RPCs only in app/actions/" lint rule, and it is the only
 * exemption. That rule exists because a `.rpc()` from a component skips rate
 * limiting and screening; this function is read-only, takes no arguments,
 * returns the same value for a given user and moment, and has nothing to
 * meter. Both the read path and the write path need it, so confining it to
 * server actions would mean duplicating it into the page anyway.
 */
export async function getCheckinDate(
  supabase: SupabaseClient<Database>,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_checkin_date")
  if (error) {
    // Logged rather than swallowed. A null here makes every check-in read
    // return nothing and the streak under-report, which looks like "you did
    // not check in" rather than like a fault. Callers must handle the null;
    // this makes the cause findable when they do.
    console.error("current_checkin_date failed", error)
    return null
  }
  return data
}
