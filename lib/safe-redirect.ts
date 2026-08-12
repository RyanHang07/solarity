/**
 * Constrains a user-supplied `next=` parameter to an in-app path, so the
 * sign-in page can't be used as an open redirect. See architecture.md
 * section 2b.
 *
 * `//host` is protocol-relative and resolves to another origin; some parsers
 * treat a backslash the same way.
 */
export function safeRedirect(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback
  if (!next.startsWith("/")) return fallback
  if (next.startsWith("//")) return fallback
  if (next.includes("\\")) return fallback
  return next
}
