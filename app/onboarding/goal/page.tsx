import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { FirstGoalForm } from "./first-goal-form"

export const metadata = { title: "Your first goal — Solarity" }

/**
 * Step 25. **The one thing onboarding was missing.**
 *
 * A person used to finish setting up with a username and an empty app. The
 * dashboard's whole subject is goals, a Circle is about whether people finished
 * theirs, and the galaxy draws a sun with nothing orbiting it. The first screen
 * after signing up was the emptiest the product will ever be, and it is the one
 * where somebody decides whether to come back.
 *
 * **One goal, not three.** The point is to leave onboarding with something to
 * check off tonight; asking for three is asking somebody to plan before they
 * have seen the thing they are planning for.
 *
 * ## Where it sits, and why here rather than at the end
 *
 * `/onboarding` → **here** → `/onboarding/install` → `/onboarding/notifications`.
 *
 * Immediately after the username, ahead of the two nudges, because this is the
 * only required step of the four. Putting a requirement behind two things a
 * person may decline is putting it where they have already started saying no.
 *
 * ## The gate is "never had a goal", not "has none now"
 *
 * **Deliberately, and it needs no new column.** Goals have no DELETE grant —
 * archiving and achieving both leave the row — so "this account has never
 * created a goal" is a question the `goals` table already answers, and it is
 * true of exactly one population: accounts that have not been through here.
 *
 * The alternative, "has no *active* goal", would drag an existing person who
 * archived their last goal back into onboarding, which is a gate applied to
 * somebody who has already passed it.
 */
export default async function FirstGoalPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in?next=/onboarding")

  const [{ data: profile }, { count: everHadAGoal }, { data: categories }] =
    await Promise.all([
      supabase
        .from("users")
        .select("username")
        .eq("id", user.id)
        .maybeSingle(),

      // Every goal ever, archived and achieved included. See the header.
      supabase
        .from("goals")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),

      supabase.from("goal_categories").select("slug, name").order("name"),
    ])

  // Ordered the same way `(app)/layout.tsx` orders its gates: a goal screen in
  // front of an account with no profile would be asking the wrong question
  // first.
  if (!profile?.username) redirect("/onboarding")
  if (everHadAGoal) redirect("/onboarding/install")

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-xs flex-col gap-2">
        <h1 className="text-xl font-semibold">What are you working on?</h1>
        <p className="text-sm opacity-70">
          One thing you want to do most days. You can add more, rename it, or
          retire it whenever you like.
        </p>
      </div>
      {/*
        The id, because the sun's colour is derived from it — `memberSun.ts`
        hashes the account onto six presets, so the sun drawn here is the one
        every Circle will show. Nothing is read from it on the client; it is a
        seed, not a credential, and it is already in the session.
      */}
      <FirstGoalForm categories={categories ?? []} userId={user.id} />
    </main>
  )
}
