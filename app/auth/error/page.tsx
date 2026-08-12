import Link from "next/link"

export const metadata = { title: "Sign-in problem — Solarity" }

/**
 * `reason` is attacker-supplied but rendered as JSX text, which React escapes.
 * Shown at all because an undetailed failure makes OAuth problems unreportable.
 */
export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">Couldn&apos;t sign you in</h1>
      {reason ? (
        <p className="max-w-sm text-center text-sm opacity-70">{reason}</p>
      ) : null}
      <Link href="/auth/sign-in" className="rounded border px-4 py-2 text-sm">
        Try again
      </Link>
    </main>
  )
}
