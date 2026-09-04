"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { saveFirstGoal } from "@/app/actions/onboarding"
import { GalaxyPreview } from "@/components/galaxy-preview"
import { SUN_COLOR_PRESETS, sunPresetIdForMember } from "@/lib/galaxy/data"
import { buildFirstGoalPreview } from "@/lib/galaxy/solarity/snapshots"
import type { ActionResult } from "@/lib/errors"

function Submit() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? "Saving…" : "Continue"}
    </button>
  )
}

/**
 * The first goal, written through the action every other goal goes through.
 *
 * **`createGoal`, not a second insert path.** That action carries the title
 * length check, the profanity screen, the rate limit, the category lookup by
 * slug rather than by uuid, and the first-goal marker that stops the person
 * being thrown at the daily check-in screen the moment they arrive. A form that
 * wrote its own row would carry none of it, and would drift the first time one
 * of them changed.
 *
 * **No skip link, and that is the decision rather than an omission.** Every
 * account reaches the app with something to check off tonight, so the empty
 * dashboard stops existing for new accounts. The cost is real and worth stating:
 * somebody who cannot think of a goal is on a form they cannot leave, and an
 * outage in this one write blocks sign-up. The back button still works, and the
 * account already exists — it is a gate on the dashboard, not on the account.
 */
export function FirstGoalForm({
  categories,
  userId,
}: {
  categories: { slug: string; name: string }[]
  /** Fixes the sun's colour. See `buildFirstGoalPreview`. */
  userId: string
}) {
  const router = useRouter()
  const [state, action] = useActionState<ActionResult | null, FormData>(
    saveFirstGoal,
    null,
  )

  /**
   * **Opens on the colour this account already renders**, not on an empty
   * choice. `sunPresetIdForMember` is what every galaxy has drawn for them
   * since they signed up, so the picker starts by showing them their sun and
   * offering five alternatives — rather than asking a question they did not
   * know they had and rendering nothing until they answer it.
   *
   * It also means the field always has a valid value, which is why
   * `saveFirstGoal` can treat a missing one as "not from this form".
   */
  const [sun, setSun] = useState(() => sunPresetIdForMember(userId))

  /**
   * **Controlled, and only because the picture needs to know.**
   *
   * The form still submits `category` as a plain field — nothing about the
   * write changed — but the canvas beside it has to react to the choice, and a
   * `change` handler with no state would have nowhere to put the answer.
   *
   * Still no `disabled` on the placeholder: see the comment on the option.
   */
  const [category, setCategory] = useState("")

  /**
   * **Memoised on the slug**, so typing a title does not rebuild the snapshot
   * on every keystroke and hand the renderer a new object identity to diff.
   * The sun does not change either way; the work would be entirely wasted.
   */
  const snapshot = useMemo(
    () =>
      buildFirstGoalPreview({
        userId,
        sunPresetId: sun,
        categorySlug: category || null,
      }),
    [userId, sun, category],
  )

  /**
   * **The action cannot redirect and this one must not.**
   *
   * `createGoal` is shared with the dashboard, where a redirect would be wrong,
   * so it returns a result. Navigating here rather than there keeps the action
   * ignorant of which screen called it — the alternative is a `next` parameter
   * threaded through an action that four other callers do not need.
   */
  useEffect(() => {
    if (state?.ok) router.push("/onboarding/install")
  }, [state, router])

  return (
    <form action={action} className="flex w-full max-w-xs flex-col gap-3">
      {/*
        **Above the fields, and it is the first thing on the screen for a
        reason.** Onboarding has been a form asking for text; this is the first
        moment the product shows what the text is *for*. The sun is already
        theirs — hashed from their account, the same one their Circles will see
        — so it is there before they have typed anything, and choosing a
        category puts a planet around it while their thumb is still on the
        picker.

        It removes itself when the canvas cannot exist. Nothing below depends
        on it, which is the rule that lets it be here at all: this is the one
        screen in the product nobody can skip.
      */}
      <GalaxyPreview snapshot={snapshot} />

      {/*
        **A radiogroup, not a row of buttons.** Six mutually exclusive choices
        with one selected is exactly what radios are, so this gets arrow-key
        navigation, a single tab stop and the right announcement for free —
        and the e2e suite can locate it by role and name like everything else.

        The input is visually hidden rather than absent: `sr-only` keeps it
        focusable and in the accessibility tree while the `<label>` beside it
        draws the swatch, which is the same trick the avatar picker uses to
        open a file dialog from a label on iOS.

        Named `sun` and submitted with the form, so the colour and the goal are
        one write from the person's point of view even though the action makes
        two.
      */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Your sun</legend>
        <div role="radiogroup" aria-label="Your sun" className="flex gap-2">
          {SUN_COLOR_PRESETS.map((preset) => (
            <label
              key={preset.id}
              className="flex cursor-pointer flex-col items-center gap-1"
            >
              <input
                type="radio"
                name="sun"
                value={preset.id}
                checked={sun === preset.id}
                onChange={() => {
                  setSun(preset.id)
                }}
                className="sr-only peer"
              />
              {/*
                `peer-checked` and `peer-focus-visible` rather than a class
                computed in JS: the ring follows the input's real state, so it
                cannot disagree with what would be submitted.

                A ring rather than a colour change, because the thing being
                selected *is* a colour and altering it to show selection would
                misrepresent the choice.
              */}
              <span
                aria-hidden
                className="h-8 w-8 rounded-full border border-transparent ring-offset-2 ring-offset-[var(--background)] peer-checked:ring-2 peer-checked:ring-current peer-focus-visible:ring-2 peer-focus-visible:ring-current"
                style={{
                  backgroundColor: `#${preset.color.toString(16).padStart(6, "0")}`,
                }}
              />
              <span className="sr-only">{preset.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-xs opacity-60">
        {category
          ? "Your sun, and the planet this goal will be."
          : "Your sun. Pick a category below and it gets a planet."}
      </p>

      <label htmlFor="title" className="text-sm font-medium">
        Your goal
      </label>
      <input
        id="title"
        name="title"
        required
        maxLength={100}
        autoComplete="off"
        placeholder="Read for 20 minutes"
        className="rounded border px-3 py-2 text-sm"
      />

      <label htmlFor="category" className="text-sm font-medium">
        Category
      </label>
      <select
        id="category"
        name="category"
        required
        value={category}
        onChange={(event) => {
          setCategory(event.target.value)
        }}
        className="rounded border px-3 py-2 text-sm"
      >
        {/*
          **Not `disabled`, and `goals-panel.tsx` already carried the reason.**

          iOS renders a `<select>` as a wheel and skips disabled options
          entirely, so a disabled placeholder opens the wheel on the first real
          category while the element's value is still `""` — tapping Done moves
          nothing, fires no `change`, and submits an empty category. The picker
          says "Career & Professional" and the form disagrees, which reads as
          the selection not working.

          This form shipped with `disabled` on it, which is the same defect the
          dashboard fixed in step 16, reintroduced on **the screen most likely
          to be met on a phone and the only one nobody can skip**. Found by
          auditing the diff against `patterns.md` rather than by using it.
        */}
        <option value="">Choose a category</option>
        {categories.map((category) => (
          <option key={category.slug} value={category.slug}>
            {category.name}
          </option>
        ))}
      </select>
      {/*
        The line that used to be here said "the category is the colour this
        goal gets in your galaxy". The picture above says it now, in the colour
        itself, which is the whole reason it is there.
      */}

      {/*
        `role="alert"` and never an empty one: an alert node that exists with no
        text is a thing tests wait on and find nothing in. See `patterns.md`,
        "a decoy that satisfies the wait".
      */}
      {state && !state.ok ? (
        <p role="alert" className="text-xs text-red-600">
          {state.error}
        </p>
      ) : null}

      <Submit />
    </form>
  )
}
