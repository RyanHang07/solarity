import Link from "next/link"

/**
 * Privacy and Terms, on the two pages a signed-out visitor can reach.
 *
 * **Google's OAuth consent review looks for the privacy link on the app's
 * homepage**, not only inside the account area, which is why this is on `/` and
 * `/auth/sign-in` rather than only in settings.
 */
export function LegalFooter() {
  return (
    <footer className="flex gap-4 text-xs opacity-60">
      <Link href="/privacy" className="underline">
        Privacy
      </Link>
      <Link href="/terms" className="underline">
        Terms
      </Link>
    </footer>
  )
}
