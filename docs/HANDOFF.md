# Current implementation handoff

Maintained by the integration owner after each verified merge (`AGENTS.md` rule 10). Feature branches put proposed handoff details in their PR instead.

**Status (2026-10-26):** Phase 0 in progress, not passed. On `main`: the documentation pack, monorepo tooling, a CI workflow and a read-only `GET /api/v1/health` endpoint. No web app, database, migrations, authentication, quotes, trading engine, staging or production deployment exists.

**Last verified merge:** `2b7dd07`, ivanmueller/gss#1 (Phase 0 bootstrap). Documentation-only updates after it are listed in `docs/CHANGELOG.md`.

**Last verified artifact:** MASTER_PROJECT_SPECIFICATION.md v1.0, AI delivery workflow clarified 2026-10-26.

## Phase 0 tickets

| Ticket | State | Notes |
|---|---|---|
| GT-001 private repo, permissions, protected main | **Not done** | `ivanmueller/gss` is **public**, by the owner's choice on 2026-10-26; the spec requires private. `main` has no branch protection. Owner action. |
| GT-002 monorepo tooling | Done | pnpm 10.28.0 workspace (`apps/*`, `packages/*`), strict TypeScript 6.0, ESLint 10 with typescript-eslint strict type-checked rules, Prettier, Vitest 5. |
| GT-003 AGENTS.md, adapters, docs, templates | Done in repo | Updated with the AI workflow pack (`docs/AI_CODING_SYSTEM.md`). The revised gate needs the chosen implementer and independent reviewer to load `AGENTS.md`: verified for Claude Code only (it loaded `CLAUDE.md` and the `@AGENTS.md` import). Codex, the proposed reviewer, is not yet verified; Gemini only if it is used. |
| GT-004 CI typecheck/lint/test | Running, not yet enforced | Workflow `CI`, job `check`, passed on ivanmueller/gss#1 (head `bc4afe1`). Blocking merges needs it as a required check under branch protection (GT-001). Dependabot configured for npm and GitHub Actions. |
| GT-005 dev/staging secret management | Not done | Only `.gitignore` rules (`.env*`, `.dev.vars`) and a key-names-only `.env.example`. No Cloudflare or Supabase secret stores exist. |

## Tests run on the merged bootstrap

- Local (Node 22.22.0, pnpm 10.28.0): `pnpm check` clean; Vitest 3 of 3 pass (`apps/api/src/index.test.ts`). A deliberate type error failed typecheck and lint, and a wrong expectation failed the tests. A fresh clone with `pnpm install --frozen-lockfile` passes `pnpm check`.
- `pnpm --filter @grain/api dev` (wrangler 4.153, workerd 1.20261023.1): `GET /api/v1/health` → 200 `{"status":"ok","service":"api"}` with `Cache-Control: no-store`; `POST` → 404.
- GitHub Actions: `check` passed on ivanmueller/gss#1.
- Not run: Workers-runtime unit tests, any deployment, any security or RLS test (nothing to test yet), a failing sample PR against branch protection.

## Dependencies on `main`

| Package | Why |
|---|---|
| `hono` | API framework chosen in the spec. |
| `wrangler` | Local Workers runtime now; staging/production deploys later. |
| `@cloudflare/workers-types` | Types for Worker globals under strict typecheck. |
| `typescript` ~6.0.3 | Strict TypeScript; 7.x is not used yet (see `docs/DECISIONS.md`). |
| `vitest` | Unit test runner named in the spec. |
| `eslint`, `@eslint/js`, `typescript-eslint` | Lint (§12). |
| `prettier` | Formatting (§12). |

## Blockers and open choices

1. Repository visibility: public (owner accepted for now), while the spec requires a private repository. Keep it to the specification and synthetic data until it is private.
2. No branch protection on `main`, so a failing PR can still be merged.
3. Primary coding hub and reviewer not chosen. `docs/AI_CODING_SYSTEM.md` recommends Cursor 3 with Claude implementing and Codex reviewing, decided by a one-time comparison (§10) before standardizing paid tools.

## Next exact task

Owner: protect `main` with the `check` job of workflow `CI` as a required status check and at least one reviewer, then prove the Phase 0 gate with a sample PR that fails CI and cannot merge. Choose the implementer and independent reviewer, and verify the reviewer loads `AGENTS.md`; do not buy subscriptions only to prove an unused agent works. Optionally run the tool comparison in `docs/AI_CODING_SYSTEM.md` §10 first. Then GT-005 (secrets) and making the repository private (GT-001).

After Phase 0: Phase 1 from GT-010 (`apps/web` React/Vite scaffold). The thin trade vertical slice in `docs/BUILD_PLAN.md` starts once GT-013–GT-015 are merged and the quote/API/engine contracts are agreed.

**Instruction for next agent:** Read `AGENTS.md` first; do not claim any feature is implemented merely because it appears in the specification. Include handoff details in your PR. **Only the integration owner updates this file after an actual merge** with its latest commit, verified tests/results, changed files, blockers, and next task.
