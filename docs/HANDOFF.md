# Current implementation handoff

Maintained by the integration owner after each verified merge (`AGENTS.md` rule 10). Feature branches put proposed handoff details in their PR instead. This update was written by Claude Code at the owner's request and records merged state only.

**Status (2026-10-27):** Phase 0 nearly passed (open items below); Phase 1 started with GT-010. On `main`: the documentation pack, monorepo tooling, CI with a required `check`, a staging deploy on every merge, a read-only `GET /api/v1/health` endpoint and the web app shell on synthetic data. No database, migrations, authentication, real quotes, trading engine or production deployment exists.

**Last verified merge:** `d33a9b5`, ivanmueller/gss#7 (web app shell). Deploy staging run #3 then passed its smoke test on https://grain-trading-api-staging.ivan-mueller02.workers.dev/ : `/api/v1/health` → `{"status":"ok","service":"api"}`, `/` → web app, `/api/v1/does-not-exist` → 404.

**Last verified artifact:** MASTER_PROJECT_SPECIFICATION.md v1.0, AI delivery workflow clarified 2026-10-26.

## Phase 0 tickets

| Ticket | State | Notes |
|---|---|---|
| GT-001 private repo, permissions, protected main | Partly done | `main` is protected and `CI / check` is a required status (seen on ivanmueller/gss#7). Admin bypass is still allowed. The repository is **public** by the owner's choice; the spec requires private, and branch protection on a private repo needs a paid GitHub plan. |
| GT-002 monorepo tooling | Done | pnpm 10.28.0 workspace (`apps/*`, `packages/*`, `tests/e2e`), strict TypeScript 6.0, ESLint 10 with typescript-eslint strict type-checked rules, Prettier, Vitest 5. |
| GT-003 AGENTS.md, adapters, docs, templates | Done in repo | Claude Code verified loading `AGENTS.md` (via `CLAUDE.md`). The chosen independent reviewer (Codex proposed) is not yet verified. |
| GT-004 CI typecheck/lint/test | Done | Workflow `CI`, job `check`: format, lint, typecheck, unit tests, build. Required on `main`. Dependabot for npm and GitHub Actions. |
| GT-005 dev/staging secret management | Partly done | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are GitHub repository secrets used only by the push-to-main deploy. Owner to record the token's expiry date. No Supabase secrets yet. |

## Phase 1

| Ticket | State | Notes |
|---|---|---|
| GT-010 scaffold React/Vite/Worker/Hono | Done | `apps/web` (React 19, Vite 8, Tailwind 4, shadcn/ui-style components) served by the `apps/api` Worker on staging, same origin as the API. Synthetic data only: four fictional facilities and the golden-fixture prices. Map is a placeholder until GT-023 picks a licensed tile provider. |
| GT-011 onward | Not started | Supabase projects, auth with MFA, organizations, migrations. |

## Tests run on the merged state

- CI `check` green on ivanmueller/gss#7: `pnpm check` (API 3/3, web 24/24 unit and component tests) and `pnpm build`.
- Deploy staging run #3: `pnpm check`, `pnpm build`, `wrangler deploy --env staging`, smoke test above.
- Before merge, locally: Playwright Chromium at desktop and phone sizes against `wrangler dev --env staging` (selection by mouse and keyboard, no sideways scroll on phones, no console errors).
- Not run: security or RLS tests (no data layer yet), a failing sample PR against branch protection.

## Blockers and open choices

1. Repository visibility: public, while the spec requires private. Keep it to the specification and synthetic data until that changes.
2. Independent reviewer not chosen and verified (Phase 0 gate). `docs/AI_CODING_SYSTEM.md` proposes Codex.
3. Staging is open to anyone with the URL. Add Cloudflare Access before authentication or any non-synthetic data reaches it.
4. Thin-slice prerequisites: decide whether audit logging (GT-016) comes before or with the first quote tables.

## Next exact task

Merge the open browser-test PR (Playwright in CI, GitHub Actions updates superseding Dependabot #2–#4). Then GT-011: the owner creates Supabase dev and staging projects; Claude Code sets up the Supabase CLI, the migration chain and the first organization/membership tables with RLS tests (GT-013, GT-014), then sign-in with MFA (GT-012).

**Instruction for next agent:** Read `AGENTS.md` first; do not claim any feature is implemented merely because it appears in the specification. Include handoff details in your PR. **Only the integration owner updates this file after an actual merge** with its latest commit, verified tests/results, changed files, blockers, and next task.
