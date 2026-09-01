"use client"

import { useActionState, useSyncExternalStore } from "react"
import { useFormStatus } from "react-dom"
import {
  updateUsername,
  updateTimezone,
  updateTodayScreenMode,
  updatePushShowsCircleName,
  updateStatsVisibility,
  updateNotificationPrefs,
} from "@/app/actions/settings"
import type { ActionResult } from "@/lib/errors"

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

/** Result text for one form. Rendered from the action, never from a prop. */
function Result({ state, done }: { state: ActionResult | null; done: string }) {
  if (!state) return null
  return state.ok ? (
    <p className="text-sm opacity-70">{done}</p>
  ) : (
    <p role="alert" className="text-sm text-red-600">
      {state.error}
    </p>
  )
}

const noSubscribe = () => () => {}

export function UsernameForm({ current }: { current: string }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    updateUsername,
    null,
  )

  // `aria-label` is what makes this a `form` landmark. A `<form>` with no
  // accessible name is not exposed as one, so `getByRole("form")` matches
  // nothing, and two forms on a page are indistinguishable to a screen reader
  // as well as to a test.
  return (
    <form aria-label="Username" action={action} className="flex flex-col gap-2">
      <label htmlFor="username" className="text-sm font-medium">
        Username
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="username"
          name="username"
          required
          minLength={3}
          maxLength={30}
          pattern="[A-Za-z0-9_]+"
          autoComplete="off"
          defaultValue={current}
          className="min-w-48 flex-1 rounded border px-3 py-2 text-sm"
        />
        <Submit label="Save" pendingLabel="Saving…" />
      </div>
      <p className="text-xs opacity-60">
        This is how your Circles recognise you, so it has to be unique. You can
        change it once every 14 days.
      </p>
      <Result state={state} done="Username updated." />
    </form>
  )
}

export function TimezoneForm({
  current,
  pending,
}: {
  current: string
  pending: string | null
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    updateTimezone,
    null,
  )

  /**
   * The browser's guess, offered as a one-click fix rather than imposed.
   *
   * Read through `useSyncExternalStore` with an empty server snapshot, the same
   * shape `onboarding-form.tsx` uses: `Intl` does not exist during the server
   * render, and reading it in an effect would flash the wrong value first.
   */
  const detected = useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    () => "",
  )

  return (
    <form
      aria-label="Check-in timezone"
      action={action}
      className="flex flex-col gap-2"
    >
      <label htmlFor="timezone" className="text-sm font-medium">
        Check-in timezone
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="timezone"
          name="timezone"
          required
          autoComplete="off"
          defaultValue={current}
          className="min-w-48 flex-1 rounded border px-3 py-2 text-sm"
        />
        <Submit label="Save" pendingLabel="Saving…" />
      </div>

      {detected && detected !== current && detected !== pending ? (
        <p className="text-xs opacity-60">
          This device says <strong>{detected}</strong>.
        </p>
      ) : null}

      {/*
        What is in force, and what is queued, as two separate facts.
        `checkin_date_for` reads `checkin_timezone` and `now()` alone, so the
        live zone IS today's boundary; showing only the chosen one would say
        today is something it is not.
      */}
      {pending ? (
        <p className="text-xs opacity-70">
          <strong>{pending}</strong> takes over at your next daily reset. Until
          then your day still ends on {current} time.
        </p>
      ) : (
        <p className="text-xs opacity-60">
          Your day resets at 2 AM in {current}. A change here takes effect at
          your next daily reset, so today keeps the boundary it started with.
        </p>
      )}

      {/*
        "Saved." and nothing more. The longer wording overlapped the static
        paragraph above, which says "takes effect at your next daily reset"
        whether or not anything was saved — so an assertion on it passed while
        the button still read "Saving…". A confirmation that is a substring of
        permanent copy confirms nothing.
      */}
      <Result state={state} done="Saved." />
    </form>
  )
}

/** The three modes, named for how often rather than for what they switch. */
const MODES = [
  ["every_open", "Every time I open the app"],
  ["once_daily", "Once a day"],
  ["never", "Never"],
] as const

export function TodayScreenForm({ current }: { current: string }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    updateTodayScreenMode,
    null,
  )

  return (
    <form
      // `/today` links straight here with `#check-in-screen`. `scroll-mt`
      // leaves room for the header, which is sticky in spirit if not yet in
      // CSS; landing with the heading under the chrome is the usual way an
      // anchor link disappoints.
      id="check-in-screen"
      aria-label="Daily check-in screen"
      action={action}
      className="flex scroll-mt-6 flex-col gap-2"
    >
      <span className="text-sm font-medium">Daily check-in screen</span>

      {/*
        Radios rather than a select. Three options, all of which should be
        readable without opening anything, and the difference between them is
        the whole decision.
      */}
      <div className="flex flex-col gap-1">
        {MODES.map(([value, label]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mode"
              value={value}
              defaultChecked={current === value}
            />
            {label}
          </label>
        ))}
      </div>

      {/*
        Said plainly, because the setting reads as more aggressive than it is:
        none of the three ever shows the screen on a day you have finished. That
        is also why the first option is not called "Always".
      */}
      <p className="text-xs opacity-60">
        Shown only when you still have goals to check off. A finished day always
        goes straight to your dashboard.
      </p>

      <div>
        <Submit label="Save" pendingLabel="Saving…" />
      </div>
      <Result state={state} done="Saved." />
    </form>
  )
}

/**
 * 10g-2. Whether a push may name the Circle it is about.
 *
 * **Separate from the device toggle next to it, because they answer different
 * questions.** That one is "does this browser get notifications at all", and it
 * is per device. This is "what may a notification say", and it is per account:
 * a lock screen in an open-plan office is not less exposed on your laptop.
 *
 * **Default on, and the copy says what off costs.** With it off every push
 * reads the same, which is the state this whole piece exists to fix, so the
 * person choosing it should know they are choosing it.
 */
export function PushNameForm({ current }: { current: boolean }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    updatePushShowsCircleName,
    null,
  )

  return (
    <form
      id="notification-detail"
      aria-label="Notification detail"
      action={action}
      className="flex scroll-mt-6 flex-col gap-2"
    >
      <span className="text-sm font-medium">What notifications say</span>

      <label className="flex items-center gap-2 text-sm">
        {/*
          A checkbox sends nothing when unticked, which is why the action reads
          absence as off rather than looking for a "false".
        */}
        <input type="checkbox" name="show" defaultChecked={current} />
        Name the Circle in notifications
      </label>

      <p className="text-xs opacity-60">
        On, a notification says which Circle it is about, and that name appears
        on your lock screen. Off, every notification reads the same and you open
        the app to find out which one. Goals are never named either way.
      </p>

      <div>
        <Submit label="Save" pendingLabel="Saving…" />
      </div>
      <Result state={state} done="Saved." />
    </form>
  )
}

/**
 * Step 15c. Whether your four lifetime numbers appear on your profile.
 *
 * **Default off**, which is why the copy leads with what turning it *on* does
 * rather than what turning it off costs — the opposite of `PushNameForm` above,
 * because the default is the opposite.
 *
 * **The copy has to be exact about what this does not cover.** Your username,
 * display name, picture and join month are visible to any signed-in user
 * whatever this says; the toggle governs the four numbers. Someone who reads
 * "hidden" as "invisible" has been misled by omission, and this is the one
 * screen where that is correctable.
 */
export function StatsVisibilityForm({ current }: { current: boolean }) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    updateStatsVisibility,
    null,
  )

  return (
    <form
      id="profile-stats"
      aria-label="Profile stats"
      action={action}
      className="flex scroll-mt-6 flex-col gap-2"
    >
      <span className="text-sm font-medium">Stats on your profile</span>

      <label className="flex items-center gap-2 text-sm">
        {/* Unticked sends nothing, which the action reads as off. */}
        <input type="checkbox" name="visible" defaultChecked={current} />
        Show my streaks and totals
      </label>

      <p className="text-xs opacity-60">
        On, anyone signed in who opens your profile sees your current streak,
        longest streak, days completed and goals achieved. Off, they see nothing
        about your numbers. Either way your username, picture and the month you
        joined are visible — this covers the four numbers only.
      </p>

      <div>
        <Submit label="Save" pendingLabel="Saving…" />
      </div>
      <Result state={state} done="Saved." />
    </form>
  )
}

/**
 * Step 19. Which kinds of update may reach you during the day.
 *
 * **Four switches rather than one, and that is what stops people turning
 * everything off.** Before this, the only control was the per-device switch,
 * which also governs the digest. Somebody who found intraday activity noisy had
 * to silence the one notification they wanted to keep, so the app would have
 * been teaching people to disable it entirely.
 *
 * **`circle_activity` is described honestly as the frequent one.** It is the
 * only kind here that can arrive more than once a day, and burying that would
 * make the switch above it look broken when the buzzing continued.
 */
export function NotificationPrefsForm({
  goalAchieved,
  firstFinisher,
  lastOneLeft,
  circleActivity,
}: {
  goalAchieved: boolean
  firstFinisher: boolean
  lastOneLeft: boolean
  circleActivity: boolean
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(
    updateNotificationPrefs,
    null,
  )

  const rows = [
    {
      name: "last_one_left",
      checked: lastOneLeft,
      label: "When a Circle is waiting on you",
      hint: "Everyone else has finished their day and you haven't. At most once a day per Circle.",
    },
    {
      name: "goal_achieved",
      checked: goalAchieved,
      label: "When somebody achieves a goal",
      hint: "Rare: achieving a goal is final, so this is a handful of times a year.",
    },
    {
      name: "first_finisher",
      checked: firstFinisher,
      label: "When somebody finishes first",
      hint: "The first person in a Circle to finish their whole day. Once a day per Circle.",
    },
    {
      name: "circle_activity",
      checked: circleActivity,
      label: "When people get started",
      hint: "The frequent one. Somebody's first check-in of the day, grouped so a Circle can only reach you once an hour.",
    },
  ]

  return (
    <form
      aria-label="What you hear about"
      action={action}
      className="flex flex-col gap-3"
    >
      <span className="text-sm font-medium">What you hear about</span>

      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div key={row.name} className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={row.name} defaultChecked={row.checked} />
              {row.label}
            </label>
            <p className="pl-6 text-xs opacity-60">{row.hint}</p>
          </div>
        ))}
      </div>

      <p className="text-xs opacity-60">
        Your daily digest is separate and always arrives. These are the updates
        that reach you while the day is still going.
      </p>

      <div>
        <Submit label="Save" pendingLabel="Saving…" />
      </div>
      <Result state={state} done="Saved." />
    </form>
  )
}
