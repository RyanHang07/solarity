import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { signOut } from "@/app/actions/auth"
import { signedAvatarUrl } from "@/app/actions/settings"
import { Avatar } from "@/components/avatar"

/**
 * Onboarding gate for every signed-in screen. See architecture/app.md section 2b
 * for why this lives here rather than in the proxy.
 *
 * A signed-in user with no row is a broken state rather than a new user — the
 * auth trigger creates it. Onboarding is still the right destination, since
 * setting a username is the only thing that can repair it.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: profile } = await supabase
    .from("users")
    .select("username, avatar_url")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.username) redirect("/onboarding")

  /**
   * 15f. Your own picture in the header.
   *
   * **One signed URL per page load, and it is the price of the feature.** This
   * layout wraps every signed-in screen, so a Storage round trip here is paid
   * on all of them. It is a single `createSignedUrl` against a private bucket
   * and the alternative — a public bucket — would make every avatar a
   * permanent unauthenticated URL, which is a worse trade than one request.
   *
   * Null when there is no picture, and `Avatar` renders an initial rather than
   * a broken image.
   */
  const avatarUrl = await signedAvatarUrl(profile.avatar_url)

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight">
          Solarity
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {/*
            **A link to your own profile, not decoration.** The picture is the
            most tappable thing in the header and every app puts your profile
            behind it; making it inert would be a small, constant surprise.
          */}
          <Link href="/profile" className="flex items-center gap-2 opacity-70">
            <Avatar url={avatarUrl} name={profile.username} size={24} />
            <span>{profile.username}</span>
          </Link>
          <form action={signOut}>
            <button type="submit" className="underline opacity-70">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col p-4">{children}</main>
    </div>
  )
}
