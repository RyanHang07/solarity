# Solarity docs

Friends in invite-only Circles (max 10) see each other's daily progress.

## Read this when

| You want to… | Go to |
|---|---|
| Build the next thing | [`build-plan.md`](build-plan.md) — open work only. **Right now that is step 10's manual pass, on a phone** |
| Understand how something works | [`architecture/`](architecture/README.md) — schema, security, time, app |
| Avoid a bug this codebase keeps having | [`patterns.md`](patterns.md) — twenty-three shapes, plus the standing checks |
| Run it, test it, or verify a release | [`testing.md`](testing.md) |
| Know what the product is for | [`product-and-design.md`](product-and-design.md) |
| Find something designed but not built | [`deferred.md`](deferred.md) |
| Know why a past decision went that way | [`history.md`](history.md) — append-only |

## Before you change the schema

1. Assertions at the bottom of the migration.
2. Apply, then prove it in a rolled-back transaction, **both directions**.
3. Regenerate types (`Out-File -Encoding utf8` on Windows, never `>`).
4. `npm run typecheck` (**not bare `tsc`**: the route types are generated), `eslint .`, `npm run test:e2e`.
5. **Commit the migration file.** Applying through the MCP tool records it on the remote and writes nothing to `supabase/migrations/`; the repo then claims a schema it does not have, and nothing in CI notices.
6. Record the reasoning in `history.md`, and any new shape in `patterns.md`.

Full routine in [`patterns.md`](patterns.md#schema-change-routine).

## House style for these docs

- **A claim, then its reason.** Tables and bullets over paragraphs; a reason that took a debugging session to learn is worth a row, not a page.
- **Keep the reasoning.** Most bugs here were found by re-reading an old "why", so compression must not delete it.
- **History is append-only** and lives in one file, so the working documents stay short enough to read daily.
