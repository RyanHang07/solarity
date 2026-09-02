import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Notice } from "@/components/notice"
import { LegalFooter } from "@/components/legal-footer"
import { ExampleDigest } from "./example-digest"

export const metadata = {
  title: "Solarity — goals you keep with friends",
  description:
    "Set daily goals, check them off, and let a few friends see how you're doing. Invite-only Circles of up to ten people.",
}

/**
 * Step 20i. The landing page.
 *
 * ## Deliberately plain, and that is a decision rather than a stub
 *
 * The design system lands later and this page is the most design-sensitive
 * surface in the product, so building it twice was the alternative. The
 * constraint taken instead: **nothing here may depend on styling to make
 * sense.** Semantic headings, real sections, readable at 375px with only the
 * utility classes the rest of the app already uses. That is what makes the
 * later pass a restyle rather than a rewrite.
 *
 * ## Written for somebody you invited
 *
 * Not a stranger being persuaded. Whoever reads this arrived holding a link or
 * a recommendation, so it answers the three things they cannot guess — what a
 * Circle is, what a day looks like, what the streak rule costs — and gets out
 * of the way. That matches the ten-person cap and the audience the legal review
 * assumed.
 *
 * ## Signed-in visitors never see it
 *
 * They are redirected, as before. It is also why `start_url` in the manifest
 * moved to `/dashboard` in this step: with a real page here, every cold launch
 * of the installed app would otherwise flash the hero before redirecting.
 *
 * ## It still carries `notice`
 *
 * A signed-out visitor following a dead invite link lands here, and sending
 * them to `/dashboard` instead would bounce them to sign-in and lose the
 * explanation.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  const { notice } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect("/dashboard")

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-10 p-6">
      <Notice notice={notice} href="/" />

      {/* ---------------------------------------------------------- hero -- */}
      <header className="flex flex-col gap-3 pt-8">
        <h1 className="text-3xl font-semibold tracking-tight">Solarity</h1>
        <p className="text-base">
          Set your own daily goals. Let a few friends see whether you kept them.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Link
            href="/auth/sign-up"
            className="rounded border px-4 py-2 text-sm font-medium"
          >
            Create an account
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded border px-4 py-2 text-sm font-medium"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* ------------------------------------------------------- premise -- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Why a few friends beats an app</h2>
        <p className="text-sm opacity-80">
          A habit tracker you use alone is a list you can quietly stop opening.
          A Circle is three or four people who will notice. That is the whole
          idea, and it is why Circles are invite-only and hold at most ten
          people — small enough that missing a day is visible to somebody who
          knows you.
        </p>
      </section>

      {/* ---------------------------------------------------- three steps -- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">How it works</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm opacity-80">
          <li>
            <strong className="font-medium">Start a Circle</strong> and invite up
            to nine people, by username or with a link.
          </li>
          <li>
            <strong className="font-medium">Everyone sets their own goals.</strong>{" "}
            Yours are yours; nobody assigns anybody anything.
          </li>
          <li>
            <strong className="font-medium">Check in once a day.</strong> Tick
            what you did, add a note or a photo if you want to.
          </li>
        </ol>
      </section>

      {/* -------------------------------------------------- what you read -- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">What you actually see</h2>
        <p className="text-sm opacity-80">
          Nothing pings you all day. Each morning you get one summary of how
          yesterday went for everyone in the Circle:
        </p>
        <ExampleDigest />
        <p className="text-sm opacity-80">
          You can also hear when somebody finishes first, or when a Circle is
          waiting on you — each of those is a switch you control.
        </p>
      </section>

      {/* -------------------------------------------------------- streaks -- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">About streaks</h2>
        <p className="text-sm opacity-80">
          {/*
            Said here rather than discovered on day three. It is the rule most
            likely to feel unfair in the moment, and a product that hides it is
            one that loses the Circle the first time it bites.
          */}
          A Circle&apos;s streak only continues on a day when{" "}
          <strong className="font-medium">everyone</strong> finished everything.
          One person missing one goal ends it for the group. That is harsh on
          purpose — a streak that survives anything is not worth keeping.
        </p>
        <p className="text-sm opacity-80">
          Your own streak is separate, and only depends on you.
        </p>
      </section>

      {/* ------------------------------------------------------- install -- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">It works like an app</h2>
        <p className="text-sm opacity-80">
          Solarity runs in a browser and can be added to your home screen. On an
          iPhone that is the only way notifications work at all, so it&apos;s
          worth doing — we&apos;ll walk you through it after you sign up.
        </p>
      </section>

      <footer className="flex flex-col gap-3 border-t pt-6 pb-10">
        <div className="flex flex-wrap gap-3">
          <Link
            href="/auth/sign-up"
            className="rounded border px-4 py-2 text-sm font-medium"
          >
            Create an account
          </Link>
        </div>
        <LegalFooter />
      </footer>
    </main>
  )
}
