import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { CONTACT_EMAIL, MINIMUM_AGE, TERMS_VERSION, formatVersion } from "@/lib/legal"
import { safeRedirect } from "@/lib/safe-redirect"
import { AcceptForm } from "./accept-form"

export const metadata = { title: "Terms — Solarity" }

/**
 * Step 20c. The one screen an account created before migration 105 ever sees.
 *
 * ## Why it exists at all
 *
 * Google sign-in never showed anybody a checkbox, so every account that
 * predates step 20 has agreed to nothing. The two honest options were to
 * backfill them as accepted — writing a timestamp claiming consent nobody gave,
 * in the column whose whole purpose is proving it was given — or to ask. This
 * asks.
 *
 * ## Why it is outside `(app)`
 *
 * Same reason `/onboarding` and `/onboarding/install` are: the `(app)` layout
 * redirects people who have not accepted, and a screen inside that group would
 * redirect to itself. There is no way to opt a route out of its own group's
 * layout, so it lives here.
 *
 * ## Why it summarises rather than embedding the terms
 *
 * The full text is at `/terms`, linked below and opening in place. Reproducing
 * it here would create a second copy to keep in step with `TERMS_VERSION`, and
 * the copy people actually read is the short one either way. What matters is
 * that both are reachable before the button, not that both are on this page.
 */
export default async function TermsGatePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in?next=/onboarding/terms")

  const { data: profile } = await supabase
    .from("users")
    .select("username, terms_accepted_at")
    .eq("id", user.id)
    .maybeSingle()

  // No username means this is not their next step. Onboarding records
  // acceptance itself, so sending them there skips this screen entirely rather
  // than queuing a second one behind it.
  if (!profile?.username) redirect("/onboarding")

  // Already agreed, so this URL is a dead end rather than a question. Reaching
  // it by hand or by back button lands on the app instead of asking twice.
  if (profile.terms_accepted_at) redirect("/dashboard")

  // The same treatment every `next=` in the app gets: a caller-supplied path is
  // an open-redirect surface, and this one is reachable while signed in.
  // `safeRedirect` already falls back to `/dashboard`, so there is nothing to
  // coalesce here — it never returns null.
  const destination = safeRedirect(next)

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded border px-4 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Before you carry on</h1>
          <p className="text-sm opacity-70">
            Solarity has terms and a privacy policy, and you signed in before
            there was anything to agree to. Here they are.
          </p>
        </div>

        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          <li>You need to be {MINIMUM_AGE} or older.</li>
          <li>
            Your goals, notes and photos stay yours. They are shown to the
            Circles you choose and nowhere else.
          </li>
          <li>
            Don&apos;t post anything illegal, anything that harasses somebody, or
            a photo of a person who hasn&apos;t agreed to be in it.
          </li>
          <li>
            It&apos;s run by one person and it&apos;s free, so there are no
            guarantees about it staying up or nothing being lost.
          </li>
        </ul>

        <p className="text-sm">
          The full{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline">
            Privacy policy
          </Link>{" "}
          say the rest. Both are short.
        </p>

        <AcceptForm next={destination} />

        <p className="text-xs opacity-60">
          Agreeing records the date and the version ({formatVersion(TERMS_VERSION)})
          against your account, and nothing else. If you&apos;d rather not, write
          to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>{" "}
          and your account will be deleted.
        </p>
      </div>
    </main>
  )
}
