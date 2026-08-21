"use client"

import { useActionState, useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import {
  createGoal,
  archiveGoal,
  setCircleVisibility,
  setHiddenEverywhere,
} from "@/app/actions/goals"
import type { ActionResult } from "@/lib/errors"

type Category = { slug: string; name: string; color_hex: string }
type Circle = { id: string; name: string }
type Goal = {
  id: string
  title: string
  archived_at: string | null
  achieved_at: string | null
  hidden_everywhere: boolean
  goal_categories: { name: string; color_hex: string } | null
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  )
}

/**
 * One goal's visibility, collapsed until asked for.
 *
 * **Collapsed matters.** Ten goals across six Circles is sixty controls, and on
 * almost every day you want none of them. `<details>` rather than React state
 * so it survives the re-render `revalidatePath` triggers after each toggle:
 * component state would snap shut the moment you used it.
 *
 * The switches submit a form each rather than firing on change, so this works
 * before hydration and reports its own failures. `hidden` is sent only when
 * asking to hide, matching the `noteShared` convention in `checkIn`: the safer
 * outcome is what a missing field produces.
 */
function Visibility({
  goal,
  circles,
  hiddenGroupIds,
  circleAction,
  everywhereAction,
}: {
  goal: Goal
  circles: Circle[]
  hiddenGroupIds: string[]
  circleAction: (formData: FormData) => void
  everywhereAction: (formData: FormData) => void
}) {
  const hiddenSet = new Set(hiddenGroupIds)
  const everywhere = goal.hidden_everywhere

  // Counted against the Circles actually listed, not against every row in the
  // table.
  //
  // `hiddenGroupIds` includes Circles that have since been archived or locked,
  // and `circles` holds only the active ones, so `hiddenSet.size` over
  // `circles.length` could read "Hidden from 3 of 2". Rows for inactive Circles
  // are deliberately kept — archiving is not a decision to un-hide, and the
  // Circle may reopen — which is exactly why the denominator and the numerator
  // have to be drawn from the same list.
  const hiddenHere = circles.filter((c) => hiddenSet.has(c.id)).length

  // What the summary has to say without being opened, because a goal hidden
  // from people is not a state anyone should have to go looking for.
  const summary = everywhere
    ? "Hidden from every Circle"
    : hiddenHere
      ? `Hidden from ${hiddenHere} of ${circles.length}`
      : "Visible to all your Circles"

  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs opacity-70">{summary}</summary>

      <div className="mt-2 flex flex-col gap-2 border-l pl-3">
        <form action={everywhereAction} className="flex items-center gap-2">
          <input type="hidden" name="goalId" value={goal.id} />
          {!everywhere ? <input type="hidden" name="hidden" value="on" /> : null}
          <button type="submit" className="text-xs underline">
            {everywhere ? "Show in my Circles again" : "Hide from every Circle"}
          </button>
          <span className="text-xs opacity-60">
            {everywhere
              ? "Including any Circle you join later."
              : "Covers Circles you join later, which per-Circle switches cannot."}
          </span>
        </form>

        {circles.length === 0 ? (
          <p className="text-xs opacity-60">
            You&apos;re not in any active Circles, so there is nothing to hide it
            from yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {circles.map((c) => {
              const hidden = hiddenSet.has(c.id)
              return (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <span className="min-w-32">{c.name}</span>
                  {/* Disabled, not hidden, and it says why. A switch that reads
                      "visible" while the goal is hidden everywhere would be a
                      lie about what other people can see. The underlying row is
                      left alone, so turning the master switch off restores
                      whatever was chosen here before. */}
                  {everywhere ? (
                    <span className="opacity-50">hidden everywhere</span>
                  ) : (
                    <form action={circleAction}>
                      <input type="hidden" name="goalId" value={goal.id} />
                      <input type="hidden" name="groupId" value={c.id} />
                      {!hidden ? (
                        <input type="hidden" name="hidden" value="on" />
                      ) : null}
                      <button type="submit" className="underline opacity-70">
                        {hidden ? "hidden · show it" : "visible · hide it"}
                      </button>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <p className="text-xs opacity-60">
          Hiding covers the title only. The goal still counts toward your day and
          toward what your Circle sees you complete.
        </p>
      </div>
    </details>
  )
}

export function GoalsPanel({
  goals,
  categories,
  circles,
  hiddenIn,
}: {
  goals: Goal[]
  categories: Category[]
  circles: Circle[]
  hiddenIn: Record<string, string[]>
}) {
  const [createState, createAction] = useActionState<ActionResult | null, FormData>(
    createGoal,
    null,
  )
  const [archiveState, archiveAction] = useActionState<ActionResult | null, FormData>(
    archiveGoal,
    null,
  )
  // One state per action rather than one per goal. The switches render from the
  // server props above, never from these, so a result left over from an earlier
  // submission cannot masquerade as the current state; they carry the error
  // message and nothing else. See the `useActionState` note in build-plan.md.
  const [circleVisState, circleVisAction] = useActionState<
    ActionResult | null,
    FormData
  >(setCircleVisibility, null)
  const [everywhereState, everywhereAction] = useActionState<
    ActionResult | null,
    FormData
  >(setHiddenEverywhere, null)

  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (createState?.ok) formRef.current?.reset()
  }, [createState])

  const active = goals.filter((g) => !g.archived_at && !g.achieved_at)
  const inactive = goals.filter((g) => g.archived_at || g.achieved_at)

  return (
    // Named, so it is a landmark rather than an anonymous `section`. The
    // dashboard renders each goal title twice, here and in Today, and without a
    // handle on this one every locator that mentions a title is ambiguous.
    <section aria-label="Your goals" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Your goals</h2>

      <form ref={formRef} action={createAction} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            name="title"
            required
            maxLength={100}
            autoComplete="off"
            placeholder="Run 5k"
            aria-label="Goal title"
            className="min-w-48 flex-1 rounded border px-3 py-2 text-sm"
          />
          {/* Categories are seeded and referenced by slug. The UUIDs differ per
              environment, so the value here is never an id. */}
          <select
            name="category"
            required
            defaultValue=""
            aria-label="Category"
            className="rounded border px-3 py-2 text-sm"
          >
            {/*
              **Not `disabled`, and that is the whole fix for iOS.**

              iOS renders a `<select>` as a wheel and skips disabled options
              entirely. With the placeholder disabled the wheel opened showing
              the first real category *highlighted* while the element's value
              was still `""`, so tapping Done moved nothing, fired no `change`,
              and submitted an empty category. The picker said "Career &
              Professional" and the form disagreed — which reads as the
              selection simply not working.

              Selectable, the displayed row is always the real value: the wheel
              opens on "Choose a category", and picking anything commits it.
              `required` still stops an empty submit, and now the browser's
              complaint matches what the person can see.
            */}
            <option value="">Choose a category</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <Submit label="Add goal" pendingLabel="Adding…" />
        </div>
        <p className="text-xs opacity-60">
          Up to 10 active goals. A day counts only when every active goal is
          checked off, so keep the list honest.
        </p>

        {createState && !createState.ok ? (
          <p role="alert" className="text-sm text-red-600">
            {createState.error}
          </p>
        ) : null}
      </form>

      {[archiveState, circleVisState, everywhereState].map((st, i) =>
        st && !st.ok ? (
          <p key={i} role="alert" className="text-sm text-red-600">
            {st.error}
          </p>
        ) : null,
      )}

      {!active.length ? (
        <p className="text-sm opacity-70">No active goals yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((g) => (
            <li key={g.id} className="rounded border px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block size-3 shrink-0 rounded-full"
                    style={{ background: g.goal_categories?.color_hex }}
                  />
                  <span>{g.title}</span>
                  <span className="opacity-60">{g.goal_categories?.name}</span>
                </span>

                <form action={archiveAction}>
                  <input type="hidden" name="goalId" value={g.id} />
                  <button
                    type="submit"
                    className="text-xs underline opacity-70"
                    // Archiving changes the denominator for today, so it can
                    // re-complete a day that was incomplete a moment ago.
                    title="Archive this goal"
                  >
                    Archive
                  </button>
                </form>
              </div>

              <Visibility
                goal={g}
                circles={circles}
                hiddenGroupIds={hiddenIn[g.id] ?? []}
                circleAction={circleVisAction}
                everywhereAction={everywhereAction}
              />
            </li>
          ))}
        </ul>
      )}

      {inactive.length ? (
        <details>
          <summary className="cursor-pointer text-sm opacity-70">
            Archived and achieved ({inactive.length})
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {inactive.map((g) => (
              <li
                key={g.id}
                className="rounded border px-3 py-2 text-sm opacity-60"
              >
                {g.title} · {g.achieved_at ? "achieved" : "archived"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
