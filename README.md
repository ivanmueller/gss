# Grain Trading Platform

Canadian–U.S. physical grain trading operations platform. The repository is at the **Phase 0 bootstrap** stage: the specification pack, monorepo tooling, CI and a read-only API health endpoint. No web app, database, authentication, quotes, trading engine or deployment exists yet; `docs/HANDOFF.md` records the last merged state.

1. Read `MASTER_PROJECT_SPECIFICATION.md` for product and technical requirements.
2. Read `docs/BUILD_PLAN.md` for staged work and its early end-to-end demonstration path.
3. **Read `docs/AI_CODING_SYSTEM.md` for the October 2026 tool choices and practical multi-agent coding setup**; `docs/AI_WORKFLOW.md` describes Git/PR governance.
4. Every agent follows root `AGENTS.md` (Claude Code via `CLAUDE.md`, Gemini CLI via `.gemini/settings.json`; Cursor and Codex also recognize `AGENTS.md`). Verify instruction loading in your selected tool.
5. Use dedicated issue/PR branches and templates. The integration owner updates `docs/HANDOFF.md` **after** each verified merge, not separately in parallel feature branches.
6. See `docs/CHANGELOG.md` for changes made to this documentation pack.

**Initial AI workflow:** Evaluate Cursor 3 Agents Window as the primary hub, Claude for implementation, Codex for independent review, and Gemini for targeted alternate approaches. Claude Code or Google Antigravity 2.0 may replace the primary interface after a small controlled comparison. This is a **recommendation**, not a requirement or configured integration.

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

## Staging deploy

Each merge to `main` runs `.github/workflows/deploy-staging.yml`: it repeats `pnpm check`, deploys `apps/api` with `wrangler deploy --env staging` to `https://grain-trading-api-staging.<subdomain>.workers.dev`, and checks that `/api/v1/health` answers. Until the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist, it skips with a notice. Staging holds synthetic data only.

## Layout

```
apps/api/            Hono API on Cloudflare Workers (health endpoint only)
packages/            shared packages (domain, trading-engine, database) — none yet
docs/                specification sections, AI coding system, decisions, handoff, changelog
.github/             CI workflow, Dependabot, issue and PR templates
```
