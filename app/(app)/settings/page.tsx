import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { pendingTimezone, signedAvatarUrl } from "@/app/actions/settings"
import {
  UsernameForm,
  TimezoneForm,
  TodayScreenForm,
  PushNameForm,
  StatsVisibilityForm,
} from "./settings-forms"
import { AvatarForm } from "./avatar-form"
import { BlockedList } from "./blocked-list"
import { DeleteAccountPanel } from "./delete-account-panel"
import { blockedAccounts } from "@/app/actions/moderation"
import { amIAdmin } from "@/app/actions/admin"
import { PushToggle } from "@/components/push-toggle"

export const metadata = { title: "Settings — Solarity" }

/**
 * 8f-6. The route behind the gear icon on the dashboard.
 *
 * **Only controls whose backend already exists.** `sync_checkin_timezone`,
 * `complete_onboarding` doubling as the rename path, and `export_user_data` are
 * all live RPCs. Notifications joined them in 10d, once `subscribe_push` and the
 * browser half existed; until then it would have been a switch over nothing.
 *
 * That is the same shape 8h spent two migrations removing, and it is worth
 * refusing on a page that invites people to change things.
 *
 * **Account deletion joined them in 14e, and it was the rule's mirror image.**
 * The `delete-account` Edge Function has been deployed since the
 * account-lifecycle work: a complete backend with nothing able to call it. The
 * note here used to say deletion "stays out" for want of a confirmation flow,
 * which was true, and left a finished function unreachable for weeks.
 */
export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase
    .from("users")
    .select(
      "username, display_name, avatar_url, checkin_timezone, today_screen_mode, push_shows_circle_name",
    )
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

  // Signed on the server, so the object key never reaches the browser and the
  // bucket stays private. Null when there is no avatar, which is the default.
  const avatarUrl = await signedAvatarUrl(profile.avatar_url)

  // 15c. One column, and the only one on this table a client may write.
  // `user_lifetime_stats_select_visible`'s first clause is `user_id =
  // auth.uid()`, so reading your own row needs nothing special.
  const { data: stats } = await supabase
    .from("user_lifetime_stats")
    .select("visible_on_profile")
    .eq("user_id", user.id)
    .maybeSingle()

  // 15d. Through the RPC, because a blocked account's username is not readable
  // through `users` once you share no Circle. See migration 87.
  const blocked = await blockedAccounts()

  // One boolean, and it can only ever answer about you. See migration 94.
  const isAdmin = await amIAdmin()

  /**
   * Active Circles this account owns, for the deletion warning.
   *
   * **`.eq("role", "owner")` and active only.** Succession fires for every
   * Circle, but naming an archived one would list something that has already
   * stopped running as a consequence of leaving — true and misleading. Same
   * filter the Circles list uses.
   *
   * One query on a page that already runs two, and only to answer a question
   * the person is about to ask.
   */
  const { data: owned } = await supabase
    .from("group_members")
    .select("groups(name, group_status)")
    .eq("user_id", user.id)
    .eq("role", "owner")

  const ownedCircles = (owned ?? [])
    .filter((m) => m.groups?.group_status === "active")
    .map((m) => m.groups?.name ?? "Circle")

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">Settings</h1>
        <Link href="/dashboard" className="text-sm underline opacity-70">
          Back to dashboard
        </Link>
      </header>

      <section aria-label="Your account" className="flex flex-col gap-6">
        {/* First, because it is the only identity control anyone else sees
            without reading a word. */}
        <AvatarForm
          userId={user.id}
          currentUrl={avatarUrl}
          displayName={profile.display_name ?? profile.username}
        />
        <UsernameForm current={profile.username} />
        {/* Beside the other identity controls, because it governs what the
            profile those controls describe actually shows. */}
        <StatsVisibilityForm current={stats?.visible_on_profile ?? false} />
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

      <BlockedList blocked={blocked} />

      {/*
        Step 17. **The only way to discover `/admin` from inside the app**, and
        only if you are one. The route is a 404 to everybody else, so an
        unconditional link would be a dead end that also announced the route
        exists.
      */}
      {isAdmin ? (
        <section aria-label="Admin" className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Admin</h2>
          <Link href="/admin" className="self-start text-sm underline">
            Reports and administrators
          </Link>
        </section>
      ) : null}

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
        Last, and behind a border, because it is the only control here that
        cannot be undone by using the page again.
      */}
      <DeleteAccountPanel username={profile.username} ownedCircles={ownedCircles} />
    </div>
  )
}
