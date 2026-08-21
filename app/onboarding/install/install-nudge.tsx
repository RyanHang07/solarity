"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  INSTALLABLE_EVENT,
  INSTALL_PROMPT_KEY,
  isIOS,
  isStandalone,
} from "@/lib/install-prompt"

/**
 * Step 10b. "Add Solarity to your home screen", branched by what the browser
 * can actually do.
 *
 * ## Four branches, all of which lead somewhere
 *
 * | Branch | Shown when | The control |
 * |---|---|---|
 * | `installed` | already running standalone | nothing to do, continue |
 * | `prompt` | `beforeinstallprompt` was captured | a real button that opens the browser's dialog |
 * | `ios` | iPhone or iPad | the Share-sheet steps, since no API exists |
 * | `manual` | anything else, including before we know | one line pointing at the browser's own menu |
 *
 * `manual` is both the fallback **and** the first render, which is what keeps
 * this free of hydration mismatches: the server cannot know any of these facts,
 * so it renders the branch that assumes nothing and the client refines it.
 *
 * ## Why every branch has a way forward
 *
 * Detection is a hint, never a gate. `display-mode: standalone` lies on iOS
 * before the first launch from the home screen, `beforeinstallprompt` never
 * fires in Firefox or Safari, and the iOS check is a user-agent sniff. A wrong
 * answer must cost someone a paragraph they did not need, never their signup.
 */

type Branch = "manual" | "prompt" | "ios" | "installed"

export function InstallNudge({ next }: { next: string }) {
  const router = useRouter()
  const [branch, setBranch] = useState<Branch>("manual")
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    const decide = () => {
      if (isStandalone()) return setBranch("installed")
      if (window[INSTALL_PROMPT_KEY]) return setBranch("prompt")
      if (isIOS()) return setBranch("ios")
      setBranch("manual")
    }

    decide()

    // The event may have been captured before this mounted, or may arrive
    // seconds later. Reading once and subscribing covers both.
    window.addEventListener(INSTALLABLE_EVENT, decide)
    return () => window.removeEventListener(INSTALLABLE_EVENT, decide)
  }, [])

  async function install() {
    const event = window[INSTALL_PROMPT_KEY]
    if (!event) return

    // A captured event can only be used once. Clearing it first means a double
    // tap cannot call `prompt()` twice, which throws.
    window[INSTALL_PROMPT_KEY] = undefined
    setDialogOpen(true)

    try {
      await event.prompt()
      const { outcome } = await event.userChoice
      // Accepting hands over to the installed app, and the browser reloads this
      // page inside it. Moving on ourselves would race that.
      if (outcome === "accepted") return
    } catch {
      // A browser that refuses to show the dialog leaves the manual
      // instructions, which is the honest fallback rather than an error.
    }

    setDialogOpen(false)
    setBranch(isIOS() ? "ios" : "manual")
  }

  return (
    <div className="flex w-full max-w-xs flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">Add Solarity to your home screen</h1>
        <p className="text-sm opacity-70">
          {branch === "installed"
            ? "You're already set up. Solarity opens like an app on this device."
            : "It opens full screen, and it's the only way we can send you a reminder when your Circle is waiting on you."}
        </p>
      </div>

      {branch === "prompt" ? (
        <button
          type="button"
          onClick={install}
          disabled={dialogOpen}
          className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {dialogOpen ? "Waiting for your browser…" : "Add to home screen"}
        </button>
      ) : null}

      {branch === "ios" ? (
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm opacity-80">
          <li>
            Tap the Share button at the bottom of Safari, the square with an
            arrow pointing up.
          </li>
          <li>Scroll down and tap Add to Home Screen.</li>
          <li>Tap Add, then open Solarity from your home screen.</li>
        </ol>
      ) : null}

      {branch === "manual" ? (
        <p className="text-sm opacity-80">
          Look for Install or Add to Home Screen in your browser&apos;s menu. If
          it isn&apos;t there, this browser can&apos;t install apps, and Solarity
          still works normally in a tab.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => router.push(next)}
        className="rounded border px-4 py-2 text-sm font-medium"
      >
        {/* The wording carries the decision, so nobody has to wonder whether
            leaving has cost them something. */}
        {branch === "installed" ? "Continue" : "I'll do this later"}
      </button>

      {/* Only where it adds something. The `manual` branch has just said this
          in more detail, and someone already running standalone does not need
          telling how to install. A test caught the duplication: two paragraphs
          about the browser's menu, one screen. */}
      {branch === "prompt" || branch === "ios" ? (
        <p className="text-xs opacity-60">
          You can install Solarity any time from your browser&apos;s menu.
        </p>
      ) : null}
    </div>
  )
}
