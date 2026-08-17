"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { checkIn, undoCheckIn } from "@/app/actions/check-ins"

/** Mirrors the NOTE_MAX in `app/actions/check-ins.ts`. */
const NOTE_MAX = 500
import type { ActionResult } from "@/lib/errors"

type TodayGoal = {
  id: string
  title: string
  checkedIn: boolean
  color: string | null
}

function RowButton({ label, done }: { label: string; done: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded border px-3 py-1 text-xs font-medium disabled:opacity-50 ${
        done ? "opacity-70" : ""
      }`}
    >
      {pending ? "…" : label}
    </button>
  )
}

export function TodayPanel({
  goals,
  completedToday,
  streak,
  streakIncludesToday,
}: {
  goals: TodayGoal[]
  completedToday: boolean
  /** Settled days plus today, computed at display time. Never stored. */
  streak: number
  streakIncludesToday: boolean
}) {
  const [checkState, checkAction] = useActionState<ActionResult | null, FormData>(
    checkIn,
    null,
  )
  const [undoState, undoAction] = useActionState<ActionResult | null, FormData>(
    undoCheckIn,
    null,
  )

  const done = goals.filter((g) => g.checkedIn).length

  /**
   * Two actions share one error line, so which state is current has to be
   * tracked. Reading both and taking the first failure looks equivalent and is
   * not: a failed check-in keeps its result forever, so undoing successfully
   * afterwards left the old error on screen under a row that had just worked.
   *
   * Recorded on submit rather than derived. Neither form unmounts when it
   * submits, so this is safe here, unlike the confirm-and-replace flow in
   * `invite-panel.tsx` where the same trick would abort the action.
   */
  const [last, setLast] = useState<"check" | "undo" | null>(null)

  // Which goal has its note field open. One at a time: ten permanently visible
  // textareas would be ten mostly-empty boxes, and the fast path is a single
  // tap on `Check in` with no note at all.
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const current = last === "undo" ? undoState : last === "check" ? checkState : null
  const error = current && !current.ok ? current.error : null

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">Today</h2>
        <span className="text-sm opacity-70">
          {done} of {goals.length}
        </span>
      </div>

      <p className="text-sm">
        <strong>
          {streak} day{streak === 1 ? "" : "s"}
        </strong>{" "}
        <span className="opacity-70">
          {streak === 0
            ? "Check off every goal to start a streak."
            : streakIncludesToday
              ? "including today, which counts once the day ends."
              : "so far. Today is not counted yet."}
        </span>
      </p>

      {!goals.length ? (
        <p className="text-sm opacity-70">
          No active goals. A day with no goals counts as incomplete, not as a
          free pass, so add one below.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {goals.map((g) => (
            <li key={g.id} className="rounded border px-3 py-2 text-sm">
              {/*
                The form wraps the whole row so the note and its sharing tick
                are submitted with the check-in. `checkIn` writes all three in
                the single insert it already performed; attaching a note after
                the fact would need a second action and a second round trip.
              */}
              <form
                action={g.checkedIn ? undoAction : checkAction}
                onSubmit={() => setLast(g.checkedIn ? "undo" : "check")}
                className="flex flex-col gap-2"
              >
                <input type="hidden" name="goalId" value={g.id} />

                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block size-3 shrink-0 rounded-full"
                      style={{ background: g.color ?? undefined }}
                    />
                    <span className={g.checkedIn ? "line-through opacity-60" : ""}>
                      {g.title}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-2">
                    {/* Behind a link, not always visible: ten goals would mean
                        ten mostly-empty textareas, and the common case is one
                        tap with nothing to say. */}
                    {!g.checkedIn ? (
                      <button
                        type="button"
                        onClick={() => setNoteFor(noteFor === g.id ? null : g.id)}
                        aria-expanded={noteFor === g.id}
                        className="text-xs underline opacity-70"
                      >
                        {noteFor === g.id ? "Cancel note" : "+ note"}
                      </button>
                    ) : null}

                    <RowButton
                      label={g.checkedIn ? "Undo" : "Check in"}
                      done={g.checkedIn}
                    />
                  </span>
                </div>

                {noteFor === g.id && !g.checkedIn ? (
                  <div className="flex flex-col gap-1">
                    <textarea
                      name="note"
                      rows={2}
                      maxLength={NOTE_MAX}
                      aria-label={`Note for ${g.title}`}
                      placeholder="How did it go?"
                      className="rounded border px-2 py-1 text-sm"
                    />
                    <label className="flex items-center gap-2 text-xs opacity-70">
                      {/*
                        Unticked sends no field at all, and `checkIn` reads that
                        as private. Both defaults point the same way on purpose.

                        "your Circles", not "this Circle": sharing is per note,
                        so it reaches every Circle where this goal is visible.
                        The dashboard has no single Circle to name anyway.
                      */}
                      <input type="checkbox" name="noteShared" />
                      Share this note with your Circles
                    </label>
                  </div>
                ) : null}
              </form>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}

      {/* daily_completion is written by a trigger the moment the last goal is
          checked off, so this reflects the stored value rather than the count
          above. If the two ever disagree, the trigger is the one to trust. */}
      {goals.length && completedToday ? (
        <p className="text-sm opacity-70">
          Day complete. The stored counter catches up at the next rollover; a
          day is not final until it is over, since adding a goal or undoing a
          check-in can still reopen it.
        </p>
      ) : null}
    </section>
  )
}
