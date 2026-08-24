import Link from "next/link"
import { LegalFooter } from "@/components/legal-footer"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Notice } from "@/components/notice"

/**
 * Public landing, so an invite link can preview before sign-in. Signed-in
 * visitors pass straight through: a marketing page is not what should greet
 * someone opening an installed app from their home screen.
 *
 * Also the landing spot for a signed-out visitor who followed a dead invite
 * link, which is why it reads `notice`. Sending them to `/dashboard` instead
 * would bounce them to sign-in and lose the explanation.
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
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-sm">
        <Notice notice={notice} href="/" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Solarity</h1>
      <p className="max-w-sm text-center text-sm opacity-70">
        Friends who see each other&apos;s progress toward their goals motivate
        each other to keep going.
      </p>
      <Link href="/auth/sign-in" className="rounded border px-4 py-2 text-sm font-medium">
        Sign in
      </Link>

      <LegalFooter />
    </main>
  )
}
