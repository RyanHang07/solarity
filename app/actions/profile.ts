"use server"

import { createClient } from "@/lib/supabase/server"

/**
 * Step 15b. One profile, read through `profile_by_username`.
 *
 * **In `app/actions/` because of the lint rule, and the rule is right here.**
 * A `.rpc()` from a component skips rate limiting and screening. This is a
 * read and has nothing to meter, so it could have argued for a fourth
 * exemption — and the rule's own comment says a fourth should be taken as
 * evidence the rule is wrong. It is not wrong; this file costs one import.
 *
 * **Not a server action in the mutating sense.** It publishes a POST endpoint
 * that returns a profile the caller could already fetch, which is the same
 * exposure as the page itself.
 */

export type Profile = {
  userId: string
  username: string
  displayName: string | null
  /** A Storage key, not a URL. Sign it before rendering. */
  avatarKey: string | null
  memberSince: string
  isSelf: boolean
  /**
   * Whether the numbers below mean anything.
   *
   * **Not the same as all four being zero**, which is a real state: a brand
   * new account has genuinely completed no days. `false` here means the
   * person has not shared them, and the screen says so rather than printing
   * four zeroes about someone it knows nothing about.
   */
  statsVisible: boolean
  currentStreak: number | null
  longestStreak: number | null
  totalDaysCompleted: number | null
  totalGoalsAchieved: number | null
}

/**
 * Returns null for a username nobody has **and** for one either party has
 * blocked. Those are the same answer on purpose: a distinguishable result
 * turns "did they block me" into something anyone can probe.
 */
export async function profileByUsername(username: string): Promise<Profile | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc("profile_by_username", { p_username: username })
    .maybeSingle()

  if (error) {
    console.error("profile_by_username failed", error)
    return null
  }
  if (!data) return null

  return {
    userId: data.user_id,
    username: data.username,
    displayName: data.display_name,
    avatarKey: data.avatar_url,
    memberSince: data.member_since,
    isSelf: data.is_self,
    statsVisible: data.stats_visible,
    currentStreak: data.current_streak,
    longestStreak: data.longest_streak_ever,
    totalDaysCompleted: data.total_days_completed,
    totalGoalsAchieved: data.total_goals_achieved,
  }
}
