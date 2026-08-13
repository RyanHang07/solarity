import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/lib/database.types"

/** Client Components. Reads only — mutations go through `app/actions/`. */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
