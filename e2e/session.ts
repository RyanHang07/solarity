import { createServerClient } from "@supabase/ssr"
import fs from "node:fs"
import { statePath, type E2EAccount } from "./auth-state"
import { admin, requireEnv } from "./db"

/**
 * One session per account per worker, minted on first use and reused after.
 *
 * **Minting per context was worse than the problem it solved.** Every
 * `verifyOtp` is a Supabase *auth* request, and those are rate limited per hour
 * independently of anything in `lib/ratelimit.ts`. A context each meant ~30 a
 * run, which tripped that limit and produced `Request rate limit reached` on
 * the mint — and, before it got that far, 429s on token refresh that
 * `@supabase/ssr` handles by dropping the session. That is what the mysterious
 * mid-run sign-outs actually were.
 *
 * Reuse is safe as long as nothing rotates the refresh token, and nothing does:
 * an access token outlives a three-minute suite, so no refresh is attempted.
 * The danger is a long run, not a shared one.
 *
 * Cached as the promise, not the value, so concurrent callers wait on one mint
 * instead of racing into several.
 */
const cache = new Map<string, Promise<{ cookies: Cookie[]; origins: never[] }>>()

type Cookie = {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite: "Lax"
}

export function storageStateFor(email: string) {
  let existing = cache.get(email)
  if (!existing) {
    existing = loadOrMint(email)
    cache.set(email, existing)
  }
  return existing
}

/**
 * Which of the three accounts an address is, or `null` for anything else.
 *
 * Resolved from the environment rather than hard-coded, because the two
 * addresses are swapped by hand often enough that a literal would go stale
 * silently and cost a mint rather than fail.
 */
function accountFor(email: string): E2EAccount | null {
  if (email === process.env.E2E_OWNER_EMAIL) return "owner"
  if (email === process.env.E2E_JOINER_EMAIL) return "joiner"
  if (email === process.env.E2E_ADMIN_EMAIL) return "admin"
  return null
}

/**
 * Prefers the state `auth.setup.ts` already wrote.
 *
 * The setup project mints both accounts at the start of every run and writes
 * them to `e2e/.auth`. Until now nothing read those files, so a run paid for
 * four sessions to use two. Supabase's auth limit is hourly and shared across
 * runs, so the waste showed up not as a slow suite but as the third or fourth
 * `npm run test:e2e` of an afternoon failing on `Request rate limit reached`.
 *
 * Minting is kept as the fallback so this file still works on its own, for
 * instance under `tsx` where the setup project never ran.
 */
async function loadOrMint(email: string) {
  const who = accountFor(email)
  if (who) {
    try {
      const file = statePath(who)

      // Age-checked, because the files survive between runs and an access token
      // does not. `--project=chromium` skips the setup project, so a file from
      // this morning would otherwise be handed over as if it were fresh and the
      // whole suite would run signed out. Half an hour against a one-hour token
      // leaves room for the run itself.
      const age = Date.now() - fs.statSync(file).mtimeMs
      if (age > 30 * 60 * 1000) throw new Error("stale")

      const state = JSON.parse(fs.readFileSync(file, "utf8")) as { cookies: Cookie[] }
      if (state.cookies?.length) return { cookies: state.cookies, origins: [] as never[] }
    } catch {
      // Absent, unreadable or half-written: mint instead. Not worth
      // distinguishing, since the fallback is correct in every case.
    }
  }
  return mintStorageState(email)
}

/**
 * Mints one. Called once per account by `storageStateFor`.
 *
 * **The cookies are built by `createServerClient`**, not by hand: the session
 * cookie is base64-prefixed, URI-encoded and chunked at 3180 characters, all
 * `@supabase/ssr` internals that have changed before. Letting the library
 * produce them means an upgrade changes both sides at once.
 */
async function mintStorageState(email: string) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  })
  if (error) throw new Error(`generateLink failed for ${email}: ${error.message}`)

  const tokenHash = data.properties?.hashed_token
  if (!tokenHash) throw new Error(`No hashed_token returned for ${email}`)

  // Keyed by name: `setAll` can be called more than once, and a later write
  // supersedes an earlier one rather than adding to it.
  const jar = new Map<string, string>()

  const client = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    {
      cookies: {
        getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
        setAll: (list) => {
          for (const { name, value } of list) jar.set(name, value)
        },
      },
    },
  )

  const { error: verifyError } = await client.auth.verifyOtp({
    token_hash: tokenHash,
    type: "email",
  })
  if (verifyError) throw new Error(`verifyOtp failed for ${email}: ${verifyError.message}`)

  const cookies = [...jar.entries()].map(([name, value]) => ({
    name,
    value,
    domain: "localhost",
    path: "/",
    expires: -1,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  }))

  if (!cookies.length) {
    throw new Error(`no auth cookies produced for ${email}`)
  }

  return { cookies, origins: [] as never[] }
}
