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

  /**
   * Step 20d. **An account can exist with an address nobody has proved they
   * own**, and only a gate catches it.
   *
   * **The original note here was wrong and is worth correcting rather than
   * deleting.** It said `signUp` returns a session, so closing the tab left a
   * signed-in account on an unverified address. With "Confirm email" on — our
   * configuration — `signUp` returns `session: null`, so that person is signed
   * *out* and the proxy sends them to sign-in long before this line runs. The
   * same mistake left the resend control on `/auth/check-email` invisible,
   * which is how it was found.
   *
   * So what does reach this check? Configuration and providers, not the signup
   * form: "Confirm email" being turned off later, an OAuth provider that hands
   * back an address it has not verified, or an account created through the
   * dashboard without confirmation. **A cheap defence against a setting
   * changing**, rather than the main path it was written as.
   *
   * **Free.** `email_confirmed_at` is on the object `getUser()` already
   * returned; this costs no query.
   *
   * **Google accounts are unaffected**, and that was checked against the data
   * rather than assumed: Google verifies the address, so Supabase sets
   * `email_confirmed_at` at sign-in. All three accounts that predate step 20
   * have it. Had they not, adding this line would have locked every one of them
   * out of the app behind a screen that did not exist yet.
   */
  if (!user.email_confirmed_at) redirect("/auth/check-email")

  const { data: profile } = await supabase
    .from("users")
    .select("username, avatar_url, terms_accepted_at")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.username) redirect("/onboarding")

  /**
   * Step 20c. **A gate rather than a flow**, for the same reason as the
   * username check above it: any of these can be abandoned midway, and only
   * something evaluated on every protected navigation catches that.
   *
   * Reached by exactly two kinds of account. One is somebody who signed in with
   * Google before there was anything to agree to, which is everybody who
   * existed before migration 105. The other is nobody: a signup records
   * acceptance inside `complete_onboarding`, so the front door never queues
   * this screen behind it.
   *
   * **Ordered after the username on purpose.** `/onboarding/terms` needs a
   * username to exist before it means anything, and reversing the two would put
   * a terms screen in front of an account that has no profile yet.
   *
   * The column is free: it comes back in the read the layout already does.
   */
  if (!profile.terms_accepted_at) redirect("/onboarding/terms")


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
