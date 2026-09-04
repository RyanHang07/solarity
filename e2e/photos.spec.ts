import { test, expect } from "@playwright/test"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/database.types"
import {
  admin,
  assertOk,
  checkinDateFor,
  circleName,
  deleteE2ECircles,
  deleteE2EGoals,
  freeGoalSlots,
  requireEnv,
  restoreGoalSlots,
  sessionFor,
  userIdByEmail,
} from "./db"
import { photoKey } from "@/lib/photo-upload"
import { storageStateFor } from "./session"
import fs from "node:fs"
import path from "node:path"

/**
 * Step 13a. What `circle_roster` says about a photo, to whom.
 *
 * **API-level, and it stays that way even after 13d ships a screen.** The claim
 * is that a hidden goal's photo key never leaves the database, and a screen
 * test can only show that this screen does not draw it. Migration 71 exists
 * because a masking rule was right in one consumer and wrong in another.
 *
 * The same four directions are asserted in the migration's own rolled-back
 * proof. That proof runs as the table owner; this one runs as two real signed-in
 * users through PostgREST, which is the only way to know the grants and the
 * `SECURITY DEFINER` boundary agree with it.
 *
 * **Writes** one Circle named `E2E …`, one goal, one check-in. All removed.
 */

const OWNER = () => requireEnv("E2E_OWNER_EMAIL")
const JOINER = () => requireEnv("E2E_JOINER_EMAIL")

/**
 * A real 64x64 PNG, committed rather than generated at test time.
 *
 * `preparePhoto` decodes it through a canvas and re-encodes it as WebP, so a
 * stub of a few bytes would fail `sniff` or fail to decode. See
 * `e2e/fixtures/README.md` for why it is not a solid colour.
 *
 * **Resolved from `process.cwd()`, like `env.ts` and `auth-state.ts` already
 * do, and not from `import.meta.url`.** There is no `"type": "module"` here, so
 * Playwright compiles these specs to CommonJS and `import.meta` is a syntax
 * error at load time — which takes the whole file out of the run before a
 * single test starts. Playwright's cwd is the directory holding the config.
 */
const FIXTURE = path.join(process.cwd(), "e2e", "fixtures", "checkin.png")

/**
 * Opens a member's row on the Circle roster.
 *
 * **The goals list is conditionally rendered, not merely collapsed.** A closed
 * row has no goals in the DOM at all, so an assertion about a photo, a title or
 * a note finds nothing and reports "element(s) not found" — which reads like
 * the feature is broken rather than like the row is shut. `today-roster.tsx`
 * says so at the top: expanding reveals data already fetched.
 */
async function openRosterRow(page: import("@playwright/test").Page, username: string) {
  const row = page.getByRole("listitem").filter({ hasText: username }).first()
  await row.getByRole("button").filter({ hasText: username }).first().click()
  return row
}

/** The goal on the owner's row, as seen by whoever asked. */
async function goalAsSeenBy(
  client: SupabaseClient<Database>,
  groupId: string,
  ownerId: string,
  goalId: string,
) {
  const roster = await client.rpc("circle_roster", { p_group_id: groupId })
  assertOk(roster, "circle_roster")
  const row = roster.data!.find((m) => m.user_id === ownerId)
  expect(row, "the owner is missing from the roster").toBeTruthy()
  const goals = row!.goals as { id: string; photo_url: string | null; title: string | null }[]
  const goal = goals.find((g) => g.id === goalId)
  expect(goal, "the seeded goal is missing from the roster").toBeTruthy()
  return goal!
}

test("a photo key reaches a circle-mate, and stops at a hidden goal", async () => {
  const owner = await sessionFor(OWNER())
  const joiner = await sessionFor(JOINER())
  const ownerId = await userIdByEmail(OWNER())

  const freed = await freeGoalSlots(ownerId, 1)
  const created = await owner.rpc("create_circle", { p_name: circleName("photo") })
  assertOk(created, "create_circle")
  const groupId = created.data as string

  const link = await owner.rpc("create_invite_link", { p_group_id: groupId })
  assertOk(link, "create_invite_link")
  assertOk(await joiner.rpc("join_circle", { p_token: link.data as string }), "join_circle")

  const cat = await admin.from("goal_categories").select("id").limit(1).single()
  const goal = await owner
    .from("goals")
    .insert({ user_id: ownerId, title: "E2E photo goal", category_id: cat.data!.id })
    .select("id")
    .single()
  assertOk(goal, "insert goal")
  const goalId = goal.data!.id

  const entry = await owner
    .from("progress_entries")
    .insert({
      goal_id: goalId,
      user_id: ownerId,
      check_in_date: await checkinDateFor(OWNER()),
    })
    .select("id")
    .single()
  assertOk(entry, "check in")

  // **The key is written through the user's own client**, not the service key,
  // because `grant update (photo_url)` is what 13c will rely on and a test that
  // used `admin` here would pass even if that grant were revoked.
  // **`.select("id")` is not decoration.** A bare `.update()` returns
  // `data: null`, which `assertOk` treats as a failure — and more importantly,
  // RLS filters silently, so without asking for the affected rows a write that
  // matched nothing is indistinguishable from one that worked. `setNoteSharing`
  // in `app/actions/` already does it this way.
  const key = photoKey(ownerId, goalId, entry.data!.id)
  assertOk(
    await owner
      .from("progress_entries")
      .update({ photo_url: key })
      .eq("id", entry.data!.id)
      .select("id"),
    "attach photo",
  )

  try {
    // ------------------------------------------------------------- visible
    expect(
      (await goalAsSeenBy(owner, groupId, ownerId, goalId)).photo_url,
      "the owner cannot see their own photo",
    ).toBe(key)
    expect(
      (await goalAsSeenBy(joiner, groupId, ownerId, goalId)).photo_url,
      "a circle-mate cannot see a visible photo",
    ).toBe(key)

    // -------------------------------------------------------------- hidden
    // **`.insert()`, not `.upsert()`.** PostgREST compiles an upsert to
    // `ON CONFLICT DO UPDATE SET <every column in the payload>`, so it needs
    // UPDATE on `goal_id` and `group_id` too — and `authenticated` holds UPDATE
    // on `hidden` alone. The upsert fails with a bare `42501` naming the table,
    // which reads like a missing policy and is really a column grant. This goal
    // and this Circle are both created by this test, so there is nothing to
    // conflict with.
    assertOk(
      await owner
        .from("goal_group_visibility")
        .insert({ goal_id: goalId, group_id: groupId, hidden: true })
        .select("goal_id"),
      "hide the goal",
    )

    // Migration 72's rule: masking never applies to yourself. Hiding a goal
    // once took the owner's own photo away from them.
    expect(
      (await goalAsSeenBy(owner, groupId, ownerId, goalId)).photo_url,
      "hiding took the owner's own photo away",
    ).toBe(key)

    const masked = await goalAsSeenBy(joiner, groupId, ownerId, goalId)
    expect(masked.photo_url, "a hidden goal still served its photo key").toBeNull()
    // Asserted alongside, so a null `photo_url` cannot be the result of the
    // fixture having quietly gone missing.
    expect(masked.title, "the title leaked, so this fixture proves nothing").toBeNull()

    // ------------------------------------------------------------ no photo
    assertOk(
      await owner
        .from("progress_entries")
        .update({ photo_url: null })
        .eq("id", entry.data!.id)
        .select("id"),
      "detach photo",
    )
    const bare = await goalAsSeenBy(owner, groupId, ownerId, goalId)
    expect(bare.photo_url, "a photoless check-in reported a photo").toBeNull()
  } finally {
    // **Entries before goals.** `progress_entries_goal_id_fkey` is
    // `ON DELETE SET NULL`, so deleting the goal leaves the check-in behind
    // with its `photo_url` intact and its `goal_id` gone — a row claiming a
    // photo that no object backs. Eight of those survived earlier runs of this
    // very file before the audit found them. `boundaries.spec.ts` has always
    // deleted entries first; this did not.
    await admin.from("progress_entries").delete().eq("goal_id", goalId)
    await admin.from("goals").delete().eq("id", goalId)
    await deleteE2ECircles()
    await deleteE2EGoals()
    await restoreGoalSlots(freed)
  }
})

test("photo_url cannot be pointed at someone else's object", async () => {
  /**
   * **Migration 80, from the API a real client actually has.**
   *
   * `authenticated` holds `update (photo_url)`, and the only WITH CHECK is
   * `user_id = auth.uid()`. So until 80 the column was free text on a row you
   * own, and `circle_roster` hands its value to your Circle — a forged key
   * would have shown a stranger's photo as your proof of a day's work.
   *
   * `attachCheckinPhoto` derives the key server-side and never accepts one,
   * which is the right shape for the app. This asserts the rule where the app
   * cannot be routed around it.
   */
  const owner = await sessionFor(OWNER())
  const ownerId = await userIdByEmail(OWNER())

  const freed = await freeGoalSlots(ownerId, 1)
  const cat = await admin.from("goal_categories").select("id").limit(1).single()
  const goal = await owner
    .from("goals")
    .insert({ user_id: ownerId, title: "E2E forged key", category_id: cat.data!.id })
    .select("id")
    .single()
  assertOk(goal, "insert goal")

  const entry = await owner
    .from("progress_entries")
    .insert({
      goal_id: goal.data!.id,
      user_id: ownerId,
      check_in_date: await checkinDateFor(OWNER()),
    })
    .select("id")
    .single()
  assertOk(entry, "check in")

  try {
    const own = photoKey(ownerId, goal.data!.id, entry.data!.id)

    // Accepted, which is what stops this being a test that refuses everything
    // — and it proves `photoKey` and the constraint build the same string.
    assertOk(
      await owner
        .from("progress_entries")
        .update({ photo_url: own })
        .eq("id", entry.data!.id)
        .select("id"),
      "the row's own key was refused",
    )

    // Someone else's folder.
    const foreign = await owner
      .from("progress_entries")
      .update({ photo_url: photoKey(crypto.randomUUID(), goal.data!.id, entry.data!.id) })
      .eq("id", entry.data!.id)
    expect(foreign.error, "a forged owner was accepted").toBeTruthy()

    // Your own folder, a different entry. The subtler half: the first segment
    // is right, so a constraint that only checked the owner would let it pass.
    const wrongEntry = await owner
      .from("progress_entries")
      .update({ photo_url: photoKey(ownerId, goal.data!.id, crypto.randomUUID()) })
      .eq("id", entry.data!.id)
    expect(wrongEntry.error, "a key for another entry was accepted").toBeTruthy()
  } finally {
    await admin.from("progress_entries").delete().eq("goal_id", goal.data!.id)
    await admin.from("goals").delete().eq("id", goal.data!.id)
    await deleteE2EGoals()
    await restoreGoalSlots(freed)
  }
})

test("the key names an object only its owner may write", async () => {
  // 13a hands a viewer a path. The path is a *name*, and this is the assertion
  // that it is not also a door: `checkin_photos_insert` scopes writes by the
  // first folder, so a circle-mate holding the key still cannot put anything
  // there. Without this, "a key is not a capability" is a claim in a comment.
  const joiner = await sessionFor(JOINER())
  const ownerId = await userIdByEmail(OWNER())

  const forged = photoKey(ownerId, crypto.randomUUID(), crypto.randomUUID())
  const { error } = await joiner.storage
    .from("checkin-photos")
    .upload(forged, new Blob([new Uint8Array(new ArrayBuffer(1))], { type: "image/webp" }))

  expect(error, "a circle-mate wrote into someone else's folder").toBeTruthy()
})

/* ------------------------------------------------------------------- 13d --
 * The whole path, through a browser: pick a file, see it on a friend's screen.
 */

test("a photo picked on the dashboard reaches a circle-mate, and hiding takes it back", async ({
  browser,
}) => {
  /**
   * **The only test that exercises `preparePhoto`.** Everything else about
   * photos is asserted at the API, because that is where the rules live. But
   * decoding, EXIF orientation, resizing and the WebP re-encode all need a
   * canvas, and a canvas is a browser. A stubbed decode here would leave the
   * one part of the pipeline that can only be tested in a browser untested.
   *
   * **Writes** one Circle, one goal, one check-in and one Storage object. All
   * removed, including the object: an orphan in a private bucket is invisible
   * to `purge-expired-photos`, which finds files through `photo_url`.
   */
  const owner = await sessionFor(OWNER())
  const joiner = await sessionFor(JOINER())
  const ownerId = await userIdByEmail(OWNER())
  const title = `E2E photo ${Date.now().toString().slice(-6)}`

  // The roster labels rows by username, not by email or id.
  const ownerName = (
    await admin.from("users").select("username").eq("id", ownerId).single()
  ).data!.username!

  const freed = await freeGoalSlots(ownerId, 1)
  const created = await owner.rpc("create_circle", { p_name: circleName("shot") })
  assertOk(created, "create_circle")
  const groupId = created.data as string

  const link = await owner.rpc("create_invite_link", { p_group_id: groupId })
  assertOk(link, "create_invite_link")
  assertOk(await joiner.rpc("join_circle", { p_token: link.data as string }), "join_circle")

  const cat = await admin.from("goal_categories").select("id").limit(1).single()
  const goal = await owner
    .from("goals")
    .insert({ user_id: ownerId, title, category_id: cat.data!.id })
    .select("id")
    .single()
  assertOk(goal, "insert goal")

  const ownerCtx = await browser.newContext({ storageState: await storageStateFor(OWNER()) })
  const joinerCtx = await browser.newContext({ storageState: await storageStateFor(JOINER()) })
  const ownerPage = await ownerCtx.newPage()
  const joinerPage = await joinerCtx.newPage()

  try {
    await ownerPage.goto("/dashboard")
    const row = ownerPage.getByRole("listitem").filter({ hasText: title })

    await row.getByRole("button", { name: "Check in" }).click()

    /**
     * **Wait for the check-in to land before looking for the photo control.**
     *
     * `click()` returns as soon as the click is dispatched. The button then
     * reads `…` and is disabled while the server action runs, and the photo
     * control does not exist at all until there is a `progress_entries` row to
     * attach it to — `entryId` is what renders it.
     *
     * So the assertion below was racing a round trip to a remote database on a
     * five-second budget, and the failure it produced said "no labelled file
     * input for this goal", which points at the markup rather than at the wait.
     * The page snapshot from the failing run showed the row mid-flight:
     * `button "…" [disabled]`.
     *
     * **Raising the expect timeout would have been the wrong fix.** It would
     * have made this test slower to fail and left every other assertion in the
     * file paying for one action's latency. `Undo` is the actual completion
     * signal — the button only reads that once the entry exists — so waiting
     * for it is both faster in the good case and honest about what is being
     * waited on.
     */
    await expect(
      row.getByRole("button", { name: "Undo" }),
      "the check-in never landed",
    ).toBeVisible({ timeout: 20_000 })

    /**
     * **The control is a `<label>`, and the input is off-screen rather than
     * `display:none`.** iOS Safari can open the sheet from a hidden input and
     * then hand nothing back when a source is chosen; a label opens the picker
     * natively with no script. Found on a real iPhone, where every headless
     * browser had accepted the old version.
     *
     * Asserted structurally, because a Playwright `setInputFiles` succeeds on a
     * `display:none` input and would never have caught this.
     */
    const picker = row.getByLabel(`Add photo for ${title}`)
    await expect(picker, "no labelled file input for this goal").toBeAttached()
    expect(
      await picker.evaluate((el) => getComputedStyle(el).display),
      "the file input is display:none, which iOS will not hand a file back from",
    ).not.toBe("none")

    // Checked rather than assumed. A wrong path makes `setInputFiles` fail
    // with a message about the locator, which sends you looking at the DOM.
    expect(fs.existsSync(FIXTURE), `fixture missing at ${FIXTURE}`).toBe(true)
    await picker.setInputFiles(FIXTURE)

    // `Remove photo` appears only when `photo_url` is set, so waiting for it
    // waits for the whole chain: decode, re-encode, upload, and the action.
    await expect(row.getByRole("button", { name: "Remove photo" })).toBeVisible({
      timeout: 20_000,
    })

    /**
     * **Stored as JPEG, whatever was picked.** The bucket accepts nothing else.
     *
     * Asserted on the *downloaded* object rather than on what we asked for,
     * because that distinction is the whole bug: `supabase-js` appends the blob
     * to `FormData` bare, so the type Storage validates comes from `blob.type`
     * and never from the `contentType` option. Asking for JPEG and shipping a
     * PNG is precisely what Safari did.
     */
    const key = photoKey(ownerId, goal.data!.id, await entryIdFor(goal.data!.id))
    expect(key.endsWith(".jpg")).toBe(true)
    const { data: object } = await admin.storage
      .from("checkin-photos")
      .download(key)
    expect(object?.type, "the stored object is not JPEG").toContain("jpeg")

    // ------------------------------------------------------- the friend sees
    await joinerPage.goto(`/circles/${groupId}`)
    await openRosterRow(joinerPage, ownerName)

    // **Exactly one.** `CheckinPhoto` used to draw a thumbnail and a full copy
    // with the same `alt`, which is one picture described twice — a strict-mode
    // violation here, and a screen reader saying it twice in the app. Asserting
    // the count is what keeps that from coming back.
    const photo = joinerPage.getByAltText(`Check-in photo for ${title}`)
    await expect(photo, "the photo is drawn more than once").toHaveCount(1)
    await expect(photo, "a circle-mate cannot see the photo").toBeVisible()

    // A signed URL, not a public one. A bucket accidentally made public would
    // pass every other assertion in this file.
    const src = await photo.getAttribute("src")
    expect(src, "the image is not behind a signed URL").toContain("/object/sign/")

    // **And the signature works for them.** Everything above is satisfied by an
    // `<img>` whose src 403s: it is present, visible, and pointing at a signed
    // path. `naturalWidth` is non-zero only once the bytes have arrived and
    // decoded, which is the actual claim this test makes about a circle-mate.
    await expect
      .poll(() => photo.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
        message: "the signed URL did not resolve to an image for the circle-mate",
        timeout: 15_000,
      })
      .toBeGreaterThan(0)

    // ------------------------------------------------------------ and hiding
    // Insert rather than upsert: see the note in the first test.
    assertOk(
      await owner
        .from("goal_group_visibility")
        .insert({ goal_id: goal.data!.id, group_id: groupId, hidden: true })
        .select("goal_id"),
      "hide the goal",
    )
    await joinerPage.reload()
    // Re-opened, because a reload closes it again — and asserting `toHaveCount(0)`
    // on a shut row would pass no matter what the masking rule did.
    await openRosterRow(joinerPage, ownerName)
    await expect(
      joinerPage.getByText("Hidden goal").first(),
      "the row did not open, so the absence below proves nothing",
    ).toBeVisible()
    await expect(
      joinerPage.getByAltText(`Check-in photo for ${title}`),
      "a hidden goal still showed its photo",
    ).toHaveCount(0)
  } finally {
    const { data: entry } = await admin
      .from("progress_entries")
      .select("photo_url")
      .eq("goal_id", goal.data!.id)
      .maybeSingle()
    if (entry?.photo_url) {
      await admin.storage.from("checkin-photos").remove([entry.photo_url])
    }
    await admin.from("progress_entries").delete().eq("goal_id", goal.data!.id)
    await admin.from("goals").delete().eq("id", goal.data!.id)
    await deleteE2ECircles()
    await deleteE2EGoals()
    await restoreGoalSlots(freed)
    await ownerCtx.close()
    await joinerCtx.close()
  }

  async function entryIdFor(goalId: string) {
    const { data } = await admin
      .from("progress_entries")
      .select("id")
      .eq("goal_id", goalId)
      .single()
    return data!.id
  }
})
