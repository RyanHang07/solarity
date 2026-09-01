import { test, expect } from "@playwright/test"
import { admin, requireEnv, sessionFor, userIdByEmail } from "./db"
import { storageStateFor } from "./session"

/**
 * Step 17. The admin surface, from both sides of it.
 *
 * **Two questions, and only one of them is about the screens.** Whether a
 * standard user is kept out is a security claim and is asserted against the
 * *database*, because `/admin` returning a 404 proves only that one page
 * declined to render. The RPCs are the control; the 404 is the courtesy, and
 * both are tested.
 *
 * **A third real account, `E2E_ADMIN_EMAIL`, that is already an admin.**
 *
 * The first version of this file promoted the owner and demoted them again.
 * That worked exactly until a real admin existed: the last test asserts the
 * last admin cannot be demoted, and with two admins in the system the demotion
 * is *allowed* and the assertion fails. It was a test borrowing state it did
 * not create — the shape `patterns.md` names — and it would have failed the
 * first time the product was actually configured.
 *
 * `users.role` is in no client grant, so the suite cannot mint an admin and
 * should not try. The account is promoted once by SQL and the run asserts that
 * it *is* one, so a missing grant fails with a sentence rather than as a
 * puzzling 404 three tests later.
 *
 * **Writes** up to two reports, and briefly moves the role between the admin
 * account and the owner. All restored, admin first — the `finally` in the last
 * test says why the order matters.
 */

const OWNER = () => requireEnv("E2E_OWNER_EMAIL")
const JOINER = () => requireEnv("E2E_JOINER_EMAIL")
const ADMIN = () => requireEnv("E2E_ADMIN_EMAIL")

async function setRole(userId: string, role: "standard" | "admin") {
  const { error } = await admin.from("users").update({ role }).eq("id", userId)
  if (error) throw error
}

/** Seeded with the service key: the insert policy is `moderation.spec`'s subject, not this file's. */
async function seedReport(
  reporterId: string,
  reportedId: string,
  contentType: "user_profile" | "checkin_note",
  contentReference: string,
  reason: string,
) {
  const { data, error } = await admin
    .from("content_reports")
    .insert({
      reporter_user_id: reporterId,
      reported_user_id: reportedId,
      content_type: contentType,
      content_reference: contentReference,
      reason,
    })
    .select("id")
    .single()
  if (error) throw error
  return data.id
}

async function clearReports(reporterId: string) {
  await admin.from("content_reports").delete().eq("reporter_user_id", reporterId)
}

test("a standard user is refused by the database, not only by the page", async ({
  browser,
}) => {
  const ownerId = await userIdByEmail(OWNER())
  const joinerId = await userIdByEmail(JOINER())
  const owner = await sessionFor(OWNER())

  // A real report id, so "refused" cannot be confused with "there was nothing
  // to see".
  const reportId = await seedReport(
    joinerId,
    ownerId,
    "user_profile",
    ownerId,
    "E2E gate check",
  )

  const context = await browser.newContext({
    storageState: await storageStateFor(OWNER()),
  })
  const page = await context.newPage()

  try {
    // ------------------------------------------------------------ the control
    // Every admin RPC, called directly by a signed-in standard user. A gate in
    // the page would be worth nothing if any of these answered.
    const calls = [
      owner.rpc("admin_report_queue"),
      owner.rpc("admin_report_detail", { p_report_id: reportId }),
      owner.rpc("admin_resolve_report", {
        p_report_id: reportId,
        p_status: "dismissed",
      }),
      owner.rpc("admin_set_role", { p_user_id: joinerId, p_role: "admin" }),
      owner.rpc("admin_list_admins"),
    ]

    for (const [i, result] of (await Promise.all(calls)).entries()) {
      expect(result.error, `admin RPC ${i} answered a standard user`).not.toBeNull()
      expect(result.error?.code, `admin RPC ${i} refused with the wrong code`).toBe(
        "42501",
      )
    }

    // `am_i_admin` is the one an ordinary user *may* call. It must say no.
    const { data: mine, error: mineError } = await owner.rpc("am_i_admin")
    expect(mineError, "am_i_admin refused a signed-in user").toBeNull()
    expect(mine, "a standard user reported as an admin").toBe(false)

    // The report is untouched: the resolve above was refused, not silently
    // applied. RLS filters quietly, so this is the assertion that says so.
    const { data: row } = await admin
      .from("content_reports")
      .select("status")
      .eq("id", reportId)
      .single()
    expect(row?.status, "a standard user resolved a report").toBe("pending")

    // ----------------------------------------------------------- the courtesy
    /**
     * **`notFound()`, not a redirect and not a 403** — a 403 would confirm the
     * route exists and has something behind it worth being refused from.
     *
     * **Asserted on what renders, not on the status**, and that is not a
     * softening. `notFound()` can only set a 404 while the response headers are
     * unsent, and `(app)/loading.tsx` gives these routes a Suspense boundary —
     * so the shell flushes with a 200 and the not-found UI arrives inside a
     * response that already committed. `profile.spec.ts` hit this first. The
     * claim worth making is that no admin screen is reachable, and the RPC
     * assertions above are what make it a security claim rather than a
     * cosmetic one.
     */
    for (const path of ["/admin", "/admin/people", `/admin/reports/${reportId}`]) {
      await page.goto(path)
      await expect(
        page.getByRole("heading", { name: "Admin" }),
        `${path} rendered the admin screen for a standard user`,
      ).toHaveCount(0)
    }

    // And nothing in the app points at it.
    await page.goto("/settings")
    await expect(
      page.getByRole("region", { name: "Admin" }),
      "the Admin section rendered for a standard user",
    ).toHaveCount(0)
  } finally {
    await clearReports(joinerId)
    await context.close()
  }
})

test("an admin can read a report, resolve it, and reopen it", async ({ browser }) => {
  const adminId = await userIdByEmail(ADMIN())
  const ownerId = await userIdByEmail(OWNER())
  const joinerId = await userIdByEmail(JOINER())

  // **Asserted, not assumed.** This account is promoted by SQL outside the
  // suite, so if that was never done every assertion below would fail as a 404
  // and name nothing. One read turns that into a sentence.
  const { data: role } = await admin
    .from("users")
    .select("role")
    .eq("id", adminId)
    .single()
  expect(
    role?.role,
    `${ADMIN()} is not a site admin — see "Make yourself an admin" in build-plan.md`,
  ).toBe("admin")

  const reportId = await seedReport(
    joinerId,
    ownerId,
    "user_profile",
    ownerId,
    "E2E: this profile was reported",
  )

  /**
   * A report pointing at a check-in that does not exist.
   *
   * **The case a moderator meets and a happy-path test never would**: the entry
   * was deleted, or the photo passed the 90-day retention window, or the
   * reference predates the validation added in the 15 audit. `admin_report_detail`
   * must return the report with empty content rather than raising, because an
   * unresolvable report is exactly the kind somebody needs to dismiss.
   */
  const orphanId = await seedReport(
    joinerId,
    ownerId,
    "checkin_note",
    `${ownerId}/00000000-0000-0000-0000-000000000000/2020-01-01`,
    "E2E: points at nothing",
  )

  const context = await browser.newContext({
    storageState: await storageStateFor(ADMIN()),
  })
  const page = await context.newPage()

  try {
    // ------------------------------------------------------------- the queue
    await page.goto("/admin")
    await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible()

    const queue = page.getByRole("list", { name: "Reports" })
    await expect(queue.getByText("E2E: this profile was reported")).toBeVisible()

    // ------------------------------------------------------------ one report
    await page.goto(`/admin/reports/${reportId}`)
    await expect(page.getByText("E2E: this profile was reported")).toBeVisible()
    await expect(
      page.getByRole("region", { name: "Reported content" }),
    ).toBeVisible()

    // ---------------------------------------------------------- unresolvable
    await page.goto(`/admin/reports/${orphanId}`)
    await expect(
      page.getByText(/no longer available/i),
      "a report pointing at nothing did not say so",
    ).toBeVisible()

    // --------------------------------------------------------------- resolve
    await page.goto(`/admin/reports/${reportId}`)
    await page.getByRole("button", { name: "Mark reviewed" }).click()

    // **Asserted at the database.** The button changing is a rendering; the row
    // is the claim — and `reviewed_by` is set from `auth.uid()` inside the RPC
    // precisely so it cannot be filed under somebody else's name.
    await expect
      .poll(async () => {
        const { data } = await admin
          .from("content_reports")
          .select("status, reviewed_by, reviewed_at")
          .eq("id", reportId)
          .single()
        return data
      })
      .toMatchObject({ status: "reviewed", reviewed_by: adminId })

    // ---------------------------------------------------------------- reopen
    // The table's CHECK requires `reviewed_at` to be null exactly when pending,
    // so reopening has to clear it. A resolve that only wrote `status` would
    // fail the constraint rather than leaving a wrong row.
    await page.getByRole("button", { name: "Reopen" }).click()

    await expect
      .poll(async () => {
        const { data } = await admin
          .from("content_reports")
          .select("status, reviewed_at")
          .eq("id", reportId)
          .single()
        return data
      })
      .toMatchObject({ status: "pending", reviewed_at: null })

    // ------------------------------------------------ and the link now exists
    await page.goto("/settings")
    await expect(page.getByRole("region", { name: "Admin" })).toBeVisible()
  } finally {
    // No role to put back: this account is an admin before the run and after
    // it. That is the whole reason it exists.
    await clearReports(joinerId)
    await context.close()
  }
})

/**
 * `admin_set_role`, through a real signed-in client.
 *
 * **Writing this found the bug migration 95 fixes.** Migration 93 also forbade
 * changing your own role, which made the last-admin rule unreachable — to reach
 * it the caller must be an admin and the target a *different* admin, which
 * means there are two. 93's own proof passed because its final call was a
 * self-demotion, refused by the self-guard, which raises the same SQLSTATE: an
 * assertion that could not fail.
 *
 * 93 also counted admins on **every** demotion without checking whether the
 * target held the role, so with one admin the Revoke button would have failed
 * on every username with a message about somebody else. That was the common
 * case, not an edge.
 *
 * Each branch is asserted separately and by **hint**, because all three refusals
 * share a SQLSTATE and asserting "it was refused" is what hid the first bug.
 */
test("the role guards hold for a real admin", async () => {
  const adminId = await userIdByEmail(ADMIN())
  const ownerId = await userIdByEmail(OWNER())
  const siteAdmin = await sessionFor(ADMIN())

  try {
    // ------------------- revoking a plain user, while you are the only admin
    // Migration 93 refused this as LAST_ADMIN: it counted admins on every
    // demotion without checking whether the *target* held the role. With one
    // admin — a fresh install — the Revoke button failed on every username.
    const plain = await siteAdmin.rpc("admin_set_role", {
      p_user_id: ownerId,
      p_role: "standard",
    })
    expect(
      plain.error,
      "revoking a non-admin was refused; the count is not scoped to the target",
    ).toBeNull()

    // ---------------------------------------- the last admin cannot step down
    // **This is the assertion the whole rework was for**, and it only means
    // something because this account really is the only admin. When the suite
    // minted its own admin there were two, so the demotion was allowed and this
    // failed — the failure that prompted `E2E_ADMIN_EMAIL`.
    const last = await siteAdmin.rpc("admin_set_role", {
      p_user_id: adminId,
      p_role: "standard",
    })
    expect(last.error, "the last admin demoted themselves").not.toBeNull()
    expect(last.error?.hint, "refused for the wrong reason").toBe("LAST_ADMIN")

    // ------------------------------------------- but one of two can step down
    const promote = await siteAdmin.rpc("admin_set_role", {
      p_user_id: ownerId,
      p_role: "admin",
    })
    expect(promote.error, "an admin could not promote somebody").toBeNull()

    const step = await siteAdmin.rpc("admin_set_role", {
      p_user_id: adminId,
      p_role: "standard",
    })
    expect(step.error, "self-demotion with two admins was refused").toBeNull()

    // And the demoted admin really lost it, rather than the write being
    // accepted and doing nothing.
    const after = await siteAdmin.rpc("admin_list_admins")
    expect(after.error?.hint, "a demoted admin still had admin powers").toBe(
      "NOT_SITE_ADMIN",
    )

    // ------------------------------------------------------- audited, always
    const { data: audit } = await admin
      .from("audit_log")
      .select("action_type, actor_user_id, target_user_id")
      .in("action_type", ["site_admin_granted", "site_admin_revoked"])
      .order("created_at", { ascending: false })

    expect(
      audit?.length,
      "the promotion and the revocation were not both audited",
    ).toBeGreaterThanOrEqual(2)
    expect(audit?.[0]?.actor_user_id, "the audit named the wrong actor").toBe(adminId)
  } finally {
    /**
     * **Put the real admin back first, and the borrowed one back after.**
     *
     * This test deliberately demotes the permanent admin, which is only
     * possible because it promotes the owner first — the last-admin rule would
     * refuse it otherwise. If an assertion throws between those two steps the
     * account is left standard and `/admin` is gone from the product, so the
     * restore is unconditional and ordered: promote the one that must exist,
     * then demote the one that must not.
     */
    await setRole(adminId, "admin")
    await setRole(ownerId, "standard")
    await admin
      .from("audit_log")
      .delete()
      .in("action_type", ["site_admin_granted", "site_admin_revoked"])
  }
})
