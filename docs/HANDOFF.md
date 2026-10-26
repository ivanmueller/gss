# Current implementation handoff

**Status (2026-10-26):** Phase 0 in progress, not passed. The documentation pack, monorepo tooling, a CI workflow and a read-only `GET /api/v1/health` endpoint exist. No web app, database, migrations, authentication, quotes, trading engine, staging or production deployment exists.

**Last verified artifact:** MASTER_PROJECT_SPECIFICATION.md v1.0 — 2026-10-26.

**Branch:** `claude/new-session-xw1566` (assigned by the Claude Code session, so it does not follow the `feat/GT-###` naming in §12). Commits: `docs: add specification and AI collaboration pack (GT-003)` (the pack as delivered), then `build: bootstrap pnpm monorepo, CI and API health endpoint (GT-002, GT-004)`. `main` was created from the docs commit; the bootstrap commit reaches `main` by PR from this branch.

## Phase 0 tickets

| Ticket | State | Notes |
|---|---|---|
| GT-001 private repo, permissions, protected main | **Not done** | `ivanmueller/gss` is **public**, by the owner's choice on 2026-10-26; the spec requires private. `main` exists but has no branch protection. Owner action. |
| GT-002 monorepo tooling | Done | pnpm 10.28.0 workspace (`apps/*`, `packages/*`), strict TypeScript 6.0, ESLint 10 with typescript-eslint strict type-checked rules, Prettier, Vitest 5. |
| GT-003 AGENTS.md, adapters, docs, templates | Done in repo | Instruction loading verified for Claude Code only (its session loaded `CLAUDE.md` and the `@AGENTS.md` import). Codex and Gemini CLI not yet verified. |
| GT-004 CI typecheck/lint/test | Written, not yet run on GitHub | `.github/workflows/ci.yml`, workflow `CI`, job `check`. Blocking merges needs it set as a required check under branch protection (GT-001). Dependabot config added for npm and GitHub Actions (§10.1). |
| GT-005 dev/staging secret management | Not done | Only `.gitignore` rules (`.env*`, `.dev.vars`) and a key-names-only `.env.example`. No Cloudflare or Supabase secret stores exist. |

## Tests run (2026-10-26, local, Node 22.22.0, pnpm 10.28.0)

- `pnpm check`: Prettier check, ESLint and `tsc --noEmit` clean; Vitest 3 of 3 pass (`apps/api/src/index.test.ts`).
- Gates bite: a deliberate type error failed typecheck and lint, and a deliberately wrong expectation failed the tests; both reverted.
- `pnpm --filter @grain/api dev` (wrangler 4.153, workerd 1.20261023.1): `GET /api/v1/health` → 200 `{"status":"ok","service":"api"}` with `Cache-Control: no-store`; `POST` → 404.
- Not run: CI on GitHub, Workers-runtime unit tests, any deployment, any security or RLS test (nothing to test yet).

## Dependencies added

| Package | Why |
|---|---|
| `hono` | API framework chosen in the spec. |
| `wrangler` | Local Workers runtime now; staging/production deploys later. |
| `@cloudflare/workers-types` | Types for Worker globals under strict typecheck. |
| `typescript` ~6.0.3 | Strict TypeScript; 7.x is not used yet (see `docs/DECISIONS.md`). |
| `vitest` | Unit test runner named in the spec. |
| `eslint`, `@eslint/js`, `typescript-eslint` | Lint (§12). |
| `prettier` | Formatting (§12). |

## Blockers

1. Repository visibility: public (owner accepted for now), while the spec requires a private repository. Keep it to the specification and synthetic data until it is private.
2. No branch protection on `main`, so a failing PR can still be merged.

## Next exact task

Owner: make the repository private, protect `main` with the `check` job of workflow `CI` as a required status check and at least one reviewer, then merge this branch by PR. Prove the Phase 0 gate with a sample PR that fails CI and cannot merge, and confirm Codex and Gemini CLI load `AGENTS.md`. Then GT-005 (secrets), then Phase 1 starting with GT-010 (`apps/web` React/Vite scaffold).

**Instruction for next agent:** Read `AGENTS.md` first; do not claim any feature is implemented merely because it appears in the specification. After any real development session, record the latest commit, tests run/results, changed files, operational blockers, and the next exact task in this file.
