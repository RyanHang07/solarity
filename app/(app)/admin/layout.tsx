import Link from "next/link"
import { notFound } from "next/navigation"
import { amIAdmin } from "@/app/actions/admin"

export const metadata = { title: "Admin — Solarity" }

/**
 * Step 17. The gate, and the shape every admin screen sits in.
 *
 * **`notFound()`, not a redirect and not a 403.** A 403 confirms the route
 * exists and that there is something behind it worth being refused from. A 404
 * says only what a wrong URL says. The database refuses independently — every
 * admin RPC checks `private.is_admin()` first — so this is the courtesy and
 * that is the control.
 *
 * **Outside `(shell)` on purpose.** The four-tab bar is the product; this is
 * the back office, and putting Overview and Circles across the top of a
 * moderation queue would invite doing one while distracted by the other.
 *
 * It keeps `(app)/layout.tsx` above it, so the session and onboarding gates
 * still apply and the header still says who you are signed in as — which on
 * this screen is the thing most worth knowing.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!(await amIAdmin())) notFound()

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <h1 className="text-xl font-semibold">Admin</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin" className="underline opacity-70">
            Reports
          </Link>
          <Link href="/admin/people" className="underline opacity-70">
            Administrators
          </Link>
          <Link href="/dashboard" className="underline opacity-70">
            Back to the app
          </Link>
        </nav>
      </header>
      {children}
    </div>
  )
}
