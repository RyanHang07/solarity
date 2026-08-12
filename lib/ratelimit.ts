import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

/**
 * The app's primary abuse control. Limits are tabulated in architecture.md
 * section 2b.
 *
 * Only applies to calls made through server actions, which is why `.rpc(` is
 * lint-confined to `app/actions/`.
 */

type Window = Parameters<typeof Ratelimit.slidingWindow>[1]

const LIMITS = {
  // Bounds guessing, not succeeding: onboarding is retried legitimately, and
  // the rename path it shares is already capped at once per 14 days by the RPC.
  onboarding: [15, "1 h"],
  createCircle: [5, "1 d"],
  joinCircle: [10, "1 h"],
  createGoal: [20, "1 h"],
  checkIn: [60, "1 h"],
  photoUpload: [20, "1 h"],
  report: [10, "1 d"],
  inviteLink: [10, "1 h"],
} as const satisfies Record<string, readonly [number, Window]>

export type LimitName = keyof typeof LIMITS

/**
 * Built on first use, never at module scope.
 *
 * `Redis.fromEnv()` throws when the Upstash variables are absent, and this
 * module sits in the import graph of every server action — at module scope a
 * missing variable would fail `next build` rather than a request, turning a
 * runtime concern into a broken build in CI or any environment-less checkout.
 */
let redis: Redis | undefined
const limiters = new Map<LimitName, Ratelimit>()

function limiter(name: LimitName): Ratelimit {
  let existing = limiters.get(name)
  if (existing) return existing

  redis ??= Redis.fromEnv()
  const [tokens, window] = LIMITS[name]
  existing = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, window),
    analytics: true,
    prefix: `solarity:${name}`,
  })
  limiters.set(name, existing)
  return existing
}

/**
 * Throws if the caller is over their limit. Keyed by user id, so one abusive
 * account can't degrade the service for everyone.
 */
export async function enforce(
  name: LimitName,
  identifier: string,
  message = "You're doing that too often. Try again shortly.",
) {
  const { success, reset } = await limiter(name).limit(identifier)
  if (!success) {
    const seconds = Math.max(1, Math.ceil((reset - Date.now()) / 1000))
    throw new RateLimitError(message, seconds)
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterSeconds: number,
  ) {
    super(message)
    this.name = "RateLimitError"
  }
}
