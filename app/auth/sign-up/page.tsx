import Link from "next/link"
import { redirect } from "next/navigation"
import { LegalFooter } from "@/components/legal-footer"
import { createClient } from "@/lib/supabase/server"
import { signInWithGoogle } from "@/app/actions/auth"
import { MINIMUM_AGE } from "@/lib/legal"
import { SignUpForm } from "./sign-up-form"

export const metadata = { title: "Create an account — Solarity" }

/**
 * Step 20e. The second way in.
 *
 * **Google first, here as on `/auth/sign-in`.** It is one tap against three
 * fields and an email round trip, it is what almost everybody will use, and
 * putting it second would be arranging the page around the implementation
 * rather than around the person.
 *
 * **The age line is here rather than only in the terms**, because 18+ is a rule
 * somebody should meet before creating an account rather than discover inside
 * one. Nothing enforces it: Google asks nothing and this form asks nothing, and
 * that gap is deliberate and recorded in the legal review.
 */
export default async function SignUpPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Already signed in, so this page is a dead end. The gate decides where they
  // actually belong — onboarding, terms or the dashboard.
  if (user) redirect("/dashboard")

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded border px-4 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Create an account</h1>
          <p className="text-sm opacity-70">
            Solarity is goals you keep with a few friends watching.
          </p>
        </div>

        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value="/dashboard" />
          <button
            type="submit"
            className="w-full rounded border px-4 py-2 text-sm font-medium"
          >
            Continue with Google
          </button>
        </form>

        <div className="flex items-center gap-3 text-xs opacity-50">
          <span className="h-px flex-1 bg-current" />
          or
          <span className="h-px flex-1 bg-current" />
        </div>

        <SignUpForm />

        <p className="text-xs opacity-60">
          You need to be {MINIMUM_AGE} or older. You&apos;ll pick a username
          next.
        </p>

        <p className="border-t pt-4 text-sm">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="underline">
            Sign in
          </Link>
        </p>
      </div>

      <LegalFooter />
    </main>
  )
}
