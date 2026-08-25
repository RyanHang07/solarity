import { test, expect } from "@playwright/test"

/**
 * The public surface: the two policy pages, and the two files that describe the
 * site to a crawler.
 *
 * **Signed out on purpose, and that is the whole point of the file.** Google's
 * OAuth consent screen will not publish without a reachable privacy URL, and a
 * page behind a redirect to sign-in does not qualify. The default `page`
 * fixture carries no storage state, so every test here is a stranger.
 *
 * **Writes nothing.**
 */

test("a stranger can read both policies", async ({ page }) => {
  for (const [path, heading] of [
    ["/privacy", "Privacy"],
    ["/terms", "Terms"],
  ] as const) {
    const response = await page.goto(path)

    // Not a redirect to sign-in. Asserting the URL as well as the heading,
    // because a redirect that happened to land somewhere with the same word on
    // it would satisfy the heading alone.
    expect(response!.status(), `${path} did not return 200`).toBe(200)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible()

    // A version, because an undated policy cannot be superseded.
    await expect(page.getByText(/Last updated/)).toBeVisible()
  }
})

test("each policy links to the other, and both link home", async ({ page }) => {
  await page.goto("/privacy")
  await page.getByRole("link", { name: "Terms" }).first().click()
  await expect(page).toHaveURL(/\/terms$/)

  await page.getByRole("link", { name: "Privacy" }).first().click()
  await expect(page).toHaveURL(/\/privacy$/)

  await page.getByRole("link", { name: "Solarity" }).click()
  await expect(page).toHaveURL(/\/$/)
})

test("the privacy policy states what it must", async ({ page }) => {
  await page.goto("/privacy")

  // Retention, spelled out. These are the numbers `purge-expired-photos` and
  // `run_retention_sweep` actually enforce, and the page reads them from the
  // same module, so a change to one without the other fails here.
  await expect(page.getByText(/Photos: 90 days/)).toBeVisible()

  // The thing deletion does *not* do. It is the least intuitive behaviour in
  // the product and the one most likely to be quietly dropped from the copy.
  await expect(page.getByText(/check-in records\s+stay/i)).toBeVisible()

  // Contact, as a real mailto rather than plain text.
  const contact = page.getByRole("link", { name: /@/ }).first()
  await expect(contact).toHaveAttribute("href", /^mailto:/)
})

test("a signed-out visitor can reach the policies from the front door", async ({
  page,
}) => {
  // Google's review looks for the privacy link on the homepage, not only inside
  // the account area.
  for (const from of ["/", "/auth/sign-in"]) {
    await page.goto(from)
    await expect(
      page.getByRole("link", { name: "Privacy" }),
      `no privacy link on ${from}`,
    ).toBeVisible()
    await expect(page.getByRole("link", { name: "Terms" })).toBeVisible()
  }
})

test("the sitemap lists the public pages and never an invite", async ({ request }) => {
  const response = await request.get("/sitemap.xml")
  expect(response.status()).toBe(200)
  const xml = await response.text()

  /**
   * **Assert the kind of document before asserting its contents.**
   *
   * `/robots.txt` and `/sitemap.xml` were missing from the proxy's public list
   * and both were being redirected to `/auth/sign-in`. This test stayed green
   * through all of it: the sign-in page carries `legal-footer.tsx`, so it
   * contains `/privacy` and `/terms` and does not contain `/join` — all three
   * assertions below passing against a document that was not a sitemap.
   *
   * `request.get` follows redirects and reports the final 200, so a status
   * check cannot catch this either. The content type can.
   */
  expect(
    response.headers()["content-type"],
    "sitemap.xml did not return XML, so this is not a sitemap",
  ).toContain("xml")

  expect(xml).toContain("/privacy")
  expect(xml).toContain("/terms")

  /**
   * **The assertion this file exists for.**
   *
   * An invite token is a bearer credential: whoever holds the URL can join the
   * Circle. A sitemap that enumerated them would publish every one. `sitemap.ts`
   * has no way to reach the database today and must never gain one, so this
   * fails the moment somebody adds a `groups.map(...)` that looks helpful.
   */
  expect(xml, "the sitemap contains an invite path").not.toContain("/join")
})

test("robots keeps crawlers away from invite links", async ({ request }) => {
  const response = await request.get("/robots.txt")
  expect(response.status()).toBe(200)
  const txt = await response.text()

  // Same trap as the sitemap above: a redirect to sign-in returns 200 with an
  // HTML body. Naming it here means the failure reads as "this is the wrong
  // document" rather than as "the rules are missing".
  expect(
    response.headers()["content-type"],
    "robots.txt did not return text/plain, so this is not robots.txt",
  ).toContain("text/plain")

  // `/join/[token]` already sets `robots: noindex`, but that is a request read
  // *after* the fetch. This stops the fetch, which is what keeps the token out
  // of a crawler's logs.
  expect(txt).toContain("Disallow: /join/")
  expect(txt).toContain("Sitemap:")
})
