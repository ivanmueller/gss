# Current implementation handoff

Maintained by the integration owner after each verified merge (`AGENTS.md` rule 10). Feature branches put proposed handoff details in their PR instead. This update was written by Claude Code at the owner's request and records merged state only.

**Status (2026-10-27, night):** Phase 1 foundation working on staging with real data; Phase 2 under way. On `main`: monorepo tooling and required CI (unit, database and browser tests); staging deploy on every merge; sign-in with email, password and required authenticator code; the API reading Postgres as `app_api` through Cloudflare Hyperdrive; a counterparty directory (buyers, contacts, locations, PNG logos, spreadsheet import) with row level security and an audit trail; the header showing the user's first name and last initial; the map search API (`GET /api/v1/facilities?bbox=`, PostGIS); a **Map** page on Mapbox GL JS; and **Find coordinates**, which looks addresses up with Geocodio and saves the results an operations or admin member keeps. The trading workspace still runs on synthetic data. No quotes, trading engine, editing of counterparties, member management or production deployment exists. The owner's buyers have no coordinates yet: the first real Geocodio lookup on staging is the next step.

**Last verified merge:** `0411a71`, ivanmueller/gss#22 (the project guide brought in line with the owner's decisions: current state in `AGENTS.md`, the public repository recorded in `docs/DECISIONS.md`, Geocodio in the specification and architecture). CI run #51 green on `main`; Deploy staging run #19 succeeded.

Before it, ivanmueller/gss#21 (`022b19d`): finding coordinates with Geocodio (GT-021) and the handoff update for #20. CI run #48 was green on its head `83e696c`, whose tree `main` received unchanged; `main`'s own run #49 was cancelled when #22 merged, and run #51 covers both. Deploy staging run #18 applied migration `20261027050000_facility_geocoding.sql` to `gss-staging`. Codex reviewed #21: nothing to change (owner's report).

Owner setup in this session: the owner had a Mapbox public token and was given the steps for the GitHub secret `MAPBOX_PUBLIC_TOKEN`; Deploy staging was then rerun by hand (run #17). The owner created a Geocodio key limited to the batch geocoding endpoint and reported the Worker secret `GEOCODIO_API_KEY` done. Not yet confirmed on staging: the map with Mapbox's tiles, and a real Geocodio lookup.

Earlier: ivanmueller/gss#20 (`fbbe503`, the **Map** page on Mapbox GL JS, GT-023, and the switch from MapLibre), ivanmueller/gss#19 (`89a78f7`, map search by visible area, GT-022), ivanmueller/gss#17 and ivanmueller/gss#18.

**Last verified artifact:** MASTER_PROJECT_SPECIFICATION.md v1.0, amended 2026-10-27 for one organization, Mapbox GL JS, Geocodio and the public repository (`docs/DECISIONS.md`).

## How staging is wired

- **App and API:** one Cloudflare Worker, `grain-trading-api-staging`, at https://grain-trading-api-staging.ivan-mueller02.workers.dev. It serves `apps/web/dist` and `/api/v1/*`, and deploys from GitHub Actions on every merge to `main`.
- **Database:** Supabase project `gss-staging` (ref `nfwizbcpjpqxdoojfbdr`, free plan) holds the owner's real data. Merges apply migrations with `supabase db push` (GitHub secret `SUPABASE_STAGING_DB_URL`).
- **Worker → database:** through the Hyperdrive binding `HYPERDRIVE`, configuration `gss-staging` (id `bbc915879c6848abaa08605ff7d7825c`):
  - verifies TLS (`verify-full`) against Supabase's root CA (`supabase/certs/`);
  - connects to the session pooler on port 5432 as `app_api.nfwizbcpjpqxdoojfbdr`;
  - has query caching off and at most 5 origin connections.

  It is created or updated by the manual workflow **Set up Hyperdrive (staging)** from the GitHub secret `SUPABASE_HYPERDRIVE_URL`. Direct connections from the Worker fail, because the Workers runtime cannot trust Supabase's private CA.
- **Cloudflare API token** (GitHub secret `CLOUDFLARE_API_TOKEN`): needs Workers edit, Hyperdrive edit, and SSL and Certificates edit.
- **Map and geocoding:** Deploy staging builds the GitHub secret `MAPBOX_PUBLIC_TOKEN` into the web app (a build with a secret `sk.` token fails). The Worker secret `GEOCODIO_API_KEY` (Cloudflare → Workers & Pages → grain-trading-api-staging → Settings → Variables and Secrets) is used only by the Worker; secrets survive deploys. Geocodio failures log `Geocodio refused|unavailable … status=…` without addresses.
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
| GT-021 facility details/geocoding | Done | Address fields; coordinates from the import or found with Geocodio (**Map → Find coordinates from addresses**): exact/approximate precision, Geocodio's accuracy type and confidence, reviewed before saving, signed matches, never overwriting existing coordinates (database policy). Correcting a location belongs to counterparty editing. |
| GT-022 viewport/bbox API | Done | `GET /api/v1/facilities?bbox=` through `app.location_in_bbox()` (PostGIS `ST_Intersects`, edges included); `app_api` still has no access to the `extensions` schema. |
| GT-023 map | Done | **Map** page: Mapbox GL JS with Mapbox tiles (owner's decision), street or satellite; filled pins exact, hollow approximate; list of locations and count without coordinates; lists locations when no token works. Not yet seen on staging with the token. |
| GT-024–GT-025 | Not started | Synchronized table, synthetic fixtures. |

## Tests run on the merged state

- CI `check` green on ivanmueller/gss#21 (run #48) and on `main` (run #51): domain 67, API 120, web 83 unit tests; 137 pgTAP assertions; 26 API database tests as `app_api`; Playwright 14 (sign-in with TOTP, import, logo upload, the Map page and Find coordinates without a token or key, another organization's records hidden by list, id, logo, upload, import, map search, lookup and save, phone layout).
- Independent review: Codex reviewed ivanmueller/gss#9, the merged ivanmueller/gss#11 (three findings, fixed in ivanmueller/gss#12) and `main` at `e0db90b` (two findings, fixed in ivanmueller/gss#17). Codex reviewed `main` at `fbbe503` (ivanmueller/gss#19 and ivanmueller/gss#20): no actionable findings. It confirmed that `app_api` gains no `extensions` access, that the map query and its count stay within the organization, that the build refuses a Mapbox secret token, and that labels render as text. It noted that Mapbox GL JS sends usage telemetry (accepted in `docs/DECISIONS.md`); live traffic and the token's URL restriction were not verified. Codex reviewed ivanmueller/gss#21 (geocoding): nothing to change (owner's report, 2026-10-27).
- Mutation checks run locally on RLS policies, grants, tenant-matching keys, audit triggers, session context, retries, the PNG rules and (ivanmueller/gss#19) the map search: a leaking policy, a public grant, the imprecise `&&` box test, swapped coordinates and an unfiltered count were each caught by a test. For ivanmueller/gss#21, eight more were each caught: editors overwriting existing coordinates, viewers saving, app_api changing the town, skipping the signature or expiry check, sending the company name to Geocodio, treating a town match as exact, and a signature without the organization.

## Blockers and open choices

1. Repository is public; real data must never be committed (it lives only in `gss-staging`).
2. Real data on the free Supabase plan: no self-service backups, pauses after about a week idle. Keep the source spreadsheet as the backup until a paid plan and restore drill exist.
3. Codex's explicit `AGENTS.md` loading check not yet recorded.
4. Geocodio's free plan allows 2,500 lookups a day and its key cannot be IP-restricted without a paid plan; it is limited to the batch geocoding endpoint and lives only in the Worker.
5. Farm-location visibility (specification §6) deferred by the owner until farms are added.

## Next exact task

The owner checks **Map** on staging (Mapbox's map should show) and runs the first lookup: **Map → Find coordinates from addresses → Look up addresses**, reviews the results and saves; pins then appear. If anything fails, read the Worker's log line first (README, "Map"). Then, with the owner's choice of order: counterparty editing (edit fields, add one by hand, add contacts and locations, correct a location, archive; all audited), member management (invite staff, roles), or bids and offers with revisions leading to the thin trade slice (`docs/BUILD_PLAN.md`).

**Instruction for next agent:** Read `AGENTS.md` first, including "Working with the owner"; do not claim any feature is implemented merely because it appears in the specification. Include handoff details in your PR. **Only the integration owner updates this file after an actual merge** with its latest commit, verified tests/results, changed files, blockers, and next task.
