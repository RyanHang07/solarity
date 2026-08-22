import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

/**
 * The app's primary abuse control. Limits are tabulated in architecture/
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

  // The two invite limits. Keyed by client IP and by a hash of the token
  // respectively, NOT by user id, because `/join/[token]` serves signed-out
  // visitors and is the app's only unauthenticated endpoint.
  inviteAttempt: [20, "1 h"],

  // 60, not the 10 the plan originally specified. See the note below: 10 would
  // let a shared link lock out the people it was shared with.
  inviteToken: [60, "1 h"],

  // CSP violation reports, keyed by client IP. Generous on purpose: one broken
  // page can emit a report per blocked resource per load, and the point of the
  // endpoint is to hear about exactly that. Refusal is silent — the route
  // answers 204 either way and simply stops logging, so a flood costs log
  // volume rather than a wrong answer to a browser that is not listening.
  cspReport: [120, "1 h"],
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
    // Off: it writes extra Redis keys per request against a free-tier command
    // budget, to populate an Upstash dashboard nobody is reading yet. Turn on
    // when there is traffic worth analysing.
    analytics: false,

    /**
     * **Off, and this one is not an optimisation you want.**
     *
     * Left undefined, `@upstash/ratelimit` builds an in-process `Map` and, on
     * every refusal, records `blockUntil(identifier, endOfWindow)`. Subsequent
     * calls then short-circuit **before touching Redis**, for up to the full
     * window: an hour, here.
     *
     * That puts the limiter's state in two places, and only one of them can be
     * cleared. Deleting the Redis keys leaves the process still refusing, so
     * `scripts/reset-ratelimit.mjs` appears to do nothing and the only real fix
     * is restarting the server. It cost an afternoon: an e2e run tripped the
     * per-IP invite limit, cleared Redis, and every later test still got
     * refused.
     *
     * Worse in development than the hour suggests, because the invite limits
     * key on client IP and localhost has no `x-forwarded-for`, so every local
     * request shares one bucket. One test run would lock the join page for
     * everyone until the dev server restarted.
     *
     * What turning it off costs: a refused request now spends a Redis command
     * rather than being answered from memory, so a sustained attack from one
     * identifier burns the free-tier command budget faster. Worth revisiting
     * alongside `analytics`, when there is traffic to measure. Not worth a
     * limiter whose state cannot be inspected or reset.
     */
    ephemeralCache: false,

    prefix: `solarity:${name}`,
  })
  limiters.set(name, existing)
  return existing
}

/**
 * Throws if the caller is over their limit. Keyed by user id, so one abusive
 * account can't degrade the service for everyone.
 *
 * **Call this after cheap local validation, immediately before the first call
 * that leaves the process.** A token spent on a typo or a filtered word is a
 * penalty for a mistake, and the limits bound expensive operations rather than
 * keystrokes. Validation that touches nothing but memory costs nothing worth
 * metering; a database round trip does.
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
