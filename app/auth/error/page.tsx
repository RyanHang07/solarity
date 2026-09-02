import Link from "next/link"
import { CONTACT_EMAIL } from "@/lib/legal"

export const metadata = { title: "Sign-in problem — Solarity" }

/**
 * Step 20e. The two reasons this route now receives, and why they are mapped.
 *
 * `reason` began as a passthrough for Supabase's own OAuth message, which is
 * attacker-supplied and rendered as JSX text, so React escapes it. That stays:
 * an undetailed failure makes an OAuth problem unreportable.
 *
 * **What changed is that `/auth/confirm` sends two codes of its own**, and
 * rendering `link` or `missing` as a bare word would be worse than saying
 * nothing. They are mapped to sentences that describe what somebody should do,
 * because both are recoverable and neither is their fault.
 *
 * An unrecognised value still falls through to the passthrough, which keeps the
 * OAuth behaviour intact rather than silently swallowing a message nobody
 * anticipated.
 */
const KNOWN: Record<string, { title: string; body: string; retry: string; retryHref: string }> = {
  link: {
    title: "That link has expired",
    body: "Confirmation links are single-use and don't last long. Ask for a new one and it'll arrive in a moment.",
    retry: "Get a new link",
    retryHref: "/auth/check-email",
  },
  missing: {
    title: "Something was missing from that link",
    body: "The link didn't carry what we needed to confirm you. Opening it from the email again usually fixes it — some mail apps trim long URLs.",
    retry: "Get a new link",
    retryHref: "/auth/check-email",
  },
}

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>
}) {
  const { reason } = await searchParams
  const known = reason ? KNOWN[reason] : undefined

  return (
    <main className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 p-8">
      <div className="flex w-full max-w-sm flex-col gap-3 rounded border px-4 py-5">
        <h1 className="text-xl font-semibold">
          {known?.title ?? "Couldn't sign you in"}
        </h1>

        {known ? (
          <p className="text-sm opacity-70">{known.body}</p>
        ) : reason ? (
          <p className="text-sm opacity-70">{reason}</p>
        ) : null}

        <Link
          href={known?.retryHref ?? "/auth/sign-in"}
          className="self-start rounded border px-4 py-2 text-sm font-medium"
        >
          {known?.retry ?? "Try again"}
        </Link>

        <p className="text-xs opacity-60">
          Still stuck? Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </div>
    </main>
  )
}
