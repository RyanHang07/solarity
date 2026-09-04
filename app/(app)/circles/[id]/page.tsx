import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { RefreshOnReturn } from "./refresh-on-return"
import { StreakDecision } from "./streak-decision"
import { TodayRoster } from "./today-roster"
import { CircleGalaxyPanel } from "./circle-galaxy-panel"
import { PageBlocks, ViewholeProvider } from "@/components/viewhole"
import { getCircleRoster } from "@/lib/supabase/circle-roster"

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

  // `Today` is the default, because it is what the Circle is for. `Members`
  // therefore needs its own param rather than being the no-param fallback it
  // used to be. `sw.js` deep-links to `?tab=overview` and is unaffected.
  const view = tab === "members" || tab === "overview" ? tab : "today"

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

  // Only when it is going to be rendered. The other two tabs do not need it,
  // and it is the most expensive read on the page.
  const roster = view === "today" ? await getCircleRoster(supabase, id) : null

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
  // Username first: this names people to their Circle, and `display_name` is
  // not unique. See `today-roster.tsx`.
  const graceNames = inGrace.map(
    (m) => m.users?.username || m.users?.display_name || "Someone",
  )
  const decisionPending = !!circle.streak_decision_pending && graceNames.length > 0

  const deadline = formatDeadline(cycle?.deadline ?? null)

  return (
    <ViewholeProvider>
      <div className="flex flex-col gap-6">
      {/*
        8g phase 1, and only on a Circle that is still running. An inactive
        Circle's roster is frozen at a past instant, so a refresh cannot change
        anything, and a page that quietly refetches implies live data where
        there is none.
      */}
      {circle.group_status === "active" ? <RefreshOnReturn /> : null}

      {/*
        **First on the page, the same as Overview.**

        It sat between the tabs and the roster for one revision, which put a
        picture of today's progress below three blocks of chrome about the
        Circle. The galaxy is what this screen is for looking at; the name, the
        deadline and the tabs are how you steer once you have looked.

        **Only on the Today tab**, because it is drawn from the roster and the
        roster is only read there. Members and Overview answer different
        questions and have no sky.

        Moving it up also collapsed the two `PageBlocks` regions back into one:
        with the frame at the top, everything else is contiguous again.
      */}
      {view === "today" && roster ? (
        <CircleGalaxyPanel members={roster} frozen={!!roster[0]?.as_of} />
      ) : null}

      <PageBlocks className="flex flex-col gap-6">
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
        locks at the 2 AM rollover on the 16th. architecture/time-and-streaks.md section 8.
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
        {(
          [
            ["today", "Today", `/circles/${id}`],
            ["members", "Members", `/circles/${id}?tab=members`],
            ["overview", "Overview", `/circles/${id}?tab=overview`],
          ] as const
        ).map(([key, label, href]) => (
          <Link
            key={key}
            href={href}
            className={`px-1 pb-2 ${view === key ? "border-b-2 font-medium" : "opacity-70"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      {view === "overview" ? (
        <OverviewTab digests={digests ?? []} />
      ) : view === "today" ? (
        !roster ? (
          <p role="alert" className="text-sm text-red-600">
            Couldn&apos;t load today&apos;s progress. Reload in a moment.
          </p>
        ) : (
          <>
            {/*
              An archived or locked Circle reports the day it stopped, not
              today. `as_of` is null while it is live, which is what this
              branches on rather than the status string, so the two cannot
              disagree.
            */}
            {roster[0]?.as_of ? (
              <p className="rounded border px-3 py-2 text-sm">
                <strong>Final standing</strong>
                <span className="opacity-70">
                  {" "}
                  · this Circle {roster[0].circle_status === "archived" ? "was archived" : "locked"}{" "}
                  on {new Date(roster[0].as_of).toLocaleDateString()}, so these
                  numbers stopped changing then.
                </span>
              </p>
            ) : null}

            {/*
              **Above the roster, and the roster stays.** The sky is additive:
              it is a picture of what the list underneath already says, and the
              list is the source of truth that survives a device with no WebGL.

              `ViewholeProvider` is local to this branch rather than around the
              whole page, because the frame it drives only exists here — the
              Members and Overview tabs render no canvas, and a provider that
              spanned them would be state nothing could change.
            */}
            <>
              <TodayRoster
                members={roster}
                frozen={!!roster[0]?.as_of}
                groupId={id}
              />

              <p className="text-xs opacity-60">
                Each person&apos;s day is counted in their own timezone, so
                someone ahead of you may already have finished.
              </p>
            </>
          </>
        )
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {(members ?? []).map((m) => {
              const stat = statsBy.get(m.user_id)
              const days = stat?.current_streak ?? 0
              return (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between gap-3 rounded border px-3 py-2 text-sm"
                >
                  <span>
                    {/* coalesce(username, display_name): the unique handle
                        first, because this is where members tell each other
                        apart. `display_name` is not unique and two people can
                        hold the same one. */}
                    {m.users?.username || m.users?.display_name}
                    {m.user_id === user.id ? (
                      <span className="opacity-60"> (you)</span>
                    ) : null}
                    {m.role !== "member" ? (
                      <span className="opacity-60"> · {m.role}</span>
                    ) : null}
                  </span>

                  {m.streak_grace ? (
                    <span className="shrink-0 text-xs opacity-60">
                      settling in, not counted yet
                    </span>
                  ) : (
                    <span className="opacity-70">
                      {days} day{days === 1 ? "" : "s"}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>

          {/*
            Deliberately NOT the dashboard's `+ 1 if today complete` rule. That
            works there because we know your check-in date. Members sit in
            different timezones, so this tab has no single "today" to add, and
            guessing would show a number that disagrees with what that person
            sees on their own dashboard. Stored values only.

            The `Today` tab is where live progress lives, and it solves the same
            problem differently: each member's counts are computed against their
            own check-in date rather than against one shared guess.
          */}
          <p className="text-xs opacity-60">
            Streaks update at each member&apos;s own daily rollover, so today&apos;s
            progress appears here tomorrow. See the Today tab for live counts.
          </p>
        </>
      )}
      </PageBlocks>
      </div>
    </ViewholeProvider>
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
                not silently relabel a past digest. architecture/schema.md section 3. */}
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
