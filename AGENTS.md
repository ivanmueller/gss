# Agent instructions — Canadian–U.S. Physical Grain Trading Platform

This is a **Phase 0 project**: documentation, monorepo tooling, CI and a read-only API health endpoint. No working application or live data exists. Before coding, read the *relevant sections* of `MASTER_PROJECT_SPECIFICATION.md` and current status in `docs/HANDOFF.md`.

## Mission
Build a secure, auditable Canadian-to-U.S. physical grain trading operations platform. The map is for discovery; executable economics comes from validated bid/offer records, quote delivery terms, source FX and freight inputs, and a deterministic saved scenario snapshot.

## Intended architecture
- One private GitHub monorepo; React/Vite/strict TypeScript frontend; Hono API on Cloudflare Workers.
- Supabase Postgres/PostGIS, Supabase Auth, private Storage, organization-aware access.
- Shared domain/validation packages and a pure TypeScript trading-engine package using **decimal**, never JS float, for monetary arithmetic.
- MapLibre GL JS with a properly licensed map tile provider.
- Python is out of scope until analytics or optimization justifies it.

## Always follow
1. Source of design intent: `MASTER_PROJECT_SPECIFICATION.md`. Per-module details: `docs/`. **Do not invent market prices, routing fees, FX quotes or regulatory outcomes.** Label all synthetic data.
2. A quote must carry side, commodity/grade, numeric units, currency, delivery basis, valid time, available quantity and provenance. Treat indicative/stale as non-executable.
3. Normalize quantity/FX explicitly. Missing FX, freight or unit conversion must **block** margin calculations; do not treat missing as zero. Preserve quote revision IDs and calculation engine version in every saved scenario.
4. Enforce organization isolation server-side; no browser service-role secrets; limit grants/RLS, secure private files; test cross-tenant denials.
5. Do not alter an executed/saved historical calculation in place. Version changes and audit them.
6. Use schema migrations for changes; add tests for every financial calculation, permission change and bug fix.
7. Use independent Git branch/worktree per agent; no direct commits to protected main; open PR describing tests, migrations, risks, assumptions and docs touched.
8. No AI model can autonomously commit a real grain trade, approve a payment, execute a hedge, or send contract offers to third parties.
9. Do not add microservices, runtime LLM agent frameworks, vector DBs or predicted pricing to v1 without an approved architecture decision.
10. Always update `docs/HANDOFF.md` with actual work performed and tests run. Never claim an unbuilt feature works.

## Read by task
- UX: `docs/PRODUCT.md`.
- Schema: `docs/DATA_MODEL.md` and `docs/ARCHITECTURE.md`.
- API: `docs/API.md`.
- Financial logic: `docs/TRADING_RULES.md` + `docs/ACCEPTANCE_TESTS.md`.
- Tickets: `docs/BUILD_PLAN.md`.
- Agent collaboration: `docs/AI_WORKFLOW.md`.
- Open decisions: `docs/DECISIONS.md`.

## Commands
- `pnpm install`
- `pnpm check`: format check, lint, typecheck and tests, the same steps CI runs.
- `pnpm format`: apply Prettier (Markdown is excluded).
- `pnpm --filter @grain/api dev`: local Worker at `http://localhost:8787/api/v1/health`.

## Completion definition
Run and report lint, TypeScript typecheck, relevant unit/integration tests, security/RLS tests where needed and a staged end-to-end smoke test for user-visible changes. If test infrastructure does not exist yet, explicitly state that and create it in the current approved phase.
