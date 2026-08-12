// Solarity — self-serve data export (architecture doc section 16).
//
// Deliberately runs the query as the CALLING USER rather than with the service
// key. public.export_user_data() is SECURITY INVOKER, so RLS applies and the
// function is structurally incapable of returning anyone else's rows even if a
// WHERE clause were wrong. Using the service key here would trade that guarantee
// for nothing.
//
// Returns JSON directly rather than uploading to Storage and handing back a
// signed URL. At v1 volumes a user's entire history is small, and streaming it
// back avoids creating an export artifact that then needs its own retention and
// access rules.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase.rpc("export_user_data");

  if (error) {
    console.error("export-data failed", { userId: user.id, err: error.message });
    return new Response(JSON.stringify({ error: "Export failed. Please try again." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const filename = `solarity-export-${new Date().toISOString().slice(0, 10)}.json`;

  return new Response(JSON.stringify(data, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
