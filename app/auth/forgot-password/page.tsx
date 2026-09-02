import Link from "next/link"
import { redirect } from "next/navigation"
import { LegalFooter } from "@/components/legal-footer"
import { createClient } from "@/lib/supabase/server"
import { ForgotForm } from "./forgot-form"

export const metadata = {
  title: "Reset your password — Solarity",
  robots: { index: false, follow: false },
}

/**
 * Step 20f. The way back in.
 *
 * **Linked from `/auth/sign-in` since 20e**, before this page existed, because
 * the sign-in page is where somebody looks for it and a missing link is the
 * whole problem it solves.
 *
 * **Google accounts have nothing to reset**, and the note at the bottom says so.
 * Somebody who signed in with Google and never set a password will otherwise
 * request a link, receive nothing — enumeration protection forbids explaining —
 * and conclude the product is broken. That sentence is the only thing standing
 * between them and that conclusion.
 */
export default async function ForgotPasswordPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Already signed in, so there is nothing to recover. Changing a password from
  // here would be a different feature with a different guard.
  if (user) redirect("/dashboard")

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="flex w-full max-w-sm flex-col gap-4 rounded border px-4 py-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Reset your password</h1>
          <p className="text-sm opacity-70">
            Tell us your email address and we&apos;ll send you a link to set a
            new one.
          </p>
        </div>

        <ForgotForm />

        <p className="border-t pt-4 text-xs opacity-60">
          If you signed in with Google, there&apos;s no password to reset — use
          the Google button on the{" "}
          <Link href="/auth/sign-in" className="underline">
            sign-in page
          </Link>
          .
        </p>
      </div>

      <LegalFooter />
    </main>
  )
}
