import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { getTodayData } from "@/lib/supabase/today"
import { getDigestDays } from "@/lib/supabase/digests"
import { getPersonalGalaxy } from "@/lib/supabase/galaxy"
import { TodayPanel } from "./today-panel"
import { GalaxyPanel } from "./galaxy-panel"
import { PageBlocks, ViewholeProvider } from "@/components/viewhole"
import { DigestPanel } from "./digest-panel"
import { Notice } from "@/components/notice"
import { TAB_NOTIFICATION_TYPES } from "@/lib/notification-types"
import { readMemberships } from "./memberships"

export const metadata = { title: "Solarity" }

/**
 * Step 14a. **Overview, and only Overview.**
 *
 * The shell — the section bar, the unread badge, the `/today` gate — is in
 * `layout.tsx` and is not re-rendered when you move between sections. This file
 * is the body for `/dashboard` and nothing else knows about it.
 *
 * Where you stand: today's check-in, and how the last five days ended in each
 * Circle. **Two panels and a link out**, after the manual pass found Overview
 * naming every goal twice: once in Today with its controls, once again in a
 * summary below with nothing to do to them.
 *
 * **`?tab=` still works**, as a redirect. Bookmarks, existing specs and any link
 * written before this split keep landing in the right place, and an unrecognised
 * value falls through to here exactly as it did when this was one page.
 *
 * **`getCheckinDate` is read again here**, even though the layout read it for
 * the gate. There is no way to pass layout data to a page, and on a section
 * switch the layout does not run at all — so the alternative to one repeated
 * RPC on a full load is no date on the section that needs it most.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tab?: string }>
}) {
  const { notice, tab } = await searchParams

  // One line, and it keeps every URL written before 14a valid. `?tab=nonsense`
  // is not redirected: falling through to Overview is what it always did.
  if (tab === "circles") redirect("/dashboard/circles")
  if (tab === "notifications") redirect("/dashboard/notifications")

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")
  const userId = user.id

  /**
   * **Two queries, down from four.** The goals list and the category list were
   * both read here for the summary that Today already covers, and neither had
   * a reader left once it went. Overview is the screen every session opens
   * with, so a query it does not need is paid for on every visit.
   *
   * `/dashboard/goals` runs both, which is where the list and the add-goal
   * form now live.
   */
  const [{ active, inactive }, today] = await Promise.all([
    readMemberships(supabase, userId),
    getCheckinDate(supabase),
  ])

  /**
   * The panel's numbers come from the shared read, not from four queries
   * written out again here.
   *
   * `/today` renders the same component, and two copies of "what is checked off
   * and what does that make the streak" would drift. The rule is one
   * implementation per rule; see `patterns.md`.
   */
  const todayData = await getTodayData(supabase, userId, today)

  /**
   * Step 22. The galaxy, built on the server and handed down as a prop.
   *
   * **After `getTodayData`, not beside it.** `dayClosed` is that read's
   * `completedToday`, so the sun and the fraction printed above it are the same
   * fact rather than two reads of one row that could disagree.
   *
   * **A snapshot, not a client fetch.** `buildPersonalSnapshot` lives behind
   * `lib/galaxy/data`, which is proven to reach no renderer code, so a server
   * component can build the whole picture without PixiJS entering the graph.
   * `GalaxyPanel` is the `"use client"` boundary and the only thing that mounts
   * a canvas.
   */
  const galaxy = await getPersonalGalaxy(
    supabase,
    userId,
    today,
    todayData.completedToday,
  )

  /**
   * Step 11. Five days of digests, grouped into boxes.
   *
   * **Two reads, both cheap, and neither per Circle.** The snapshots are one
   * query; the attention signals are one more. The panel this replaced ran a
   * query per Circle to render a single row each.
   */
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
   * That is deliberate: the boxes are a place to scan, and the thing waiting on
   * you should not be halfway down the fourth one.
   */
  const needsAttention = new Set<string>()
  for (const m of [...active, ...inactive]) {
    if (m.groups?.streak_decision_pending) needsAttention.add(m.group_id)
  }

  // Unread notifications, by Circle. `payload->>group_id` rather than reading
  // whole payloads: this needs one string per row, and payloads carry more.
  //
  // **The same type filter, and it is load-bearing.** Digests are never marked
  // read, so without it every Circle with a digest would count as "needing you"
  // forever, and the ordering would say nothing at all.
  const { data: unreadRows } = await supabase
    .from("notifications")
    .select("payload->>group_id")
    .eq("user_id", userId)
    .is("read_at", null)
    .in("type", TAB_NOTIFICATION_TYPES)

  for (const row of unreadRows ?? []) {
    const groupId = (row as { group_id: string | null }).group_id
    if (groupId) needsAttention.add(groupId)
  }

  const digestDays = await getDigestDays(supabase, membership, needsAttention)

  return (
    /**
     * **The provider wraps the whole page and knows nothing about it.**
     *
     * `GalaxyPanel` opens the viewhole; `PageBlocks` is everything that gets
     * out of its way. Neither names the other, so moving a panel or adding one
     * is a change to this file alone — which is the point of the split, and the
     * reason the surroundings are one wrapper rather than a class on each
     * block.
     */
    <ViewholeProvider>
      {/* Here rather than in the layout, because layouts do not receive
          `searchParams` — and every `?notice=` redirect in the codebase targets
          a bare `/dashboard`, so there is nothing to spread. */}
      <Notice notice={notice} />

      {/*
        Without a date, "nothing is checked in" and "we could not tell" are
        indistinguishable, and the streak would quietly under-report. So the
        panel is replaced rather than rendered with confidently wrong numbers.

        Only the panel, though. Returning this in place of the whole page also
        hid the goals list, which does not depend on today's date, while the copy
        claimed only today's progress was missing.
      */}
      {/*
        **First, above Today.** It was under it for one release, on the argument
        that the thing you came to do should lead — and that is true of the
        *goals*, which are one scroll away regardless. Overview's job is to say
        where you stand, and the galaxy says it in the form worth looking at.

        It is also the block most likely to be absent, which is the cost of
        leading with it and is why `GalaxyPanel` removes itself rather than
        rendering an empty frame.
      */}
      {/* Null when a read failed. The panel is additive, so absence is the
          honest answer — see `getPersonalGalaxy`. */}
      {galaxy ? <GalaxyPanel snapshot={galaxy} /> : null}

      <PageBlocks>

      {today ? (
        <TodayPanel
          goals={todayData.goals}
          userId={userId}
          completedToday={todayData.completedToday}
          streak={todayData.streak}
          streakIncludesToday={todayData.completedToday}
        />
      ) : (
        <p role="alert" className="text-sm text-red-600">
          Couldn&apos;t work out today&apos;s date, so today&apos;s progress and
          your streak aren&apos;t showing. Everything else below is fine. Reload
          in a moment.
        </p>
      )}

      {/*
        **A link, not a list, and the second time this section has shrunk.**

        Step 16 replaced the goals *panel* with a read-only summary. The manual
        pass then found the obvious thing: Today already names every active
        goal, one per row, with the controls that matter. The summary underneath
        printed the same titles again with nothing to do to them, so Overview
        said everything twice and neither copy was the authoritative one.

        What is left is the way out. Right-aligned and quiet, because it is a
        destination rather than an action: the reason to open Overview is the
        two panels around it.
      */}
      <div className="flex justify-end">
        <Link href="/dashboard/goals" className="text-sm underline opacity-70">
          View goals
        </Link>
      </div>

      <DigestPanel days={digestDays} viewerId={userId} today={today} />
      </PageBlocks>
    </ViewholeProvider>
  )
}
