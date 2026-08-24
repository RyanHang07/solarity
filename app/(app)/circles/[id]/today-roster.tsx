"use client"

import { useActionState, useState } from "react"
import { useFormStatus } from "react-dom"
import { setNoteSharing } from "@/app/actions/check-ins"
import { CheckinPhoto } from "@/components/checkin-photo"
import type { ActionResult } from "@/lib/errors"
import type { RosterMember } from "@/lib/roster"
import { formatProgress } from "@/lib/roster"

function ShareToggle({ shared }: { shared: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-xs underline opacity-70 disabled:opacity-40"
    >
      {pending ? "Saving…" : shared ? "Stop sharing" : "Share with your Circles"}
    </button>
  )
}

/**
 * Who did what today, for everyone in the Circle.
 *
 * **Expanding reveals data already fetched.** `circle_roster` returns every
 * member's goals in the same call as their counts, so opening a row is
 * presentation rather than a request. A per-member fetch would be one round
 * trip per curious tap on a list that is at most ten people long.
 *
 * Everything shown here was masked in the database. A hidden goal arrives with
 * a null title and its real tick, and there is no branch in this file that
 * could leak one, because the title is simply not present.
 */
export function TodayRoster({
  members,
  frozen,
  groupId,
}: {
  members: RosterMember[]
  /** An archived Circle: nothing here can change, so nothing offers to. */
  frozen: boolean
  groupId: string
}) {
  const [openId, setOpenId] = useState<string | null>(null)

  // One action for every row, which is safe here because the roster re-renders
  // from the server after each change: the result is never read back, only the
  // error is. See build-plan.md on stale `useActionState`.
  const [shareState, shareAction] = useActionState<ActionResult | null, FormData>(
    setNoteSharing,
    null,
  )

  return (
    <ul className="flex flex-col gap-2">
      {members.map((m) => {
        const open = openId === m.user_id
        // Username first, display name only as a fallback.
        //
        // The reverse of what this used to do, and of what `display_name` is
        // for. `display_name` is not unique: two members who both set theirs to
        // "Ryan Hang" render as two identical rows in a Circle of people who are
        // supposed to be recognising each other, and setting yours to match a
        // friend's is a cheaper impersonation than the unicode lookalikes the
        // case-insensitive username index already blocks. Recognition needs the
        // unique handle.
        const name = m.username || m.display_name
        return (
          <li key={m.user_id} className="rounded border text-sm">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : m.user_id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
            >
              <span>
                {name}
                {m.is_self ? <span className="opacity-60"> (you)</span> : null}
                {m.role !== "member" ? (
                  <span className="opacity-60"> · {m.role}</span>
                ) : null}
              </span>

              <span className="flex shrink-0 items-center gap-2">
                {/* The visible half of `streak_grace`. Without it the Circle
                    silently stops counting someone and the roster looks
                    identical to one where it does not. */}
                {m.streak_grace ? (
                  <span className="text-xs opacity-60">settling in</span>
                ) : null}
                <span className="opacity-70">{formatProgress(m)}</span>
                <span aria-hidden className="opacity-40">
                  {open ? "▾" : "▸"}
                </span>
              </span>
            </button>

            {open ? (
              <div className="border-t px-3 py-2">
                {m.goals.length === 0 ? (
                  <p className="text-xs opacity-60">
                    {m.is_self
                      ? "You have no active goals. Add one on your dashboard."
                      : "No active goals."}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {m.goals.map((g) => (
                      <li key={g.id} className="flex flex-col gap-0.5">
                        <span className="flex items-baseline justify-between gap-3">
                          <span className={g.hidden ? "italic opacity-60" : ""}>
                            {/* Hidden means "not what it is", never "not
                                whether it was done", which is why the tick
                                still shows either way.

                                On your own row you get the real title and a
                                marker. `circle_roster` withheld it from you
                                too until migration 72, so this read "Hidden
                                goal" to the one person who already knew what
                                it said. `hidden` stays true on your own row
                                precisely so this marker has something to read;
                                it is the only place you can see, from inside
                                the Circle, what this Circle cannot. */}
                            {g.hidden && !m.is_self ? "Hidden goal" : g.title}
                          </span>
                          {g.hidden && m.is_self ? (
                            <span className="shrink-0 text-xs opacity-50">
                              hidden here
                            </span>
                          ) : null}
                          <span
                            aria-label={g.checked ? "done" : "not done"}
                            className={`shrink-0 ${g.checked ? "" : "opacity-40"}`}
                          >
                            {g.checked ? "✓" : "✗"}
                          </span>
                        </span>

                        {/*
                          `photoUrl` is already masked by `circle_roster` and
                          already signed as this viewer, so there is nothing to
                          decide here: if it is null there is no photo to draw.

                          The alt text never repeats a hidden goal's title —
                          `g.title` is null on someone else's hidden goal, and
                          the masked branch above is the only place that word
                          appears.
                        */}
                        {g.photoUrl ? (
                          <CheckinPhoto
                            url={g.photoUrl}
                            alt={
                              g.hidden && !m.is_self
                                ? `Check-in photo from ${m.username}`
                                : `Check-in photo for ${g.title}`
                            }
                          />
                        ) : null}

                        {g.note ? (
                          <span className="flex flex-wrap items-baseline gap-2">
                            <span className="text-xs opacity-70">{g.note}</span>

                            {/*
                              Only your own note, and only while the Circle is
                              live. On a frozen roster nothing can change, so
                              offering a control that would silently do nothing
                              is worse than offering none.
                            */}
                            {m.is_self && g.entry_id && !frozen ? (
                              <form action={shareAction}>
                                <input type="hidden" name="entryId" value={g.entry_id} />
                                <input type="hidden" name="groupId" value={groupId} />
                                <input
                                  type="hidden"
                                  name="shared"
                                  value={g.note_shared ? "false" : "true"}
                                />
                                <ShareToggle shared={g.note_shared} />
                              </form>
                            ) : null}

                            {m.is_self && !g.note_shared && !frozen ? (
                              <span className="text-xs opacity-50">
                                (only you can see this)
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </li>
        )
      })}
      {shareState && !shareState.ok ? (
        <li role="alert" className="text-sm text-red-600">
          {shareState.error}
        </li>
      ) : null}
    </ul>
  )
}
