import { redirect } from "next/navigation"
import { LegalFooter } from "@/components/legal-footer"
import { createClient } from "@/lib/supabase/server"
import { signInWithGoogle } from "@/app/actions/auth"
import { safeRedirect } from "@/lib/safe-redirect"

export const metadata = { title: "Sign in — Solarity" }

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

      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={target} />
        <button
          type="submit"
          className="rounded border px-4 py-2 text-sm font-medium"
        >
          Continue with Google
        </button>
      </form>

      <LegalFooter />
    </main>
  )
}
