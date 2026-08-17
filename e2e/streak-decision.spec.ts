import { test, expect, type Browser } from "@playwright/test"
import {
  createCircleViaApi,
  deleteE2ECircles,
  findCircleByName,
  inviteTokenFor,
  requireEnv,
  setGroupStreak,
} from "./db"
import { storageStateFor } from "./session"

const STREAK = 14

/**
 * Builds the one situation 7e exists for: a Circle already on a streak, which
 * someone then joins.
 *
 * The streak is written with the service key because there is no way to earn 14
 * days inside a test. Everything after that point goes through the UI.
 */
async function circleOnAStreakWithAJoiner(browser: Browser) {
  const ownerEmail = requireEnv("E2E_OWNER_EMAIL")

  // Built through the API. The dashboard form is metered at 5 Circles a day and
  // is covered by `invite.spec.ts`; this file needs a Circle to exist, not to
  // re-test how one is made. See `createCircleViaApi`.
  const { name, groupId } = await createCircleViaApi(ownerEmail, "streak")
  await setGroupStreak(groupId, STREAK)

  const token = await inviteTokenFor(ownerEmail, groupId)

  const ownerContext = await browser.newContext({
    storageState: await storageStateFor(ownerEmail),
  })
  const ownerPage = await ownerContext.newPage()

  // The joiner still joins through the UI: the grace state it produces is what
  // this file is about, so that step stays a real one.
  const joinerContext = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_JOINER_EMAIL")),
  })
  const joinerPage = await joinerContext.newPage()
  await joinerPage.goto(`/join/${token}`)
  await joinerPage.getByRole("button", { name: new RegExp(`Join ${name}`) }).click()
  await expect(joinerPage).toHaveURL(/\/circles\//)

  return { name, circleId: groupId, ownerPage, joinerPage, ownerContext, joinerContext }
}

test.afterAll(async () => {
  await deleteE2ECircles()
})

test("the joiner is visibly not counted, to everyone", async ({ browser }) => {
  const s = await circleOnAStreakWithAJoiner(browser)

  // The half that matters most. Without it the Circle silently stops counting
  // someone and the roster looks identical to one where it does not.
  //
  // Matched loosely on purpose: the marker now appears on both tabs, worded
  // fully on `Members` and short on `Today`, and this test cares that it is
  // there rather than which tab happens to be the default this month.
  await expect(s.joinerPage.getByText(/settling in/i)).toBeVisible()

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
  await expect(s.ownerPage.getByText(/settling in/i)).toHaveCount(0)
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
