import { test, expect } from "@playwright/test"
import { admin, requireEnv, userIdByEmail } from "./db"
import { storageStateFor } from "./session"

/**
 * Step 14e. The delete-account control.
 *
 * ## What this file deliberately does not do
 *
 * **It never submits the form.** The suite runs against two real accounts, and
 * `E2E_OWNER_EMAIL` owns the storage state every other spec depends on. A
 * successful deletion would not fail one test; it would end the run and could
 * not be undone by anything in this repository.
 *
 * So the server-side confirmation check is **not** covered end to end, and it
 * would be dishonest to imply otherwise. Testing it means POSTing a deliberately
 * wrong username and asserting a refusal — which is safe only if the check
 * works, and destroys the account if it does not. That asymmetry is the reason
 * not to: a test whose failure mode is "the thing it was testing already
 * happened" is not a test.
 *
 * What is covered is the gate a person actually meets: the control is closed by
 * default, the submit stays disabled until the typed name matches exactly, and
 * cancelling puts it away. The server-side check exists because the client one
 * is a courtesy rather than a control, and it is asserted by reading the code,
 * not by running it.
 *
 * **Writes nothing.** The only database call is a read confirming the account
 * still exists at the end, which is this file's own safety net.
 */

const EMAIL = () => requireEnv("E2E_OWNER_EMAIL")

test("deleting an account is closed by default and gated on typing the username", async ({
  browser,
}) => {
  const userId = await userIdByEmail(EMAIL())

  const { data: profile } = await admin
    .from("users")
    .select("username")
    .eq("id", userId)
    .single()
  const username = profile!.username!

  const context = await browser.newContext({
    storageState: await storageStateFor(EMAIL()),
  })
  const page = await context.newPage()

  try {
    await page.goto("/settings")

    const panel = page.getByRole("region", { name: "Delete your account" })
    await expect(panel).toBeVisible()

    // Closed. The confirmation field does not exist until asked for, so it
    // cannot be filled by an autofill pass or reached by a stray tab.
    await expect(panel.getByLabel(/Type .* to confirm/)).toHaveCount(0)

    await panel.getByRole("button", { name: "Delete your account" }).click()

    const field = panel.getByLabel(/Type .* to confirm/)
    await expect(field).toBeVisible()

    const submit = panel.getByRole("button", { name: "Delete my account" })
    await expect(submit, "the submit was enabled before anything was typed").toBeDisabled()

    // A near miss stays disabled. `slice(0, -1)` rather than a fixed string, so
    // this is a prefix of the real username and not merely a different word.
    await field.fill(username.slice(0, -1))
    await expect(submit, "a partial username enabled the submit").toBeDisabled()

    await field.fill(`${username}x`)
    await expect(submit, "a superset of the username enabled the submit").toBeDisabled()

    // The export offer lives inside the confirmation, where it is in front of
    // someone who has just said they are leaving.
    await expect(panel.getByRole("link", { name: /Download your data/ })).toBeVisible()

    // Exact match enables it, and this is the negative control: without it, a
    // permanently disabled button would pass every assertion above.
    await field.fill(username)
    await expect(submit, "the exact username did not enable the submit").toBeEnabled()

    // ------------------------------------------------------------------------
    // And then we do not press it. Cancel closes the panel and clears the field,
    // so the next open cannot start with a match already typed.
    // ------------------------------------------------------------------------
    await panel.getByRole("button", { name: "Cancel" }).click()
    await expect(panel.getByLabel(/Type .* to confirm/)).toHaveCount(0)

    await panel.getByRole("button", { name: "Delete your account" }).click()
    await expect(
      panel.getByRole("button", { name: "Delete my account" }),
      "cancelling left the typed username behind",
    ).toBeDisabled()
  } finally {
    await context.close()
  }

  // The safety net, asserted rather than assumed. If this file ever grows a
  // test that submits, this is what says so on the way out.
  const { data: stillThere } = await admin
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle()
  expect(stillThere, "the test account was deleted").not.toBeNull()
})
