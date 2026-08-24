import Link from "next/link"
import { formatVersion } from "@/lib/legal"

/**
 * The frame both policy pages share.
 *
 * **One layout, so the two cannot drift.** They are read side by side and
 * linked from each other; two hand-built pages would end up with two heading
 * scales and two ways of saying "last updated".
 *
 * **Reachable signed out**, which is the whole point: Google's OAuth consent
 * screen needs a public privacy URL, and a page behind a redirect to sign-in
 * does not qualify. `PUBLIC_PREFIXES` in `lib/supabase/proxy.ts` is what makes
 * that true, and `e2e/legal.spec.ts` is what keeps it true.
 */
export function PolicyPage({
  title,
  version,
  intro,
  children,
}: {
  title: string
  version: string
  /** One sentence under the heading, before any section. */
  intro: string
  children: React.ReactNode
}) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-2">
        <Link href="/" className="text-sm underline opacity-70">
          Solarity
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm opacity-70">{intro}</p>
        {/* A date, not a semver: nobody reading this cares about an ordinal,
            and the constant it comes from is what a future acceptance column
            will compare. */}
        <p className="text-xs opacity-60">Last updated {formatVersion(version)}</p>
      </header>

      {/* `prose`-free on purpose: the app has no typography plugin, and one
          styled wrapper here would be a second styling system to maintain for
          two pages. */}
      <div className="flex flex-col gap-6 text-sm leading-relaxed">{children}</div>

      <footer className="flex gap-4 border-t pt-4 text-sm opacity-70">
        <Link href="/privacy" className="underline">
          Privacy
        </Link>
        <Link href="/terms" className="underline">
          Terms
        </Link>
      </footer>
    </main>
  )
}

/** A titled block. Exists so every section on both pages is shaped the same. */
export function PolicySection({
  heading,
  children,
}: {
  heading: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold">{heading}</h2>
      {children}
    </section>
  )
}
