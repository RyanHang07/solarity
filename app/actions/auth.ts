"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { safeRedirect } from "@/lib/safe-redirect"

/**
 * Starts the Google OAuth flow.
 *
 * Server-side so the PKCE code verifier is written as an httpOnly cookie the
 * callback route can read back. Starting the flow in the browser leaves it
 * JS-readable for no benefit.
 */
export async function signInWithGoogle(formData: FormData) {
  const next = safeRedirect(formData.get("next")?.toString())
  const supabase = await createClient()

  // From the request, not an env var, so localhost and preview deployments
  // both work. Every origin it can produce must be listed in Supabase → Auth →
  // URL Configuration → Redirect URLs.
  const origin = (await headers()).get("origin") ?? "http://localhost:3000"

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (error || !data.url) {
    redirect(`/auth/error?reason=${encodeURIComponent(error?.message ?? "no_url")}`)
  }

  redirect(data.url)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/")
}
