import { test, expect } from "@playwright/test"
import { clearRateLimits } from "./db"

/**
 * Step 7f. `/join/[token]` is the only endpoint in the app a stranger can reach
 * without an account, and `circle_preview` answers "is this token real" for
 * free, so it is the one place enumeration is worth bounding.
 *
 * **Signed out on purpose.** The limits key on client IP and on a hash of the
 * token, never on a user id, precisely so they apply to someone who has not
 * signed in.
 *
 * **This spec deliberately exhausts a budget every other spec shares.** With
 * one worker the files run alphabetically, so it lands between `invite` and
 * `streak-decision` rather than last. That is safe only because it clears the
 * limits in `afterAll` and `streak-decision` clears them again in its
 * `beforeAll`; do not remove either on the grounds that the other exists.
 */
test.use({ storageState: { cookies: [], origins: [] } })

// A full budget going in, and a clean one going out. Without the second, the
// specs that ran earlier would fail on the limiter if you re-ran the suite.
test.beforeAll(async () => {
  await clearRateLimits()
})
test.afterAll(async () => {
  await clearRateLimits()
})

const LIMIT_MESSAGE = /too many invite links/i
const DEAD_LINK = /no longer valid/i

test("a machine trying many tokens is cut off, and told why", async ({ page }) => {
  // The first attempt must behave normally. Asserting this before the loop
  // means a test that passes because *everything* is refused cannot go
  // unnoticed.
  await page.goto("/join/probe-token-0")
  await expect(page).toHaveURL(/\/\?notice=invite-invalid/)
  await expect(page.getByText(DEAD_LINK)).toBeVisible()

  // A distinct token each time. Sharing one would exercise the per-token limit
  // instead, and the point here is the per-IP limit.
  //
  // Looping to a bound rather than asserting on attempt 21: a page load is not
  // guaranteed to be exactly one request, and pinning the count would make this
  // a test of Next's rendering rather than of the limiter.
  let limitedAt = 0
  for (let attempt = 1; attempt <= 40 && !limitedAt; attempt++) {
    await page.goto(`/join/probe-token-${attempt}`)
    if (await page.getByText(LIMIT_MESSAGE).isVisible()) limitedAt = attempt
  }

  expect(limitedAt, "the per-IP invite limit never triggered in 40 attempts").toBeGreaterThan(0)

  // The refusal has to be honest. Saying "this invite is no longer valid" about
  // a link that is fine sends people back to the inviter for a replacement they
  // do not need, and the message says so along with how long to wait.
  await expect(page.getByText(LIMIT_MESSAGE)).toBeVisible()
  await expect(page.getByText(/hasn't expired/i)).toBeVisible()
  await expect(page.getByText(/wait \d+ minute/i)).toBeVisible()

  // Refused, not redirected. A redirect would lose the explanation.
  expect(page.url()).toContain("/join/")
  await expect(page.getByText(DEAD_LINK)).toHaveCount(0)
})

test("clearing the budget restores access", async ({ page }) => {
  // Proves the previous test failed on the limiter rather than on something
  // that would refuse forever. Without this, a broken preview page would look
  // identical to a working limiter.
  //
  // **This only works because `lib/ratelimit.ts` sets `ephemeralCache: false`.**
  // Left on, `@upstash/ratelimit` caches a refusal in the server process for
  // the rest of the window and answers from memory without consulting Redis,
  // so clearing keys here changes nothing and every later spec inherits the
  // block. If this test starts failing while the one above passes, check that
  // setting before suspecting anything else.
  await clearRateLimits()

  await page.goto("/join/probe-token-after-reset")
  await expect(page).toHaveURL(/\/\?notice=invite-invalid/)
  await expect(page.getByText(DEAD_LINK)).toBeVisible()
})
