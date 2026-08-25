import { notFound, redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { profileByUsername } from "@/app/actions/profile"
import { signedAvatarUrl } from "@/app/actions/settings"
import { ProfileView } from "../../profile-view"
import { ProfileActions } from "./profile-actions"

/**
 * Step 15b. Somebody else's profile.
 *
 * **Your own username redirects to `/profile`.** One canonical URL for your own
 * page, so the Profile tab, a link you typed and a link somebody sent you all
 * land in the same place — and the tab's highlight is right, since
 * `activeSection` matches `/profile` exactly and would draw nothing on
 * `/profile/<you>`.
 *
 * **A missing profile and a blocked one are the same 404**, because
 * `profile_by_username` returns no rows for both. That is deliberate: any
 * distinguishable result turns "did they block me" into something anyone can
 * test, and the answer is the one thing the blocker chose to withhold.
 *
 * Blocking and reporting arrive in 15d and 15e; this is the read.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  // **Not the display name, and not fetched.** Titles are rendered before any
  // authorisation is known, and a title is one of the few things that leaks out
  // of a page — into history, into the tab strip, into a shared screenshot.
  // The username is already in the URL the person typed.
  return { title: `${decodeURIComponent(username)} — Solarity` }
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const profile = await profileByUsername(decodeURIComponent(username))

  if (!profile) notFound()

  // **After the lookup, not before.** Redirecting on a string comparison with
  // the session's username would work, and would also mean two ways of deciding
  // who you are. The RPC already answers it, and `is_self` is the answer.
  if (profile.isSelf) redirect("/profile")

  const avatarUrl = await signedAvatarUrl(profile.avatarKey)

  /**
   * Whether a report about this person would be accepted.
   *
   * **Asked here so the control can be hidden, not so it can be enforced.**
   * `content_reports_insert_own` requires `private.shares_group_with`, and that
   * policy is what actually refuses. This query only decides whether to offer a
   * button that would fail.
   *
   * **Both sides filtered explicitly, and the shortcut deliberately not
   * taken.** `group_members`'s SELECT policy is `is_group_member(group_id)`, so
   * a bare read of their rows already comes back empty unless we share a Circle
   * — one query would answer this. That is leaning on RLS as a join, and the
   * lesson written into `readMemberships` is the opposite one: RLS bounds what
   * you *may* read, never what you *meant* to read. Two filters and an
   * intersection say what they mean and survive a policy change.
   */
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: theirs }, { data: mine }] = await Promise.all([
    supabase.from("group_members").select("group_id").eq("user_id", profile.userId),
    supabase.from("group_members").select("group_id").eq("user_id", user?.id ?? ""),
  ])

  const ours = new Set((mine ?? []).map((m) => m.group_id))
  const sharesCircle = (theirs ?? []).some((m) => ours.has(m.group_id))

  return (
    <>
      <ProfileView profile={profile} avatarUrl={avatarUrl} />
      <ProfileActions
        userId={profile.userId}
        username={profile.username}
        sharesCircle={sharesCircle}
      />
    </>
  )
}
