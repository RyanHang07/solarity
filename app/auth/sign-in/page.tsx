import Link from "next/link"
import { redirect } from "next/navigation"
import { LegalFooter } from "@/components/legal-footer"
import { createClient } from "@/lib/supabase/server"
import { signInWithGoogle } from "@/app/actions/auth"
import { safeRedirect } from "@/lib/safe-redirect"
import { PasswordForm } from "./password-form"

export const metadata = { title: "Sign in — Solarity" }

/**
 * Step 20e. Two ways in, one page.
 *
 * **One route rather than `/auth/sign-in/password`**, and the reason is the
 * `next` parameter. It is the only thing carrying somebody back to the page
 * they were trying to reach, `sw.js` deep-links with it, and a second hop is
 * exactly where a value like that gets silently dropped — landing people on the
 * dashboard instead of the Circle they tapped a notification for.
 *
 * **Google stays on top** because it is one tap against two fields, and because
 * every existing account uses it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const target = safeRedirect(next)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) redirect(target)

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Solarity</h1>
      <p className="max-w-xs text-center text-sm opacity-70">
        Friends who see each other&apos;s progress motivate each other to keep going.
      </p>

      <div className="flex w-full max-w-sm flex-col gap-5 rounded border px-4 py-5">
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={target} />
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

        <PasswordForm next={target} />

        <div className="flex flex-col gap-2 border-t pt-4 text-sm">
          {/*
            Present before `/auth/forgot-password` exists, because the sign-in
            page is where somebody looks for it and a missing link is the whole
            problem it solves. 20f builds the page.
          */}
          <Link href="/auth/forgot-password" className="underline opacity-70">
            Forgot your password?
          </Link>
          <p>
            No account yet?{" "}
            <Link href="/auth/sign-up" className="underline">
              Create one
            </Link>
          </p>
        </div>
      </div>

      <LegalFooter />
    </main>
  )
}
