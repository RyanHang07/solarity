import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { pendingTimezone } from "@/app/actions/settings"
import {
  UsernameForm,
  TimezoneForm,
  TodayScreenForm,
  PushNameForm,
} from "./settings-forms"
import { PushToggle } from "@/components/push-toggle"

export const metadata = { title: "Settings — Solarity" }

/**
 * 8f-6. The route behind the gear icon on the dashboard.
 *
 * **Only controls whose backend already exists.** `sync_checkin_timezone`,
 * `complete_onboarding` doubling as the rename path, and `export_user_data` are
 * all live RPCs. Notifications joined them in 10d, once `subscribe_push` and the
 * browser half existed; until then it would have been a switch over nothing.
 * Account deletion still is one, and stays out.
 *
 * That is the same shape 8h spent two migrations removing, and it is worth
 * refusing on a page that invites people to change things.
 */
export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase
    .from("users")
    .select("username, display_name, checkin_timezone, today_screen_mode, push_shows_circle_name")
    .eq("id", user.id)
    .maybeSingle()

  // The `(app)` layout already bounces anyone without a username to onboarding,
  // so this is belt and braces rather than a real path. Guarded anyway: the
  // forms below would otherwise render with `undefined` defaults and save them.
  if (!profile?.username) redirect("/onboarding")

  // Through an RPC, not a column. See migration 75: `authenticated` cannot read
  // `pending_checkin_timezone` at all, because a grant that let you see your own
  // would have let every circle-mate see it too.
  const pending = await pendingTimezone()

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Link href="/dashboard" className="text-sm underline opacity-70">
          Back to dashboard
        </Link>
      </header>

      <section aria-label="Your account" className="flex flex-col gap-6">
        <UsernameForm current={profile.username} />
        <TimezoneForm current={profile.checkin_timezone} pending={pending} />
        <TodayScreenForm current={profile.today_screen_mode} />
        {/* Per account, unlike the device toggle below: what a notification may
            say does not change with the phone you are holding. */}
        <PushNameForm current={profile.push_shows_circle_name} />
      </section>

      {/* Client-only: whether this browser is permitted, subscribed, and still
          the one the row names are three facts the server cannot see. */}
      <PushToggle />

      <section aria-label="Your data" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Your data</h2>
        <p className="text-sm opacity-70">
          Everything Solarity holds about you: your goals, check-ins, Circles and
          streaks, as one JSON file.
        </p>
        {/*
          A plain link to a route handler, not a button calling an action. The
          deliverable is a file, and `Content-Disposition` does that without
          building a Blob and a synthetic click in the browser. It also survives
          being opened in a new tab.
        */}
        <Link href="/settings/export" className="text-sm underline">
          Download your data
        </Link>
      </section>

      <section aria-label="Legal" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Legal</h2>
        {/*
          Also linked from `/` and `/auth/sign-in`. Here as well because this is
          where someone looks when they want to know what happens to their
          photos, and a policy nobody can find from inside the app is a policy
          written for a consent-screen reviewer rather than for a user.
        */}
        <div className="flex gap-4">
          <Link href="/privacy" className="text-sm underline">
            Privacy
          </Link>
          <Link href="/terms" className="text-sm underline">
            Terms
          </Link>
        </div>
      </section>

      {/*
        Still deliberately absent: deleting your account needs a confirmation
        flow, and nobody has written one. A control over a function that does
        not exist is the exact thing 8h was built to remove.
      */}
    </div>
  )
}
