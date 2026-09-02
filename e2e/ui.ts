import type { Page, Locator } from "@playwright/test"

/**
 * Locators for things the app renders that a bare role query gets wrong.
 *
 * ## `errorAlert`, and why `getByRole("alert")` is a trap here
 *
 * **Next's dev overlay renders its own empty `alert` node on every page.** It
 * is attached before the app has done anything, so a page-wide alert query has
 * two failure modes and both of them lie:
 *
 * - When the real error *has* rendered, two nodes match and the call fails as a
 *   strict-mode violation, reported as though the page were ambiguous rather
 *   than as though the query were.
 * - When the real error has *not* rendered yet, exactly one node matches — the
 *   empty one — so nothing waits and nothing complains. `textContent()` returns
 *   `""` immediately, and an assertion on it fails with "no error shown" while
 *   the screenshot taken moments later shows the error plainly there.
 *
 * The second is how `sign-up.spec.ts` failed: the app was correct, the message
 * was on screen, and the test had read a different element entirely. `push
 * .spec.ts` had already met this and written the fix inline; the third copy is
 * what moved it here.
 *
 * Two things make it right. **The tag**, because every error in this app is a
 * `<p role="alert">` and the overlay's is not a paragraph. And **`hasText`
 * requiring a non-space character**, because an alert that says nothing is not
 * an error being shown — that alone would have caught this without knowing the
 * overlay existed.
 *
 * Prefer this to `getByRole("alert")` everywhere, including inside an already
 * scoped locator: the scope makes the collision unlikely rather than
 * impossible, and the emptiness check is worth having on its own.
 */
export function errorAlert(scope: Page | Locator): Locator {
  return scope.locator('p[role="alert"]').filter({ hasText: /\S/ })
}
