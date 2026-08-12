import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { Database } from "@/lib/database.types"

/**
 * Server Components, Route Handlers, and Server Actions.
 *
 * Carries the user's session, not the service key: every RPC checks
 * `auth.uid()` internally and `service_role` has none, so the service key would
 * make all of them raise "Not authenticated".
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Components have read-only cookies. Safe to ignore: the
            // proxy is refreshing the session on the same request.
          }
        },
      },
    },
  )
}

/**
 * Service-role client. Bypasses RLS. Only for work no user can be the actor of.
 * Lint bans importing this into components.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set")

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: { getAll: () => [], setAll: () => {} },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
}
