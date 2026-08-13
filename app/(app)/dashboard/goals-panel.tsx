"use client"

import { useActionState, useEffect, useRef } from "react"
import { useFormStatus } from "react-dom"
import { createGoal, archiveGoal } from "@/app/actions/goals"
import type { ActionResult } from "@/lib/errors"

type Category = { slug: string; name: string; color_hex: string }
type Goal = {
  id: string
  title: string
  archived_at: string | null
  achieved_at: string | null
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

export function GoalsPanel({
  goals,
  categories,
}: {
  goals: Goal[]
  categories: Category[]
}) {
  const [createState, createAction] = useActionState<ActionResult | null, FormData>(
    createGoal,
    null,
  )
  const [archiveState, archiveAction] = useActionState<ActionResult | null, FormData>(
    archiveGoal,
    null,
  )

  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (createState?.ok) formRef.current?.reset()
  }, [createState])

  const active = goals.filter((g) => !g.archived_at && !g.achieved_at)
  const inactive = goals.filter((g) => g.archived_at || g.achieved_at)

  return (
    <section className="flex flex-col gap-4">
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
            <option value="" disabled>
              Category…
            </option>
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

      {archiveState && !archiveState.ok ? (
        <p role="alert" className="text-sm text-red-600">
          {archiveState.error}
        </p>
      ) : null}

      {!active.length ? (
        <p className="text-sm opacity-70">No active goals yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {active.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
            >
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
