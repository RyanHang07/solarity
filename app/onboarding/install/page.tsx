import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { InstallNudge } from "./install-nudge"

export const metadata = { title: "Add Solarity — Solarity" }

/**
 * Step 10b, the screen after the username.
 *
 * ## Why it is its own route rather than a step inside `/onboarding`
 *
 * `/onboarding` redirects to `/dashboard` the moment a username exists, and by
 * the time anyone reaches this screen one does. Keeping this here as a second
 * phase would mean either weakening that redirect or holding the flow in client
 * state, where a reload loses your place.
 *
 * ## Why it lives outside `(app)`
 *
 * Same reason `/onboarding` does: the `(app)` layout redirects people without a
 * username, and `/today` diverts people with an unfinished day. Neither should
 * fire during signup, and a screen inside that group cannot opt out.
 *
 * ## Gated on signing in and nothing else
 *
 * Whether the app is installed is a fact about a device, not an account, so
 * there is nothing on the server to check and nothing to remember. Reaching
 * this URL later shows the nudge again, which is the harmless direction: it is
 * a page with a way out and no side effects, and nothing links to it.
 */
export default async function InstallPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in?next=/onboarding")

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      {/* The permission ask comes after this, never before: on iOS push works
          only inside an installed PWA, so asking first would spend the one
          permission a browser grants on a browser that cannot deliver. */}
      <InstallNudge next="/onboarding/notifications" />
    </main>
  )
}
