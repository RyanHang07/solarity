import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { OnboardingForm } from "./onboarding-form"

export const metadata = { title: "Set up — Solarity" }

export default async function OnboardingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in?next=/onboarding")

  const { data: profile } = await supabase
    .from("users")
    .select("username, first_name")
    .eq("id", user.id)
    .maybeSingle()

  // Renaming happens in settings, not here.
  if (profile?.username) redirect("/dashboard")

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-xl font-semibold">
        {profile?.first_name ? `Welcome, ${profile.first_name}` : "Welcome"}
      </h1>
      <OnboardingForm />
    </main>
  )
}
