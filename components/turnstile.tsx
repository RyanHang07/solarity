"use client"

import Script from "next/script"
import { useEffect, useRef, useState } from "react"

/**
 * Step 20h. The Cloudflare Turnstile widget, as a hidden form field.
 *
 * ## Why a component rather than a call in each form
 *
 * Three forms need this — signup, password sign-in and reset — and each needs
 * the same four things: the script, a container, a token in a field named
 * `captchaToken`, and a way to reset after a failed submit. Three copies would
 * be three chances to forget the last one.
 *
 * ## Absent key means absent widget, deliberately
 *
 * `next build` runs in CI with **no environment variables at all**, and a
 * component that threw or rendered a broken widget without a site key would
 * fail a build that is supposed to prove the app compiles. So no key renders
 * nothing and submits no token.
 *
 * That is safe in exactly one direction: if Supabase has CAPTCHA **off**,
 * nothing is lost. If it is **on**, every submission is refused with
 * `no captcha_token found` — which is the error a missing
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` produces, and worth recognising, because it
 * names the token rather than the key.
 *
 * ## The token is single-use
 *
 * Cloudflare issues a token per solve and Supabase spends it. A form submitted
 * twice — a failed password, then a corrected one — needs a fresh one, so the
 * widget is reset whenever the parent says the last attempt failed. Without
 * that, the second attempt fails with a message about a captcha rather than
 * about the password, which is the most confusing possible outcome.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string
          callback: (token: string) => void
          "expired-callback"?: () => void
          "error-callback"?: () => void
          theme?: "auto" | "light" | "dark"
        },
      ) => string
      reset: (id?: string) => void
    }
  }
}

export function Turnstile({
  /**
   * Bumped by the parent after a failed submit. Any change resets the widget
   * and clears the spent token.
   */
  resetKey = 0,
}: {
  resetKey?: number
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  const container = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const [token, setToken] = useState("")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!siteKey || !ready || !container.current) return
    if (widgetId.current !== null) return

    widgetId.current = window.turnstile!.render(container.current, {
      sitekey: siteKey,
      callback: (t) => setToken(t),
      // An expired or errored challenge must clear the token, not keep a stale
      // one that Supabase will reject with a message about a captcha.
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken(""),
      theme: "auto",
    })
  }, [siteKey, ready])

  useEffect(() => {
    if (resetKey === 0 || widgetId.current === null) return
    window.turnstile?.reset(widgetId.current)
    setToken("")
  }, [resetKey])

  if (!siteKey) return null

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
      />
      <div ref={container} />
      {/*
        The field name Supabase's client reads nothing from — the *action* does,
        and passes it as `options.captchaToken`. Named here so all three forms
        agree without a shared constant nobody would look up.
      */}
      <input type="hidden" name="captchaToken" value={token} />
    </>
  )
}
