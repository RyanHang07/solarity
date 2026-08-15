import { createHash } from "node:crypto"
import { headers } from "next/headers"

/**
 * Rate-limit identities for callers who have no user id.
 *
 * Every other limit in the app keys on `auth.uid()`. `/join/[token]` serves
 * signed-out visitors, so it needs identities that exist before sign-in.
 */

/**
 * The client's IP, as reported by whatever sits in front of the app.
 *
 * **`x-forwarded-for` is only trustworthy behind a proxy that overwrites it.**
 * Vercel does, which is where this runs. Served without one, a client could set
 * the header itself and mint a fresh rate-limit bucket per request, so this
 * must not become the sole defence for anything that matters. It bounds
 * enumeration; it does not stop a determined attacker.
 *
 * Falls back to a single shared bucket rather than to something unique. A
 * per-request fallback would silently disable the limit exactly when the header
 * is missing, which is the case where it is most needed. Sharing one bucket
 * fails toward limiting too much, which is visible, rather than too little,
 * which is not. In local development every request lands in that bucket.
 */
export async function clientIp(): Promise<string> {
  const h = await headers()

  const forwarded = h.get("x-forwarded-for")
  if (forwarded) {
    // Left-most entry is the original client; the rest are proxies.
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }

  return h.get("x-real-ip")?.trim() || "no-ip"
}

/**
 * A rate-limit key for an invite token.
 *
 * **Never use the raw token.** It is a live bearer credential, and a Redis key
 * name reaches the keyspace, `SCAN` output, slow-query logs and any dashboard
 * anyone opens. Anyone who can read one has a working invite.
 *
 * Truncated to 32 hex characters, which is 128 bits: far past the point where
 * a collision matters for a counter, and short enough to keep keys readable.
 */
export function inviteTokenKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 32)
}
