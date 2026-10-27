# Grain Trading Platform

Canadian–U.S. physical grain trading operations platform. The repository has the Phase 0 tooling, CI and a staging deploy, plus the GT-010 web app shell: the workspace layout with **synthetic** facilities and quotes, served by the same Cloudflare Worker as the API. No database, authentication, real quotes, trading engine or production deployment exists yet; `docs/HANDOFF.md` records the last merged state.

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
pnpm check                      # format check, lint, typecheck, tests (CI also runs pnpm build)
pnpm --filter @grain/api dev    # API Worker: http://localhost:8787/api/v1/health
pnpm --filter @grain/web dev    # web app with hot reload: http://localhost:5173 (proxies /api to :8787)
pnpm preview:staging            # build, then serve web + API together as on staging: http://localhost:8787
pnpm e2e                        # build, then run the Playwright browser tests (desktop and phone)
```

`pnpm e2e` needs Chromium for Playwright 1.63.0: run `pnpm --filter @grain/e2e exec playwright install chromium` once.

`pnpm format` rewrites code to the Prettier style. Markdown is not reformatted, so the specification pack stays as delivered.

## Staging deploy

Each merge to `main` runs `.github/workflows/deploy-staging.yml`: it repeats `pnpm check`, builds the web app, deploys `apps/api` with `wrangler deploy --env staging` to `https://grain-trading-api-staging.<subdomain>.workers.dev` (the Worker serves `apps/web/dist` alongside the API), and checks `/api/v1/health`, the web page at `/`, and that unknown `/api/*` paths return 404. Until the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist, it skips with a notice. Staging holds synthetic data only.

## Database

Supabase Postgres. Migrations live in `supabase/migrations/` and pgTAP tests in `supabase/tests/`.

- **Pull requests:** CI starts a throwaway local Supabase, applies every migration from scratch and runs `supabase test db`.
- **Staging:** after a merge, the Deploy staging workflow runs `supabase db push` against the hosted `gss-staging` project (ref `nfwizbcpjpqxdoojfbdr`). It skips with a notice until the `SUPABASE_STAGING_DB_URL` repository secret exists.
- **Locally (optional):** with Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development), run `supabase db start` then `supabase test db`.

Application tables live in the private `app` schema, which the Supabase Data API does not expose; the API Worker will reach them as the least-privilege `app_api` role (`docs/DECISIONS.md`).

## Layout

```
apps/api/            Hono API on Cloudflare Workers (health endpoint only); serves apps/web on staging
apps/web/            React + Vite + Tailwind web app shell (synthetic data only)
tests/e2e/           Playwright browser tests against the staging Worker config
packages/            shared packages (domain, trading-engine, database) — none yet
supabase/            database migrations, pgTAP tests and local CLI config
docs/                specification sections, AI coding system, decisions, handoff, changelog
.github/             CI workflow, Dependabot, issue and PR templates
```
