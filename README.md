# Grain Trading Platform

Canadian–U.S. physical grain trading operations platform. The repository is at the **Phase 0 bootstrap** stage: the specification pack, monorepo tooling, CI and a read-only API health endpoint. No web app, database, authentication, quotes, trading engine or deployment exists yet; `docs/HANDOFF.md` records the real current state.

1. Read `MASTER_PROJECT_SPECIFICATION.md` for the complete product and technical requirements.
2. Read `docs/BUILD_PLAN.md` for the order of work, beginning with Phase 0.
3. AI coding agents use `AGENTS.md` (Claude via `CLAUDE.md`, Gemini CLI via `.gemini/settings.json`).
4. Keep project execution notes in `docs/HANDOFF.md` after each merged PR.
5. Use the included GitHub issue/PR templates to share scope and acceptance criteria across AI models.

**Recommended stack:** React/Vite, TypeScript, Hono/Cloudflare Workers, Supabase PostgreSQL/PostGIS/Auth/Storage, MapLibre; pnpm, Vitest, Playwright.

**Important:** Do not publish live grain prices, counterparty contact data, geocoordinates of private farms, credentials, or real contract documents in a public repository or as unredacted prompts to AI tools.

## Quick start

Requires Node.js 22.13 or later and pnpm 10.28 (`corepack enable` picks up the version pinned in `package.json`).

```sh
pnpm install
pnpm check                      # format check, lint, typecheck, tests (same as CI)
pnpm --filter @grain/api dev    # local Worker: http://localhost:8787/api/v1/health
```

`pnpm format` rewrites code to the Prettier style. Markdown is not reformatted, so the specification pack stays as delivered.

## Layout

```
apps/api/            Hono API on Cloudflare Workers (health endpoint only)
packages/            shared packages (domain, trading-engine, database) — none yet
docs/                specification sections, decisions, handoff
.github/             CI workflow, Dependabot, issue and PR templates
```
