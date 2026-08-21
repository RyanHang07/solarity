/**
 * Step 10b. Catching `beforeinstallprompt`, which cannot be caught late.
 *
 * ## Why a script in the document rather than an effect
 *
 * Chromium fires `beforeinstallprompt` once, early, and **the event object is
 * the only way to ever show the install dialog**. There is no API to ask for it
 * later from nothing. A listener added in a `useEffect` runs after hydration,
 * which on a slow connection is comfortably after the event has come and gone,
 * and the button would then do nothing on exactly the devices where installing
 * matters most.
 *
 * So the listener is an inline script in the root layout, and this module holds
 * the contract it writes to. The script is the earliest code we control; the
 * React side reads whatever it stashed.
 *
 * ## Detection is a hint, never a gate
 *
 * Nothing here decides whether someone may continue. Every branch of the nudge
 * has a way forward, because all of these signals lie somewhere:
 * `display-mode: standalone` is unreliable on iOS until the first launch from
 * the home screen, and `beforeinstallprompt` simply never fires in Firefox or
 * Safari even though both can install.
 */

/** Where the inline script stashes the event, and the signal it sends after. */
export const INSTALL_PROMPT_KEY = "__solarityInstallPrompt"
export const INSTALLABLE_EVENT = "solarity:installable"

/**
 * The parts of `BeforeInstallPromptEvent` we use; it is not in lib.dom.
 * Not exported: the `Window` declaration below is its only consumer.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

declare global {
  interface Window {
    [INSTALL_PROMPT_KEY]?: InstallPromptEvent
  }
}

/**
 * Runs before hydration, from the root layout. Kept to one statement per line
 * and no modern syntax, since a parse error here is silent and would cost the
 * install button on every browser at once.
 */
export const INSTALL_PROMPT_SCRIPT = `
(function () {
  window.addEventListener('beforeinstallprompt', function (e) {
    // Suppresses Chrome's own mini-infobar so the nudge is the only ask. The
    // cost of preventing it is that the event object becomes the only route to
    // the dialog, which is exactly why it is kept.
    e.preventDefault();
    window['${INSTALL_PROMPT_KEY}'] = e;
    window.dispatchEvent(new Event('${INSTALLABLE_EVENT}'));
  });

  // Chromium fires this after a successful install, whichever surface asked.
  window.addEventListener('appinstalled', function () {
    window['${INSTALL_PROMPT_KEY}'] = undefined;
    window.dispatchEvent(new Event('${INSTALLABLE_EVENT}'));
  });
})();
`

/** True once the app is running from the home screen or an app window. */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true
  // iOS never implemented `display-mode` for home-screen launches on older
  // versions and sets this instead. Non-standard, and absent everywhere else.
  return (window.navigator as { standalone?: boolean }).standalone === true
}

/**
 * Whether to show Share-sheet instructions.
 *
 * **A user-agent sniff, and deliberately so.** iOS is the one platform that can
 * install but never fires `beforeinstallprompt`, and it offers no API that says
 * "you could add this to the home screen". Without the sniff, every iPhone gets
 * the generic branch, which is the platform where skipping the install means
 * push never works at all.
 *
 * The cost of a wrong answer is bounded: someone sees instructions for a menu
 * they do not have, next to a Skip button that still works. Compare 10d, where
 * a wrong guess about the *browser* would send someone hunting through a
 * settings menu that does not exist, which is why that case guesses nothing.
 *
 * iPadOS reports itself as a Mac, hence the touch-point check.
 */
export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  return ua.includes("Macintosh") && navigator.maxTouchPoints > 1
}
