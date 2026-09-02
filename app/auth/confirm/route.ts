import { type EmailOtpType } from "@supabase/supabase-js"
import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeRedirect } from "@/lib/safe-redirect"

/**
 * Step 20e. Turns a link from an email into a session.
 *
 * ## Why this route has to exist
 *
 * Supabase's default email templates use `{{ .ConfirmationURL }}`, which points
 * at its own `/auth/v1/verify` endpoint and returns the session **in the URL
 * fragment**. A fragment is never sent to a server, so an SSR app cannot read
 * it: the link appears to work, lands on the site, and leaves the person signed
 * out. That failure looks exactly like a bug in this file, which is why the
 * dashboard templates were changed first — see build-plan.md 20b.
 *
 * With `token_hash` in the query string instead, the exchange happens here,
 * server-side, and the session lands in cookies the rest of the app can read.
 *
 * ## One route, two flows
 *
 * `type=email` is a signup confirmation and `type=recovery` is a password
 * reset. They differ only in where somebody belongs afterwards, which the
 * template says with `next`. Building two routes would mean two copies of the
 * exchange and two places to get the cookie handling wrong.
 *
 * ## The token never survives the redirect
 *
 * `token_hash` is a single-use credential and it arrives in a URL, so it is in
 * the address bar, in history, and in any referrer that leaks. It is stripped
 * from the destination rather than carried along — the exchange has already
 * happened by then and nothing downstream has any use for it.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null

  /**
   * **`/dashboard` rather than `/`, and the gate does the rest.**
   *
   * A confirmed account may still need a username or the terms screen, and
   * `app/(app)/layout.tsx` already decides that on every protected navigation.
   * Sending people to a specific onboarding step from here would be a second
   * copy of that routing, wrong the moment the gate changes.
   */
  const next = safeRedirect(searchParams.get("next"), "/dashboard")

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url))
    }

    // Expired, already used, or tampered with. All three are the same thing to
    // whoever clicked: a link that no longer works, and a page that says so and
    // offers a way to get another.
    return NextResponse.redirect(new URL("/auth/error?reason=link", request.url))
  }

  // Reached by hand, by a crawler, or by a template edited into the wrong
  // shape. The last is worth distinguishing while the templates are new.
  return NextResponse.redirect(new URL("/auth/error?reason=missing", request.url))
}
