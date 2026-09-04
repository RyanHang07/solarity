import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { getCheckinDate } from "@/lib/supabase/checkin-date"
import { alreadySeen, hasUnfinishedDay } from "@/lib/today-gate"
import { TAB_NOTIFICATION_TYPES } from "@/lib/notification-types"
import { TabBar } from "./tab-bar"

/**
 * Steps 14a and 15b. **The app shell: everything that must not move.**
 *
 * Before this existed, each section was `?tab=` on a single page, so switching
 * re-rendered the whole thing — the bar included — and re-ran every read whether
 * or not the destination drew any of it. Route segments give **partial
 * rendering**: a navigation between siblings re-renders only the child, and this
 * layout is reused from the router cache. The bar is the same DOM across every
 * switch, and these reads happen once per visit rather than once per tap.
 *
 * **`(shell)` is a route group, so it contributes nothing to any URL.** That is
 * the whole reason it exists: `/dashboard`, `/dashboard/circles`,
 * `/dashboard/notifications` and `/profile` are four siblings under one layout
 * without `/profile` having to live at `/dashboard/profile` to get there. When
 * the mobile shape arrives, this layout is what grows a bottom bar, and
 * `/today`, `/settings` and `/circles/[id]` stay deliberately outside it —
 * `/today` in particular is a full-screen gate that a nav bar would undermine.
 *
 * **Three things live here, and the test for admission is "does it belong to
 * the shell rather than to a section".**
 *
 * 1. The `/today` gate, so it fires whichever section you land on.
 * 2. The unread count, because it renders on a section *label* — a badge you
 *    can only see after opening the thing it counts is not a badge.
 * 3. The bar itself.
 *
 * **Memberships are deliberately *not* here**, even though all three sections
 * read them. There is no way to hand layout data to a child page, and hoisting
 * them would mean fetching for sections that then fetch again anyway. One query
 * per section is the honest cost of partial rendering.
 *
 * **The gate no longer re-runs on a section switch**, which follows from the
 * layout being cached. That is the right behaviour: the gate is about where an
 * arrival lands, and by the second tap you have already arrived.
 */
export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()

  // `(app)/layout.tsx` above has already established a session, so this is
  // served from the per-request cache. Guarded rather than asserted anyway:
  // TypeScript cannot see that guarantee, and a `user!` would be a runtime
  // TypeError if the session expired between the two renders.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const [{ data: profile }, { count: unread }, today] = await Promise.all([
    // One column, for the gate below. The row is already cached by the parent
    // layout's own read of this table.
    supabase
      .from("users")
      .select("today_screen_mode")
      .eq("id", user.id)
      .maybeSingle(),

    // `head: true` asks PostgREST for the count and none of the rows.
    //
    // **A badge must count what its section can show.** Digests moved to the
    // day boxes in 11c, so counting them would put a number on Notifications
    // that nothing on Notifications could clear.
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null)
      .in("type", TAB_NOTIFICATION_TYPES),

    // One implementation of the 2 AM boundary rule, in the database, shared by
    // this read path and the INSERT policy that guards writes.
    getCheckinDate(supabase),
  ])

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
  /**
   * Step 25. **No goal, no shell** — for an account that has never had one.
   *
   * A gate rather than a step in a flow, for the same reason as the username
   * and terms gates one layout up: `/onboarding/goal` can be abandoned by
   * closing the tab, and only something evaluated on every protected
   * navigation catches that.
   *
   * ## Here, and not in `(app)/layout.tsx`, and that was a real bug
   *
   * It was in the outer layout for one revision, which put it in front of
   * **`/settings` and `/admin` as well**. Two consequences, and the second is
   * the serious one:
   *
   *   * the admin account has never created a goal — moderation has nothing to
   *     do with goals — so the console became unreachable
   *   * somebody who signs up, abandons at the goal step and later wants to
   *     **delete their account** could not reach settings to do it. A gate that
   *     stands between a person and leaving is not a nudge
   *
   * The gate belongs to the product loop, so it guards the loop's screens. The
   * shell is `/dashboard`, its sections and `/profile` — where every session
   * starts, so nobody who has skipped this gets far. `/settings`, `/admin`,
   * `/today` and `/circles/[id]` stay reachable.
   *
   * ## "Never had a goal", not "has none now"
   *
   * Goals have no DELETE grant, so archiving and achieving both leave the row
   * and the table answers this on its own. The other reading would drag
   * somebody who archived their last goal back into onboarding, which is a gate
   * applied to a person who has already passed it.
   *
   * **The layout is cached across section switches**, so this costs one `head`
   * count per visit rather than per tap — the same property the `/today` gate
   * below relies on.
   */
  const { count: everHadAGoal, error: goalCountError } = await supabase
    .from("goals")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)

  /**
   * **The error is read, and that is the whole point of reading it.**
   *
   * A failed count comes back as `count: null`, so `!everHadAGoal` alone treats
   * "I could not tell" as "definitely none" — and this is a *gate*, so the cost
   * of that conflation is sending an established account into onboarding
   * because one read hiccuped. `patterns.md`, "a default that answers a
   * question the read never answered": for anything a person will act on,
   * absence and failure are not the same thing, and the fix is a third state
   * rather than a better default.
   *
   * The third state here is "carry on". A person who has passed this gate sees
   * their dashboard; a person who has not gets asked again on the next
   * navigation, which costs one screen and strands nobody.
   */
  if (!goalCountError && everHadAGoal === 0) redirect("/onboarding/goal")

  const mode = profile?.today_screen_mode ?? "once_daily"
  if (
    !(await alreadySeen(mode, today)) &&
    (await hasUnfinishedDay(supabase, user.id, today))
  ) {
    redirect("/today")
  }

  return (
    <div className="flex flex-col gap-8">
      {/*
        **The count goes stale on its own, and `MarkRead` repairs it.** This
        layout is not re-rendered when you navigate to Notifications, so
        `unread` here is whatever it was when you entered the dashboard. Opening
        the list marks everything read and then calls `router.refresh()`, which
        re-renders this layout on the server without unmounting the bar.
      */}
      <TabBar badges={{ notifications: unread ?? 0 }} />
      {children}
    </div>
  )
}
