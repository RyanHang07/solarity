import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PushPrompt } from "./push-prompt"

export const metadata = { title: "Notifications — Solarity" }

/**
 * Step 10c, the last screen of onboarding.
 *
 * **After the install nudge, not before.** On iOS push works only inside an
 * installed PWA, so asking first would spend the single permission on a browser
 * that cannot deliver anything.
 *
 * Outside `(app)` and gated on signing in alone, for the same reasons as
 * `/onboarding/install`: no gate should fire mid-signup, and whether this
 * browser is subscribed is a device fact with nothing to remember server-side.
 */
export default async function NotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in?next=/onboarding")

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <PushPrompt next="/dashboard" />
    </main>
  )
}
