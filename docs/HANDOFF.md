# Current implementation handoff

Maintained by the integration owner after each verified merge (`AGENTS.md` rule 10). Feature branches put proposed handoff details in their PR instead. This update was written by Claude Code at the owner's request and records merged state only.

**Status (2026-10-27, evening):** Phase 1 foundation working on staging with real data; Phase 2 under way. On `main`: monorepo tooling and required CI (unit, database and browser tests); staging deploy on every merge; sign-in with email, password and required authenticator code; the API reading Postgres as `app_api` through Cloudflare Hyperdrive; a counterparty directory (buyers, contacts, locations, PNG logos, spreadsheet import) with row level security and an audit trail; a design system (tokens, shared components, light and slate night themes with a Dark mode switch) and an app frame with a left menu, a connection dot and a profile menu showing the user's first name and last initial; a Workspace with the Mapbox map, a commodity picker and an order book of asks and bids in CAD (USD converted exactly at a labelled synthetic rate), on synthetic data; the map search API (`GET /api/v1/facilities?bbox=`, PostGIS), a **Map** page on Mapbox GL JS, and **Find coordinates** (Geocodio lookups reviewed before saving). The trading workspace still runs only on synthetic data, shown when the profile menu's Demo data switch is on. The FX source is decided (the Bank of Canada daily rate) but not built. No quotes, FX connector, trading engine, editing of counterparties, member management or production deployment exists on `main`.

**Last verified merge:** `44f286c`, ivanmueller/gss#28 (the order book redrawn as rows: colour only on the price, no Firm/Indicative tags (a dashed circle marks indicative prices, "FX" converted ones, both explained in a footer), no volume bars, "CAD/MT" once in the heading, the spread in each commodity's heading). CI run #63 green on the pull request (including Playwright) and run #64 green on `main`; Deploy staging run #25 succeeded. The owner's screenshot of staging shows it; the owner then asked for the coloured boxes back, simpler, with "/MT" on each price.

Before it: `b298cd2`, ivanmueller/gss#27 (the Demo data switch with a "Demo" tag beside GSS; the workspace's demo notes removed). CI runs #61 and #62 green; Deploy staging run #24 succeeded.

Earlier: `a149613`, ivanmueller/gss#26 (Codex's two findings on ivanmueller/gss#25 fixed: the money helpers accept the full range of calculated amounts exactly; negative prices display). CI runs #59 and #60 green; Deploy staging run #23 succeeded.

Earlier: `ccfc308`, ivanmueller/gss#25 (the order book in CAD with Ask and Bid wording, asks left and bids right, bids green and asks red; USD quotes converted exactly with `toCad` at the labelled synthetic 1.360000, keeping the original price and rate; no quote times in the book; the panel flush with the map with an arrow tab; the page frame at 88rem; browser tests at a fixed date; the owner's FX decision recorded: the Bank of Canada daily rate). CI runs #57 and #58 green; Deploy staging run #22 succeeded. Codex checked the golden fixture, the synthetic-rate label and the hidden panel.

Before it: `3b9ecda`, ivanmueller/gss#24 (the Workspace rebuilt around the real Mapbox map, styled from map tokens; a commodity picker; an order book with gross spreads on `decimal.js`; synthetic fixtures extended to four commodities and nine fictional facilities). CI run #55 green on the pull request (including Playwright) and run #56 green on `main`; Deploy staging run #21 succeeded. The owner's screenshot of staging showed the real map and the order book.

Before it: `c493af8`, ivanmueller/gss#23 (design system: OKLCH colour ramps, light and slate night themes, one Dark mode switch, IBM Plex type, rounding, spacing and shadow tokens, shared components; a left-menu app frame with a connection dot and profile menu; every page moved onto it; `docs/DESIGN_SYSTEM.md`). CI run #53 green on the pull request (including Playwright) and run #54 green on `main`; Deploy staging run #20 succeeded. Front end only: no API, database or permission changes.

Before it: ivanmueller/gss#22 (`0411a71`, the project guide brought in line with the owner's decisions: public repository, Mapbox, Geocodio; CI run #51, Deploy staging run #19). ivanmueller/gss#21 (`022b19d`, **Find coordinates** from addresses with Geocodio's free plan, reviewed before saving, GT-021; migration `20261027050000_facility_geocoding.sql`, applied by Deploy staging run #18, which succeeded; its own CI run was cancelled when #22's started, and run #51 covers its code). The lookup needs the Worker secret `GEOCODIO_API_KEY` (README, "Map"); whether the owner has set it, and the map with Mapbox tiles on staging (a manual Deploy staging, run #17, followed ivanmueller/gss#20), have not been verified by an agent. ivanmueller/gss#20 (`fbbe503`, the **Map** page on Mapbox GL JS, GT-023), ivanmueller/gss#19 (`89a78f7`, map search by visible area, GT-022; migration `20261027040000_facility_map_search.sql` applied to `gss-staging` by Deploy staging run #15), ivanmueller/gss#17 (Codex's review of `e0db90b`: only reads retried; logos fully validated as PNG) and ivanmueller/gss#18 (this file and `AGENTS.md`'s "Working with the owner") are merged.

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
| GT-010 scaffold | Done | React 19, Vite 8, Tailwind 4, shadcn-style components on design tokens (`docs/DESIGN_SYSTEM.md`); minimal router (`/`, `/map`, `/map/coordinates`, `/counterparties`, `/counterparties/import`, `/counterparties/:id`). |
| GT-011 Supabase projects | Done (one project) | `gss-staging` only; CI and local use a throwaway local Supabase. |
| GT-012 auth and MFA | Done | Password + required TOTP; no self sign-up; the Worker verifies each token with Supabase Auth and requires `aal2`. |
| GT-013 organizations and memberships | Partly done | One organization by owner's decision; membership limits data to active staff. Role checks exist for the directory (operations and org_admin edit). Member management UI/API not started. |
| GT-014 migrations and least-privilege access | Done | `app_api` (no login in migrations, no RLS bypass); every table RLS-protected and revoked from Supabase roles. |
| GT-015 PostGIS and counterparty/facility schema | Partly done | PostGIS in `extensions`; counterparties, contacts, facilities (lat/long, precision, generated `geography`), logos, import batches. Commodity and grade tables not started. |
| GT-016 audit infrastructure | Minimal | `app.audit_events` written by trigger for directory tables (actor, action, entity, changed column names, request id); no API access. Audit view (`GET /api/v1/audit`) not started. |
| GT-020 counterparty CRUD | Partly done | Create via CSV import (column mapping, server-side review, duplicates skipped) and logo upload/replace. Editing, single create, archive not started. |
| GT-021 facility details/geocoding | Done (key pending) | Address, region, postal code, optional coordinates with exact/approximate precision. **Find coordinates** looks addresses up with Geocodio from the Worker and saves only reviewed, signed results for locations without coordinates. Needs `GEOCODIO_API_KEY` on the staging Worker. Correcting a saved location belongs to counterparty editing. |
| GT-022 viewport/bbox API | Done | `GET /api/v1/facilities?bbox=` through `app.location_in_bbox()` (PostGIS `ST_Intersects`, edges included); `app_api` still has no access to the `extensions` schema. |
| GT-023 map | Done (token pending) | **Map** page: Mapbox GL JS with Mapbox tiles (owner's decision), street or satellite; filled pins exact, hollow approximate; list of locations and count without coordinates. Works without a token by listing locations. |
| GT-024 synchronized table | Done on synthetic data | Workspace map, order book and facility table select in step; commodity and seller/buyer filters; phone tabs with a list alternative. Not yet on real quotes. |
| GT-025 synthetic fixtures | Done | Nine fictional facilities, four commodities, labelled; includes the golden fixture and its rate. |

## Tests run on the merged state

- CI `check` runs #63 (pull request) and #64 (`main` at `44f286c`) green for ivanmueller/gss#28, including Playwright; locally `pnpm check` passed with domain 124, API 120 and web 190 unit tests.
- CI `check` runs #61 (pull request) and #62 (`main` at `b298cd2`) green for ivanmueller/gss#27, including Playwright; locally `pnpm check` passed with domain 124, API 120 and web 186 unit tests (new: the Demo data switch's storage, the switch above Dark mode and the Demo tag, the empty workspace with demo data off).
- CI `check` runs #59 (pull request) and #60 (`main` at `a149613`) green for ivanmueller/gss#26; locally `pnpm check` passed with domain 124, API 120 and web 180 unit tests (new: Codex's 13-decimal conversion rounded, compared and subtracted; exactness at the edges checked against BigInt; negative prices formatted and rendered).
- CI `check` runs #57 (pull request) and #58 (`main` at `ccfc308`) green for ivanmueller/gss#25, including Playwright (new: the order book flush with the map and the hide/show tab, CAD prices with the original USD price and rate). Locally `pnpm check` passed with domain 117, API 120 and web 175 unit tests (new: `toCad` and `roundMoney` including the golden fixture USD 725.00 × 1.360000 = CAD 986.00, ranking and spreads on exact CAD amounts, a missing rate never priced at zero, Ask/Bid columns, contrast of the green and red roles in both themes).
- CI `check` runs #53 (pull request) and #54 (`main` at `c493af8`) green for ivanmueller/gss#23; locally `pnpm check` passed with domain 67, API 120 and web 111 unit tests (new: token contrast in both themes, theme switching and the pre-paint script, the app frame, status dot and profile menu). CI `check` run #51 green on `main` at `0411a71`, which includes ivanmueller/gss#21's pgTAP, API database and browser tests (counts not collected here). Earlier, CI `check` green on ivanmueller/gss#20: domain 55, API 86, web 75 unit tests; 120 pgTAP assertions; 21 API database tests as `app_api`; Playwright 14 (sign-in with TOTP, import, logo upload, the Map page without a token, another organization's records hidden by list, id, logo, upload, import and map search, phone layout).
- Independent review: Codex reviewed ivanmueller/gss#9, the merged ivanmueller/gss#11 (three findings, fixed in ivanmueller/gss#12) and `main` at `e0db90b` (two findings, fixed in ivanmueller/gss#17). Codex reviewed `main` at `fbbe503` (ivanmueller/gss#19 and ivanmueller/gss#20): no actionable findings. It confirmed that `app_api` gains no `extensions` access, that the map query and its count stay within the organization, that the build refuses a Mapbox secret token, and that labels render as text. It noted that Mapbox GL JS sends usage telemetry (accepted in `docs/DECISIONS.md`); live traffic and the token's URL restriction were not verified. Codex reviewed ivanmueller/gss#23 at `d107e83`: three findings (session warning hidden in the menu, phone menu reopening after a resize, blocked storage skipping the device theme before first paint), all fixed with regression tests in `6ac7c4a` before merge. In the same review Codex found the merged ivanmueller/gss#21's update policy, column grants and signature checks unchanged from the tested version, with no further findings.
- Mutation checks run locally on RLS policies, grants, tenant-matching keys, audit triggers, session context, retries, the PNG rules and (ivanmueller/gss#19) the map search: a leaking policy, a public grant, the imprecise `&&` box test, swapped coordinates and an unfiltered count were each caught by a test.

## Blockers and open choices

1. Repository is public; real data must never be committed (it lives only in `gss-staging`).
2. Real data on the free Supabase plan: no self-service backups, pauses after about a week idle. Keep the source spreadsheet as the backup until a paid plan and restore drill exist.
3. Codex's explicit `AGENTS.md` loading check not yet recorded.
4. Geocoding: Geocodio's free plan chosen by the owner and built (ivanmueller/gss#21). The owner's buyers get coordinates once `GEOCODIO_API_KEY` is set and **Find coordinates** is run on staging.
5. Farm-location visibility (specification §6) deferred by the owner until farms are added.
6. FX: the owner chose the Bank of Canada daily rate (`docs/DECISIONS.md`); the connector (GT-052) is built with bids and offers. Until then the workspace uses the labelled synthetic 1.360000. Claude Code cloud sessions cannot reach `www.bankofcanada.ca` until the owner allows it in the environment's network settings.

## Next exact task

The owner checks **Map** on staging (Mapbox token) and sets `GEOCODIO_API_KEY`, then runs **Find coordinates**. In progress, not merged (owner's request): the order book back to coloured boxes, simpler, with "/MT" on each price, on branch `claude/build-status-review-o075nw`. Then, in the owner's order: counterparty editing (edit fields, add one by hand, add contacts and locations, archive; all audited), member management (invite staff, roles), then bids and offers with revisions and the Bank of Canada FX connector (GT-052), leading to the thin trade slice (`docs/BUILD_PLAN.md`).

**Instruction for next agent:** Read `AGENTS.md` first, including "Working with the owner"; do not claim any feature is implemented merely because it appears in the specification. Include handoff details in your PR. **Only the integration owner updates this file after an actual merge** with its latest commit, verified tests/results, changed files, blockers, and next task.
