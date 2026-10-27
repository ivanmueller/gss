# Agent instructions — Canadian–U.S. Physical Grain Trading Platform

This project has its **Phase 1 foundation and first Phase 2 slices** on staging, with the owner's real buyer data: sign-in with MFA, the counterparty directory and spreadsheet import, a Mapbox map, and coordinates found with Geocodio. Quotes, the trading engine and saved scenarios do not exist yet; the trading workspace still shows synthetic data. Before coding, read the *relevant sections* of `MASTER_PROJECT_SPECIFICATION.md` and current status in `docs/HANDOFF.md`.

## Mission
Build a secure, auditable Canadian-to-U.S. physical grain trading operations platform. The map is for discovery; executable economics comes from validated bid/offer records, quote delivery terms, source FX and freight inputs, and a deterministic saved scenario snapshot.

## Intended architecture
- One GitHub monorepo, public by the owner's choice (`docs/DECISIONS.md`): never commit real business data or secrets. React/Vite/strict TypeScript frontend; Hono API on Cloudflare Workers.
- Supabase Postgres/PostGIS, Supabase Auth, private Storage, organization-aware access.
- Shared domain/validation packages and a pure TypeScript trading-engine package using **decimal**, never JS float, for monetary arithmetic.
- Mapbox GL JS with Mapbox map tiles (owner's decision, `docs/DECISIONS.md`); keep Mapbox calls in one map component so the provider can be changed later.
- Geocoding with Geocodio's free plan, from the Worker only, with every result reviewed before saving (owner's decision, `docs/DECISIONS.md`).
- Python is out of scope until analytics or optimization justifies it.

## Always follow
1. Source of design intent: `MASTER_PROJECT_SPECIFICATION.md`. Per-module details: `docs/`. **Do not invent market prices, routing fees, FX quotes or regulatory outcomes.** Label all synthetic data.
2. A quote must carry side, commodity/grade, numeric units, currency, delivery basis, valid time, available quantity and provenance. Treat indicative/stale as non-executable.
3. Normalize quantity/FX explicitly. Missing FX, freight or unit conversion must **block** margin calculations; do not treat missing as zero. Preserve quote revision IDs and calculation engine version in every saved scenario.
4. Enforce organization isolation server-side; no browser service-role secrets; limit grants/RLS, secure private files; test cross-tenant denials.
5. Do not alter an executed/saved historical calculation in place. Version changes and audit them.
6. Use schema migrations for changes; add tests for every financial calculation, permission change and bug fix.
7. Use independent Git branch/worktree per agent; no direct commits to protected main; open PR describing tests, migrations, risks, assumptions and docs touched. Agree on shared schemas/API contracts before parallel implementation.
8. No AI model can autonomously commit a real grain trade, approve a payment, execute a hedge, or send contract offers to third parties.
9. Do not add microservices, runtime LLM agent frameworks, vector DBs or predicted pricing to v1 without an approved architecture decision.
10. On feature branches, include the proposed handoff details in the PR, **not a competing edit to `docs/HANDOFF.md`**. Only the integration owner updates that file after a verified merge. Never claim an unbuilt feature works.

## Working with the owner
- The owner runs a grain trading shop and is not a developer. Explain in plain language, give exact click paths (e.g. "Cloudflare → Workers & Pages → grain-trading-api-staging → Logs"), and keep owner steps few and numbered.
- When another tool has work to do, say so with a **Codex:** or **Gemini:** prefix and a paste-ready prompt. Codex independently reviews high-risk changes (database, auth, money) before merge; Gemini is optional (e.g. comparing map tile providers).
- Never ask for secrets in chat (passwords, connection strings, `sb_secret_` keys, API tokens). Ask for the non-secret part instead, such as the host after `@`. Real business data (buyer rows, contacts, prices) never goes into Git or prompts; ask for column headers only.
- The platform serves one organization, the owner's shop (`docs/DECISIONS.md`).
- The owner opens and merges pull requests; give the compare link, keep CI green, and update `docs/HANDOFF.md` in a separate commit after each verified merge (the owner has delegated this).
- Staging failures: read the Worker's log line (`Database unavailable … code=… kind=…`) before guessing; see `docs/HANDOFF.md`, "How staging is wired".

## Read by task
- UX: `docs/PRODUCT.md`; look and feel, tokens and components: `docs/DESIGN_SYSTEM.md`.
- Schema: `docs/DATA_MODEL.md` and `docs/ARCHITECTURE.md`.
- API: `docs/API.md`.
- Financial logic: `docs/TRADING_RULES.md` + `docs/ACCEPTANCE_TESTS.md`.
- Tickets: `docs/BUILD_PLAN.md`.
- Agent collaboration and governance: `docs/AI_WORKFLOW.md`.
- October 2026 development environment, model assignments, worktree orchestration, sample prompts and early vertical slice: `docs/AI_CODING_SYSTEM.md`.
- Open decisions: `docs/DECISIONS.md`.

## Commands
- `pnpm install`
- `pnpm check`: format check, lint, typecheck and tests, the same steps CI runs.
- `pnpm format`: apply Prettier (Markdown is excluded).
- `pnpm build`: build the web app (CI runs it after `pnpm check`).
- `pnpm --filter @grain/api dev`: local API Worker at `http://localhost:8787/api/v1/health`.
- `pnpm --filter @grain/web dev`: web app with hot reload at `http://localhost:5173`; `/api` is proxied to port 8787.
- `pnpm preview:staging`: build, then serve web and API together as on staging.
- `pnpm e2e`: build, then run the Playwright browser tests (CI runs them in the required `check` job). Needs a local Supabase with sign-in (`supabase start`); see README "Quick start".
- `supabase db start` then `supabase test db`: apply migrations to a local Supabase and run the pgTAP tests (needs Docker; CI runs them in `check`).
- `pnpm --filter @grain/api test:db`: the API's database code as `app_api` against a migrated database (see README "Database").

## Database rules
- Every schema change is a new file in `supabase/migrations/`; never edit a migration that has reached `main`.
- Application tables go in the private `app` schema. Each new table enables row level security, gets policies for `app_api` keyed on `app.current_user_id()` and organization membership, and is revoked from `public`, `anon`, `authenticated` and `service_role` before granting `app_api` only what it needs. New functions are revoked the same way.
- Every new table or policy ships with pgTAP tests in `supabase/tests/database/`, including cross-organization denials.

## Completion definition
Run and report lint, TypeScript typecheck, relevant unit/integration tests, security/RLS tests where needed and a staged end-to-end smoke test for user-visible changes. If test infrastructure does not exist yet, explicitly state that and create it in the current approved phase.
