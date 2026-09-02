"use server"

import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { safeRedirect } from "@/lib/safe-redirect"
import { enforce } from "@/lib/ratelimit"
import { clientIp } from "@/lib/request-identity"
import { passwordProblem } from "@/lib/password"
import { toMessage, type ActionResult } from "@/lib/errors"

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
      // Force the account chooser; Google skips it for a single signed-in account, and `consent` re-prompts permissions.
      queryParams: { prompt: "select_account" },
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

/**
 * Step 20e. Create an account with an email address and a password.
 *
 * ## What it deliberately does not tell you
 *
 * **Enumeration protection is on in the dashboard**, so `signUp` succeeds
 * whether or not the address is already registered, and Supabase decides
 * silently whether to send anything. This action must not undo that by
 * inspecting the result and saying something different in the two cases —
 * which is why it reports one outcome and always redirects to the same place.
 *
 * The person it strands is somebody who already has a Google account on that
 * address: they get a confirmation screen and no email, ever. The Google button
 * on `/auth/check-email` is the whole rescue, and it is why that button is not
 * decoration.
 *
 * ## Why the username is not here
 *
 * The plan had this form collecting one. Confirm-email is on, so a
 * username taken here would be held by an account nobody has proved they own,
 * and abandonment is indistinguishable from deliberate squatting. It moves to
 * `/onboarding`, which Google users already pass through, so both paths share
 * one implementation of the rules.
 *
 * ## Metered by IP, because there is no session yet
 *
 * Every other limit in the app keys on `auth.uid()`. This one cannot, so it
 * uses the forwarded client IP — a weaker key that groups a household, hence a
 * generous number.
 */
export async function signUpWithPassword(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = formData.get("email")?.toString().trim() ?? ""
  const password = formData.get("password")?.toString() ?? ""
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? ""
  const captchaToken = formData.get("captchaToken")?.toString() || undefined

  if (!email.includes("@")) return { ok: false, error: "Enter an email address." }

  // The same module the form's hint and its client-side check read from, so the
  // three cannot disagree with each other. See `lib/password.ts` on the one
  // place they can still drift from: the dashboard.
  const problem = passwordProblem(password)
  if (problem) return { ok: false, error: problem }

  /**
   * **Checked here as well as in the browser, because the form works without
   * JavaScript.** With it off, neither the rules nor the match are checked on
   * the client, and a mismatch reaching this point unexamined would create an
   * account with the *first* password while whoever typed it is certain they
   * used the second. They would then be unable to sign in and unable to say
   * why. A confirmation field is a typo-catcher, and a typo-catcher that only
   * works when scripting does is not one.
   */
  if (password !== confirmPassword) {
    return { ok: false, error: "Those passwords don't match." }
  }

  try {
    await enforce("signUp", await clientIp())
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const supabase = await createClient()
  const origin = (await headers()).get("origin") ?? "http://localhost:3000"

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Where Supabase sends people when the template uses `{{ .RedirectTo }}`.
      // The templates use `{{ .SiteURL }}` today, so this is inert — kept
      // because it costs nothing and is the switch to flip if per-environment
      // links are ever wanted. See testing.md.
      emailRedirectTo: `${origin}/auth/confirm`,
      // Step 20h. Empty when the widget is absent, which Supabase accepts while
      // CAPTCHA is off and refuses the moment it is on.
      captchaToken,
    },
  })

  // A refusal here is a real one — a weak password the dashboard rejects, or a
  // malformed address — never "that address exists", which enumeration
  // protection suppresses.
  if (error) return { ok: false, error: error.message }

  /**
   * **The address travels in the URL, because there is no session to read it
   * from.** With "Confirm email" on, `signUp` returns a user and
   * `session: null`, so whoever lands on the next page is signed out. Building
   * that page to read `getUser()` left its resend control invisible, which is
   * how this was found.
   *
   * Safe to pass: the resend it addresses is metered per address and reports
   * success whether or not anything was sent, so a crafted value reveals
   * nothing about who has an account.
   */
  redirect(`/auth/check-email?email=${encodeURIComponent(email)}`)
}

/**
 * Step 20e. Sign in with a password.
 *
 * **One message for every failure**, and that is the whole design. "No account
 * with that address" and "wrong password" are two facts, and telling them apart
 * turns this form into the address checker that enumeration protection exists
 * to prevent. Supabase returns a single `Invalid login credentials` for both;
 * this keeps it that way rather than helpfully decomposing it.
 */
export async function signInWithPassword(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = formData.get("email")?.toString().trim() ?? ""
  const password = formData.get("password")?.toString() ?? ""
  const next = safeRedirect(formData.get("next")?.toString())
  const captchaToken = formData.get("captchaToken")?.toString() || undefined

  if (!email || !password) {
    return { ok: false, error: "Enter your email address and password." }
  }

  try {
    await enforce("signInWithPassword", await clientIp())
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken },
  })

  if (error) {
    return { ok: false, error: "That email address and password don't match." }
  }

  redirect(next)
}

/**
 * Step 20e. Send the confirmation email again.
 *
 * **A link expiring is the ordinary case**, not an edge one: anybody who signs
 * up and reads their email tomorrow needs this, and without it their account is
 * unreachable and un-recreatable, because signing up again with the same
 * address is exactly what enumeration protection makes silent.
 *
 * **Supabase enforces 60 seconds between emails to one address** and answers a
 * faster request with nothing at all. The form says so rather than letting a
 * button look broken.
 *
 * Metered per address as well as by IP: an unmetered resend is a way to make
 * Solarity send repeated mail to somebody else, which is how a sending domain
 * gets flagged.
 */
export async function resendConfirmation(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = formData.get("email")?.toString().trim() ?? ""
  if (!email.includes("@")) return { ok: false, error: "Enter an email address." }

  try {
    await enforce("resendConfirmation", email.toLowerCase())
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  const supabase = await createClient()
  const origin = (await headers()).get("origin") ?? "http://localhost:3000"

  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${origin}/auth/confirm` },
  })

  // Reported as sent either way, for the same reason `signUpWithPassword`
  // reports one outcome: distinguishing "resent" from "no such account" would
  // reintroduce the leak.
  if (error) console.error("resend confirmation failed", error.message)

  return { ok: true, data: undefined }
}

/**
 * Step 20f. Ask for a password reset link.
 *
 * ## It says the same thing every time, on purpose
 *
 * "If there's an account, we've sent a link" is returned for a real address, an
 * address nobody has registered, and an address that has hit its limit. Saying
 * anything else turns this form into a checker for who uses Solarity, which is
 * the leak enumeration protection exists to close — and this is the easiest
 * place in the app to leak it, because a reset form is *expected* to know
 * whether it found you.
 *
 * ## Including when it refuses
 *
 * A rate-limited request returns the same sentence rather than "too many
 * attempts". A distinguishable refusal is still a signal: try an address, get
 * the limit message, and you have learned the previous attempts were counted
 * against something real. The cost is that somebody genuinely rate-limited is
 * not told why, which is a fair trade for a form used once a year.
 *
 * ## Timing has to match too
 *
 * A branch that returned early for unknown addresses would leak by clock even
 * with identical wording. So there is no such branch: every call does the same
 * two limit checks and the same Supabase call, and Supabase itself does not
 * tell us which case it was.
 */
export async function requestPasswordReset(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = formData.get("email")?.toString().trim() ?? ""
  const captchaToken = formData.get("captchaToken")?.toString() || undefined
  if (!email.includes("@")) return { ok: false, error: "Enter an email address." }

  const sent: ActionResult = { ok: true, data: undefined }

  try {
    await enforce("passwordReset", await clientIp())
    await enforce("passwordResetAddress", email.toLowerCase())
  } catch {
    // Deliberately swallowed. See above: a refusal that reads differently from
    // a success is a signal about which addresses are real.
    return sent
  }

  const supabase = await createClient()
  const origin = (await headers()).get("origin") ?? "http://localhost:3000"

  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    // Where the template's `{{ .RedirectTo }}` would point. Inert while the
    // templates use `{{ .SiteURL }}`, and the switch to flip for per-environment
    // links. See testing.md.
    redirectTo: `${origin}/auth/confirm?next=/auth/reset-password`,
    captchaToken,
  })

  // Logged, never surfaced. A real failure here is ours to fix and not
  // something the person can act on, and telling them the address was rejected
  // would be the leak again.
  if (error) console.error("password reset request failed", error.message)

  return sent
}

/**
 * Step 20f. Set a new password, using the session the recovery link minted.
 *
 * **There is no "current password" field, and that is not an oversight.**
 * Whoever reaches this screen arrived through `/auth/confirm` with a
 * single-use `token_hash` from their own inbox, which Supabase exchanged for a
 * session. Proving control of the address *is* the authentication. Asking for
 * the old password would ask the one thing somebody resetting it does not have.
 *
 * **Which makes the session check the whole guard.** No session means the link
 * was never followed, or has expired, or somebody typed the URL — and in every
 * case there is nothing to update.
 */
export async function updatePassword(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const password = formData.get("password")?.toString() ?? ""
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? ""

  const problem = passwordProblem(password)
  if (problem) return { ok: false, error: problem }

  // Checked here as well as in the browser, because the form works with
  // JavaScript off and a silent mismatch would set a password nobody meant.
  if (password !== confirmPassword) {
    return { ok: false, error: "Those passwords don't match." }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return {
      ok: false,
      error: "That reset link has expired. Ask for a new one and try again.",
    }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) return { ok: false, error: error.message }

  // Straight into the app rather than back to sign-in: they are already
  // authenticated, and asking somebody to sign in with a password they set two
  // seconds ago is a step that exists only to look thorough.
  redirect("/dashboard")
}
