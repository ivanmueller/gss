# Ordered build plan

Issues are proposed identifiers. File them in the GitHub repository when available.

## Where the build stands (2026-10-29)

Ticket by ticket, with notes, in `docs/HANDOFF.md`. In short:

| Phase | State |
|---|---|
| 0 — Repository and documentation baseline | Done, except Codex's recorded check that it reads `AGENTS.md`. The repository is public by the owner's choice (`docs/DECISIONS.md`), not private as GT-001 says. |
| 1 — Infrastructure, auth and database | Done except grade tables (GT-015; commodities exist since bids and offers), an audit view (GT-016) and backups with a restore drill (GT-017; the free Supabase plan has none). One organization only, GSS, by the owner's decision: there is nothing to switch between, and the isolation tests stay. |
| 2 — Counterparties, facilities, map and table | Done on the owner's real buyer data: directory with editing, import, logos, archive (GT-020), locations with Geocodio coordinates (GT-021), map search (GT-022), the Mapbox map in Counterparties (GT-023), fixtures (GT-025). The workspace's synchronized map, order book and table (GT-024) run on GSS's live bids and offers, or on made-up data while Demo data is on. Also built at the owner's request: the Team page (GT-013). |
| 3 — Versioned quotes | Mostly done: quote and revision tables (GT-030), entering, revising, withdrawing and expiry (GT-031), validation (GT-032), live quotes in a list, on counterparty pages and in the workspace (GT-033), provenance and audit (GT-034). Not started: quote import from files (GT-035). The gate's "never mislabeled firm or actionable" holds for status; actionability comes with Phase 4. |
| 5 (pulled forward) — Bank of Canada FX connector (GT-052) | Built (ivanmueller/gss#54, #55): the Worker stores the daily USD/CAD rate twice a day and the workspace converts USD bids and offers with it. Done once a stored rate is seen on staging. |
| 5 (pulled forward) — Carrier freight rates (part of GT-050) | Built at the owner's request (2026-10-29, the priority after the FX connector): carriers in Counterparties with a Carriers filter, and the Freight page for carrier rates from one location to another, kept as revisions. Lanes without a carrier quote, route geometry and routing (GT-051) are not started. |
| Owner's requests not started | Map overlay layers from ArcGIS (GT-026), waiting for the first layer's address. |
| 4, 5 (rest), 6 | Not started. The thin trade slice is next. |

# 13. Execution plan, ordered backlog and acceptance gates

These are **release-readiness gates**, not calendar promises. Phase 0 and the minimum secure Phase 1 foundation are mandatory prerequisites. Thereafter, a thin end-to-end slice may implement the necessary **minimum** Phase 2–4 capabilities before all polish/import tasks finish. The complete phase acceptance gates must still pass before that phase is declared complete. See `docs/AI_CODING_SYSTEM.md` §8. Synthetic test records are permitted until validated market data is onboarded.

## Phase 0 — Repository and documentation baseline

**Tickets:** GT-001 create private repo/permissions/protected main; GT-002 install monorepo tooling; GT-003 add AGENTS.md, Claude/Gemini adapters, documentation and PR templates; GT-004 establish CI typecheck/lint/test; GT-005 development/staging secret management.

**Gate:** Fresh clone installs and runs tests; chosen implementer and independent reviewer demonstrably read common instructions (verify Gemini or other optional tools if used); a sample PR cannot merge with failed CI. No code secrets stored in repo. Do not buy subscriptions solely to prove an unused agent works.

## Phase 1 — Infrastructure, auth and database foundation

**Tickets:** GT-010 scaffold React/Vite/Cloudflare Worker/Hono; GT-011 create separate Supabase projects; GT-012 implement auth/session and MFA; GT-013 organizations, memberships and role capabilities; GT-014 migration chain and least-privilege database access; GT-015 PostGIS, facility/commodity/counterparty schema; GT-016 audit infrastructure; GT-017 seeded fictional data, backups and restore runbook.

**Gate:** Users can sign in and switch among only authorized organizations (one organization, GSS, by the owner's decision: signed-in users reach only it); unauthorized direct API requests fail; tenancy tests pass; migration setup works on a fresh database.

### Early cross-phase milestone — thin trade vertical slice (not a production release)

After GT-013–GT-015 establish secure organization-bound schema and minimal data, agree on the quote/API/engine contracts, then take **minimal** scope from GT-020–GT-025, GT-030–GT-034, and GT-040–GT-046 to demonstrate a fictional seller → buyer scenario through a basic map/table, server-side deterministic economics, saved snapshot and reload. Include quote revisioning and cross-tenant denial tests. **Defer** richer filters, polish and CSV imports until this path works; do not skip their later acceptance gates. This is an ordering optimization, not permission to bypass Phase 0, security, required input validation or migrations.

## Phase 2 — Counterparties, facilities, map and table

**Tickets:** GT-020 counterparty CRUD with permissions; GT-021 facility details/geocoding precision; GT-022 viewport/bbox API using PostGIS; GT-023 Mapbox GL JS map with Mapbox tiles; GT-024 responsive synchronized facility table, filters and accessibility; GT-025 synthetic producer/buyer fixtures; GT-026 map overlay layers from ArcGIS services (owner's request, 2026-10-29), switchable on the Mapbox maps, each layer's terms of use recorded first.

**Gate:** Verified/approximate geolocations display distinctly; map selection updates detail panel and table; tenant isolation holds for geographic queries; mobile/narrow screens remain usable.

## Phase 3 — Versioned quotes and source provenance

**Tickets:** GT-030 quote+quote_revisions migrations; GT-031 bid/offer CRUD, expiry/withdraw/revision; GT-032 quote input validation (grade, price, unit, basis, quantity, dates); GT-033 current quote discovery + facility quote pane; GT-034 provenance and audit; GT-035 CSV quote import staging/rejections.

**Gate:** Quote history is preserved across updates; expired/withdrawn quotes cannot appear active without an explicit historical filter; unsuitable quotes cannot be mislabeled firm or actionable.

## Phase 4 — Trading engine and saved scenarios: FIRST USEFUL RELEASE

**Tickets:** GT-040 decimal-based money/quantity normalization; GT-041 grade/date/quantity/basis compatibility validator; GT-042 pure scenario economics and warnings; GT-043 golden test fixture plus exhaustive boundary tests; GT-044 scenario builder UI; GT-045 server calculation endpoint, immutable saved versions and CSV export; GT-046 human acceptance walkthrough with two fictitious locations.

**Gate:** The synthetic 42 MT example returns exactly CAD 46.00/MT and CAD 1,932.00, and a stale/missing FX, missing freight, unmatched basis or unit yields a visible block/warning as specified. Reloading an old scenario never recalculates it silently against changed market data. An internal tester completes the entire journey without developer intervention.

## Phase 5 — Commercially useful freight and discovery

**Tickets:** GT-050 freight quote/lane data model (carrier rates by route pulled forward by the owner, 2026-10-29); GT-051 licensed road routing integration; GT-052 source/time-aware FX connector (the Bank of Canada daily rate; pulled forward by the owner to be built with bids and offers); GT-053 candidate-match query and rankings; GT-054 comparison table and suitability rules; GT-055 performance tests over representative dataset.

**Gate:** Ranked opportunities differentiate confirmed, estimated and insufficient-data scenarios; shipping cost inclusion is auditable; no inaccurate route or estimated cost is presented as firm carrier freight.

## Phase 6 — Trade management and intelligence (separate release decision)

**Tickets:** GT-060 trade lifecycle and approval authority; GT-061 contract/document storage and access; GT-062 shipment and invoice event tracking; GT-063 expected-vs-realized economics; GT-064 external price-feed adapters where licensed; GT-065 document extraction with human validation; GT-066 scenario and route analytics; GT-067 Python optimization only when justified.

**Gate:** Approved lifecycle definitions, commercial controls, auditability, and operational sign-off. AI cannot execute/approve transactions independently.

# 17. Concrete first implementation task for the coding team

**Issue GT-001 through GT-005 — Repository Bootstrap:** Create the private GitHub repo and scaffolding, copy this document pack, configure pnpm/TypeScript strict mode, initial React/Hono Cloudflare template, lint/test/typecheck CI, default branch protection, separate dev/staging secrets, and project instruction loading for the chosen implementer and independent reviewer (plus optional additional agents actually in use). Add a read-only health endpoint and one Vitest passing test. Do not build the map, quote ingestion or live calculations until Phase 0 acceptance is verified.

**Phase 4 target demonstration (also the thin cross-phase milestone):** Using fictional quote IDs, create and save the 42-MT golden scenario, then revise the buyer quote and show that the prior saved scenario still displays CAD 1,932.00 with its original assumptions. From the map, click origin/destination, calculate again and explicitly indicate whether the revised quote changed the economics.

