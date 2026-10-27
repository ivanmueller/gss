# Current implementation handoff

Maintained by the integration owner after each verified merge (`AGENTS.md` rule 10). Feature branches put proposed handoff details in their PR instead. This update was written by Claude Code at the owner's request and records merged state only.

**Status (2026-10-27):** Phase 0 nearly passed (open items below); Phase 1 in progress. On `main`: the documentation pack, monorepo tooling, CI with a required `check` (unit, database and browser tests), a staging deploy on every merge, a read-only `GET /api/v1/health` endpoint, the web app shell on synthetic data, and the first database migrations (private `app` schema, `app_api` role, organizations and memberships with row level security), applied to `gss-staging`. No authentication, real quotes, trading engine or production deployment exists.

**Last verified merge:** `8c58973`, ivanmueller/gss#9 (database foundation). Deploy staging run #5 applied both migrations to `gss-staging` (`supabase db push`: "Applying migration 20261027020000…", "…20261027020100…", "Finished supabase db push."), then deployed the Worker; smoke test passed on https://grain-trading-api-staging.ivan-mueller02.workers.dev/ (health, `/` serves the app, unknown `/api/*` → 404).

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
| GT-012 auth and MFA | In progress | Email + password with required authenticator-app (TOTP) MFA; no public sign-up. |
| GT-013 organizations and memberships | Partly done | Tables, roles enum, read-only RLS for `app_api`, 45 pgTAP tests. Role capabilities and member management not started. |
| GT-014 migrations and least-privilege access | Done | `supabase/migrations`, `app_api` role, migrations applied to staging on merge. `app_api` has no login yet. |

## Tests run on the merged state

- CI `check` green on ivanmueller/gss#9: `pnpm check` (API 3/3, web 24/24), `pnpm build`, `supabase db start` + `supabase test db` (45 pgTAP assertions on Supabase's image), Playwright 7/7.
- Independent review: Codex reviewed ivanmueller/gss#9 and requested changes on two P2 findings (privileged pre-existing `app_api`; missing membership-table denials); both fixed and verified by reproducing each before the fix.
- Deploy staging run #5: migrations applied to `gss-staging`, Worker deployed, smoke test passed.
- Not run: a failing sample PR against branch protection.

## Blockers and open choices

1. Repository visibility: public, while the spec requires private. Real data must never be committed; it goes only into the database.
2. Real data in `gss-staging` (owner's decision): free plan, no self-service backups, pauses after about a week idle. Keep the source spreadsheet as the backup until a paid plan and restore drill exist.
3. Codex's explicit `AGENTS.md` loading check not yet recorded (Phase 0 gate).
4. Thin-slice prerequisites: decide whether audit logging (GT-016) comes before or with the first quote tables.

## Next exact task

GT-012: sign-in with email, password and required TOTP MFA, verified by the Worker on every API request. Then connect the Worker to the database as `app_api` and return the user's organizations from `GET /api/v1/me`. Then the buyer list: tables for the owner's fields (counterparties, contacts, facilities) and an import path.

**Instruction for next agent:** Read `AGENTS.md` first; do not claim any feature is implemented merely because it appears in the specification. Include handoff details in your PR. **Only the integration owner updates this file after an actual merge** with its latest commit, verified tests/results, changed files, blockers, and next task.
