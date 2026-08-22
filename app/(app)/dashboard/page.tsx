import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { alreadySeen, hasUnfinishedDay } from "@/lib/today-gate"
import { getTodayData } from "@/lib/supabase/today"
import { GoalsPanel } from "./goals-panel"
import { TodayPanel } from "./today-panel"
import { CirclesPanel, type CircleRow } from "./circles-panel"
import { DigestPanel } from "./digest-panel"
import { getDigestDays, type DigestDay } from "@/lib/supabase/digests"
import { NotificationsPanel, type NotificationRow } from "./notifications-panel"
import { Notice } from "@/components/notice"
import { TAB_NOTIFICATION_TYPES } from "@/lib/notification-types"
import { PushNudge } from "@/components/push-nudge"
import { pushNudgeDismissed } from "@/lib/push-nudge"

export const metadata = { title: "Solarity" }

/**
 * Three tabs and a settings link, addressable by URL.
 *
 * `Overview` is where you stand: today's check-in, your goals, and how
 * yesterday ended in each Circle. `Circles` is the list and the create form.
 * `Notifications` is the reader those rows never had.
 *
 * Same shape as `/circles/[id]`: `?tab=` read on the server, no client state,
 * deep-linkable, and an unknown value falls back to the default rather than
 * rendering nothing. `sw.js` can point at `?tab=notifications` when it needs to.
 *
 * The settings icon is a `Link` and not a tab. It goes to another route, and
 * dressing navigation as a tab makes the back button behave unlike its
 * neighbours.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tab?: string }>
}) {
  const { notice, tab } = await searchParams
  const view = tab === "circles" || tab === "notifications" ? tab : "overview"
  const supabase = await createClient()

  // The layout above has already established there is a session, so this is a
  // cached call rather than a second round trip. Guarded rather than asserted
  // anyway: a `user!` here would become a runtime TypeError if the session
  // expired between the layout and this render, and TypeScript cannot see the
  // layout's guarantee.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const [{ data: circles }, { data: goals }, { data: categories }, { data: profile }] =
    await Promise.all([
      // `.eq("user_id", …)` is load-bearing, and leaving it out was a bug.
      //
      // The SELECT policy is `private.is_group_member(group_id)`: you can read
      // every member row of every Circle you belong to, which is exactly what
      // the roster on `/circles/[id]` needs. So RLS scopes this to the caller's
      // **Circles**, not to the caller's **memberships**, and without the
      // filter a Circle of three came back as three rows and rendered three
      // times, each showing a different person's role.
      //
      // The general form: RLS is not a substitute for a WHERE clause. It bounds
      // what you *may* read, never what you *meant* to read.
      supabase
        .from("group_members")
        // `streak_decision_pending` is one more column on a query this page
        // already runs, and it is half of what orders the digest boxes.
        .select("group_id, role, groups(name, group_status, streak_decision_pending)")
        .eq("user_id", user.id)
        .order("joined_at", { ascending: true }),

      // Goals are user-owned, and since migration 64 RLS agrees: `goals_select_own`
      // is `user_id = auth.uid()`. The filter is kept anyway because the policy
      // is a ceiling, not a statement of intent, and a reader should not have to
      // check the policy to know this panel shows your goals.
      supabase
        .from("goals")
        .select(
          "id, title, archived_at, achieved_at, hidden_everywhere, goal_categories(name, color_hex)",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),

      supabase.from("goal_categories").select("slug, name, color_hex").order("name"),

      // Only for the `/today` gate below. One column, and the row is already
      // cached by the layout's own read of this table.
      supabase
        .from("users")
        .select("today_screen_mode")
        .eq("id", user.id)
        .maybeSingle(),
    ])

  // One implementation of the 2 AM boundary rule, in the database, shared by
  // this read path and the INSERT policy that guards writes.
  const today = await getCheckinDate(supabase)

  /**
   * The panel's numbers come from the shared read, not from four queries
   * written out again here.
   *
   * `/today` renders the same component, and two copies of "what is checked off
   * and what does that make the streak" would drift. The rule is one
   * implementation per rule; see `patterns.md`.
   */
  const todayData = await getTodayData(supabase, user.id, today)
  const completedToday = todayData.completedToday
  const displayStreak = todayData.streak

  /**
   * Step 9b: divert to `/today` when the day is unfinished.
   *
   * **Here and not in `(app)/layout.tsx`.** `/today` lives inside `(app)`, so a
   * condition in that layout would fire on `/today` itself and redirect it to
   * `/today` forever. `/onboarding` gets away with being a layout gate's target
   * only because it sits outside the route group. `e2e/gates.spec.ts` holds
   * both halves of that.
   *
   * `alreadySeen` only reads cookies, because a render cannot set one. `/today`
   * marks itself seen once it has painted.
   */
  const mode = profile?.today_screen_mode ?? "once_daily"
  if (
    !(await alreadySeen(mode, today)) &&
    (await hasUnfinishedDay(supabase, user.id, today))
  ) {
    redirect("/today")
  }

  const activeGoals = (goals ?? []).filter((g) => !g.archived_at && !g.achieved_at)

  /**
   * Which of your goals are hidden in which Circles.
   *
   * **Filtered to your own goal ids on purpose.** `ggv_select_owner_or_member`
   * is `owns_goal(goal_id) OR is_group_member(group_id)`, so an unfiltered read
   * also returns rows for *other* members' goals in Circles you belong to.
   * Correct as a policy, wrong as a query: this panel is about your goals, and
   * RLS bounds what you may read rather than what you meant to read.
   *
   * Second query rather than an embed, because the row only exists when hidden
   * and an inner join would drop every visible goal.
   */
  const ownGoalIds = activeGoals.map((g) => g.id)
  const { data: visibility } = ownGoalIds.length
    ? await supabase
        .from("goal_group_visibility")
        .select("goal_id, group_id")
        .in("goal_id", ownGoalIds)
        .eq("hidden", true)
    : { data: [] }

  const hiddenIn = new Map<string, string[]>()
  for (const row of visibility ?? []) {
    hiddenIn.set(row.goal_id, [...(hiddenIn.get(row.goal_id) ?? []), row.group_id])
  }
  // `locked` and `archived` move beneath rather than disappearing: locked is
  // awaiting a renewal decision, archived is retired, and both are still
  // history the owner may want. product-and-design.md section 3.
  const active = circles?.filter((m) => m.groups?.group_status === "active") ?? []
  const inactive = circles?.filter((m) => m.groups?.group_status !== "active") ?? []

  /**
   * The unread count, on every render regardless of tab.
   *
   * It renders on the `Notifications` label, so it cannot be fetched only when
   * that tab is open: a badge you can see only after looking is not a badge.
   * `head: true` asks PostgREST for the count and none of the rows.
   */
  const { count: unread } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null)
    // A badge must count what its tab can show. Digests moved to the day boxes
    // in 11c, so counting them would put a number on this tab that nothing on
    // this tab could clear.
    .in("type", TAB_NOTIFICATION_TYPES)

  /**
   * The latest digest per Circle, one small query each rather than one large
   * one.
   *
   * Retention keeps 90 days, so a single `.in(...)` over ten Circles could pull
   * 900 rows to use ten of them. PostgREST has no `DISTINCT ON`, and taking the
   * newest N overall would silently drop a Circle whose last finished day is
   * older than the others.
   *
   * Bounded by how many Circles one person is in, which is small in practice.
   * If that stops being true this wants a view or an RPC, not a bigger limit.
   */
  /**
   * Step 11. Five days of digests, grouped into boxes.
   *
   * **Two reads, both cheap, and neither per Circle.** The snapshots are one
   * query; the attention signals are one more. The panel this replaced ran a
   * query per Circle to render a single row each.
   */
  let digestDays: DigestDay[] = []
  if (view === "overview") {
    const membership = [...active, ...inactive].map((m) => ({
      groupId: m.group_id,
      circleName: m.groups?.name ?? "Circle",
      inactive: m.groups?.group_status !== "active",
    }))

    /**
     * Which Circles want something from you, right now.
     *
     * **A fact about the present, not about the day in the box**, so a Circle
     * awaiting a decision rises to the top of every box including last week's.
     * That is deliberate: the boxes are a place to scan, and the thing waiting
     * on you should not be halfway down the fourth one.
     */
    const needsAttention = new Set<string>()
    for (const m of [...active, ...inactive]) {
      if (m.groups?.streak_decision_pending) needsAttention.add(m.group_id)
    }

    // Unread notifications, by Circle. `payload->>group_id` rather than reading
    // whole payloads: this needs one string per row, and payloads carry more.
    //
    // **The same type filter, and it is load-bearing.** Digests are never
    // marked read, so without it every Circle with a digest would count as
    // "needing you" forever, and the ordering would say nothing at all.
    const { data: unreadRows } = await supabase
      .from("notifications")
      .select("payload->>group_id")
      .eq("user_id", user.id)
      .is("read_at", null)
      .in("type", TAB_NOTIFICATION_TYPES)

    for (const row of unreadRows ?? []) {
      const groupId = (row as { group_id: string | null }).group_id
      if (groupId) needsAttention.add(groupId)
    }

    digestDays = await getDigestDays(supabase, membership, needsAttention)
  }

  // Read for the notifications tab only, and cheap: one cookie, no query.
  const nudgeDismissed = view === "notifications" ? await pushNudgeDismissed() : true

  let notifications: NotificationRow[] = []
  if (view === "notifications") {
    const { data: rows } = await supabase
      .from("notifications")
      .select("id, type, created_at, read_at, payload")
      .eq("user_id", user.id)
      // Filtered by type rather than by read state: a digest must not appear
      // here whether or not anything ever marked it read.
      .in("type", TAB_NOTIFICATION_TYPES)
      .order("created_at", { ascending: false })
      .limit(100)

    // The live name, keyed by id. `payload.group_id` has no foreign key, so a
    // Circle can be gone; those fall back to the stored copy. See migration 73.
    const names = new Map<string, string>()
    for (const m of [...active, ...inactive]) {
      if (m.groups?.name) names.set(m.group_id, m.groups.name)
    }

    notifications = (rows ?? []).map((n): NotificationRow => {
      const payload = (n.payload ?? {}) as Record<string, unknown>
      const groupId = typeof payload.group_id === "string" ? payload.group_id : null
      const stored =
        typeof payload.circle_name === "string" ? payload.circle_name : null

      return {
        id: n.id,
        type: n.type,
        createdAt: new Date(n.created_at).toLocaleString(),
        readAt: n.read_at,
        circleName: groupId ? (names.get(groupId) ?? null) : null,
        storedCircleName: stored,
        groupId,
        payload,
      }
    })
  }

  const tabs = [
    ["overview", "Overview", "/dashboard"],
    ["circles", "Circles", "/dashboard?tab=circles"],
    [
      "notifications",
      unread ? `Notifications (${unread})` : "Notifications",
      "/dashboard?tab=notifications",
    ],
  ] as const

  return (
    <div className="flex flex-col gap-8">
      <Notice notice={notice} />

      <nav className="flex items-center justify-between gap-3 border-b text-sm">
        <div className="flex gap-3">
          {tabs.map(([key, label, href]) => (
            <Link
              key={key}
              href={href}
              className={`px-1 pb-2 ${
                view === key ? "border-b-2 font-medium" : "opacity-70"
              }`}
            >
              {label}
            </Link>
          ))}
        </div>
        <Link
          href="/settings"
          // "Account settings", not "Settings". The Circle page has its own
          // Settings link to a different route, and two links with the same
          // name and different destinations are ambiguous to a screen reader
          // as well as to a test locator.
          aria-label="Account settings"
          title="Account settings"
          className="pb-2 opacity-70"
        >
          {/* Text, not an icon font or an SVG dependency. The gear is the
              conventional glyph and it needs no asset pipeline. */}
          <span aria-hidden>⚙</span>
        </Link>
      </nav>

      {view === "overview" ? (
        <>
          {/*
            Without a date, "nothing is checked in" and "we could not tell" are
            indistinguishable, and the streak would quietly under-report. So the
            panel is replaced rather than rendered with confidently wrong
            numbers.

            Only the panel, though. Returning this in place of the whole page
            also hid the goals list and the Circles list, neither of which
            depends on today's date, while the copy claimed only today's
            progress was missing.
          */}
          {today ? (
            <TodayPanel
              goals={todayData.goals}
              completedToday={completedToday}
              streak={displayStreak}
              streakIncludesToday={completedToday}
            />
          ) : (
            <p role="alert" className="text-sm text-red-600">
              Couldn&apos;t work out today&apos;s date, so today&apos;s progress
              and your streak aren&apos;t showing. Everything else below is fine.
              Reload in a moment.
            </p>
          )}

          {/*
            Only active Circles get a visibility toggle. An archived Circle's
            roster is frozen at a past instant, so a change now would either do
            nothing or appear to rewrite history depending on which side of that
            instant it landed. Same reasoning as the note-sharing controls in 8d.
          */}
          <GoalsPanel
            goals={goals ?? []}
            categories={categories ?? []}
            circles={active.map((m) => ({
              id: m.group_id,
              name: m.groups?.name ?? "Circle",
            }))}
            hiddenIn={Object.fromEntries(hiddenIn)}
          />

          <DigestPanel days={digestDays} viewerId={user.id} today={today} />
        </>
      ) : null}

      {view === "circles" ? (
        <CirclesPanel active={active as CircleRow[]} inactive={inactive as CircleRow[]} />
      ) : null}

      {view === "notifications" ? (
        <>
          {/* 10f. Above the list, and only for people who never decided. The
              cookie is read here because a client component cannot; everything
              else it needs is client-side. */}
          <PushNudge dismissed={nudgeDismissed} />
          <NotificationsPanel rows={notifications} unread={unread ?? 0} />
        </>
      ) : null}
    </div>
  )
}
