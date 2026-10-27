# Current implementation handoff

Maintained by the integration owner after each verified merge (`AGENTS.md` rule 10). Feature branches put proposed handoff details in their PR instead. This update was written by Claude Code at the owner's request and records merged state only.

**Status (2026-10-27):** Phase 0 nearly passed (open items below); Phase 1 in progress. On `main`: the documentation pack, monorepo tooling, CI with a required `check` (unit, database and browser tests), a staging deploy on every merge, the web app shell on synthetic data, the first database migrations (private `app` schema, `app_api` role, organizations and memberships with row level security) applied to `gss-staging`, sign-in with email, password and a required authenticator code, and `GET /api/v1/me`, which reads the signed-in user's organizations from Postgres as `app_api`. No buyer list, real quotes, trading engine or production deployment exists.

**Last verified merge:** `e39cbcb`, ivanmueller/gss#12 (counterparty directory with logos and spreadsheet import; Codex's ivanmueller/gss#11 findings fixed). CI green (pnpm check, pgTAP, API database tests, Playwright 14/14); Deploy staging run #8 applied `20261027030000` and `20261027030100` to `gss-staging` and deployed the Worker. Open: the staging Worker cannot reach Supabase directly (Supabase's private CA), so `/api/v1/me` answers 503 until the Hyperdrive binding lands.

**Last verified artifact:** MASTER_PROJECT_SPECIFICATION.md v1.0, AI delivery workflow clarified 2026-10-26.

## Phase 0 tickets

| Ticket | State | Notes |
|---|---|---|
| GT-001 private repo, permissions, protected main | Partly done | `main` is protected and `CI / check` is a required status (seen on ivanmueller/gss#7). Admin bypass is still allowed. The repository is **public** by the owner's choice; the spec requires private, and branch protection on a private repo needs a paid GitHub plan. |
| GT-002 monorepo tooling | Done | pnpm 10.28.0 workspace (`apps/*`, `packages/*`, `tests/e2e`), strict TypeScript 6.0, ESLint 10 with typescript-eslint strict type-checked rules, Prettier, Vitest 5, Playwright 1.63, Supabase CLI 2.122. |
| GT-003 AGENTS.md, adapters, docs, templates | Done in repo | Claude Code verified loading `AGENTS.md` (via `CLAUDE.md`). Codex is acting as independent reviewer (it reviewed ivanmueller/gss#9 against `AGENTS.md`); its explicit instruction-loading check is still to be recorded. |
| GT-004 CI typecheck/lint/test | Done | Workflow `CI`, job `check`: format, lint, typecheck, unit tests, build. Required on `main`. Dependabot for npm and GitHub Actions. |
| GT-005 dev/staging secret management | Partly done | GitHub repository secrets used only by the push-to-main deploy: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_STAGING_DB_URL` (session-pooler URL for `gss-staging`). Owner to record the Cloudflare token's expiry date. |

## Phase 1

| Ticket | State | Notes |
|---|---|---|
| GT-010 scaffold React/Vite/Worker/Hono | Done | `apps/web` (React 19, Vite 8, Tailwind 4, shadcn/ui-style components) served by the `apps/api` Worker on staging, same origin as the API. Synthetic data only: four fictional facilities and the golden-fixture prices. Map is a placeholder until GT-023 picks a licensed tile provider. |
| GT-011 Supabase projects | Done (one project) | `gss-staging` (ref `nfwizbcpjpqxdoojfbdr`); CI and local use a throwaway local Supabase. The owner chose to keep real data in `gss-staging` for now (see `docs/DECISIONS.md`). |
| GT-012 auth and MFA | Done | Supabase Auth email + password with required authenticator-app (TOTP) MFA; no self sign-up (administrators create users). The Worker verifies every token with Supabase Auth and requires `aal2` on every route except `/health`. Owner verified on staging. |
| GT-013 organizations and memberships | Partly done | Tables, roles enum, read-only RLS for `app_api`, 45 pgTAP tests. `GET /api/v1/me` returns the user's active organizations and roles; the header shows the organization. On `gss-staging` the owner created their organization and `org_admin` membership by SQL. Role capabilities and member management not started. |
| GT-014 migrations and least-privilege access | Done | `supabase/migrations`, `app_api` role, migrations applied to staging on merge. Migrations never give `app_api` a login (a pgTAP test checks); on `gss-staging` the owner set its password, and the Worker connects as `app_api` through the transaction pooler using the Worker secret `DATABASE_URL`. |

## Tests run on the merged state

- CI `check` green on ivanmueller/gss#11 (commit `5faef27`): `pnpm check` (API 23/23, web 35/35), `pnpm build`, `supabase test db` (45/45 pgTAP on Supabase's image), `pnpm --filter @grain/api test:db` (5/5 as `app_api` against the same database), Playwright 11/11 (sign-in with TOTP, header shows the synthetic organization).
- The first CI run on ivanmueller/gss#11 failed pgTAP test 9 because CI gave `app_api` its login before the suite; fixed by enabling it after the suite (test unchanged), reproduced locally before the fix.
- Independent review: Codex reviewed ivanmueller/gss#9 (two P2 findings, both fixed and verified). No Codex review is recorded on ivanmueller/gss#10 or ivanmueller/gss#11.
- Deploy staging runs #6 and #7: Worker deployed, smoke test passed.
- Not verified by an agent: the signed-in header on staging showing the owner's organization (the agent's container cannot reach the staging host); the owner to confirm.
- Not run: a failing sample PR against branch protection.

## Blockers and open choices

1. Repository visibility: public, while the spec requires private. Real data must never be committed; it goes only into the database.
2. Real data in `gss-staging` (owner's decision): free plan, no self-service backups, pauses after about a week idle. Keep the source spreadsheet as the backup until a paid plan and restore drill exist.
3. Codex's explicit `AGENTS.md` loading check not yet recorded (Phase 0 gate).
4. Thin-slice prerequisites: decide whether audit logging (GT-016) comes before or with the first quote tables.
5. Sign-in and database access merged without a recorded independent review (ivanmueller/gss#10, ivanmueller/gss#11); a Codex review of `apps/api/src/auth.ts` and `apps/api/src/db.ts` on `main` is still worth doing.

## Next exact task

The buyer list: migrations for counterparties (with a PNG logo), contacts and facilities, organization-scoped RLS and pgTAP tests including cross-organization denials, read API endpoints, a buyer list screen, and a spreadsheet import path. Real buyer rows go only into the database, never into Git.

**Instruction for next agent:** Read `AGENTS.md` first; do not claim any feature is implemented merely because it appears in the specification. Include handoff details in your PR. **Only the integration owner updates this file after an actual merge** with its latest commit, verified tests/results, changed files, blockers, and next task.
