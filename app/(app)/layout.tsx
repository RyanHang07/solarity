import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { signOut } from "@/app/actions/auth"

/**
 * Onboarding gate for every signed-in screen. See architecture.md section 2b
 * for why this lives here rather than in the proxy.
 *
 * A signed-in user with no row is a broken state rather than a new user — the
 * auth trigger creates it. Onboarding is still the right destination, since
 * setting a username is the only thing that can repair it.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase
    .from("users")
    .select("username")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.username) redirect("/onboarding")

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          Solarity
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-70">{profile.username}</span>
          <form action={signOut}>
            <button type="submit" className="underline opacity-70">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col p-4">{children}</main>
    </div>
  )
}
