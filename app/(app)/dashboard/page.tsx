import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Solarity" }

/**
 * Placeholder shell. The v1 dashboard is the check-in panel, Circles list,
 * Overview and notifications — see product-and-design.md section 3.
 */
export default async function DashboardPage() {
  const supabase = await createClient()

  // No `.eq("user_id", …)`: RLS already restricts this to the caller's
  // Circles, and a second copy of the rule would only be a weaker one.
  const { data: circles } = await supabase
    .from("group_members")
    .select("group_id, role, groups(name, group_status)")
    .order("joined_at", { ascending: true })

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Your Circles</h1>

      {!circles?.length ? (
        <p className="text-sm opacity-70">
          You&apos;re not in a Circle yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {circles.map((m) => (
            <li key={m.group_id} className="rounded border px-3 py-2 text-sm">
              {m.groups?.name} · {m.groups?.group_status} · {m.role}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
