"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { containsProfanity } from "@/lib/profanity"
import { toMessage, type ActionResult } from "@/lib/errors"
import { TERMS_VERSION } from "@/lib/legal"
import { safeRedirect } from "@/lib/safe-redirect"
import { isSunPresetId } from "@/lib/galaxy/data"
import { createGoal } from "./goals"

const USERNAME_RE = /^[A-Za-z0-9_]{3,30}$/

/**
 * Sets the username and check-in timezone, and doubles as the rename path —
 * the RPC decides which by whether a username exists, and enforces the
 * once-per-14-days limit itself.
 */
export async function completeOnboarding(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const username = formData.get("username")?.toString().trim() ?? ""
  const timezone = formData.get("timezone")?.toString().trim() ?? ""

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  // Cheap local checks first, so a rejected attempt costs no allowance.
  // Picking a username is guess-and-retry by nature; charging for each guess
  // would lock people out of onboarding for fumbling their own name.

  // Mirrors users_username_format, so the person gets a sentence rather than a
  // constraint violation.
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      error: "3–30 characters, letters, numbers and underscores only.",
    }
  }

  if (containsProfanity(username)) {
    return { ok: false, error: "Please choose a different username." }
  }

  if (!timezone) {
    return { ok: false, error: "We couldn't detect your timezone. Please pick one." }
  }

  // Immediately before the first call that leaves this process. The
  // availability check below is a real database round trip, so it is metered.
  try {
    await enforce("onboarding", user.id)
  } catch (e) {
    return { ok: false, error: toMessage(e) }
  }

  // Message-quality pre-check only; the real guard is users_username_lower_key
  // raising 23505 below. Needs the admin client because RLS hides users outside
  // your Circles, which would make every name look free.
  const admin = createAdminClient()
  const { data: taken } = await admin
    .from("users")
    .select("id")
    .ilike("username", username)
    .neq("id", user.id)
    .maybeSingle()

  if (taken) return { ok: false, error: "That username is taken." }

  const { error } = await supabase.rpc("complete_onboarding", {
    p_username: username,
    p_timezone: timezone,
    // Step 20a. The RPC `coalesce`s this, so a rename never moves an existing
    // acceptance; only a first one writes.
    p_terms_version: TERMS_VERSION,
  })

  if (error) return { ok: false, error: toMessage(error) }

  // The app layout reads `username` to decide whether to send people here.
  revalidatePath("/", "layout")

  // Redirect here rather than from an effect in the form, so there's no window
  // where the write has succeeded and the browser still shows the form.
  //
  // **To the first goal, then the two nudges.** Step 25 put the goal step
  // immediately after this one because it is the only *required* step of the
  // four: install and notifications are both skippable, and a requirement
  // placed behind two things a person may decline is a requirement placed where
  // they have already started saying no.
  redirect("/onboarding/goal")
}

/**
 * Step 20c. Records that an existing account agreed to the terms.
 *
 * **Only for accounts that predate migration 105.** A signup records acceptance
 * as part of `complete_onboarding`, so anybody arriving through the front door
 * never meets the screen this serves. What is left is everyone who signed in
 * with Google before there was anything to agree to, and Google never showed
 * them a checkbox.
 *
 * **No rate limit, deliberately.** It writes two columns on your own row, is
 * idempotent, and the gate stops asking the moment it succeeds. A limit here
 * could only ever lock somebody out of the screen standing between them and
 * the app.
 *
 * **It redirects rather than returning, which is why it takes `formData`.**
 * The destination arrives as a hidden field, so the form works with JavaScript
 * off and the client component needs no router. `redirect` throws, so nothing
 * after it runs on the happy path — the same shape as `completeOnboarding`
 * above.
 *
 * **`revalidatePath("/", "layout")` before redirecting, because the gate reads
 * these columns.** Without it the layout renders from cache, sees no
 * acceptance, and bounces straight back to the screen just completed.
 */
export async function acceptTerms(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const next = safeRedirect(formData.get("next")?.toString())

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const { error } = await supabase.rpc("accept_terms", {
    p_version: TERMS_VERSION,
  })
  if (error) return { ok: false, error: toMessage(error) }

  revalidatePath("/", "layout")
  redirect(next)
}

/**
 * Step 25b. The first goal, plus the sun colour chosen on the same screen.
 *
 * ## Why this wraps `createGoal` rather than duplicating it
 *
 * `createGoal` carries the title length check, the profanity screen, the rate
 * limit, the category lookup by slug, and the first-goal marker that stops a
 * new account being thrown at the daily check-in the moment it arrives. A
 * second insert path would carry none of that and would drift the first time
 * one of them changed. So this writes the one thing `createGoal` knows nothing
 * about and then calls it, unchanged.
 *
 * ## The colour can fail and the sign-up cannot
 *
 * `sun_preset_id` is nullable and `null` means "derive it from my id" — the
 * behaviour every account had before migration 111 — so a failed write here has
 * a correct fallback that needs no row. **Blocking the only screen nobody can
 * skip on a cosmetic column would be the worse bug by a distance.** It is
 * logged rather than returned, and the person gets the hashed colour.
 *
 * Ordered before the goal deliberately: the reverse would mean a goal created
 * and a form re-submitted, which `createGoal` would then refuse or duplicate.
 * This way a retry re-writes the same colour, which costs nothing.
 *
 * ## An invalid value is skipped, not refused
 *
 * The picker always has a selection — it opens on the colour the account
 * already renders — so an absent or unrecognised `sun` means the request did
 * not come from the form. Refusing would turn a tampered field into a wall in
 * front of sign-up; skipping leaves them with the derived colour, which is
 * exactly what they had a moment ago.
 */
export async function saveFirstGoal(
  prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Please sign in again." }

  const chosen = formData.get("sun")?.toString() ?? ""
  if (isSunPresetId(chosen)) {
    const { error } = await supabase
      .from("users")
      .update({ sun_preset_id: chosen })
      .eq("id", user.id)

    if (error) {
      // Not returned. See the header: the galaxy falls back to the derived
      // colour, and the goal below is the thing the person came here for.
      console.error("sun preset write failed", error)
    }
  }

  return createGoal(prev, formData)
}
