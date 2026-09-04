import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import { buildPersonalSnapshot } from "@/lib/galaxy/solarity/snapshots"
import type { GalaxySnapshot } from "@/lib/galaxy/data"

/**
 * Your own galaxy, read for the panel on Overview.
 *
 * ## Why this is not part of `getTodayData`
 *
 * That read is the one implementation of "what is checked off today and what
 * does that make the streak", shared by `/dashboard` and `/today`, and the rule
 * in this codebase is one implementation per rule. This is a **different
 * projection of the same rows**: it needs a category *slug* rather than a hex,
 * it needs `belt_visible`, and it needs the goals you have already achieved,
 * which the panel has no use for and `/today` would pay for on every visit.
 *
 * What it deliberately does **not** re-read is `daily_completion`. `dayClosed`
 * is passed in from `getTodayData`, so the sun and the numbers printed above it
 * cannot disagree about the same day — and a third read of one row on the
 * screen every session opens with is a cost with nothing to show for it.
 *
 * ## Achievements are goals
 *
 * There is no achievements table and there does not need to be one. Achieving
 * is irreversible, so the goal leaves the active list and becomes permanent —
 * exactly what the galaxy does with it: the planet goes and a star arrives.
 *
 * ## Nothing here is hidden
 *
 * `goals.hidden_everywhere` and `goal_group_visibility` are both about what
 * *other people* see, and this is your own view of your own goals. Applying
 * either would repeat a bug this codebase has shipped twice — `circle_roster`
 * masking your own goal's title from you, and `can_view_checkin_photo` hiding
 * your own photo from yourself.
 */
export async function getPersonalGalaxy(
  supabase: SupabaseClient<Database>,
  userId: string,
  checkinDate: string | null,
  dayClosed: boolean,
): Promise<GalaxySnapshot | null> {
  const [
    { data: goals, error: goalsError },
    { data: entries, error: entriesError },
    { data: achieved, error: achievedError },
  ] = await Promise.all([
    supabase
      .from("goals")
      .select("id, belt_visible, goal_categories(slug)")
      .eq("user_id", userId)
      .is("archived_at", null)
      .is("achieved_at", null)
      // The same order the orbit radii are handed out in, so a goal keeps its
      // orbit as long as it exists rather than swapping when another is added.
      .order("created_at", { ascending: true }),

    // `?? ""` never matches a real date, so a failed lookup draws an unlit
    // galaxy rather than filtering on null and returning every entry ever.
    supabase
      .from("progress_entries")
      .select("goal_id")
      .eq("user_id", userId)
      .eq("check_in_date", checkinDate ?? ""),

    /**
     * **Archived goals are not achievements.** Archiving is the retirement
     * path — dropped, not finished — and only `achieved_at` feeds
     * `total_goals_achieved`. A star for a goal you gave up on would be the
     * galaxy telling a story the rest of the app does not.
     */
    supabase
      .from("goals")
      .select("id, goal_categories(slug)")
      .eq("user_id", userId)
      .not("achieved_at", "is", null)
      .order("achieved_at", { ascending: true }),
  ])

  /**
   * **Null when a read failed, rather than an empty galaxy.**
   *
   * `(goals ?? [])` would draw a bare sun with nothing orbiting it — which is a
   * *claim*, and one the read never made: it says "you have no goals" when the
   * truth is "I could not tell". `patterns.md`, "a default that answers a
   * question the read never answered".
   *
   * Absence is the honest answer because this surface is additive. The panel
   * removes itself, the page closes up, and the goals list one block down —
   * which is read separately — still says what today looks like.
   */
  if (goalsError || entriesError || achievedError) return null

  const shining = new Set((entries ?? []).map((entry) => entry.goal_id))

  return buildPersonalSnapshot({
    goals: (goals ?? []).map((goal) => ({
      id: goal.id,
      categorySlug: goal.goal_categories?.slug ?? "other",
      shine: shining.has(goal.id),
      beltVisible: goal.belt_visible,
    })),
    achievements: (achieved ?? []).map((goal) => ({
      id: goal.id,
      categorySlug: goal.goal_categories?.slug ?? "other",
    })),
    dayClosed,
  })
}
