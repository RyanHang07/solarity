import type { NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Everything except static assets: auth cookies need refreshing on real
     * navigations, not on every icon fetch.
     *
     * `sw.js` and the manifest are excluded deliberately. Both are fetched
     * outside any page context, and a service worker that receives a redirect
     * instead of JavaScript fails to register — no install, and on iOS no push.
     */
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|icons/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
