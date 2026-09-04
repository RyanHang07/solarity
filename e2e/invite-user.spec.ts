import { test, expect } from "@playwright/test"
import {
  admin,
  createCircleViaApi,
  deleteE2ECircles,
  inviteTokenFor,
  requireEnv,
  sessionFor,
  userIdByEmail,
} from "./db"
import { storageStateFor } from "./session"

/**
 * Step 18. Inviting a person by name, and the page they land on.
 *
 * **Two guarantees, and they fail differently.** The flow working is visible
 * the moment it does not: nobody gets a notification. The guards are the half
 * that fails silently, so the search assertions here are about what must
 * *not* come back, and each has a control proving the query was capable of
 * returning something.
 *
 * **Writes** one Circle, one invite link and up to two notifications, all
 * removed. The block row is removed in `finally` because a leaked one would
 * make `moderation.spec.ts` pass for the wrong reason.
 */

const OWNER = () => requireEnv("E2E_OWNER_EMAIL")
const JOINER = () => requireEnv("E2E_JOINER_EMAIL")
/** Only ever a *target*: somebody real who is not in the Circle under test. */
const ADMIN = () => requireEnv("E2E_ADMIN_EMAIL")

test.afterAll(async () => {
  await deleteE2ECircles()
})

async function usernameOf(userId: string) {
  const { data } = await admin
    .from("users")
    .select("username")
    .eq("id", userId)
    .single()
  return data!.username!
}

/** Every `invited` row this account has for one Circle, read as the service key. */
async function invitesFor(userId: string, groupId: string) {
  const { data } = await admin
    .from("notifications")
    .select("id, payload")
    .eq("user_id", userId)
    .eq("type", "invited")
  return (data ?? []).filter(
    (n) => (n.payload as { group_id?: string })?.group_id === groupId,
  )
}

async function clearInvites(userId: string, groupId: string) {
  const rows = await invitesFor(userId, groupId)
  if (rows.length) {
    await admin
      .from("notifications")
      .delete()
      .in(
        "id",
        rows.map((r) => r.id),
      )
  }
}

test("an owner finds someone by username and invites them", async ({ browser }) => {
  const joinerId = await userIdByEmail(JOINER())
  const joinerName = await usernameOf(joinerId)

  const { groupId, name } = await createCircleViaApi(OWNER(), "invite by name")
  // The RPC reads a live link rather than minting one, so the Circle needs one
  // before anybody can be invited into it.
  await inviteTokenFor(OWNER(), groupId)
  await clearInvites(joinerId, groupId)

  const context = await browser.newContext({
    storageState: await storageStateFor(OWNER()),
  })
  const page = await context.newPage()

  try {
    await page.goto(`/circles/${groupId}/settings`)
    const panel = page.getByRole("region", { name: "Invite someone" })
    await expect(panel).toBeVisible()

    // **Two characters returns nothing, and the page says why.** The floor is
    // in `search_users`, so this is asserting that the copy and the rule agree
    // rather than that the box is fussy.
    await panel.getByLabel("Search by username").fill(joinerName.slice(0, 2))
    await expect(panel.getByText(/Type at least 3 characters/)).toBeVisible()

    // **The control.** Without it, every "returns nothing" assertion in this
    // file would also pass against a search that never returns anything.
    await panel.getByLabel("Search by username").fill(joinerName)

    /**
     * **Matched on the exact username, not on `hasText`.**
     *
     * This is prefix search, so a query is *supposed* to return every handle
     * that starts with it: `ryahn` legitimately returns `ryahn` and
     * `ryahnadmin`, and `hasText` matched both rows as a strict-mode
     * violation reported as "the search found nobody". The feature was working
     * and the locator was describing a set.
     *
     * Worth keeping in mind for every locator in this file: the three e2e
     * accounts share a prefix on purpose, so anything that finds a row by
     * substring finds the admin account too.
     */
    const row = panel
      .getByRole("listitem")
      .filter({ has: page.getByText(joinerName, { exact: true }) })
    await expect(row, "the search found nobody, so nothing below means anything").toBeVisible({
      timeout: 15_000,
    })

    await row.getByRole("button", { name: `Invite ${joinerName}`, exact: true }).click()
    await expect(row.getByText("Invited")).toBeVisible({ timeout: 15_000 })

    // Asserted at the database, because an optimistic label would satisfy the
    // line above with nothing written.
    const rows = await invitesFor(joinerId, groupId)
    expect(rows.length, "no invite notification was written").toBe(1)

    const payload = rows[0].payload as Record<string, unknown>
    expect(payload.circle_name, "the invite does not name the Circle").toBe(name)
    expect(
      typeof payload.token === "string" && payload.token.length > 0,
      "the invite carries no token, so the notification cannot be acted on",
    ).toBe(true)

    // **The same call again is a no-op, not a second row.** The button will be
    // pressed twice by someone unsure the first worked.
    await page.reload()
    const again = page
      .getByRole("region", { name: "Invite someone" })
      .getByLabel("Search by username")
    await again.fill(joinerName)
    const row2 = page
      .getByRole("region", { name: "Invite someone" })
      .getByRole("listitem")
      .filter({ has: page.getByText(joinerName, { exact: true }) })
    await expect(row2).toBeVisible({ timeout: 15_000 })
    await row2.getByRole("button", { name: `Invite ${joinerName}`, exact: true }).click()
    await expect(row2.getByText("Invited")).toBeVisible({ timeout: 15_000 })

    expect(
      (await invitesFor(joinerId, groupId)).length,
      "inviting twice left two notifications in somebody's list",
    ).toBe(1)
  } finally {
    await clearInvites(joinerId, groupId)
    await context.close()
  }
})

test("the invited person sees it, and the link takes them into the Circle", async ({
  browser,
}) => {
  const ownerId = await userIdByEmail(OWNER())
  const joinerId = await userIdByEmail(JOINER())
  const ownerName = await usernameOf(ownerId)

  const { groupId, name } = await createCircleViaApi(OWNER(), "invite lands")
  await inviteTokenFor(OWNER(), groupId)
  await clearInvites(joinerId, groupId)

  const owner = await sessionFor(OWNER())
  const { error } = await owner.rpc("invite_user_to_circle", {
    p_group_id: groupId,
    p_user_id: joinerId,
  })
  expect(error, "the invite RPC refused a legitimate invite").toBeNull()

  const context = await browser.newContext({
    storageState: await storageStateFor(JOINER()),
  })
  const page = await context.newPage()

  try {
    await page.goto("/dashboard/notifications")
    const panel = page.getByRole("region", { name: "Notifications" })

    // Named by the person, not just the Circle: an invite from nobody in
    // particular reads as an invite from a stranger.
    const link = panel.getByRole("link", {
      name: new RegExp(`${ownerName} invited you to ${name}`),
    })
    await expect(link, "the invite is not in the notifications tab").toBeVisible()

    await link.click()

    // **The join page, not the Circle page.** They are not a member yet, so
    // `/circles/<id>` would bounce them straight back out.
    await expect(page).toHaveURL(/\/join\//)
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible()

    // Step 18c: who is already inside.
    const already = page.getByRole("region", { name: "Already here" })
    await expect(already, "the join page does not say who is in the Circle").toBeVisible()
    await expect(already.getByText(ownerName, { exact: true })).toBeVisible()
    await expect(already.getByText("owner")).toBeVisible()

    // And it is a real invite, not a description of one.
    await page.getByRole("button", { name: /Join/ }).click()
    await expect(page).toHaveURL(new RegExp(`/circles/${groupId}`), { timeout: 15_000 })
  } finally {
    await admin
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", joinerId)
    await clearInvites(joinerId, groupId)
    await context.close()
  }
})

/**
 * The refusals, at the database, as a real signed-in user.
 *
 * Through PostgREST rather than through the screen: the panel renders whatever
 * `toMessage` gives it, and what matters here is that the RPC refuses at all
 * and refuses with a hint that has copy. A screen test would pass on a
 * refusal for the wrong reason.
 */
test("the invite RPC refuses what it should, and says which", async () => {
  const ownerId = await userIdByEmail(OWNER())
  const joinerId = await userIdByEmail(JOINER())
  const joinerName = await usernameOf(joinerId)

  const { groupId } = await createCircleViaApi(OWNER(), "invite refusals")
  const owner = await sessionFor(OWNER())
  const joiner = await sessionFor(JOINER())

  try {
    /**
     * **No link yet, and an admin now gets one rather than a refusal.**
     *
     * This asserted the refusal until a real person met it: invite by name,
     * be told to go generate a link, come back, invite again — a second apart
     * in the timestamps, and remembered afterwards only as "it said something
     * about expired". Migration 110 mints here instead.
     *
     * **The rule it was protecting is intact and is the next assertion.**
     * `create_invite_link` rotates, so minting over a link people are already
     * holding would revoke it. Nothing is held when nothing is live, which is
     * the only case this covers.
     */
    const minted = await owner.rpc("invite_user_to_circle", {
      p_group_id: groupId,
      p_user_id: joinerId,
    })
    expect(
      minted.error?.hint ?? null,
      "an admin inviting into a Circle with no live link was refused",
    ).toBeNull()

    const [firstInvite] = await invitesFor(joinerId, groupId)
    const mintedToken = (firstInvite?.payload as { token?: string })?.token
    expect(
      mintedToken,
      "the invite went out without a token, so it is a note rather than a link",
    ).toBeTruthy()

    /**
     * **And the second invite reuses it rather than rotating.** This is the
     * assertion the old refusal was standing in for: if the mint were
     * unconditional, inviting a second person would hand out a new token and
     * silently kill the one the first person is holding.
     */
    await clearInvites(joinerId, groupId)
    const again = await owner.rpc("invite_user_to_circle", {
      p_group_id: groupId,
      p_user_id: joinerId,
    })
    expect(again.error?.hint ?? null).toBeNull()
    const [secondInvite] = await invitesFor(joinerId, groupId)
    expect(
      (secondInvite?.payload as { token?: string })?.token,
      "a second invite minted a new link and revoked the first one",
    ).toBe(mintedToken)

    await inviteTokenFor(OWNER(), groupId)

    // A non-member cannot invite into a Circle they are not in.
    const outsider = await joiner.rpc("invite_user_to_circle", {
      p_group_id: groupId,
      p_user_id: ownerId,
    })
    expect(outsider.error?.hint, "a non-member could invite into a Circle").toBe(
      "NOT_A_MEMBER",
    )

    // The control: the same call from a member works.
    const ok = await owner.rpc("invite_user_to_circle", {
      p_group_id: groupId,
      p_user_id: joinerId,
    })
    expect(ok.error, "a member could not invite").toBeNull()

    // Already inside. Joining for real is more work than the assertion needs,
    // so the membership is written directly.
    await admin
      .from("group_members")
      .insert({ group_id: groupId, user_id: joinerId, role: "member" })

    const dupe = await owner.rpc("invite_user_to_circle", {
      p_group_id: groupId,
      p_user_id: joinerId,
    })
    expect(dupe.error?.hint, "somebody already in the Circle could be invited").toBe(
      "ALREADY_MEMBER",
    )

    // And they stop appearing in the search that feeds the button, so the
    // refusal above is one a person never has to see.
    const { data: found } = await owner.rpc("search_users", {
      p_query: joinerName,
      p_group_id: groupId,
    })
    expect(
      (found ?? []).some((u) => u.id === joinerId),
      "a member of this Circle came back as somebody to invite",
    ).toBe(false)

    // The control for that one: without the Circle, they are findable again.
    const { data: foundAnywhere } = await owner.rpc("search_users", {
      p_query: joinerName,
    })
    expect(
      (foundAnywhere ?? []).some((u) => u.id === joinerId),
      "the search cannot find them at all, so the exclusion above proves nothing",
    ).toBe(true)

    /**
     * **A plain member still cannot mint, and this is the half of migration
     * 110 with teeth.**
     *
     * `create_invite_link` is owner-and-admin; this RPC is any member. So a
     * mint that did not re-check the role would be a way for an ordinary
     * member to cause a bearer credential for the Circle to exist, by pressing
     * a button that says "invite". The refusal they get names who can fix it.
     *
     * The joiner is a member by now, and the target is somebody outside the
     * Circle so the lookup actually reaches the link branch: `ALREADY_MEMBER`
     * and `NOT_FOUND` are both checked before it.
     */
    await admin
      .from("invite_links")
      .update({ enabled: false })
      .eq("group_id", groupId)

    const memberMint = await joiner.rpc("invite_user_to_circle", {
      p_group_id: groupId,
      p_user_id: await userIdByEmail(ADMIN()),
    })
    expect(
      memberMint.error?.hint,
      "a plain member minted this Circle's invite link by inviting somebody",
    ).toBe("INVITE_LINK_MISSING")
  } finally {
    await admin
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", joinerId)
    await clearInvites(joinerId, groupId)
  }
})

/**
 * Step 18a. The two ways a search could return more than it was asked for.
 *
 * **`%` is the whole enumeration hole.** `like` treats it as "everything", so
 * without escaping, one character in the box returns a page of the user table
 * to anybody signed in. `_` is the quieter version: a single-character
 * wildcard that widens every search by one letter.
 */
test("search escapes its wildcards and holds its floor", async () => {
  const owner = await sessionFor(OWNER())
  const joinerName = await usernameOf(await userIdByEmail(JOINER()))

  for (const wildcard of ["%%%", "___", "%_%"]) {
    const { data, error } = await owner.rpc("search_users", { p_query: wildcard })
    expect(error, `search errored on ${wildcard}`).toBeNull()
    expect(
      data ?? [],
      `"${wildcard}" was treated as a pattern, so anyone can walk the user table`,
    ).toHaveLength(0)
  }

  const { data: tooShort } = await owner.rpc("search_users", {
    p_query: joinerName.slice(0, 2),
  })
  expect(tooShort ?? [], "two characters returned rows").toHaveLength(0)

  // The control, again: three characters of a real username does find somebody,
  // so the four empty results above are the guards and not a broken query.
  const { data: found } = await owner.rpc("search_users", {
    p_query: joinerName.slice(0, 3),
  })
  expect(
    (found ?? []).length,
    "three characters of a real username found nobody",
  ).toBeGreaterThan(0)
})

/**
 * Step 18c. A revoked link stops naming the Circle's members.
 *
 * The roster is the one thing on the join page that is about *people* rather
 * than about the Circle, so it is the one worth proving goes away.
 */
test("a revoked invite link stops showing who is in the Circle", async () => {
  const { groupId } = await createCircleViaApi(OWNER(), "revoked roster")
  const token = await inviteTokenFor(OWNER(), groupId)
  const owner = await sessionFor(OWNER())

  const live = await owner.rpc("circle_preview_members", { p_token: token })
  expect(live.error, "the members preview errored on a live link").toBeNull()
  // The control. A function that returned nothing for everything would satisfy
  // the assertion after this one.
  expect(
    (live.data ?? []).length,
    "a live link showed no members, so the revoked case proves nothing",
  ).toBeGreaterThan(0)

  /**
   * **And it is this Circle's members, not a slice of the whole table.**
   * Migration 99 resolved the token to a group id and never filtered by it, so
   * it returned the first ten rows of `group_members` across every Circle to
   * anybody holding any live link. Migration 100 added the `where`. Comparing
   * against the Circle's own count is what makes that regression visible.
   */
  const { count: realMembers } = await admin
    .from("group_members")
    .select("user_id", { count: "exact", head: true })
    .eq("group_id", groupId)
  expect(
    (live.data ?? []).length,
    "the members preview returned rows from other Circles",
  ).toBe(realMembers)

  await admin.from("invite_links").update({ enabled: false }).eq("group_id", groupId)

  const revoked = await owner.rpc("circle_preview_members", { p_token: token })
  expect(
    (revoked.data ?? []).length,
    "a revoked link still names the people in the Circle",
  ).toBe(0)
})
