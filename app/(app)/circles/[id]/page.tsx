import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { StreakDecision } from "./streak-decision"

export const metadata = { title: "Circle — Solarity" }

/** Shape written by `build_daily_digests`. Denormalized at write time. */
type DigestSummary = {
  members: { user_id: string; username: string; completed: boolean; streak: number }[]
  completed_count: number
  member_count: number
  group_streak: number
}

function formatDeadline(deadline: string | null) {
  if (!deadline) return null
  return new Date(deadline).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  })
}

/**
 * The Circle page. `public/sw.js` deep-links here from every digest
 * notification, including `?tab=overview`, so both tabs are addressable by URL
 * rather than by client state.
 */
export default async function CirclePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab } = await searchParams
  const showOverview = tab === "overview"

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  // RLS returns nothing for a Circle you are not in, so "not a member" and
  // "does not exist" are indistinguishable here. That is deliberate: telling
  // them apart would confirm a Circle exists to anyone guessing ids.
  //
  // Sent home with a notice rather than shown a bare 404. The common way to
  // reach this is a digest notification for a Circle you have since left or
  // been removed from, and a dead end is a poor answer to a tap the app itself
  // invited. The URL is not preserved, which is the cost.
  const { data: circle } = await supabase
    .from("groups")
    .select(
      "id, name, group_status, streak_decision_pending, pending_streak_joiners",
    )
    .eq("id", id)
    .maybeSingle()

  if (!circle) redirect("/dashboard?notice=circle-unavailable")

  const { data: cycle } = await supabase
    .from("group_cycles")
    .select("id, deadline, current_streak, longest_streak, started_at")
    .eq("group_id", id)
    .is("ended_at", null)
    .maybeSingle()

  const [{ data: members }, { data: stats }, { data: digests }] =
    await Promise.all([
      supabase
        .from("group_members")
        .select(
          "user_id, role, joined_at, streak_grace, users(username, display_name)",
        )
        .eq("group_id", id)
        .order("joined_at", { ascending: true }),

      cycle
        ? supabase
            .from("group_cycle_stats")
            .select("user_id, current_streak, longest_streak_in_cycle")
            .eq("cycle_id", cycle.id)
        : Promise.resolve({ data: [] }),

      supabase
        .from("digest_snapshots")
        .select("date, summary")
        .eq("group_id", id)
        .order("date", { ascending: false })
        .limit(14),
    ])

  const statsBy = new Map(
    (stats ?? []).map((s) => [s.user_id, s]),
  )

  // Read off the roster rather than queried again. The settings page checks
  // this itself and redirects, so hiding the link is presentation, not access
  // control.
  const myRole = (members ?? []).find((m) => m.user_id === user.id)?.role
  const isAdmin = myRole === "owner" || myRole === "admin"

  /**
   * The pending-streak decision. `join_circle` sets it; only
   * `resolve_streak_decision` clears it, and only the owner may call that.
   *
   * The names come from the roster's `streak_grace` flag rather than from
   * `pending_streak_joiners`, which holds raw ids and would need a second
   * query to turn into names. The two are written in the same statement, so
   * they cannot disagree.
   */
  const inGrace = (members ?? []).filter((m) => m.streak_grace)
  const graceNames = inGrace.map(
    (m) => m.users?.display_name || m.users?.username || "Someone",
  )
  const decisionPending = !!circle.streak_decision_pending && graceNames.length > 0

  const deadline = formatDeadline(cycle?.deadline ?? null)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{circle.name}</h1>
          <p className="text-sm opacity-70">
            {circle.group_status !== "active" ? `${circle.group_status} · ` : ""}
            {members?.length ?? 0} of 10 members
          </p>
        </div>
        {isAdmin ? (
          <Link
            href={`/circles/${id}/settings`}
            className="shrink-0 text-sm underline opacity-70"
          >
            Settings
          </Link>
        ) : null}
      </header>

      {/*
        Shown prominently and stated as the last playable day, not a bare date.
        A deadline of the 15th means the 15th is fully playable and the Circle
        locks at the 2 AM rollover on the 16th. architecture.md section 8.
      */}
      <section className="rounded border px-3 py-2 text-sm">
        {deadline ? (
          <>
            <strong>Runs through {deadline}</strong>
            <span className="opacity-70">
              {" "}
              — that day is fully playable; the Circle locks the morning after.
            </span>
          </>
        ) : (
          <>
            <strong>No deadline</strong>
            <span className="opacity-70"> — this Circle runs until someone sets one.</span>
          </>
        )}
      </section>

      {/*
        Owner sees the decision; everyone else sees why the roster has someone
        marked "settling in". Nobody gets a notification for this yet: that
        needs a new `notification_type` value, a writer and a digest teaser in
        separate migrations. The banner is enough while the owner visits.
      */}
      {decisionPending && myRole === "owner" ? (
        <StreakDecision
          groupId={id}
          joiners={graceNames}
          streak={cycle?.current_streak ?? 0}
        />
      ) : null}

      <section className="flex gap-6 text-sm">
        <span>
          <strong className="text-base">{cycle?.current_streak ?? 0}</strong>{" "}
          <span className="opacity-70">group streak</span>
        </span>
        <span>
          <strong className="text-base">{cycle?.longest_streak ?? 0}</strong>{" "}
          <span className="opacity-70">longest</span>
        </span>
      </section>

      <nav className="flex gap-3 border-b text-sm">
        <Link
          href={`/circles/${id}`}
          className={`px-1 pb-2 ${!showOverview ? "border-b-2 font-medium" : "opacity-70"}`}
        >
          Members
        </Link>
        <Link
          href={`/circles/${id}?tab=overview`}
          className={`px-1 pb-2 ${showOverview ? "border-b-2 font-medium" : "opacity-70"}`}
        >
          Overview
        </Link>
      </nav>

      {showOverview ? (
        <OverviewTab digests={digests ?? []} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(members ?? []).map((m) => {
            const s = statsBy.get(m.user_id)
            return (
              <li
                key={m.user_id}
                className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
              >
                <span>
                  {/* coalesce(display_name, username): username is guaranteed
                      after onboarding, so there is always something to show. */}
                  {m.users?.display_name || m.users?.username}
                  {m.user_id === user.id ? <span className="opacity-60"> (you)</span> : null}
                  {m.role !== "member" ? (
                    <span className="opacity-60"> · {m.role}</span>
                  ) : null}
                </span>
                {/* The visible half of `streak_grace`. Without this the Circle
                    silently stops counting someone and the roster looks
                    identical to one where it doesn't, which is the bug 7e
                    exists to close. */}
                {m.streak_grace ? (
                  <span className="shrink-0 text-xs opacity-60">
                    settling in, not counted yet
                  </span>
                ) : (
                  <span className="opacity-70">
                    {s?.current_streak ?? 0} day
                    {(s?.current_streak ?? 0) === 1 ? "" : "s"}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/*
        Deliberately NOT the dashboard's `+ 1 if today complete` rule. That
        works there because we know your check-in date. Members can sit in
        different timezones, so this page has no single "today" to add, and
        guessing would show a number that disagrees with what that person sees
        on their own dashboard. Stored values only.
      */}
      <p className="text-xs opacity-60">
        Per-member streaks update at each member&apos;s own daily rollover, so
        today&apos;s progress appears tomorrow.
      </p>
    </div>
  )
}

function OverviewTab({
  digests,
}: {
  digests: { date: string; summary: unknown }[]
}) {
  if (!digests.length) {
    return (
      <p className="text-sm opacity-70">
        No digests yet. The first one is written after this Circle&apos;s first
        full day ends.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {digests.map((d) => {
        const s = d.summary as DigestSummary
        return (
          <li key={d.date} className="rounded border px-3 py-2 text-sm">
            <div className="flex justify-between">
              <strong>{new Date(d.date).toLocaleDateString()}</strong>
              <span className="opacity-70">
                {s.completed_count} of {s.member_count} complete
              </span>
            </div>
            {/* Usernames come from the snapshot, not a live join: a rename must
                not silently relabel a past digest. architecture.md section 3. */}
            <p className="mt-1 opacity-70">
              {s.members
                .map((m) => `${m.completed ? "✓" : "·"} ${m.username}`)
                .join("   ")}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
