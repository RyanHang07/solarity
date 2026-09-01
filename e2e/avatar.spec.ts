import { test, expect, type Locator } from "@playwright/test"
import fs from "node:fs"
import path from "node:path"
import { admin, requireEnv, sessionFor, userIdByEmail } from "./db"
import { AVATAR_BUCKET, AVATAR_EDGE, avatarKey } from "@/lib/avatar"
import { storageStateFor } from "./session"

/**
 * Step 15f. Uploading, replacing and removing your picture.
 *
 * **Through the screen, because every bug this pipeline has ever had was in
 * the browser.** Step 13's photo upload passed headless and failed on a real
 * iPhone three separate times: a `display:none` input that never returned a
 * file, a CSP that blocked the compressor's worker, and a canvas that could not
 * encode WebP. None of those are reachable from an API test.
 *
 * This cannot prove the iPhone case either — Playwright's WebKit is not iOS
 * Safari. What it can prove is that the whole path runs end to end in a real
 * browser with a real file, and that the database refuses the one thing the
 * screen must never be able to do.
 *
 * **Writes** one object at `<owner>/avatar.jpg` and one column value. Both are
 * put back.
 *
 * **Resolved from `process.cwd()`, not `import.meta.url`.** There is no
 * `"type": "module"` here, so Playwright compiles these specs to CommonJS and
 * `import.meta` is a load-time syntax error that takes the whole file out of
 * the run before a single test starts.
 */
const FIXTURE = path.join(process.cwd(), "e2e", "fixtures", "checkin.png")

/**
 * A **second, deliberately non-square** picture, for the replace step.
 *
 * Two things it buys. Different bytes, so "the object changed" is a fact about
 * Storage rather than about a label that already said "Replace picture" before
 * the second upload started. And 96×48 is the first rectangular source this
 * pipeline has ever been given by a test. `prepareAvatar` centre-crops with
 * `Math.min(width, height)` and two offsets, and a square fixture exercises
 * none of that arithmetic. Real pictures are never square.
 */
const WIDE_FIXTURE = path.join(process.cwd(), "e2e", "fixtures", "avatar-wide.png")

/**
 * The decoded dimensions of an `<img>`, as `"256x256"`.
 *
 * A string rather than a pair, so a failure prints `"64x64"` against
 * `"256x256"` instead of an object diff.
 */
function naturalSize(img: Locator): Promise<string> {
  return img.evaluate((el) => {
    const i = el as HTMLImageElement
    return `${i.naturalWidth}x${i.naturalHeight}`
  })
}

/** The stored object's size, or null when there is none. */
async function storedSize(userId: string): Promise<number | null> {
  const { data } = await admin.storage
    .from(AVATAR_BUCKET)
    .list(userId, { search: "avatar.jpg" })
  const size = data?.[0]?.metadata?.size
  return typeof size === "number" ? size : null
}

const EMAIL = () => requireEnv("E2E_OWNER_EMAIL")

/** Puts the account back exactly as it was: no column value, no object. */
async function clearAvatar(userId: string) {
  const { error } = await admin
    .from("users")
    .update({ avatar_url: null })
    .eq("id", userId)
  if (error) throw error
  await admin.storage.from(AVATAR_BUCKET).remove([avatarKey(userId)])
}

test("a picture can be uploaded from settings, and removed again", async ({
  browser,
}) => {
  const userId = await userIdByEmail(EMAIL())
  const { data: me } = await admin
    .from("users")
    .select("username")
    .eq("id", userId)
    .single()
  const username = me!.username!

  // Checked rather than assumed, the same guard `photos.spec.ts` keeps: a
  // missing fixture makes `setInputFiles` fail with a message about the
  // locator, which sends you looking at the DOM for an input that is fine.
  for (const file of [FIXTURE, WIDE_FIXTURE]) {
    expect(fs.existsSync(file), `fixture missing at ${file}`).toBe(true)
  }

  await clearAvatar(userId)

  const context = await browser.newContext({
    storageState: await storageStateFor(EMAIL()),
  })
  const page = await context.newPage()

  try {
    await page.goto("/settings")
    const panel = page.getByRole("region", { name: "Picture" })
    await expect(panel).toBeVisible()

    // No avatar is the default, and it must not read as a broken image.
    await expect(
      panel.getByRole("img", { name: "Your picture" }),
      "an avatar rendered for an account that has none",
    ).toHaveCount(0)
    await expect(panel.getByText("Add a picture")).toBeVisible()

    // ------------------------------------------------------------------ set
    // **`setInputFiles`, not a click on the label.** The picker is a native
    // dialog no automation can drive; this hands the file straight to the
    // input, which is what the label would have caused. The input is
    // positioned off-screen rather than `display:none` — for iOS's sake — and
    // `setInputFiles` works on it either way.
    await panel.locator("#avatar-file").setInputFiles(FIXTURE)

    const img = panel.getByRole("img", { name: "Your picture" })
    await expect(img, "no picture appeared after uploading").toBeVisible({
      timeout: 15_000,
    })

    // **Asserted at the database and at Storage, not only on screen.** An
    // optimistic render would satisfy the assertion above while nothing had
    // been written; a stale page would fail it while everything had.
    const { data: row } = await admin
      .from("users")
      .select("avatar_url")
      .eq("id", userId)
      .single()
    expect(row?.avatar_url, "the column does not name this user's own key").toBe(
      avatarKey(userId),
    )

    const { data: listed } = await admin.storage
      .from(AVATAR_BUCKET)
      .list(userId, { search: "avatar.jpg" })
    expect(listed?.length, "no object was written to the bucket").toBe(1)

    // **The decoded image, not its layout box.** What this replaced asked for a
    // bounding box and checked it was truthy, under a comment claiming it
    // proved the crop. It could not: `Avatar` sets `width`/`height` inline and
    // `object-cover`, so the box is 64 CSS pixels whatever the bytes are, and
    // an `<img>` that 404s still has one. `naturalWidth` is the JPEG's own
    // size, so this fails if the pipeline ever stores the source untouched.
    //
    // Polled, because `toBeVisible` is satisfied by that same layout box: the
    // element is visible before a byte of the JPEG has been decoded, and
    // `naturalWidth` is 0 until it has.
    await expect
      .poll(() => naturalSize(img), { message: "the stored image is not a 256px square" })
      .toBe(`${AVATAR_EDGE}x${AVATAR_EDGE}`)

    /**
     * **The three places the picture has to appear, not just the one that
     * uploads it.** The plan promised the profile *and the roster*; the first
     * build did settings and the profile only, and a picture you have to
     * navigate to a settings page to see is not the point of a picture. Each
     * of these reads through a different path — the header signs one URL in
     * `(app)/layout.tsx`, the roster signs a batch inside `circle_roster` —
     * so one of them working says nothing about the others.
     */
    await expect(
      page.getByRole("banner").getByRole("img", { name: `${username}'s picture` }),
      "no picture in the header",
    ).toBeVisible()

    const { data: membership } = await admin
      .from("group_members")
      .select("group_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle()

    if (membership) {
      await page.goto(`/circles/${membership.group_id}`)
      // **Named, not just "an image".** A roster row can hold a check-in photo
      // as well as an avatar, and `getByRole("img")` would then resolve to two
      // and fail as a strict-mode violation rather than as a missing avatar.
      await expect(
        page
          .getByRole("listitem")
          .filter({ hasText: username })
          .getByRole("img", { name: `${username}'s picture` }),
        "no picture on the roster row",
      ).toBeVisible()
    }

    // -------------------------------------------------------------- replace
    //
    // **Back to `/settings` first, and its absence is what hung this test.**
    // The roster check above navigates away, and `setInputFiles` on a control
    // that is not on the page does not fail. It waits for the element until the
    // test's own 30s timeout, then reports as a bare "Test timeout exceeded"
    // with no locator named. A step that leaves the page owes the next one a
    // way back.
    await page.goto("/settings")
    const sizeBefore = await storedSize(userId)

    // The key is fixed, so a second upload overwrites rather than orphaning.
    await panel.locator("#avatar-file").setInputFiles(WIDE_FIXTURE)

    // **Polled on the object, not on the label.** "Replace picture" has been
    // on screen since the *first* upload finished, so asserting it here would
    // pass with the second upload deleted: the assertion-that-cannot-fail
    // pattern, one line after a real one. A different fixture guarantees
    // different bytes, so a changed size is proof the write landed.
    await expect
      .poll(() => storedSize(userId), {
        message: "replacing did not write new bytes to the fixed key",
        timeout: 15_000,
      })
      .not.toBe(sizeBefore)

    const { data: afterReplace } = await admin.storage
      .from(AVATAR_BUCKET)
      .list(userId)
    expect(
      afterReplace?.length,
      "replacing left a second object behind, so the fixed key is not fixed",
    ).toBe(1)

    /**
     * **What the rectangular source proves, and what it does not.** A 2:1
     * picture went in and a 256px square came out, so `prepareAvatar`'s crop
     * arithmetic ran on a rectangle without throwing: the case every real
     * photograph takes, and the one no test took before.
     *
     * It does not prove the crop is *centred*. A stretch would also produce
     * 256×256, and telling those apart needs the decoded pixels, which a
     * cross-origin signed URL taints a canvas against reading. Whether a face
     * comes out centred stays with the manual pass.
     */
    await expect
      .poll(() => naturalSize(img), { message: "the replacement is not a 256px square" })
      .toBe(`${AVATAR_EDGE}x${AVATAR_EDGE}`)

    // --------------------------------------------------------------- remove
    await panel.getByRole("button", { name: "Remove picture" }).click()

    await expect(panel.getByRole("img", { name: "Your picture" })).toHaveCount(0)
    const { data: cleared } = await admin
      .from("users")
      .select("avatar_url")
      .eq("id", userId)
      .single()
    expect(cleared?.avatar_url, "removing did not clear the column").toBeNull()

    await expect(panel.locator('p[role="alert"]')).toHaveCount(0)
  } finally {
    await clearAvatar(userId)
    await context.close()
  }
})

/**
 * Migration 85, through PostgREST as a real signed-in user.
 *
 * **The migration proves this as the table owner**, where grants do not apply
 * and RLS is bypassed. This is the only way to know the CHECK, the
 * `update (avatar_url)` grant and the UPDATE policy agree — the same reason
 * `photos.spec.ts` re-proves migration 80 through a user's own client.
 *
 * The hole being closed: the storage policies stop you *writing* into someone
 * else's folder, and nothing stopped you *naming* it. With profiles open to any
 * signed-in user, a forged `avatar_url` would render another person's face as
 * your own.
 */
test("the database refuses an avatar_url that is not your own key", async () => {
  const userId = await userIdByEmail(EMAIL())
  const otherId = await userIdByEmail(requireEnv("E2E_JOINER_EMAIL"))
  const owner = await sessionFor(EMAIL())

  try {
    // The control, first. A rule that refused everything would pass every
    // assertion below while breaking the feature entirely.
    const ok = await owner
      .from("users")
      .update({ avatar_url: avatarKey(userId) })
      .eq("id", userId)
      .select("id")
    expect(ok.error, "a user could not set their own avatar key").toBeNull()
    expect(ok.data, "setting an own key matched no rows").toHaveLength(1)

    // ------------------------------------------------------------ the forgery
    const forged = await owner
      .from("users")
      .update({ avatar_url: avatarKey(otherId) })
      .eq("id", userId)
      .select("id")
    expect(forged.error, "another user's key was accepted").not.toBeNull()
    expect(forged.error?.code).toBe("23514")

    // The shape that existed in this column before migration 85: a remote URL.
    const remote = await owner
      .from("users")
      .update({ avatar_url: "https://lh3.googleusercontent.com/a/x" })
      .eq("id", userId)
      .select("id")
    expect(remote.error?.code, "an https avatar_url was accepted").toBe("23514")

    // Null is always allowed. Having no picture is the default.
    const cleared = await owner
      .from("users")
      .update({ avatar_url: null })
      .eq("id", userId)
      .select("id")
    expect(cleared.error, "clearing an avatar was refused").toBeNull()
  } finally {
    await clearAvatar(userId)
  }
})
