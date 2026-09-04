import { test, expect } from "@playwright/test"
import { admin, requireEnv, userIdByEmail } from "./db"
import { errorAlert } from "./ui"
import { MIN_PASSWORD_LENGTH } from "@/lib/password"
import { TERMS_VERSION } from "@/lib/legal"

/**
 * Step 20e. Creating an account with an email address and a password.
 *
 * ## How this is testable at all
 *
 * The suite cannot read email, so the confirmation link cannot be clicked. But
 * `admin.auth.admin.generateLink()` returns the same `hashed_token` the email
 * would have carried, **without sending anything** — which is already how
 * `e2e/session.ts` mints sessions for the three fixture accounts.
 *
 * That means `/auth/confirm` can be driven for real: a genuine token, a genuine
 * `verifyOtp`, genuine cookies, and the gate genuinely letting somebody
 * through. It is the route the Supabase docs warn about, and the one worth
 * covering properly.
 *
 * ## Writes
 *
 * One `auth.users` row per test, deleted in `finally`. The address is unique
 * per run so a leaked account from a crashed run cannot make the next one pass
 * or fail for the wrong reason.
 */

/** Unique per run: a reused address would hit the 60-second resend window. */
function freshEmail() {
  return `e2e-signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`
}

const GOOD_PASSWORD = "solarity1test"

async function deleteByEmail(email: string) {
  const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  const found = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
  if (found) await admin.auth.admin.deleteUser(found.id)
}

test("a new account is created unconfirmed, and cannot reach the app", async ({
  page,
}) => {
  const email = freshEmail()

  try {
    await page.goto("/auth/sign-up")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PASSWORD)
    await page.getByLabel("Confirm password").fill(GOOD_PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()

    await expect(page).toHaveURL(/\/auth\/check-email/)
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible()
    // The address is echoed back, which is the only confirmation somebody gets
    // that they did not typo it.
    await expect(page.getByText(email)).toBeVisible()

    /**
     * **The resend control, which was missing and rendered nothing.** It was
     * gated behind `user?.email`, on the belief that `signUp` leaves a session.
     * It does not when confirmation is required, so the one screen where a
     * person waits had no way to ask again — and the account would have been
     * unreachable and un-recreatable once the link expired, because signing up
     * again with the same address is exactly what enumeration protection makes
     * silent.
     */
    await expect(
      page.getByRole("button", { name: "Send it again" }),
      "no way to ask for another confirmation email",
    ).toBeVisible()

    // **The account exists and is unconfirmed.** Both halves matter: the first
    // proves signup did something, the second is the state the gate is for.
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const created = data?.users.find((u) => u.email?.toLowerCase() === email)
    expect(created, "signup created no account").toBeTruthy()
    expect(
      created!.email_confirmed_at,
      "the account was confirmed without anybody opening a link",
    ).toBeFalsy()

    /**
     * **An unconfirmed signup cannot reach the app**, which is the claim worth
     * making. *How* it is stopped was asserted wrongly at first: this expected
     * the gate in `app/(app)/layout.tsx` to catch a signed-in account with an
     * unverified address.
     *
     * With "Confirm email" on, `signUp` returns `session: null`, so there is no
     * session at all and the **proxy** turns them away at sign-in — earlier and
     * more cheaply than the gate would have. The gate still earns its place as
     * a defence against that setting changing; it is simply not what runs here.
     */
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/auth\/sign-in/)
  } finally {
    await deleteByEmail(email)
  }
})

test("confirming the address lets the account into onboarding", async ({ page }) => {
  const email = freshEmail()

  try {
    await page.goto("/auth/sign-up")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PASSWORD)
    await page.getByLabel("Confirm password").fill(GOOD_PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/auth\/check-email/)

    /**
     * The link the email would have contained, minted rather than received.
     * `type: "signup"` is what Supabase calls the confirmation token; the route
     * receives it as `type=email`, which is the `EmailOtpType` that verifies it.
     * The two names are not a mistake and are the sort of thing that costs an
     * afternoon.
     */
    const { data: link, error } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password: GOOD_PASSWORD,
    })
    expect(error, "generateLink refused").toBeNull()
    const tokenHash = link?.properties?.hashed_token
    expect(tokenHash, "no hashed_token to confirm with").toBeTruthy()

    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=email`)

    /**
     * **Onboarding, not the dashboard**, and that is the gate working rather
     * than the route guessing. `/auth/confirm` sends everybody to `/dashboard`;
     * the layout then sees no username and redirects. A confirmed account with
     * no profile belongs at `/onboarding` and nowhere else.
     */
    await expect(page).toHaveURL(/\/onboarding$/)

    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
    const confirmed = data?.users.find((u) => u.email?.toLowerCase() === email)
    expect(
      confirmed!.email_confirmed_at,
      "the address is still unconfirmed after a successful exchange",
    ).toBeTruthy()
  } finally {
    await deleteByEmail(email)
  }
})

test("a used or broken confirmation link explains itself", async ({ page }) => {
  const email = freshEmail()

  try {
    await page.goto("/auth/sign-up")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PASSWORD)
    await page.getByLabel("Confirm password").fill(GOOD_PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/auth\/check-email/)

    const { data: link } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password: GOOD_PASSWORD,
    })
    // Asserted rather than `!`-ed. A missing token would otherwise make the
    // next line request `token_hash=undefined`, which lands on the error page —
    // and the test would pass, for entirely the wrong reason.
    const tokenHash = link?.properties?.hashed_token
    expect(tokenHash, "no hashed_token to confirm with").toBeTruthy()

    // Once, which works.
    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=email`)
    await expect(page).toHaveURL(/\/onboarding$/)

    // **Twice, which is the ordinary case**: a link double-clicked, or opened
    // again from an email somebody kept. It must say something comprehensible
    // rather than fail silently or 500.
    await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=email`)
    await expect(page).toHaveURL(/\/auth\/error/)
    await expect(page.getByRole("heading", { name: /link has expired/i })).toBeVisible()
    await expect(page.getByRole("link", { name: "Get a new link" })).toBeVisible()

    // And a link with nothing in it, which is what a mail client truncating a
    // long URL produces.
    await page.goto("/auth/confirm")
    await expect(page).toHaveURL(/\/auth\/error/)
    await expect(page.getByRole("heading", { name: /something was missing/i })).toBeVisible()
  } finally {
    await deleteByEmail(email)
  }
})

/**
 * The client-side rules, which exist only so somebody is told while typing.
 *
 * **Supabase is the authority** and refuses these too; this asserts the form
 * says so first, because the alternative is a round trip that ends in a
 * refusal the person could have been warned about.
 */
test("the signup form states its password rules and refuses a weak one", async ({
  page,
}) => {
  await page.goto("/auth/sign-up")

  await expect(
    page.getByText(new RegExp(`At least ${MIN_PASSWORD_LENGTH} characters`)),
  ).toBeVisible()

  /**
   * **Exact, because "Confirm password" contains "Password".** Without it this
   * resolves to two fields and fails as a strict-mode violation reported as a
   * missing input — the same trap the invite search hit with prefix usernames.
   *
   * **And exactness is only safe because the field is now named "Password".**
   * It was not: the hint and the error lived inside the `<label>`, so a
   * `<label>`'s whole text content became the accessible name and the field was
   * called "Password At least 8 characters, with a letter and a number.". Every
   * test that filled this form waited the full timeout on a locator that could
   * never match, and reported it as a form that would not enable. Fixed in the
   * component rather than here, because the wrong name was wrong for a screen
   * reader before it was wrong for Playwright.
   */
  const password = page.getByLabel("Password", { exact: true })
  const confirm = page.getByLabel("Confirm password")
  const submit = page.getByRole("button", { name: "Create account" })

  // Nothing typed yet: there is no valid submission to make.
  await expect(submit).toBeDisabled()

  await password.fill("short1")
  await password.blur()
  await expect(page.getByText(/Use at least 8 characters/)).toBeVisible()
  await expect(submit).toBeDisabled()

  // Long enough, no digit. The message names which half is missing rather than
  // restating the whole rule.
  await password.fill("solarityletters")
  await password.blur()
  await expect(page.getByText(/Include at least one number/)).toBeVisible()
  await expect(submit).toBeDisabled()

  // A good password with nothing in the confirmation field is still not a valid
  // submission, which is the whole point of the second field.
  await password.fill(GOOD_PASSWORD)
  await password.blur()
  await expect(submit).toBeDisabled()

  await confirm.fill("something-else-1")
  await confirm.blur()
  await expect(page.getByText(/don't match/i)).toBeVisible()
  await expect(submit).toBeDisabled()

  // The control: matching, valid, and the button comes back. Without this the
  // four assertions above would pass against a form that never enables at all.
  await confirm.fill(GOOD_PASSWORD)
  await confirm.blur()
  await expect(page.getByText(/don't match/i)).toHaveCount(0)
  await expect(submit).toBeEnabled()
})

/**
 * The reveal, which exists because a password field is the one input nobody can
 * proofread.
 */
test("the password can be revealed and hidden again", async ({ page }) => {
  await page.goto("/auth/sign-up")

  const password = page.getByLabel("Password", { exact: true })
  const confirm = page.getByLabel("Confirm password")
  const toggle = page.getByRole("button", { name: "Show password" })

  await expect(password).toHaveAttribute("type", "password")
  await expect(confirm).toHaveAttribute("type", "password")

  await toggle.click()

  // **Both fields, from one control.** Revealing only the first would leave the
  // confirmation unreadable, which is the field somebody most wants to check.
  await expect(password).toHaveAttribute("type", "text")
  await expect(confirm).toHaveAttribute("type", "text")

  // And it goes back, so it is a toggle rather than a one-way door.
  await page.getByRole("button", { name: "Hide password" }).click()
  await expect(password).toHaveAttribute("type", "password")
  await expect(confirm).toHaveAttribute("type", "password")
})

test("signing in with a wrong password says one thing, whatever is wrong", async ({
  page,
}) => {
  await page.goto("/auth/sign-in")

  /**
   * **The same sentence for both facts**, which is the point. A real address
   * with a wrong password and an address with no account are different truths,
   * and telling them apart turns this form into the address checker that
   * enumeration protection exists to prevent.
   */
  /**
   * **`errorAlert`, and an assertion before every read.**
   *
   * The first version read `getByRole("alert").textContent()` straight after
   * the click. `textContent()` waits only for its element to be *attached*, and
   * Next's dev overlay has an empty alert attached from the start — so the read
   * resolved instantly against the wrong node, returned `""`, and failed with
   * "no error shown" over a screenshot showing the error on screen. The same
   * shape as `allInnerTexts()` in the avatar spec: a read is not a wait.
   */
  const wrongPassword = "not-the-right-one-1"
  const alert = errorAlert(page)

  await page.getByLabel("Email").fill(requireEnv("E2E_OWNER_EMAIL"))
  await page.getByLabel("Password").fill(wrongPassword)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(alert).toBeVisible()
  const real = await alert.textContent()

  await page.goto("/auth/sign-in")
  await page.getByLabel("Email").fill(freshEmail())
  await page.getByLabel("Password").fill(wrongPassword)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(alert).toBeVisible()
  const unknown = await alert.textContent()

  expect(real, "no error shown for a wrong password").toBeTruthy()
  expect(
    unknown,
    "a real account and an unknown address produce different messages",
  ).toBe(real)
})

/**
 * Step 20f. Password reset, end to end.
 *
 * Same trick as the confirmation tests: `generateLink` with `type: "recovery"`
 * returns the `hashed_token` the email would have carried, so the whole path —
 * token exchange, recovery session, new password, signing in with it — runs for
 * real without anybody reading an inbox.
 */
test("a reset link sets a new password, and the new password works", async ({
  browser,
}) => {
  const email = freshEmail()
  const newPassword = "solarity2reset"

  // Its own context, because this test signs in and must not inherit or leave a
  // session that changes what another test sees.
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto("/auth/sign-up")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PASSWORD)
    await page.getByLabel("Confirm password").fill(GOOD_PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/auth\/check-email/)

    // Confirm first, so the account is in the state a real person resets from.
    const { data: confirmLink } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password: GOOD_PASSWORD,
    })
    await page.goto(
      `/auth/confirm?token_hash=${confirmLink?.properties?.hashed_token}&type=email`,
    )
    await expect(page).toHaveURL(/\/onboarding$/)

    // Sign out, because resetting is something you do when you cannot get in.
    await page.goto("/auth/sign-in")

    const { data: recovery, error } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    })
    expect(error, "generateLink refused a recovery link").toBeNull()
    const tokenHash = recovery?.properties?.hashed_token
    expect(tokenHash, "no hashed_token to reset with").toBeTruthy()

    /**
     * **The `next` is what the email template carries**, and it is the reason
     * one route serves both flows: `type=recovery` verifies, then hands over to
     * the page named here. Getting this wrong in the dashboard sends people to
     * the dashboard with a live recovery session and no way to finish.
     */
    await page.goto(
      `/auth/confirm?token_hash=${tokenHash}&type=recovery&next=/auth/reset-password`,
    )
    await expect(page).toHaveURL(/\/auth\/reset-password$/)
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible()

    await page.getByLabel("New password", { exact: true }).fill(newPassword)
    await page.getByLabel("Confirm password").fill(newPassword)
    await page.getByRole("button", { name: "Set new password" }).click()

    // Straight into the app: they are already authenticated, so asking them to
    // sign in with a password set two seconds ago would be ceremony.
    await expect(page).toHaveURL(/\/onboarding$/)

    /**
     * **The assertion that makes this test worth having.** Everything above is
     * satisfied by a form that navigates correctly and changes nothing. Signing
     * in with the new password is the only proof it was written.
     */
    /**
     * **Cookies cleared rather than signing out through the UI.** The first
     * version clicked a Sign out button inside a `.catch(() => {})`, which is a
     * swallowed failure pretending to be a step: after a reset they are signed
     * in, so `/auth/sign-in` redirects and no such button exists. An empty
     * catch turns "this never ran" and "this failed" into the same silence.
     */
    await context.clearCookies()

    await page.goto("/auth/sign-in")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill(newPassword)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(page).not.toHaveURL(/\/auth\/sign-in/)

    // And the old one no longer does, which is the other half of "changed".
    await context.clearCookies()
    await page.goto("/auth/sign-in")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password").fill(GOOD_PASSWORD)
    await page.getByRole("button", { name: "Sign in" }).click()
    await expect(errorAlert(page)).toBeVisible()
  } finally {
    await deleteByEmail(email)
    await context.close()
  }
})

test("asking for a reset says the same thing for any address", async ({ page }) => {
  /**
   * **The one screen where a leak is easiest**, because a reset form is
   * *expected* to know whether it found you. A real address and one nobody has
   * registered must produce identical copy — and a rate-limited request must
   * too, which is why the action swallows that refusal rather than reporting it.
   */
  await page.goto("/auth/forgot-password")
  await page.getByLabel("Email").fill(requireEnv("E2E_OWNER_EMAIL"))
  await page.getByRole("button", { name: "Send a reset link" }).click()
  const real = await page.getByText(/reset link is on its way/i).textContent()
  expect(real, "no confirmation shown for a real address").toBeTruthy()

  await page.goto("/auth/forgot-password")
  await page.getByLabel("Email").fill(freshEmail())
  await page.getByRole("button", { name: "Send a reset link" }).click()
  const unknown = await page.getByText(/reset link is on its way/i).textContent()

  expect(
    unknown,
    "a registered address and an unknown one are answered differently",
  ).toBe(real)
})

test("a reset page with no session offers a new link rather than a form", async ({
  browser,
}) => {
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto("/auth/reset-password")

    // Not a 404 and not a broken form: the honest reading of "no session here"
    // is that the link expired, and the only useful thing to offer is another.
    await expect(page.getByRole("heading", { name: /link has expired/i })).toBeVisible()
    await expect(page.getByRole("link", { name: "Send a new link" })).toBeVisible()

    /**
     * **This passed for the wrong reason until the label fix.** The field was
     * accessibly named "New password At least 8 characters…", so this locator
     * matched nothing anywhere, on any page — a count of zero that proved only
     * that the locator was broken. The two assertions above are what kept the
     * test honest in the meantime; this one now costs something.
     */
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0)
  } finally {
    await context.close()
  }
})

/**
 * Step 20c. The terms interstitial, on an account built for it.
 *
 * **The state it needs cannot occur through the front door.** A signup records
 * acceptance inside `complete_onboarding`, so the only accounts that meet this
 * screen are ones that had a username *before* migration 105 existed. That is
 * constructed here: sign up, confirm, onboard, then null the columns.
 *
 * **Not tested on the fixture accounts, deliberately.** They are pushed past
 * this screen in `auth.setup.ts`, and a test that accepted on their behalf
 * would consume the exact state it was asserting — the second run would pass
 * for the wrong reason.
 */
test("an account created before the terms existed is asked once", async ({
  browser,
}) => {
  const email = freshEmail()
  const context = await browser.newContext()
  const page = await context.newPage()

  try {
    await page.goto("/auth/sign-up")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(GOOD_PASSWORD)
    await page.getByLabel("Confirm password").fill(GOOD_PASSWORD)
    await page.getByRole("button", { name: "Create account" }).click()
    await expect(page).toHaveURL(/\/auth\/check-email/)

    const { data: link } = await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password: GOOD_PASSWORD,
    })
    await page.goto(
      `/auth/confirm?token_hash=${link?.properties?.hashed_token}&type=email`,
    )
    await expect(page).toHaveURL(/\/onboarding$/)

    // A username, which is what makes the terms screen the *next* step rather
    // than a screen queued behind onboarding.
    // The real label and the real button, checked against
    // `onboarding-form.tsx` rather than guessed — the first draft of this test
    // invented `getByLabel("Username")` and a regex over three possible button
    // names, which would have failed as "element not found" and read like a
    // broken redirect.
    const username = `e2e${Date.now().toString(36)}`.slice(0, 20)
    await page.getByLabel("Pick a username").fill(username)
    await page.getByRole("button", { name: "Continue" }).click()
    await expect(page).not.toHaveURL(/\/onboarding$/)

    const userId = await userIdByEmail(email)

    /**
     * **A goal, so the account is complete in every way except terms.**
     *
     * Step 25 added a second gate: `(app)/(shell)/layout.tsx` sends an account
     * that has never created a goal to `/onboarding/goal`. This account had
     * just been made and had none, so the two `/dashboard` assertions below
     * were landing on the *goal* screen and reporting it as the terms gate
     * misbehaving.
     *
     * **The test's subject is the terms gate**, and a fixture that trips a
     * different one is asserting about two features at once. Giving it a goal
     * is the same move `ensureUnfinishedDay` makes elsewhere: state the
     * precondition rather than inherit it. Third instance today of
     * `patterns.md`, "a new gate is a new precondition for every signed-in
     * test" — and the first where the gate was mine.
     *
     * Written straight to the table rather than through the UI: this is
     * scaffolding for a test about something else, and the `E2E ` prefix means
     * `deleteE2EGoals` reaps it even if the run dies before cleanup.
     */
    const category = await admin
      .from("goal_categories")
      .select("id")
      .limit(1)
      .single()
    const seeded = await admin
      .from("goals")
      .insert({
        user_id: userId,
        title: `E2E terms-gate goal ${Date.now().toString().slice(-6)}`,
        category_id: category.data!.id,
      })
      .select("id")
    expect(seeded.data, "could not seed the goal the shell gate wants").toHaveLength(1)

    /**
     * **And opt out of the `/today` diversion, for the same reason.**
     *
     * Seeding the goal above satisfied one gate and armed another: an account
     * with an unchecked goal has an unfinished day, so step 9b sends it to
     * `/today` instead of the dashboard. A fresh account defaults to
     * `once_daily`; the three fixture accounts are set to `never` by
     * `auth.setup.ts` for exactly this reason, and this one is fabricated here
     * so it has to do it itself.
     *
     * **The lesson is the general one**: a test that mints its own account owes
     * it every precondition the shared fixtures are given, and `auth.setup.ts`
     * is the list of what those are. Fixing one gate collision by creating
     * another is the shape to watch for.
     */
    const quieted = await admin
      .from("users")
      .update({ today_screen_mode: "never" })
      .eq("id", userId)
      .select("id")
    expect(quieted.data, "could not opt the account out of /today").toHaveLength(1)

    // **Now make it look like an account that predates migration 105.**
    const cleared = await admin
      .from("users")
      .update({ terms_accepted_at: null, terms_accepted_version: null })
      .eq("id", userId)
      .select("id")
    expect(cleared.data, "could not clear the acceptance columns").toHaveLength(1)

    // The gate now stands between them and every signed-in screen.
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/onboarding\/terms$/)
    await expect(
      page.getByRole("heading", { name: "Before you carry on" }),
    ).toBeVisible()

    await page.getByRole("button", { name: "I agree" }).click()
    await expect(page).toHaveURL(/\/dashboard$/)

    // **Asked once, not on every navigation**, which is the difference between
    // a gate and a nag.
    await page.goto("/dashboard")
    await expect(page).toHaveURL(/\/dashboard$/)

    // And recorded, with the version rather than only a timestamp: a date alone
    // cannot answer "agreed to which terms".
    const { data: after } = await admin
      .from("users")
      .select("terms_accepted_at, terms_accepted_version")
      .eq("id", userId)
      .single()
    expect(after?.terms_accepted_at, "agreeing recorded nothing").toBeTruthy()
    expect(after?.terms_accepted_version).toBe(TERMS_VERSION)

    // The URL is a dead end afterwards rather than asking a second time.
    await page.goto("/onboarding/terms")
    await expect(page).toHaveURL(/\/dashboard$/)
  } finally {
    await deleteByEmail(email)
    await context.close()
  }
})
