import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CirclesPanel, type CircleRow } from "../circles-panel"
import { readMemberships } from "../memberships"

export const metadata = { title: "Circles" }

/**
 * Step 14a. The Circles list and the create form.
 *
 * **The cheapest section by a wide margin: one query.** Before the split it
 * also paid for goals, categories, the check-in date and `getTodayData` —
 * including a Storage round trip to sign photo URLs — none of which it draws.
 *
 * Reached at `/dashboard/circles`; `/dashboard?tab=circles` redirects here.
 */
export default async function CirclesSectionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { active, inactive } = await readMemberships(supabase, user.id)

  return (
    <CirclesPanel active={active as CircleRow[]} inactive={inactive as CircleRow[]} />
  )
}
