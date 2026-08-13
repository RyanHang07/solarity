"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { createClient, createAdminClient } from "@/lib/supabase/server"
import { enforce } from "@/lib/ratelimit"
import { containsProfanity } from "@/lib/profanity"
import { toMessage, type ActionResult } from "@/lib/errors"

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
  })

  if (error) return { ok: false, error: toMessage(error) }

  // The app layout reads `username` to decide whether to send people here.
  revalidatePath("/", "layout")

  // Redirect here rather than from an effect in the form, so there's no window
  // where the write has succeeded and the browser still shows the form.
  redirect("/dashboard")
}
