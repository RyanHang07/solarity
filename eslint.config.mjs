import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "supabase/functions/**", // Deno runtime, not the Next.js project
    "supabase/.temp/**", // CLI scratch space; gitignored, and it bundles source
  ]),

  // ---------------------------------------------------------------------
  // Confine RPC calls to server actions.
  //
  // A `supabase.rpc()` call from a component works fine and silently skips
  // the rate limiting, Turnstile check, and profanity filter that live in the
  // Next.js layer. RLS still protects the DATA — the RPC's own auth.uid()
  // checks still run — it just becomes unthrottled, which is exactly the kind
  // of failure that's invisible until it isn't.
  //
  // Enforcing this in the database doesn't work: revoking EXECUTE from
  // `authenticated` would force calls through the server, but the RPCs check
  // auth.uid() internally and service_role has none, so all of them would raise
  // "Not authenticated". See architecture.md section 4.
  // ---------------------------------------------------------------------
  {
    files: ["**/*.{ts,tsx}"],
    // `lib/supabase/checkin-date.ts` is the single exemption, and the file
    // explains why: a read-only, argument-free function that both the read
    // path and the write path need, with nothing to rate limit. Confining it
    // to app/actions/ would only mean duplicating it back into the page.
    ignores: ["app/actions/**", "lib/supabase/checkin-date.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='rpc']",
          message:
            "Call RPCs from app/actions/ only. A direct .rpc() from a component skips rate limiting, Turnstile, and the profanity filter. See architecture.md section 4.",
        },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Keep the service key out of anything that can reach the browser.
  // ---------------------------------------------------------------------
  {
    files: ["components/**/*.{ts,tsx}", "app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/supabase/server",
              importNames: ["createAdminClient"],
              message:
                "createAdminClient bypasses RLS and must stay in server actions or route handlers.",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
