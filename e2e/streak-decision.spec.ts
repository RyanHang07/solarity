import { test, expect, type Browser } from "@playwright/test"
import {
  circleName,
  clearRateLimits,
  deleteE2ECircles,
  findCircleByName,
  setGroupStreak,
} from "./db"
import { statePath } from "./auth-state"

const OWNER = statePath("owner")
const JOINER = statePath("joiner")

const STREAK = 14

/**
 * Builds the one situation 7e exists for: a Circle already on a streak, which
 * someone then joins.
 *
 * The streak is written with the service key because there is no way to earn 14
 * days inside a test. Everything after that point goes through the UI.
 */
async function circleOnAStreakWithAJoiner(browser: Browser) {
  const ownerContext = await browser.newContext({ storageState: OWNER })
  const ownerPage = await ownerContext.newPage()

  const name = circleName("streak")
  await ownerPage.goto("/dashboard")
  await ownerPage.getByLabel("Start a Circle").fill(name)
  await ownerPage.getByRole("button", { name: "Create Circle" }).click()
  await expect(ownerPage.getByRole("link", { name })).toBeVisible()

  const circle = await findCircleByName(name)
  if (!circle) throw new Error(`Circle ${name} was not created`)
  await setGroupStreak(circle.id, STREAK)

  await ownerPage.getByRole("link", { name }).click()
  await ownerPage.getByRole("link", { name: "Settings" }).click()
  await ownerPage.getByRole("button", { name: "Generate link" }).click()

  // Wait for an absolute URL. The panel renders `/join/<token>` on the server
  // and swaps in `location.origin` at hydration, so reading a moment early
  // returns a relative path and `new URL(link)` throws two lines below with an
  // error that says nothing about hydration.
  const code = ownerPage.locator("code")
  await expect(code).toHaveText(/^https?:\/\/\S+\/join\/\S+$/)
  const link = (await code.innerText()).trim()

  const joinerContext = await browser.newContext({ storageState: JOINER })
  const joinerPage = await joinerContext.newPage()
  await joinerPage.goto(new URL(link).pathname)
  await joinerPage.getByRole("button", { name: new RegExp(`Join ${name}`) }).click()
  await expect(joinerPage).toHaveURL(/\/circles\//)

  return { name, circleId: circle.id, ownerPage, joinerPage, ownerContext, joinerContext }
}

// 3 Circles here against a cap of 5 a day. See invite.spec.ts.
test.beforeAll(async () => {
  await clearRateLimits()
})

test.afterAll(async () => {
  await deleteE2ECircles()
})

test("the joiner is visibly not counted, to everyone", async ({ browser }) => {
  const s = await circleOnAStreakWithAJoiner(browser)

  // The half that matters most. Without it the Circle silently stops counting
  // someone and the roster looks identical to one where it does not.
  await expect(s.joinerPage.getByText(/settling in, not counted yet/i)).toBeVisible()

  // A member sees the marker but is not asked to decide.
  await expect(
    s.joinerPage.getByRole("heading", { name: /decision is waiting/i }),
  ).toHaveCount(0)

  await s.joinerContext.close()
  await s.ownerContext.close()
})

test("the owner keeps the streak", async ({ browser }) => {
  const s = await circleOnAStreakWithAJoiner(browser)

  await s.ownerPage.goto(`/circles/${s.circleId}`)
  await expect(
    s.ownerPage.getByRole("heading", { name: /decision is waiting/i }),
  ).toBeVisible()
  // Scoped to the banner's sentence. `/14 day streak/` alone also matches the
  // "Keep the 14 day streak" button, and Playwright's strict mode fails on two
  // matches rather than picking one.
  await expect(
    s.ownerPage.getByText(new RegExp(`was on a ${STREAK} day streak`)),
  ).toBeVisible()

  await s.ownerPage.getByRole("button", { name: `Keep the ${STREAK} day streak` }).click()

  // Banner gone, grace over, streak intact.
  await expect(
    s.ownerPage.getByRole("heading", { name: /decision is waiting/i }),
  ).toHaveCount(0)
  await expect(s.ownerPage.getByText(/settling in, not counted yet/i)).toHaveCount(0)
  // Read from the group-streak figure rather than by text search: `14` on its
  // own matches a member's day count too.
  const kept = await findCircleByName(s.name)
  expect(kept?.streak_decision_pending).toBe(false)

  await s.joinerContext.close()
  await s.ownerContext.close()
})

test("resetting asks first, and cancelling changes nothing", async ({ browser }) => {
  const s = await circleOnAStreakWithAJoiner(browser)

  await s.ownerPage.goto(`/circles/${s.circleId}`)
  await s.ownerPage.getByRole("button", { name: "Start everyone over at 0" }).click()

  // Naming the consequence, not asking "are you sure". This wipes a number
  // every member earned, and there is no undo.
  await expect(s.ownerPage.getByText(/for.*everyone.*including members who earned it/i))
    .toBeVisible()

  await s.ownerPage.getByRole("button", { name: "Cancel" }).click()

  const stillPending = await findCircleByName(s.name)
  expect(stillPending?.streak_decision_pending).toBe(true)

  // Now go through with it.
  await s.ownerPage.getByRole("button", { name: "Start everyone over at 0" }).click()
  await s.ownerPage.getByRole("button", { name: "Reset for everyone" }).click()

  await expect(
    s.ownerPage.getByRole("heading", { name: /decision is waiting/i }),
  ).toHaveCount(0)

  const resolved = await findCircleByName(s.name)
  expect(resolved?.streak_decision_pending).toBe(false)

  await s.joinerContext.close()
  await s.ownerContext.close()
})
