import type { Page } from "@playwright/test"

/**
 * Records everything a failing page can tell us, so a timeout says *why*
 * instead of just "expected /circles/, got /join/".
 *
 * Server actions fail in a way normal Playwright output hides: the button sits
 * on its pending label, the URL never changes, and the actual cause is either a
 * console error, an uncaught exception, or a non-200 on the action's POST. None
 * of those appear in an assertion message unless something is listening.
 *
 * Attach before the interaction, and pass `report()` into the assertion's
 * message.
 */
export function diagnose(page: Page) {
  const lines: string[] = []

  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      lines.push(`[console.${m.type()}] ${m.text()}`)
    }
  })

  page.on("pageerror", (e) => {
    lines.push(`[pageerror] ${e.message}`)
  })

  page.on("requestfailed", (r) => {
    lines.push(`[requestfailed] ${r.method()} ${r.url()} :: ${r.failure()?.errorText}`)
  })

  // A server action is a POST to the page's own URL. Anything other than a 200
  // here is the answer, and it is otherwise invisible.
  page.on("response", async (r) => {
    const isAction = r.request().method() === "POST"
    if (!isAction) return
    if (r.status() === 200) {
      lines.push(`[action] 200 ${new URL(r.url()).pathname}`)
      return
    }
    let body = ""
    try {
      body = (await r.text()).slice(0, 400)
    } catch {
      body = "<body unavailable>"
    }
    lines.push(`[action] ${r.status()} ${new URL(r.url()).pathname}\n${body}`)
  })

  return function report() {
    if (!lines.length) return "no console errors, page errors or failed requests were recorded"
    return "page diagnostics:\n" + lines.join("\n")
  }
}
