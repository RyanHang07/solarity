import { test, expect } from "@playwright/test"
import {
  admin,
  createCircleViaApi,
  deleteE2ECircles,
  requireEnv,
  sessionFor,
  userIdByEmail,
} from "./db"
import { SUN_COLOR_PRESETS } from "@/lib/galaxy/palettes"

/**
 * Migration 111's check constraint, held against `SUN_COLOR_PRESETS`.
 *
 * ## Why this spec exists
 *
 * The six preset ids are written twice: once in `lib/galaxy/palettes.ts`, which
 * owns them, and once in a SQL `check` constraint. A single source would mean
 * either no constraint — so a typo'd value is stored, renders as the default,
 * and reports nothing anywhere — or generating SQL from TypeScript, which is a
 * build step for six strings.
 *
 * **So the duplication is enforced rather than trusted.** `patterns.md`'s
 * standing lesson is that a rule with no enforcement is a rule that gets
 * broken, and this codebase has already shipped two constants that were
 * supposed to be kept in step by a comment.
 *
 * Adding a preset in TypeScript and not in SQL fails here, in seconds, instead
 * of failing on the one screen in the product nobody can skip.
 *
 * **Through the service key on purpose.** The subject is the *constraint*, not
 * the grant or the RLS policy, and reaching it through a session would mean a
 * refusal could come from three places. `boundaries.spec.ts` is where the grant
 * is tested.
 */

const OWNER = () => requireEnv("E2E_OWNER_EMAIL")

test("every preset in the palette is a value the column accepts", async () => {
  const userId = await userIdByEmail(OWNER())

  const { data: before } = await admin
    .from("users")
    .select("sun_preset_id")
    .eq("id", userId)
    .single()

  try {
    for (const preset of SUN_COLOR_PRESETS) {
      const { error } = await admin
        .from("users")
        .update({ sun_preset_id: preset.id })
        .eq("id", userId)

      expect(
        error?.message ?? null,
        `the column refused '${preset.id}', which lib/galaxy/palettes.ts offers`,
      ).toBeNull()
    }

    /**
     * **The control, and without it the loop above proves nothing.** A
     * constraint that had been dropped, or a column that silently ignored
     * writes, would accept all six just as happily.
     */
    const { error: refused } = await admin
      .from("users")
      .update({ sun_preset_id: "chartreuse" })
      .eq("id", userId)

    expect(
      refused,
      "the column accepted a colour that is not a preset, so it is unconstrained",
    ).not.toBeNull()

    /**
     * And `null` stays legal, because it is not an absent value — it is
     * "derive it from my id", which is what every account did before migration
     * 111 and what a new one does until it reaches the picker.
     */
    const { error: nulled } = await admin
      .from("users")
      .update({ sun_preset_id: null })
      .eq("id", userId)

    expect(nulled?.message ?? null, "null was refused").toBeNull()
  } finally {
    // The owner account is shared by the whole suite and its sun is visible in
    // every Circle galaxy, so this restores exactly what it found.
    await admin
      .from("users")
      .update({ sun_preset_id: before?.sun_preset_id ?? null })
      .eq("id", userId)
  }
})

test("the roster hands a member's chosen sun to everyone who can see them", async () => {
  /**
   * **Stored and not returned is the failure this catches**, and it is silent:
   * the person sees their colour on Overview, which reads their row directly,
   * and their hashed one in the Circle they chose it for. Nobody looks at both
   * at once, so nothing would report it.
   */
  const ownerId = await userIdByEmail(OWNER())

  const { data: before } = await admin
    .from("users")
    .select("sun_preset_id")
    .eq("id", ownerId)
    .single()

  const chosen = SUN_COLOR_PRESETS[3]?.id
  expect(chosen, "the palette is too short for this test").toBeTruthy()

  try {
    await admin
      .from("users")
      .update({ sun_preset_id: chosen })
      .eq("id", ownerId)

    const { groupId } = await createCircleViaApi(OWNER(), "sun colour")
    try {
      const owner = await sessionFor(OWNER())
      const { data, error } = await owner.rpc("circle_roster", {
        p_group_id: groupId,
      })

      expect(error?.message ?? null).toBeNull()
      const me = (data ?? []).find((row) => row.user_id === ownerId)
      expect(
        me?.sun_preset_id,
        "circle_roster does not carry the chosen sun, so the Circle sky will disagree with the dashboard",
      ).toBe(chosen)
    } finally {
      await deleteE2ECircles()
    }
  } finally {
    await admin
      .from("users")
      .update({ sun_preset_id: before?.sun_preset_id ?? null })
      .eq("id", ownerId)
  }
})
