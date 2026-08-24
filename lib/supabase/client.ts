import { createBrowserClient } from "@supabase/ssr"
import type { Database } from "@/lib/database.types"

/**
 * Client Components. Reads, and **one deliberate write**.
 *
 * Mutations go through `app/actions/` so nothing skips rate limiting, the
 * profanity filter or the error contract. The exception is the check-in photo
 * upload in `photo-button.tsx`, which puts bytes straight into Storage.
 *
 * **It has to be an exception, rather than being one by neglect.** Routing an
 * image through a server action would serialise megabytes across our own
 * runtime to reach a bucket the browser can already address, and the thing
 * enforcing who may write where is `checkin_photos_insert` — a Storage policy
 * that evaluates the caller against the object path. The server is not a
 * checkpoint that upload is skipping; it was never on that road.
 *
 * The write that *matters* still goes through an action: `attachCheckinPhoto`
 * is what makes the object visible to anyone else, and it is metered.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  )
}
