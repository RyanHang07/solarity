/**
 * Solarity's rows → the renderer's snapshot.
 *
 * **The only file that knows about both.** `lib/galaxy` is a portable module
 * that has never heard of a roster, and `lib/roster.ts` is a shape a screen
 * needs; this is the seam, and it imports `../data` rather than `../` so that
 * nothing here can drag PixiJS into a server component. `data.boundary.test.ts`
 * proves that half is clean.
 */
import {
  buildGalaxySnapshot,
  GOAL_CATEGORIES,
  skyAmbienceTierFromCount,
  sunPresetIdForMember,
  onlySystem,
  type CategorySlug,
  type GalaxySnapshot,
  type SystemConfig,
} from "../data"
import type { RosterGoal, RosterMember } from "@/lib/roster"

/**
 * A slug the renderer will recognise, or the fallback.
 *
 * The database and `lib/galaxy/categories.ts` agree on all nine slugs — checked
 * against migration 4's seed, which was written three weeks before the renderer
 * existed and still holds. **This exists for the tenth**: the day somebody adds
 * a category in SQL and not in TypeScript, one planet should be the wrong
 * colour rather than the whole canvas failing to build.
 *
 * **A membership test, not `categoryBySlug`.** That function *throws* on an
 * unknown slug rather than returning undefined, so using it as a guard turned
 * the fallback into the crash it was written to prevent. Caught by a test that
 * happened to use a slug that did not exist.
 */
const KNOWN = new Set<string>(GOAL_CATEGORIES.map((category) => category.slug))

const asCategorySlug = (slug: string | null | undefined): CategorySlug =>
  (slug && KNOWN.has(slug) ? slug : "other") as CategorySlug

/**
 * A goal's cosmetics, which in v1 is one boolean.
 *
 * `belt_visible` is rolled by the column default in migration 107 and is the
 * only stored cosmetic. Surface kind is derived from the goal's uuid inside the
 * renderer and radius falls to its default, so neither belongs here — passing
 * `beltMode: "auto"` is what tells `resolveBeltVisible` to use the roll.
 */
const cosmeticsFor = (goals: readonly RosterGoal[]) =>
  Object.fromEntries(
    goals.map((goal) => [
      goal.id,
      { beltMode: "auto" as const, beltVisible: goal.belt_visible },
    ]),
  )

// ── one person ──────────────────────────────────────────────────────────────

export type PersonalGoalRow = {
  id: string
  categorySlug: string
  /** A `progress_entries` row for **that user's** check-in date, not today's. */
  shine: boolean
  beltVisible: boolean
}

export type PersonalAchievementRow = {
  id: string
  categorySlug: string
}

export type PersonalSnapshotInput = {
  goals: readonly PersonalGoalRow[]
  achievements: readonly PersonalAchievementRow[]
  /**
   * From `daily_completion.all_completed`.
   *
   * **Stored, not derived.** A day with zero active goals is written `false`
   * rather than skipped, and this is the value the streak is built on. The
   * renderer ships a `goals.every(shine)` helper that happens to agree; one is
   * maintained by a trigger and the other is a convenience in a render module.
   */
  dayClosed: boolean
}

/**
 * Your own galaxy.
 *
 * **Nothing here is hidden, and that is the decision rather than an omission.**
 * Hiding is `goals.hidden_everywhere` or a `goal_group_visibility` row, and both
 * are about what *other people* see. Applying either to your own view would
 * repeat a bug this codebase has shipped twice — `circle_roster` masking your
 * own goal's title from you, and `can_view_checkin_photo` hiding your own photo
 * from yourself.
 */
export const buildPersonalSnapshot = (
  input: PersonalSnapshotInput,
): GalaxySnapshot =>
  buildGalaxySnapshot({
    goals: input.goals.map((goal) => ({
      id: goal.id,
      categorySlug: asCategorySlug(goal.categorySlug),
      shine: goal.shine,
    })),
    achievements: input.achievements.map((item) => ({
      id: item.id,
      categorySlug: asCategorySlug(item.categorySlug),
    })),
    cosmetics: {},
    goalCosmeticsById: Object.fromEntries(
      input.goals.map((goal) => [
        goal.id,
        { beltMode: "auto" as const, beltVisible: goal.beltVisible },
      ]),
    ),
    dayClosed: input.dayClosed,
  })

// ── a Circle ────────────────────────────────────────────────────────────────

/**
 * A Circle's galaxy, straight from `circle_roster`.
 *
 * ## Sorted by join time, not by the order the roster returned
 *
 * The roster orders itself `is_self desc, joined_at asc`, which is right for
 * the list beneath the canvas and **wrong for the sky**: every member would see
 * a different arrangement of the same Circle, and two people looking at one
 * phone would disagree about where somebody is. The layout indexes by position
 * in `systems`, so this sorts by `joined_at` and lets the camera — not the
 * layout — know who is looking.
 *
 * ## No stars
 *
 * Star coordinates are canvas-normalised, so ten members' stars would scatter
 * across one sky with nothing tying any of them to the person who earned it. A
 * star is a personal record and a shared canvas is the wrong place for it. The
 * Circle's ambience carries its history instead.
 *
 * ## Hidden goals keep their planet
 *
 * A hidden goal arrives with a null title, its real `category_slug` and its real
 * `belt_visible`, so it draws as a coloured planet with no name — decided
 * deliberately, and migration 109 records what it costs. **Filtering them out
 * here would be worse than showing them**: the day's fraction beside the canvas
 * counts them, so a member with three goals and one hidden would read "1 of 3"
 * next to two planets.
 */
export const buildCircleSnapshot = (
  members: readonly RosterMember[],
): GalaxySnapshot => {
  const ordered = [...members].sort((a, b) =>
    a.joined_at < b.joined_at ? -1 : a.joined_at > b.joined_at ? 1 : 0,
  )

  const systems: SystemConfig[] = ordered.map((member) => {
    const solo = buildGalaxySnapshot({
      goals: member.goals.map((goal) => ({
        id: goal.id,
        categorySlug: asCategorySlug(goal.category_slug),
        shine: goal.checked,
      })),
      achievements: [],
      cosmetics: { sunPresetId: sunPresetIdForMember(member.user_id) },
      goalCosmeticsById: cosmeticsFor(member.goals),
      dayClosed: member.all_completed,
    })

    return {
      ...onlySystem(solo),
      id: member.user_id,
      dayClosed: member.all_completed,
      /**
       * **The username first, matching the roster's own rule.**
       *
       * `today-roster.tsx`: "the unique handle first, because this is where
       * members tell each other apart. `display_name` is not unique and two
       * people can hold the same one." The sky is the same situation — a hover
       * that reads "Sam's galaxy" twice in one Circle names nobody.
       *
       * Never drawn in the scene; the host renders it in the DOM.
       */
      label: member.username || member.display_name || undefined,
    }
  })

  return {
    systems,
    stars: [],
    /**
     * **Read, never recomputed.** `sky_closed` is `private.group_day_closed`,
     * the same function the nightly rollover stores its answer from, so the sky
     * and the group streak cannot disagree. Deriving it from
     * `systems.every(dayClosed)` here would drop the grace exclusion and be
     * wrong for any Circle with a member in grace.
     */
    skyClosed: ordered[0]?.sky_closed ?? false,
    ambienceTier: skyAmbienceTierFromCount(ordered[0]?.achievement_count ?? 0),
  }
}
