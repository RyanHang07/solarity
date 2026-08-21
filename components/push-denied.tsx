/**
 * What someone sees when their browser is already blocking notifications.
 *
 * Shared by onboarding (10c) and settings (10d), because there is exactly one
 * true thing to say and it should not drift between two screens.
 *
 * ## Why it names no browser
 *
 * **No user-agent detection here, deliberately.** Naming the wrong browser's
 * menus is worse than naming none: someone who has just been blocked is already
 * stuck, and sending them hunting through a menu that does not exist on their
 * machine is the least helpful thing this app could do. Browsers also move
 * these settings often enough that hand-written steps go stale silently.
 *
 * The generic sentence is always true. The links carry the specifics and are
 * maintained by the people who own the menus.
 *
 * The 10b install nudge *does* sniff for iOS, and the difference is the cost of
 * being wrong: there, a bad guess shows a paragraph next to a working Skip.
 *
 * Every URL here was fetched and read before being written down. A dead link in
 * the one place someone is already stuck is the worst place for one.
 */

const HELP = [
  {
    name: "Chrome",
    href: "https://support.google.com/chrome/answer/3220216",
  },
  {
    name: "Safari",
    href: "https://support.apple.com/guide/safari/customize-website-notifications-sfri40734/mac",
  },
  {
    name: "Firefox",
    href: "https://support.mozilla.org/en-US/kb/push-notifications-firefox",
  },
  {
    name: "Edge",
    href: "https://support.microsoft.com/en-us/edge/manage-website-notifications-in-microsoft-edge",
  },
] as const

export function PushDenied() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm opacity-80">
        Your browser is blocking notifications for Solarity. We can&apos;t ask
        again from here: that switch lives in your browser&apos;s settings, under
        this site&apos;s permissions.
      </p>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {HELP.map(({ name, href }) => (
          <li key={name}>
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline opacity-70"
            >
              How to do it in {name}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
