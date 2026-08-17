import { test, expect, type Browser, type Page } from "@playwright/test"
import {
  admin,
  assertOk,
  createCircleViaApi,
  deleteE2ECircles,
  deleteE2EGoals,
  parkActiveGoals,
  inviteTokenFor,
  requireEnv,
  restoreGoalSlots,
  restoreParkedGoals,
  sessionFor,
  userIdByEmail,
} from "./db"
import { storageStateFor } from "./session"
import { diagnose } from "./diagnose"

/**
 * Step 8b and 8c: the `Today` tab, and `Members` moving out of the default.
 *
 * The masking is proven at the API in `masking.spec.ts`. This proves the page
 * built on top of it renders the right thing, including the case that matters
 * most: a hidden goal's title must be absent from the **HTML**, not merely
 * absent from the screen. Those are different claims, and only one of them
 * survives someone opening view-source.
 */

const VISIBLE_TITLE = "E2E ROSTER VISIBLE GOAL"
const HIDDEN_TITLE = "E2E ROSTER HIDDEN GOAL"
const SHARED_NOTE = "E2E ROSTER SHARED NOTE"

/**
 * Two long-lived contexts, one per account, opened once for the whole file.
 *
 * Previously each test opened its own pair. That meant twelve contexts and
 * twelve sessions a run, which is what exhausted Supabase's hourly auth budget
 * and produced the mid-run sign-outs. Contexts are cheap; sessions are not.
 */
let ctx: {
  ownerPage: Page
  joinerPage: Page
  close: () => Promise<void>
} | null = null

async function pages(browser: Browser) {
  if (ctx) return ctx

  const ownerCtx = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_OWNER_EMAIL")),
  })
  const joinerCtx = await browser.newContext({
    storageState: await storageStateFor(requireEnv("E2E_JOINER_EMAIL")),
  })

  ctx = {
    ownerPage: await ownerCtx.newPage(),
    joinerPage: await joinerCtx.newPage(),
    close: async () => {
      await ownerCtx.close()
      await joinerCtx.close()
      ctx = null
    },
  }
  return ctx
}

/**
 * A Circle the joiner owns, with two of their goals: one visible and checked
 * off with a shared note, one hidden and not.
 *
 * **Built through the API, not the dashboard form.** `enforce("createCircle")`
 * lives in the server action, so the RPC path spends none of the 5-a-day
 * budget. A test that needs a Circle in order to assert something else should
 * not also be re-testing Circle creation, and paying a quota to do it.
 * `invite.spec.ts` covers the form, which is where that belongs.
 *
 * The **joiner** owns it deliberately: the interesting assertions are what the
 * *other* person sees, so the data has to belong to someone who is not looking.
 */
async function circleWithGoals(browser: Browser) {
  const joinerEmail = requireEnv("E2E_JOINER_EMAIL")
  const joinerId = await userIdByEmail(joinerEmail)
  const { ownerPage, joinerPage } = await pages(browser)

  const { groupId, name } = await createCircleViaApi(joinerEmail, "roster")
  const token = await inviteTokenFor(joinerEmail, groupId)

  const ownerClient = await sessionFor(requireEnv("E2E_OWNER_EMAIL"))
  const joined = await ownerClient.rpc("join_circle", { p_token: token })
  if (joined.error) throw new Error(`join_circle: ${joined.error.message}`)

  const category = await admin.from("goal_categories").select("id").limit(1).single()
  assertOk(category, "read a goal category")

  const plan: { title: string; hidden: boolean }[] = [
    { title: VISIBLE_TITLE, hidden: false },
    { title: HIDDEN_TITLE, hidden: true },
  ]

  // Every other active goal of theirs goes away for the duration.
  //
  // Not merely "free two slots". These tests assert a member's row reads
  // "1 of 2", which is a claim about the account and not about the fixture: the
  // moment the joiner had two goals of their own the row read "2 of 4" and four
  // tests failed on a locator that no longer matched anything. A count is only
  // deterministic if the fixture owns the whole list.
  const parked = await parkActiveGoals(joinerId)
  const goalIds: string[] = []

  // Everything from here on can throw, and a throw before `return` means no
  // test body runs and therefore no `cleanup` does either. Undoing it here is
  // the only place that sees both `goalIds` and `parked`.
  try {
    for (const { title, hidden } of plan) {
      // A plain `if` rather than `assertOk`. An assertion function narrowing a
      // loop-scoped `const` whose type is still being inferred makes TypeScript
      // report a circularity; the explicit check narrows the same union without
      // participating in the inference.
      const created = await admin
        .from("goals")
        .insert({ user_id: joinerId, title, category_id: category.data.id })
        .select("id")
        .single()
      if (created.error) {
        throw new Error(`create ${title} failed: ${created.error.message}`)
      }
      const goalId: string = created.data.id
      goalIds.push(goalId)
      if (hidden) {
        await admin
          .from("goal_group_visibility")
          .insert({ goal_id: goalId, group_id: groupId, hidden: true })
      }
    }

    // The date comes from the joiner's OWN session, not from `admin`. The service
    // role has no `auth.uid()`, so `current_checkin_date()` answers for nobody and
    // falls back to UTC; writing that date and then asserting against a roster
    // computed in the member's real timezone fails whenever the two differ.
    const joinerSession = await sessionFor(joinerEmail)
    const dateRes = await joinerSession.rpc("current_checkin_date")
    if (dateRes.error) throw new Error(`current_checkin_date: ${dateRes.error.message}`)

    const entry = await admin
      .from("progress_entries")
      .insert({
        goal_id: goalIds[0],
        user_id: joinerId,
        check_in_date: dateRes.data as string,
        note: SHARED_NOTE,
        note_shared: true,
      })
      .select("id")
      .single()
    if (entry.error) throw new Error(`check the visible goal off: ${entry.error.message}`)
  } catch (seedFailure) {
    await cleanup({ groupId, name, ownerPage, joinerPage, goalIds, parked })
    throw seedFailure
  }

  return { groupId, name, ownerPage, joinerPage, goalIds, parked }
}

async function cleanup(s: Awaited<ReturnType<typeof circleWithGoals>>) {
  // Contexts are NOT closed here: they belong to the file, not to one test.
  for (const id of s.goalIds) {
    await admin.from("progress_entries").delete().eq("goal_id", id)
    await admin.from("goal_group_visibility").delete().eq("goal_id", id)
    await admin.from("goals").delete().eq("id", id)
  }
  await deleteE2ECircles()
  await restoreGoalSlots(s.parked)
}

test("the Today tab is the default, and the other two are addressable", async ({
  browser,
}) => {
  const s = await circleWithGoals(browser)
  try {
    const p = s.ownerPage

    // 8c: a bare Circle URL used to land on Members. It now lands on Today.
    await p.goto(`/circles/${s.groupId}`)
    await expect(p.getByRole("link", { name: "Today" })).toBeVisible()
    await expect(p.getByText(/counted in their own timezone/i)).toBeVisible()

    await p.goto(`/circles/${s.groupId}?tab=members`)
    await expect(p.getByText(/Streaks update at each member/i)).toBeVisible()

    // The digest tab, which `sw.js` deep-links to and must not have moved.
    await p.goto(`/circles/${s.groupId}?tab=overview`)
    await expect(p.getByText(/No digests yet|complete/i).first()).toBeVisible()
  } finally {
    await cleanup(s)
  }
})

test("the roster counts, expands, and never ships a hidden title", async ({
  browser,
}) => {
  const s = await circleWithGoals(browser)
  try {
    const p = s.ownerPage
    await p.goto(`/circles/${s.groupId}`)

    // You first: the owner is looking, so their own row leads even though the
    // joiner created the Circle and joined first.
    const rows = p.getByRole("button", { expanded: false })
    await expect(rows.first()).toContainText("(you)")

    // Members are named by username, not by display name.
    //
    // The guard on the change that made this so. `display_name` is not unique,
    // and both test accounts hold the same one, so a roster that led with it
    // rendered two identical rows: unreadable in a Circle whose job is telling
    // friends apart, and an impersonation route, since anyone can set theirs to
    // match a friend's. Asserting the *username* is present is what keeps the
    // coalesce from being flipped back.
    const memberIds = await Promise.all([
      userIdByEmail(requireEnv("E2E_JOINER_EMAIL")),
      userIdByEmail(requireEnv("E2E_OWNER_EMAIL")),
    ])
    const names = await admin
      .from("users")
      .select("id, username")
      .in("id", memberIds)
    assertOk(names, "read both members' names")

    for (const u of names.data) {
      if (!u.username) throw new Error(`${u.id} has no username`)
      // Scoped to the roster's list items, not the page. The header already
      // prints your own username, so a page-wide search would pass for the
      // person doing the looking no matter what the roster rendered.
      await expect(
        p.getByRole("listitem").filter({ hasText: u.username }).first(),
        `the roster does not name ${u.username}`,
      ).toBeVisible()
    }

    // The other member: one of two goals done.
    const theirRow = p.getByRole("button").filter({ hasText: "1 of 2" })
    await expect(theirRow).toBeVisible()

    await theirRow.click()
    await expect(p.getByText(VISIBLE_TITLE)).toBeVisible()
    await expect(p.getByText("Hidden goal")).toBeVisible()
    await expect(p.getByText(SHARED_NOTE)).toBeVisible()

    // The assertion this file exists for. `toBeVisible` would pass on a title
    // that is present but styled away; this reads the delivered HTML.
    expect(await p.content(), "a hidden goal's title reached the browser").not.toContain(
      HIDDEN_TITLE,
    )
  } finally {
    await cleanup(s)
  }
})

test("an archived Circle shows its final standing, not today", async ({ browser }) => {
  const s = await circleWithGoals(browser)
  try {
    // Archived by its owner, which is the joiner here.
    const archived = await admin.rpc("archive_circle", {
      p_group_id: s.groupId,
    })
    // The RPC is owner-only and the service role has no auth.uid(), so this is
    // expected to refuse; archive through the database instead.
    if (archived.error) {
      await admin.from("groups").update({ group_status: "archived" }).eq("id", s.groupId)
      await admin
        .from("group_cycles")
        .update({ ended_at: new Date(Date.now() - 60_000).toISOString() })
        .eq("group_id", s.groupId)
        .is("ended_at", null)
    }

    const p = s.ownerPage
    await p.goto(`/circles/${s.groupId}`)

    await expect(p.getByText(/Final standing/i)).toBeVisible()
    await expect(p.getByText(/stopped changing/i)).toBeVisible()

    // The frozen numbers are still the real ones from the day it closed, so the
    // count has to survive: freezing must not mean blanking.
    await expect(p.getByRole("button").filter({ hasText: "1 of 2" })).toBeVisible()
  } finally {
    await cleanup(s)
  }
})

test("you can stop sharing your own note, and only your own", async ({ browser }) => {
  const s = await circleWithGoals(browser)
  try {
    // The note belongs to the joiner, so they are the one who can retract it.
    const mine = s.joinerPage
    const theirs = s.ownerPage

    await mine.goto(`/circles/${s.groupId}`)
    await mine.getByRole("button").filter({ hasText: "1 of 2" }).click()
    await expect(mine.getByText(SHARED_NOTE)).toBeVisible()

    // The other member sees it before, which is what makes the retraction
    // meaningful rather than a no-op on an invisible row.
    await theirs.goto(`/circles/${s.groupId}`)
    await theirs.getByRole("button").filter({ hasText: "1 of 2" }).click()
    await expect(theirs.getByText(SHARED_NOTE)).toBeVisible()

    // Nobody else gets the control, on their row or anyone's.
    await expect(
      theirs.getByRole("button", { name: /Stop sharing/i }),
      "the control appeared on someone else's note",
    ).toHaveCount(0)

    await mine.getByRole("button", { name: /Stop sharing/i }).click()
    await expect(
      mine.getByRole("button", { name: /Share with your Circles/i }),
    ).toBeVisible()
    await expect(mine.getByText(/only you can see this/i)).toBeVisible()

    // Retroactive: no backfill, the flag is read at query time.
    await theirs.reload()
    await theirs.getByRole("button").filter({ hasText: "1 of 2" }).click()
    await expect(theirs.getByText(SHARED_NOTE)).toHaveCount(0)

    // And it goes back, so an accidental tap is not a one-way door.
    await mine.getByRole("button", { name: /Share with your Circles/i }).click()
    await expect(mine.getByRole("button", { name: /Stop sharing/i })).toBeVisible()
  } finally {
    await cleanup(s)
  }
})

test("an archived Circle offers no sharing controls", async ({ browser }) => {
  const s = await circleWithGoals(browser)
  try {
    await admin.from("groups").update({ group_status: "archived" }).eq("id", s.groupId)
    await admin
      .from("group_cycles")
      .update({ ended_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("group_id", s.groupId)
      .is("ended_at", null)

    const mine = s.joinerPage
    await mine.goto(`/circles/${s.groupId}`)
    await mine.getByRole("button").filter({ hasText: "1 of 2" }).click()

    // The note is still there, because the frozen roster is history rather than
    // a blank. What is gone is the offer to change it, since nothing on a
    // closed Circle can change and a control that silently does nothing is
    // worse than no control.
    await expect(mine.getByText(SHARED_NOTE)).toBeVisible()
    await expect(mine.getByRole("button", { name: /sharing/i })).toHaveCount(0)
  } finally {
    await cleanup(s)
  }
})

test("a note written at check-in reaches the Circle only when shared", async ({
  browser,
}) => {
  // 8e, end to end: the `+ note` field on the dashboard, through to what a
  // circle-mate sees on the roster. The pieces are tested separately; this is
  // the one path a person actually walks.
  const s = await circleWithGoals(browser)
  const joinerId = await userIdByEmail(requireEnv("E2E_JOINER_EMAIL"))
  const extraGoals: string[] = []

  try {
    const category = await admin.from("goal_categories").select("id").limit(1).single()
    assertOk(category, "read a goal category")

    // Two more goals for the note-writer: one note shared, one kept private.
    const plan: { title: string; note: string; share: boolean }[] = [
      {
        title: "E2E NOTE SHARED GOAL",
        note: "E2E NOTE THAT IS SHARED",
        share: true,
      },
      {
        title: "E2E NOTE PRIVATE GOAL",
        note: "E2E NOTE THAT IS PRIVATE",
        share: false,
      },
    ]

    for (const item of plan) {
      const created = await admin
        .from("goals")
        .insert({
          user_id: joinerId,
          title: item.title,
          category_id: category.data.id,
        })
        .select("id")
        .single()
      if (created.error) throw new Error(`create ${item.title}: ${created.error.message}`)
      extraGoals.push(created.data.id)
    }

    const mine = s.joinerPage
    const report = diagnose(mine)
    await mine.goto("/dashboard")

    for (const item of plan) {
      const row = mine.locator("li").filter({ hasText: item.title })
      await row.getByRole("button", { name: "+ note" }).click()

      // The fast path is untouched: the field only exists once asked for.
      const box = row.getByRole("textbox", { name: `Note for ${item.title}` })
      await expect(box).toBeVisible()
      await box.fill(item.note)

      if (item.share) {
        await row.getByRole("checkbox").check()
      }
      await row.getByRole("button", { name: "Check in" }).click()

      // Named, because the bare form of this said only "element(s) not found"
      // while the row sat on its disabled pending label. A check-in that never
      // resolves is a server action that failed, and the reason is in the
      // console or in the action's POST, neither of which reaches a Playwright
      // assertion unless something is listening.
      await expect(
        row.getByRole("button", { name: "Undo" }),
        `Checking in "${item.title}" never resolved.\n\n${report()}`,
      ).toBeVisible()
    }

    // Both notes were stored; only one was marked shared. Asserted against the
    // database, because "what the screen shows" is the next assertion's job.
    const stored = await admin
      .from("progress_entries")
      .select("note, note_shared")
      .in("goal_id", extraGoals)
    assertOk(stored, "read the stored notes")
    expect(stored.data.map((e) => e.note_shared).sort()).toEqual([false, true])

    // And the Circle sees exactly one of them.
    //
    // A fresh context, rather than the one the helper opened. That one has sat
    // idle through two UI check-ins, and a session left waiting is a session
    // that may have been revoked: Supabase treats a reused refresh token as a
    // compromise and revokes the whole family, not just that token. Minting one
    // here keeps the window a session has to survive as short as it can be.
    const theirs = s.ownerPage
    await theirs.goto(`/circles/${s.groupId}`)
    // Anchored on the member's name, which is the only stable handle here.
    //
    // A bare `getByRole("button")` also matches Next's injected "Open Next.js
    // Dev Tools" control, which contains no "(you)" either, so `.first()` could
    // land on it: the click succeeded, expanded nothing, and the failure read
    // as a missing note rather than as a missed row.
    //
    // Filtering on `expanded: false` would be worse: the locator stops matching
    // the moment the click succeeds, so the follow-up assertion resolves to
    // nothing. A locator used after an interaction must not describe the state
    // that interaction changes.
    // Read from the database with the same `coalesce(username, display_name)`
    // the page uses, rather than hardcoded.
    //
    // This assertion is what found the bug the order now reflects. It first
    // read `username` alone and matched nothing, because the page led with
    // `display_name`; correcting it to `display_name || username` then matched
    // *both* rows, because both accounts belong to one person and share a
    // display name. A roster that cannot tell two members apart is the product
    // bug, not the test's, and `display_name` was never unique enough to carry
    // it. See `today-roster.tsx`.
    const writer = await admin
      .from("users")
      .select("username, display_name")
      .eq("id", joinerId)
      .single()
    if (writer.error) throw new Error(`read the writer: ${writer.error.message}`)
    const writerName = writer.data.username || writer.data.display_name
    if (!writerName) throw new Error("the writer has no name to render")

    // `hasNotText` still earns its place even now the handle is unique: one
    // username can be a prefix of another (`ryahn`, `ryahn2`), and `hasText` is
    // a substring match. "(you)" is what separates the looker from everyone
    // else regardless of what either is called.
    const theirRow = theirs
      .getByRole("listitem")
      .filter({ hasText: writerName })
      .filter({ hasNotText: "(you)" })
      .first()
    await theirRow.getByRole("button").first().click()

    // Proves the row actually opened. Without it, anything that fails to expand
    // reports as "the note is missing", which is what sent this test round four
    // separate wrong diagnoses.
    await expect(
      theirRow.getByRole("button").first(),
      "the member row did not expand",
    ).toHaveAttribute("aria-expanded", "true")

    await expect(theirs.getByText("E2E NOTE THAT IS SHARED")).toBeVisible()
    expect(
      await theirs.content(),
      "a note left private reached a circle-mate",
    ).not.toContain("E2E NOTE THAT IS PRIVATE")
  } finally {
    for (const id of extraGoals) {
      await admin.from("progress_entries").delete().eq("goal_id", id)
      await admin.from("goals").delete().eq("id", id)
    }
    await cleanup(s)
  }
})

// A sweep, not the cleanup: each test already deletes the goals it made. This
// catches the ones a crash left, which are the expensive kind because they sit
// against the 10-active cap and make the *next* run fail at seeding.
test.afterAll(async () => {
  await deleteE2EGoals()

  // The safety net for `parkActiveGoals`. A test that exceeds its timeout is
  // killed without finishing its `finally`, which would leave a real person's
  // goals archived with only the journal file recording which. `afterAll` still
  // runs after a timeout, so this is the first chance to put them back, and
  // `npm run test:e2e:clean` is the second.
  await restoreParkedGoals()

  if (ctx) await ctx.close()
})
