# Current implementation handoff

Maintained by the integration owner after each verified merge (`AGENTS.md` rule 10). Feature branches put proposed handoff details in their PR instead. This update was written by Claude Code at the owner's request and records merged state only.

**Status (2026-10-28):** Phase 1 foundation working on staging with real data; first Phase 2 slice (counterparty directory) live. On `main`: monorepo tooling and required CI (unit, database and browser tests); staging deploy on every merge; sign-in with email, password and required authenticator code; the API reading Postgres as `app_api` through Cloudflare Hyperdrive; a counterparty directory (buyers, contacts, locations, PNG logos, spreadsheet import) with row level security and an audit trail; the header showing the user's first name and last initial. The trading workspace still runs on synthetic data. No quotes, trading engine, editing of counterparties, member management or production deployment exists.

**Last verified merge:** `e0db90b`, ivanmueller/gss#16 (Hyperdrive uses Supabase's session pooler; reads retried once on a lost connection). Deploy staging run #12 succeeded; the owner then reran "Set up Hyperdrive (staging)" and confirmed staging works (signed in, name shown, no error).

**Open pull request:** ivanmueller/gss#17 — fixes Codex's review of `e0db90b`: only reads are retried (a retried logo upload could overwrite a later one), and logos are fully validated as PNG with a cleaned copy stored. Not merged when this was written.

**Last verified artifact:** MASTER_PROJECT_SPECIFICATION.md v1.0, amended 2026-10-27 for one organization only (`docs/DECISIONS.md`).

## How staging is wired

- **App and API:** one Cloudflare Worker, `grain-trading-api-staging`, at https://grain-trading-api-staging.ivan-mueller02.workers.dev. It serves `apps/web/dist` and `/api/v1/*`, and deploys from GitHub Actions on every merge to `main`.
- **Database:** Supabase project `gss-staging` (ref `nfwizbcpjpqxdoojfbdr`, free plan) holds the owner's real data. Merges apply migrations with `supabase db push` (GitHub secret `SUPABASE_STAGING_DB_URL`).
- **Worker → database:** through the Hyperdrive binding `HYPERDRIVE`, configuration `gss-staging` (id `bbc915879c6848abaa08605ff7d7825c`):
  - verifies TLS (`verify-full`) against Supabase's root CA (`supabase/certs/`);
  - connects to the session pooler on port 5432 as `app_api.nfwizbcpjpqxdoojfbdr`;
  - has query caching off and at most 5 origin connections.

  It is created or updated by the manual workflow **Set up Hyperdrive (staging)** from the GitHub secret `SUPABASE_HYPERDRIVE_URL`. Direct connections from the Worker fail, because the Workers runtime cannot trust Supabase's private CA.
- **Cloudflare API token** (GitHub secret `CLOUDFLARE_API_TOKEN`): needs Workers edit, Hyperdrive edit, and SSL and Certificates edit.
- **Logs:** Workers Logs are on (`observability` in `apps/api/wrangler.jsonc`). Database failures log a secret-free `code=… kind=…` line with the request id.
- **People:** the owner is `org_admin` of the one organization. Users are created in the Supabase dashboard, and names are set via `raw_user_meta_data` (README, Sign-in). The `app_api` password is set by SQL on `gss-staging` and never committed.

## Phase 0 tickets

| Ticket | State | Notes |
|---|---|---|
| GT-001 private repo, permissions, protected main | Partly done | `main` protected with required `CI / check`; admin bypass allowed. Repository is **public** by the owner's choice (spec says private; private branch protection needs a paid plan). |
| GT-002 monorepo tooling | Done | pnpm 10.28 workspace (`apps/*`, `packages/*`, `tests/e2e`), TypeScript 6.0 strict, ESLint 10 strict type-checked, Prettier, Vitest 5, Playwright 1.63, Supabase CLI 2.122. |
| GT-003 AGENTS.md, adapters, docs, templates | Done in repo | Claude Code loads `AGENTS.md` via `CLAUDE.md`. Codex reviews PRs against `AGENTS.md`; its explicit loading check is still to be recorded. |
| GT-004 CI typecheck/lint/test | Done | `CI / check`: format, lint, typecheck, unit tests, build, pgTAP (`supabase test db`), API database tests as `app_api`, Playwright. |
| GT-005 dev/staging secret management | Done for staging | GitHub secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_STAGING_DB_URL`, `SUPABASE_HYPERDRIVE_URL`. The Worker secret `DATABASE_URL` is no longer used (owner may delete it). Owner to record the Cloudflare token's expiry. |

## Phase 1 and the first Phase 2 slice

| Ticket | State | Notes |
|---|---|---|
| GT-010 scaffold | Done | React 19, Vite 8, Tailwind 4, shadcn-style components; minimal router (`/`, `/counterparties`, `/counterparties/import`, `/counterparties/:id`). |
| GT-011 Supabase projects | Done (one project) | `gss-staging` only; CI and local use a throwaway local Supabase. |
| GT-012 auth and MFA | Done | Password + required TOTP; no self sign-up; the Worker verifies each token with Supabase Auth and requires `aal2`. |
| GT-013 organizations and memberships | Partly done | One organization by owner's decision; membership limits data to active staff. Role checks exist for the directory (operations and org_admin edit). Member management UI/API not started. |
| GT-014 migrations and least-privilege access | Done | `app_api` (no login in migrations, no RLS bypass); every table RLS-protected and revoked from Supabase roles. |
| GT-015 PostGIS and counterparty/facility schema | Partly done | PostGIS in `extensions`; counterparties, contacts, facilities (lat/long, precision, generated `geography`), logos, import batches. Commodity and grade tables not started. |
| GT-016 audit infrastructure | Minimal | `app.audit_events` written by trigger for directory tables (actor, action, entity, changed column names, request id); no API access. Audit view (`GET /api/v1/audit`) not started. |
| GT-020 counterparty CRUD | Partly done | Create via CSV import (column mapping, server-side review, duplicates skipped) and logo upload/replace. Editing, single create, archive not started. |
| GT-021 facility details/geocoding | Partly done | Address, region, postal code, optional coordinates with exact/approximate precision. No geocoding. |
| GT-022–GT-025 | Not started | bbox API, MapLibre map (tile provider choice), synchronized table, synthetic fixtures. |

## Tests run on the merged state

- CI `check` green on ivanmueller/gss#16: domain 24, API 73, web 59 unit tests; 108 pgTAP assertions; 17 API database tests as `app_api`; Playwright 14 (sign-in with TOTP, import, logo upload, another organization's records hidden by list, id, logo, upload and import, phone layout).
- Independent review: Codex reviewed ivanmueller/gss#9, the merged ivanmueller/gss#11 (three findings, fixed in ivanmueller/gss#12) and `main` at `e0db90b` (two findings, fixed in open ivanmueller/gss#17).
- Mutation checks run locally on RLS policies, grants, tenant-matching keys, audit triggers, session context and retries (and, in ivanmueller/gss#17, the PNG rules); each was caught by a test.

## Blockers and open choices

1. Repository is public; real data must never be committed (it lives only in `gss-staging`).
2. Real data on the free Supabase plan: no self-service backups, pauses after about a week idle. Keep the source spreadsheet as the backup until a paid plan and restore drill exist.
3. Codex's explicit `AGENTS.md` loading check not yet recorded.

## Next exact task

Merge ivanmueller/gss#17. Then, with the owner's choice of order: counterparty editing (edit fields, add one by hand, add contacts and locations, archive; all audited), member management (invite staff, roles), or bids and offers with revisions leading to the thin trade slice (`docs/BUILD_PLAN.md`).

**Instruction for next agent:** Read `AGENTS.md` first, including "Working with the owner"; do not claim any feature is implemented merely because it appears in the specification. Include handoff details in your PR. **Only the integration owner updates this file after an actual merge** with its latest commit, verified tests/results, changed files, blockers, and next task.
