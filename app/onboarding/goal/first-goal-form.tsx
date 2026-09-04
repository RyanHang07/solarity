"use client"

import { useRouter } from "next/navigation"
import { useActionState, useEffect, useMemo, useState } from "react"
import { useFormStatus } from "react-dom"
import { createGoal } from "@/app/actions/goals"
import { GalaxyPreview } from "@/components/galaxy-preview"
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
    createGoal,
    null,
  )

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
    () => buildFirstGoalPreview({ userId, categorySlug: category || null }),
    [userId, category],
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
