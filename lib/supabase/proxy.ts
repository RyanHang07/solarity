import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import type { Database } from "@/lib/database.types"

/**
 * Refreshes the auth session and redirects anonymous requests. Called from
 * `proxy.ts`. See architecture/app.md section 2b.
 *
 * `response` must be the object that gets returned — building a fresh
 * NextResponse instead would discard the refreshed cookies and log people out
 * at random.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // getUser, not getSession: getSession reads the cookie without verifying it.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic =
    path.startsWith("/auth") ||
    path.startsWith("/_next") ||
    path === "/" ||
    path.startsWith("/join") // invite links resolve before sign-in

  if (!user && !isPublic) {
    // Path *and* query. `sw.js` deep-links to `/circles/<id>?tab=overview`, so
    // sending only the path silently drops people on the wrong tab of the right
    // page after signing in. `safeRedirect` already permits a query string; it
    // rejects on the leading characters, which a search string cannot change.
    const url = request.nextUrl.clone()
    url.pathname = "/auth/sign-in"
    url.search = ""
    url.searchParams.set("next", path + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  return response
}
