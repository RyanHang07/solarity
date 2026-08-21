"use server"

import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { writeSeen, type TodayMode } from "@/lib/today-gate"

/**
 * Records that this device has been shown `/today`.
 *
 * **A server action because cookies cannot be written during a render.** Next
 * allows `cookies().set()` in actions and route handlers only, so the page
 * renders first and a client component fires this once on mount — the same
 * shape as `markNotificationsRead` in 8f-5.
 *
 * **Marked on show, not on dismiss.** If it were written by the skip link, the
 * browser back button would take you from `/today` to `/dashboard`, which would
 * divert you straight back to `/today`. A loop, from a control most people
 * never click.
 *
 * **No `revalidatePath`.** The dashboard reads the cookie this sets, so
 * revalidating would re-render the page that mounted the component that called
 * this. The count may be one navigation stale; a render loop may not be.
 */
export async function markTodaySeen(mode: TodayMode): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return

  // The date is the database's, never the client's. It is what the cookie is
  // compared against on the next visit, so a client-supplied value would let a
  // stale tab suppress tomorrow.
  const today = await getCheckinDate(supabase)
  await writeSeen(mode, today)
}

/**
 * Leaves `/today` for the dashboard.
 *
 * Sets the marker too, so someone who skips before the mount effect has run is
 * not diverted straight back.
 *
 * **No notice.** Skipping is not an achievement and not an error; telling
 * someone what they just chose to do is the kind of message people learn to
 * dismiss without reading. The finished-day hand-off carries one because that
 * redirect is not something the person asked for.
 */
export async function leaveToday(mode: TodayMode): Promise<never> {
  await markTodaySeen(mode)
  redirect("/dashboard")
}
