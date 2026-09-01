import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import {
  getCirclePreview,
  getCirclePreviewMembers,
} from "@/lib/supabase/circle-preview"
import { signAvatars } from "@/lib/supabase/avatar-urls"
import { Avatar } from "@/components/avatar"
import { enforce, RateLimitError } from "@/lib/ratelimit"
import { clientIp, inviteTokenKey } from "@/lib/request-identity"
import { JoinButton } from "./join-button"

export const metadata = {
  title: "Invite — Solarity",
  // A live invite link is a bearer credential. Keeping it out of search
  // indexes matters more here than on any other route.
  robots: { index: false, follow: false },
}

/**
 * Preview statuses that mean the link is dead. One notice, one redirect, no
 * 404. The reasoning for collapsing four causes into one message is in
 * `components/notice.tsx`.
 *
 * `circle_preview` checks `enabled` before `group_status`, so an **archived**
 * Circle arrives here as `revoked`: `trg_disable_links_on_status_change` has
 * already turned the link off by then. That is the common path, and it is why
 * the message does not say "expired".
 */
const DEAD = new Set(["not_found", "revoked", "expired"])

/** Statuses that keep their own copy, because the Circle is real and may reopen. */
const EXPLAIN: Record<string, string> = {
  circle_full:
    "This Circle is full. Circles hold up to 10 people, so ask whoever invited you to make room or start another.",
  circle_locked:
    "This Circle has finished its cycle and isn't taking new members right now. It may reopen when the group starts a new one.",
  circle_archived:
    "This Circle has been retired by its owner, so it isn't taking new members.",
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  /**
   * Metered before the database is touched. This is the app's only
   * unauthenticated endpoint, so it is the only one an attacker can hit without
   * an account, and `circle_preview` answers "is this token real" for free.
   *
   * **Two limits, two different attacks.** The IP limit stops one machine
   * trying many tokens. The token limit stops many machines hammering one.
   * Neither substitutes for the other, and the token is hashed because a raw
   * one is a live credential that would end up in the Redis keyspace.
   *
   * A refusal renders as itself rather than as a dead link. Telling someone
   * their invite is invalid when it is fine, and would work again in ten
   * minutes, sends them back to the inviter for a replacement they do not need.
   */
  let limited: RateLimitError | null = null
  try {
    await enforce("inviteAttempt", await clientIp())
    await enforce("inviteToken", inviteTokenKey(token))
  } catch (e) {
    if (!(e instanceof RateLimitError)) throw e
    limited = e
  }

  if (limited) {
    return (
      <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
        <div className="flex w-full max-w-sm flex-col gap-3 rounded border px-4 py-5">
          <h1 className="text-lg font-semibold">Too many invite links</h1>
          <p className="text-sm opacity-70">
            You&apos;ve opened a lot of invites in a short time. Wait{" "}
            {Math.ceil(limited.retryAfterSeconds / 60)} minute
            {Math.ceil(limited.retryAfterSeconds / 60) === 1 ? "" : "s"} and try
            this link again. It hasn&apos;t expired.
          </p>
          <Link href={user ? "/dashboard" : "/"} className="text-sm underline opacity-70">
            {user ? "Back to your dashboard" : "Back to Solarity"}
          </Link>
        </div>
      </main>
    )
  }

  // Runs for signed-out visitors too, which is what migration 63's grant to
  // `anon` is for. Asking someone to make an account before telling them what
  // they are joining is the wrong order.
  const preview = await getCirclePreview(supabase, token)

  // A null preview means the RPC itself failed. Indistinguishable from a dead
  // link as far as the visitor is concerned, and a 500 would be a worse answer.
  if (!preview || DEAD.has(preview.status)) {
    // A signed-out visitor has no dashboard. Sending them there would bounce
    // them to sign-in and lose the explanation on the way.
    redirect(user ? "/dashboard?notice=invite-invalid" : "/?notice=invite-invalid")
  }

  const name = preview.circle_name ?? "This Circle"
  const count = preview.member_count ?? 0
  const explanation = EXPLAIN[preview.status]

  // Signed in but no username: joining now would write a null into the
  // `invite_accepted` notification every existing member receives. Onboarding
  // first, and the link still works afterwards.
  let profileIncomplete = false
  if (user) {
    const { data: profile } = await supabase
      .from("users")
      .select("username")
      .eq("id", user.id)
      .maybeSingle()
    profileIncomplete = !profile?.username
  }

  /**
   * 8h-4: what this Circle will actually see of your list.
   *
   * **Honest by construction.** Per-Circle visibility rows cannot exist yet:
   * `ggv_insert_own_goal` requires `is_group_member(group_id)`, and you are not
   * one. So the only thing that can hide a goal from a Circle you have not
   * joined is `hidden_everywhere`, and counting over `goals` alone cannot be
   * out of date.
   *
   * Signed out this stays null. There are no goals to count, and rendering a
   * line about "your goals" to someone without an account implies one exists.
   */
  /**
   * Step 18c. Who is already inside, with pictures when the viewer can have
   * them.
   *
   * **Read after the dead-link redirect above**, so a revoked token costs one
   * RPC rather than two. The function refuses on its own as well; this is about
   * not paying for an answer nobody will see.
   *
   * Signing is skipped entirely for a signed-out visitor. `signAvatars` would
   * return an empty map anyway, and a round trip to Storage to be told no is
   * one the join page should not make.
   */
  const previewMembers = await getCirclePreviewMembers(supabase, token)
  const memberAvatars = user
    ? await signAvatars(
        supabase,
        previewMembers.map((m) => m.avatar_url),
      )
    : new Map<string, string>()

  const members = previewMembers.map((m) => ({
    username: m.username,
    role: m.role,
    avatarUrl: m.avatar_url ? (memberAvatars.get(m.avatar_url) ?? null) : null,
  }))

  // `circle_preview_members` orders owner first, so this is a find rather than
  // a sort. Null when the roster could not be read, which is a missing phrase
  // rather than a missing page.
  const owner = members.find((m) => m.role === "owner")?.username ?? null

  let goalCounts: { total: number; visible: number } | null = null
  if (user && !profileIncomplete) {
    const { data: myGoals } = await supabase
      .from("goals")
      .select("hidden_everywhere")
      .eq("user_id", user.id)
      .is("archived_at", null)
      .is("achieved_at", null)

    const total = myGoals?.length ?? 0
    goalCounts = {
      total,
      visible: (myGoals ?? []).filter((g) => !g.hidden_everywhere).length,
    }
  }

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded border px-4 py-5">
        <div className="flex flex-col gap-1">
          {/*
            **The owner, not the inviter, and the difference is not a detail.**
            A token is shared: the same link reaches somebody through a direct
            invite, a pasted message and a forward, and nothing in it records
            who sent it *to you*. `invite_links.created_by` is who made the
            link, which is a different person as soon as one member generates
            a link and another passes it on.

            So the honest name here is whose Circle it is, which the roster
            already knows and cannot be wrong about. Who invited *you*
            specifically is in the notification that brought you here, where it
            is a fact rather than a guess.
          */}
          <p className="text-sm opacity-70">
            You&apos;ve been invited to{owner ? ` ${owner}'s Circle` : ""}
          </p>
          <h1 className="text-xl font-semibold">{name}</h1>
          <p className="text-sm opacity-70">
            {count} of 10 {count === 1 ? "member" : "members"}
          </p>
        </div>

        {/*
          Step 18c. **The question an invitee actually has**, which the count
          never answered: do I know these people. A number tells you the size
          of a room and nothing about who is in it.

          Rendered above the join button rather than below it, because it is
          something to read before deciding rather than after.
        */}
        {members.length > 0 ? (
          <section aria-label="Already here" className="flex flex-col gap-2">
            <h2 className="text-sm font-medium opacity-70">Already here</h2>
            <ul className="flex flex-col gap-1">
              {members.map((m) => (
                <li key={m.username} className="flex items-center gap-2 text-sm">
                  {/*
                    **Initials for a signed-out visitor, and that is not a
                    fallback firing by accident.** `avatars_select` is
                    `bucket_id = 'avatars'` for *authenticated* readers, so
                    nobody signed out can be handed a signed URL, and reaching
                    for the service key to make one would put the app in the
                    business of deciding what Storage already decides.
                  */}
                  <Avatar url={m.avatarUrl} name={m.username} size={24} />
                  <span className="truncate">{m.username}</span>
                  {m.role !== "member" ? (
                    <span className="text-xs opacity-50">· {m.role}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {explanation ? (
          <>
            <p className="rounded border px-3 py-2 text-sm">{explanation}</p>
            <Link href={user ? "/dashboard" : "/"} className="text-sm underline opacity-70">
              {user ? "Back to your dashboard" : "Back to Solarity"}
            </Link>
          </>
        ) : profileIncomplete ? (
          <>
            <p className="text-sm opacity-70">
              Finish setting up your account first, then open this link again.
            </p>
            <Link
              href="/onboarding"
              className="rounded border px-4 py-2 text-center text-sm font-medium"
            >
              Finish setting up
            </Link>
          </>
        ) : user ? (
          <>
            <JoinButton token={token} circleName={name} />
            <p className="text-xs opacity-60">
              Everyone here can see whether you checked off your goals each day.
              That is the point of a Circle.
            </p>
            {/*
              Both numbers whenever they differ. "3 goals visible here" alone
              would conceal that there were ever five, which is the one fact
              this line exists to surface.

              No link to change it, deliberately. The per-Circle switches cannot
              exist before you are a member, so the only thing reachable from
              here is the hide-everywhere switch you can reach any time, and
              sending someone out of a two-click flow to find it costs more than
              it gives.
            */}
            {goalCounts ? (
              <p className="text-xs opacity-60">
                {goalCounts.total === 0
                  ? "You have no goals yet. Nothing to show until you add one."
                  : goalCounts.visible === goalCounts.total
                    ? `Your ${goalCounts.total} ${goalCounts.total === 1 ? "goal" : "goals"} will be visible here.`
                    : `${goalCounts.visible} of your ${goalCounts.total} goals will be visible here. The rest are hidden everywhere.`}
              </p>
            ) : null}
          </>
        ) : (
          <>
            {/*
              `next` survives the OAuth round trip and `safeRedirect` permits
              `/join/...`, so this lands back here with the button live rather
              than dumping them on the dashboard.
            */}
            <Link
              href={`/auth/sign-in?next=/join/${encodeURIComponent(token)}`}
              className="rounded border px-4 py-2 text-center text-sm font-medium"
            >
              Sign in to join
            </Link>
            <p className="text-xs opacity-60">
              Solarity is invite-only. You&apos;ll come straight back here.
            </p>
          </>
        )}
      </div>
    </main>
  )
}
