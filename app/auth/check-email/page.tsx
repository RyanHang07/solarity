import Link from "next/link"
import { redirect } from "next/navigation"
import { LegalFooter } from "@/components/legal-footer"
import { createClient } from "@/lib/supabase/server"
import { signInWithGoogle, signOut } from "@/app/actions/auth"
import { CONTACT_EMAIL } from "@/lib/legal"
import { ResendForm } from "./resend-form"

export const metadata = {
  title: "Confirm your email — Solarity",
  // Nothing here is useful to a crawler, and the page only exists mid-flow.
  robots: { index: false, follow: false },
}

/**
 * Step 20d, corrected in 20e. Where somebody waits for a confirmation link.
 *
 * ## The assumption this page was built on was wrong
 *
 * It was written believing `signUp` returns a session, so the address could be
 * read from `getUser()`. **With "Confirm email" on — which is our
 * configuration — `signUp` returns a user and `session: null`.** Whoever reads
 * this page is signed *out*, `getUser()` gives nothing, and the resend control
 * hidden behind `user?.email` never rendered at all. Found by using it.
 *
 * So the address arrives in the query string, put there by the action that just
 * used it. The session is still read, because the page has a second caller.
 *
 * ## Two ways in, and they are not the same
 *
 * 1. **Straight from signup**, signed out, with `?email=`. The ordinary case.
 * 2. **From the gate**, signed in, with an unconfirmed address. Rare with our
 *    settings — `signUp` issues no session — but the check in
 *    `app/(app)/layout.tsx` exists for configuration that changes and for
 *    providers that hand back an unverified address. That visitor needs a way
 *    out, hence the sign-out control, which is meaningless in case 1.
 *
 * ## The Google line is the whole rescue for one person
 *
 * With enumeration protection on, somebody who already has a Google account on
 * this address gets a confirmation screen and **no email, ever**. The form is
 * not allowed to explain that, because explaining it is precisely the leak the
 * setting prevents. This line is the only thing that reaches them, which is why
 * it is not decoration and should not be tidied away.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const { email: fromQuery } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Confirmed already, so this page has nothing to say. Sending them on rather
  // than showing a screen about a state they are no longer in.
  if (user?.email_confirmed_at) redirect("/dashboard")

  /**
   * The session wins where there is one, because it is the address the account
   * actually has. The query parameter is caller-supplied and only ever used to
   * address a resend — which is metered per address, and which reports success
   * whether or not anything was sent, so it reveals nothing about who exists.
   */
  const email = user?.email ?? (fromQuery?.includes("@") ? fromQuery : null)

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded border px-4 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Check your email</h1>
          <p className="text-sm opacity-70">
            {email ? (
              <>
                We sent a confirmation link to{" "}
                <strong className="font-medium">{email}</strong>. Open it and
                you&apos;re in.
              </>
            ) : (
              <>We sent you a confirmation link. Open it and you&apos;re in.</>
            )}
          </p>
        </div>

        {/*
          Required text, not a nicety. Without a custom domain, SPF and DKIM
          cannot align, so mail to another provider may be filtered silently.
          See testing.md, Brevo & email.
        */}
        <p className="text-sm opacity-70">
          If it hasn&apos;t arrived in a minute or two, check your spam folder.
        </p>

        {/*
          20e. Needs an address, and now has one in both cases. Landing here
          with neither a session nor a parameter means somebody typed the URL,
          and a form asking for an email address again would just be a second
          signup form.
        */}
        {email ? <ResendForm email={email} /> : null}

        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm">Already have an account?</p>
          <form action={signInWithGoogle}>
            <input type="hidden" name="next" value="/dashboard" />
            <button
              type="submit"
              className="rounded border px-4 py-2 text-sm font-medium"
            >
              Continue with Google
            </button>
          </form>
          <p className="text-xs opacity-60">
            If you signed up with Google before, use this. No confirmation email
            is sent for a Google account.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4 text-xs opacity-70">
          {/* Only with a session to end. Signed out this would be a control
              that does nothing to a state you are not in. */}
          {user ? (
            <form action={signOut}>
              <button type="submit" className="underline">
                Sign out
              </button>
            </form>
          ) : (
            <Link href="/auth/sign-in" className="underline">
              Sign in
            </Link>
          )}
          <Link href="/" className="underline">
            Back to Solarity
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            Get help
          </a>
        </div>
      </div>

      <LegalFooter />
    </main>
  )
}
