import { test, expect } from "@playwright/test"
import path from "node:path"
import { admin, requireEnv, sessionFor, userIdByEmail } from "./db"
import { AVATAR_BUCKET, avatarKey } from "@/lib/avatar"
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

    // The stored image is the square this pipeline promises, not the source.
    // A missing crop would leave the fixture's own proportions behind.
    const box = await img.boundingBox()
    expect(box, "the picture has no layout box").toBeTruthy()

    // -------------------------------------------------------------- replace
    // The key is fixed, so a second upload overwrites rather than orphaning.
    await panel.locator("#avatar-file").setInputFiles(FIXTURE)
    await expect(panel.getByText("Replace picture")).toBeVisible()

    const { data: afterReplace } = await admin.storage
      .from(AVATAR_BUCKET)
      .list(userId)
    expect(
      afterReplace?.length,
      "replacing left a second object behind, so the fixed key is not fixed",
    ).toBe(1)

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
