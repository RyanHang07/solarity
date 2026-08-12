import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeRedirect } from "@/lib/safe-redirect"

/**
 * sign-in action → Google → Supabase `/auth/v1/callback` → here, with a
 * one-time `code`. Exchanging it for a session is what signs the person in.
 *
 * A route handler rather than a page: the exchange writes session cookies, and
 * Server Components can't set them.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeRedirect(searchParams.get("next"))

  // Usually the user cancelling on the consent screen.
  const oauthError = searchParams.get("error_description") ?? searchParams.get("error")
  if (oauthError) {
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(oauthError)}`,
    )
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/auth/error?reason=missing_code`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Usually an expired or already-used code: a reloaded callback URL, or a
    // stale tab.
    return NextResponse.redirect(
      `${origin}/auth/error?reason=${encodeURIComponent(error.message)}`,
    )
  }

  return NextResponse.redirect(`${origin}${next}`)
}
