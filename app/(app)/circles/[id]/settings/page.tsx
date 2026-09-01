import Link from "next/link"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { InvitePanel } from "./invite-panel"
import { InvitePersonPanel } from "./invite-person-panel"
import { ArchivePanel } from "./archive-panel"

export const metadata = { title: "Circle settings — Solarity" }

export default async function CircleSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/sign-in")

  const { data: circle } = await supabase
    .from("groups")
    .select("id, name, group_status")
    .eq("id", id)
    .maybeSingle()

  if (!circle) redirect("/dashboard?notice=circle-unavailable")

  const { data: me } = await supabase
    .from("group_members")
    .select("role")
    .eq("group_id", id)
    .eq("user_id", user.id)
    .maybeSingle()

  // Defensive, not a normal path: nothing links a plain member here. Sent to
  // the Circle rather than the dashboard, since they can see the Circle fine.
  const isAdmin = me?.role === "owner" || me?.role === "admin"
  if (!isAdmin) redirect(`/circles/${id}`)

  // `.limit(1)` rather than `.maybeSingle()`. Only `create_invite_link` keeps
  // there to one enabled row; the schema permits several, so a second row would
  // turn this page into an error instead of showing the newest link.
  const { data: links } = await supabase
    .from("invite_links")
    .select("token, expires_at")
    .eq("group_id", id)
    .eq("enabled", true)
    .order("created_at", { ascending: false })
    .limit(1)

  const link = links?.[0] ?? null

  // An enabled row past its expiry is still enabled. Nothing sweeps them, and
  // `join_circle` is the thing that refuses, so the page has to work this out
  // rather than trust the flag.
  const expired = !!link?.expires_at && new Date(link.expires_at) < new Date()

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href={`/circles/${id}`} className="text-sm underline opacity-70">
          Back to {circle.name}
        </Link>
        <h1 className="text-xl font-semibold">Circle settings</h1>
        <p className="text-sm opacity-70">
          You are {me?.role === "owner" ? "the owner" : "an admin"}.
        </p>
      </header>

      {/*
        Step 18. **Above the link, because it is the better answer to the same
        question.** Somebody opening this page wants another person in their
        Circle; the link is the fallback for a person who is not on Solarity
        yet, and the search is the direct route for one who is.

        Only while the Circle is active, and the RPC refuses anyway: a search
        box on an archived Circle would be a control that can only fail.
      */}
      {circle.group_status === "active" ? <InvitePersonPanel groupId={id} /> : null}

      {circle.group_status === "active" ? (
        <InvitePanel
          groupId={id}
          token={link?.token ?? null}
          expiresAt={link?.expires_at ?? null}
          expired={expired}
        />
      ) : (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Invite link</h2>
          <p className="text-sm opacity-70">
            This Circle is {circle.group_status}, so it can&apos;t take new
            members and any link it had was turned off automatically.
          </p>
        </section>
      )}

      {/* Owner only. An admin manages members and links; retiring the Circle is
          the one act with no undo, so it stays with the owner. The RPC enforces
          this regardless; hiding it just avoids offering a button that fails. */}
      {me?.role === "owner" && circle.group_status !== "archived" ? (
        <ArchivePanel groupId={id} circleName={circle.name} />
      ) : null}
    </div>
  )
}
