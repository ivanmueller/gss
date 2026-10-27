# Grain Trading Platform

Canadian–U.S. physical grain trading operations platform. The repository has the Phase 0 tooling, CI and a staging deploy, plus the GT-010 web app shell: the workspace layout with **synthetic** facilities and quotes, served by the same Cloudflare Worker as the API. No database, authentication, real quotes, trading engine or production deployment exists yet; `docs/HANDOFF.md` records the last merged state.

1. Read `MASTER_PROJECT_SPECIFICATION.md` for product and technical requirements.
2. Read `docs/BUILD_PLAN.md` for staged work and its early end-to-end demonstration path.
3. **Read `docs/AI_CODING_SYSTEM.md` for the October 2026 tool choices and practical multi-agent coding setup**; `docs/AI_WORKFLOW.md` describes Git/PR governance.
4. Every agent follows root `AGENTS.md` (Claude Code via `CLAUDE.md`, Gemini CLI via `.gemini/settings.json`; Cursor and Codex also recognize `AGENTS.md`). Verify instruction loading in your selected tool.
5. Use dedicated issue/PR branches and templates. The integration owner updates `docs/HANDOFF.md` **after** each verified merge, not separately in parallel feature branches.
6. See `docs/CHANGELOG.md` for changes made to this documentation pack.

**Initial AI workflow:** Evaluate Cursor 3 Agents Window as the primary hub, Claude for implementation, Codex for independent review, and Gemini for targeted alternate approaches. Claude Code or Google Antigravity 2.0 may replace the primary interface after a small controlled comparison. This is a **recommendation**, not a requirement or configured integration.

**Recommended stack:** React/Vite, TypeScript, Hono/Cloudflare Workers, Supabase PostgreSQL/PostGIS/Auth/Storage, Mapbox GL JS; pnpm, Vitest, Playwright.

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

`pnpm e2e` needs Chromium for Playwright 1.63.0 (`pnpm --filter @grain/e2e exec playwright install chromium`, once) and a local Supabase with its sign-in service: `supabase start`, then set the variables listed in `.env.example` from `supabase status -o env` and write `apps/api/.dev.vars.staging`. CI does exactly this in `.github/workflows/ci.yml`.

## Sign-in

Email and password through Supabase Auth, plus a required authenticator-app code (TOTP). There is no self sign-up: an administrator adds each user in the Supabase dashboard. On first sign-in the app shows a QR code to set up the authenticator. The API accepts only sessions that completed that step (`aal2`), checking each token with Supabase Auth; `/api/v1/health` is the only public API route.

The header shows the user's first name and last initial, never the email. Set a user's name in the Supabase SQL editor:

```sql
update auth.users
   set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
                            || jsonb_build_object('first_name', 'First', 'last_name', 'Last')
 where email = 'user@example.com';
```

`pnpm format` rewrites code to the Prettier style. Markdown is not reformatted, so the specification pack stays as delivered.

## Counterparties

Signed-in members see their organization's counterparties under **Counterparties**, as a table or by logo. Operations and admin members can import a CSV spreadsheet (in Excel: Save As → "CSV UTF-8 (Comma delimited)"), match its columns, review the result and import; companies already in the list are skipped. They can also upload a PNG logo (up to 512 KB) on a counterparty's page. Real records go only into the database, never into Git.

## Map

**Map** shows the organization's counterparty locations on a Mapbox map (Mapbox GL JS, `docs/DECISIONS.md`), as street map or satellite: filled pins are exact locations, hollow pins approximate ones (such as a town). Clicking a pin shows the location; the list under the map links to each counterparty. Locations without coordinates cannot be shown, and the page says how many there are.

The map needs a Mapbox **public** token, built into the web app when staging deploys. It is not a secret (every visitor's browser receives it), so Mapbox limits where it works; it is still kept out of Git so it can be replaced. Never use a secret token (`sk.`): the build refuses one.

1. In Mapbox (account.mapbox.com → **Tokens** → **Create a token**): name it, keep only the public scopes, and under URL restrictions add `https://grain-trading-api-staging.ivan-mueller02.workers.dev`. Create it and copy the token (it starts with `pk.`).
2. In GitHub (**Settings → Secrets and variables → Actions → New repository secret**): name `MAPBOX_PUBLIC_TOKEN`, paste the token, **Add secret**.
3. Run **Actions → Deploy staging → Run workflow** (or merge any change), then open **Map** on staging.

Without the token, the page lists the locations and explains what is missing. To replace the token, update the secret and deploy again.

## Staging database connection

The staging Worker reaches Supabase through Cloudflare Hyperdrive, which verifies Supabase's certificate (`docs/DECISIONS.md`). To create or update it: give the Cloudflare API token Hyperdrive and SSL and Certificates edit permissions, add the GitHub secret `SUPABASE_HYPERDRIVE_URL` (`postgresql://app_api.<project-ref>:<password>@<pooler-host>:5432/postgres`, Supabase's session pooler), then run **Actions → Set up Hyperdrive (staging)**. Its summary shows the configuration ID that `apps/api/wrangler.jsonc` binds as `HYPERDRIVE`. Locally, `wrangler dev --env staging` connects that binding to the database in `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` (CI sets it to the throwaway database).

## Staging deploy

Each merge to `main` runs `.github/workflows/deploy-staging.yml`: it repeats `pnpm check`, builds the web app, deploys `apps/api` with `wrangler deploy --env staging` to `https://grain-trading-api-staging.<subdomain>.workers.dev` (the Worker serves `apps/web/dist` alongside the API), and checks `/api/v1/health`, the web page at `/`, and that unknown `/api/*` paths return 404. Until the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist, it skips with a notice. Staging holds synthetic data only.

## Database

Supabase Postgres. Migrations live in `supabase/migrations/` and pgTAP tests in `supabase/tests/`.

- **Pull requests:** CI starts a throwaway local Supabase, applies every migration from scratch and runs `supabase test db`.
- **Staging:** after a merge, the Deploy staging workflow runs `supabase db push` against the hosted `gss-staging` project (ref `nfwizbcpjpqxdoojfbdr`). It skips with a notice until the `SUPABASE_STAGING_DB_URL` repository secret exists.
- **Locally (optional):** with Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development), run `supabase db start` then `supabase test db`.

Application tables live in the private `app` schema, which the Supabase Data API does not expose; the API Worker reaches them as the least-privilege `app_api` role (`docs/DECISIONS.md`). The Worker's `DATABASE_URL` secret (Cloudflare dashboard → the Worker → Settings → Variables and Secrets) holds the `app_api` transaction-pooler URL; locally it goes in `apps/api/.dev.vars.staging`. `pnpm --filter @grain/api test:db` runs the API's database code as `app_api` against a database with the migrations applied (`API_TEST_ADMIN_DATABASE_URL`, `API_TEST_DATABASE_URL`).

## Layout

```
apps/api/            Hono API on Cloudflare Workers (health, /me, counterparties, map search); serves apps/web on staging
apps/web/            React + Vite + Tailwind web app (synthetic workspace; real counterparty directory and map)
tests/e2e/           Playwright browser tests against the staging Worker config
packages/domain/     shared validation used by web and API (counterparty import rows, PNG check, regions)
supabase/            database migrations, pgTAP tests and local CLI config
docs/                specification sections, AI coding system, decisions, handoff, changelog
.github/             CI workflow, Dependabot, issue and PR templates
```
