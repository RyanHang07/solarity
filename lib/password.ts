/**
 * Step 20e. What makes a password acceptable, in one place.
 *
 * ## Why this module exists rather than a regex in the form
 *
 * The rules are enforced by **Supabase**, in the dashboard, under Authentication
 * → Sign In / Providers → Email. That setting is the authority: it is what
 * actually refuses a weak password, and it applies to signup, password sign-in
 * and reset alike.
 *
 * Validating in the browser as well duplicates a policy that lives somewhere
 * else, which is a real cost and was taken deliberately: it buys instant
 * feedback instead of a round trip that ends in a refusal somebody could have
 * been told about while typing.
 *
 * **The mitigation is that there is exactly one copy on this side.** The helper
 * text, the client check and the tests all read from here, so the form can
 * never disagree with its own hint — only ever with the dashboard, which is one
 * place to look when they drift.
 *
 * **If the dashboard setting changes, change this file in the same sitting.**
 * The failure mode is quiet and one-directional: loosen the dashboard and this
 * refuses passwords the server would have taken; tighten it and this waves
 * through passwords the server rejects, which reads as a broken form.
 */

/** Mirrors "Minimum password length" in the dashboard. */
export const MIN_PASSWORD_LENGTH = 8

/**
 * Mirrors "Password Requirements: letters and digits".
 *
 * Deliberately not a single regex. Two named checks produce two different
 * sentences, and "must contain a letter and a number" after the fact is worse
 * than being told which half is missing.
 */
const HAS_LETTER = /\p{L}/u
const HAS_DIGIT = /\p{Nd}/u

/** The sentence shown under the field, before anybody has typed anything. */
export const PASSWORD_HINT = `At least ${MIN_PASSWORD_LENGTH} characters, with a letter and a number.`

/**
 * What is wrong with a password, or null when nothing is.
 *
 * Returns copy rather than a code, because there is exactly one caller and no
 * hint table to route through. Order matters: length first, since a short
 * password usually fails everything and naming three problems at once helps
 * nobody.
 *
 * **`\p{L}` and `\p{Nd}` rather than `[A-Za-z]` and `[0-9]`.** A password of
 * Cyrillic letters and Arabic-Indic digits satisfies Supabase's rule, and an
 * ASCII-only check here would refuse it while the server accepted it — the
 * exact drift this module exists to avoid, arriving from the direction nobody
 * thinks about.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`
  }
  if (!HAS_LETTER.test(password)) return "Include at least one letter."
  if (!HAS_DIGIT.test(password)) return "Include at least one number."
  return null
}
