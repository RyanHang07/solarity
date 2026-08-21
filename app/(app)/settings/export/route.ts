import { exportUserData } from "@/app/actions/settings"

/**
 * Your data, as a download.
 *
 * A route handler rather than a server action because the deliverable is a
 * **file**: an action returns a value to React, and turning that into a
 * download means building a Blob and a synthetic anchor click in the browser.
 * A `Content-Disposition` header is the same thing without the client-side
 * choreography, and it works with the link right-clicked into a new tab.
 *
 * The RPC itself is called from `app/actions/settings.ts`, because `.rpc(` is
 * lint-banned outside that directory and the rule is worth keeping literal.
 */
export async function GET() {
  const result = await exportUserData()

  if (!result.ok) {
    // Plain text, not JSON: this URL is opened directly by a browser, and a
    // JSON error object rendered raw in a tab is worse than a sentence.
    return new Response(result.error, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  const stamp = new Date().toISOString().slice(0, 10)

  return new Response(JSON.stringify(result.data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="solarity-${stamp}.json"`,
      // Never cached. It is personal data and it changes every day.
      "Cache-Control": "no-store",
    },
  })
}
