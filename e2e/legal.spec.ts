import { test, expect } from "@playwright/test"
import {
  CONTROLLER_NAME,
  DATA_REGION,
  PROCESSORS,
  RESPONSE_DAYS,
} from "@/lib/legal"

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

  /**
   * **Every processor, named.** The 31 Aug review found one entry describing a
   * service and nearly deleted another that was real, so the list is the part
   * of this page most likely to drift in both directions. Asserting each name
   * fails when somebody edits `PROCESSORS` and never looks at the page.
   *
   * The names come from `lib/legal.ts`, so this cannot pass by containing the
   * word "Supabase" somewhere unrelated: `PolicySection` renders them as list
   * items and nothing else on the page mentions a vendor.
   */
  for (const p of PROCESSORS) {
    await expect(
      page.getByRole("listitem").filter({ hasText: p.name }),
      `${p.name} is in PROCESSORS and not on the page`,
    ).not.toHaveCount(0)
  }

  /**
   * **The export claim, which is the sentence a data access request is judged
   * against.** It read "everything Solarity holds about you" while the RPC
   * returned six things and omitted six more. The page now lists what the file
   * contains and names what it does not, so this asserts the disclaimer is
   * still there rather than the list being quietly widened back to a claim.
   */
  await expect(
    page.getByText(/Not in the file:/),
    "the export section no longer says what it leaves out",
  ).toBeVisible()

  /**
   * **No promise of a notice nobody can send.** Both pages used to say a change
   * would be shown in the app before it took effect. There is no acceptance
   * record, no banner and no email, so the sentence had no machinery behind it.
   */
  await expect(
    page.getByText(/told in the app/i),
    "the page promises in-app notice, which nothing implements",
  ).toHaveCount(0)

  /**
   * **The four sufficiency facts**, added on 31 Aug for the half of the review
   * a lawyer would ask about rather than the half the code answers.
   *
   * Each is a claim a reader or a regulator would look for by name, and each
   * would be dropped silently by a rewrite that was only tidying prose. The
   * controller and the window come from `lib/legal.ts`, so editing the constant
   * without editing the page fails here.
   */
  await expect(
    page.getByText(CONTROLLER_NAME),
    "no named controller, so the page says who runs it only in the abstract",
  ).not.toHaveCount(0)

  await expect(
    page.getByText(new RegExp(`${RESPONSE_DAYS} days`)),
    "no response window for requests that are not self-serve",
  ).toBeVisible()

  await expect(
    page.getByRole("heading", { name: "Cookies" }),
    "no cookie section, which is the first absence a reviewer notices",
  ).toBeVisible()

  await expect(
    page.getByText(new RegExp(DATA_REGION)),
    "the page does not say where the data physically is",
  ).not.toHaveCount(0)
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
