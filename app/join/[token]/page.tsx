import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCirclePreview } from "@/lib/supabase/circle-preview"
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

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded border px-4 py-5">
        <div className="flex flex-col gap-1">
          <p className="text-sm opacity-70">You&apos;ve been invited to</p>
          <h1 className="text-xl font-semibold">{name}</h1>
          <p className="text-sm opacity-70">
            {count} of 10 {count === 1 ? "member" : "members"}
          </p>
        </div>

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
