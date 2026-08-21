import "server-only"
import { cookies } from "next/headers"

/**
 * Step 10f. Whether this device has already been nudged about notifications.
 *
 * **A cookie, for the same reason `/today`'s marker is one.** "I have seen this
 * suggestion" is a fact about a device, not an account: the nudge is about the
 * browser you are holding, so dismissing it on a laptop should not hide it on
 * the phone that would actually deliver the notification.
 *
 * A column would also mean writing during a page render, which no read path in
 * this app does.
 */

const COOKIE = "solarity_push_nudge"

/** Read-only, so it is safe in a server component. */
export async function pushNudgeDismissed(): Promise<boolean> {
  const jar = await cookies()
  return jar.get(COOKIE)?.value === "1"
}

/** Called from a server action, because that is the only place cookies may be set. */
export async function dismissPushNudge() {
  const jar = await cookies()
  jar.set(COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Half a year. Long enough that "no thanks" means it, short enough that
    // someone who changes their mind a year later is asked once more rather
    // than never again.
    maxAge: 60 * 60 * 24 * 180,
  })
}
