# Canadian–U.S. Physical Grain Trading Platform
## Master Project Specification & Technical Build Plan

**Version:** 1.0 — product/architecture baseline; AI delivery workflow clarified 2026-10-26  
**Prepared:** 26 October 2026  
**Audience:** Company owners, grain traders, software engineers, Claude Code, OpenAI Codex, Gemini CLI, external developers  
**Status:** Design specification; not a claim that software, integrations, live market data, or production infrastructure have been implemented.

> **Governing principle:** Build a trustworthy, auditable physical trading workflow before adding automation. A map is a discovery interface; the source of economic truth is the quote, delivery terms, calculation engine, and saved trade scenario.

## Executive decision summary

| Decision | Baseline choice | Rationale |
|---|---|---|
| Code and project management | Private GitHub monorepo | One canonical history of changes, issues, reviews, and project documentation |
| Main programming language | Strict TypeScript | Share validation and trading types across user interface and API |
| Web app | React + Vite + Tailwind CSS + shadcn/ui | Responsive private operations interface with inexpensive deployment |
| API | Hono running on Cloudflare Workers | Lightweight typed HTTP layer; compatible with React/Vite on Workers |
| Database | Supabase PostgreSQL + PostGIS | Relational records, managed authentication, spatial indexes |
| Files | Private Supabase Storage | Contract and transport document attachments; signed access only |
| Maps | MapLibre GL JS with licensed production tile provider | Flexible map visualization without coupling to one map-data vendor |
| Trade economics | Pure TypeScript package using decimal arithmetic | Reproducible deterministic values and extensive unit tests |
| Authentication | Supabase Auth + MFA and server-side membership checks | Least privilege and explicit organization isolation |
| Testing | Vitest, Playwright, PostgreSQL integration tests, RLS tests | Automated regression protection, especially for money and permissions |
| Initial deployment | Cloudflare Workers for web/API; Supabase separately | Fits existing familiarity, minimizes operations burden |
| AI-assisted development | `AGENTS.md` + `docs/AI_CODING_SYSTEM.md` + Git worktrees/PRs | Prefer Cursor 3 as an initial agent hub, but keep model/vendor choice replaceable and enforce independent review |
| Analytics | Python added only after MVP | Avoid two application runtimes until numerical analysis justifies it |

### Product success criterion

An authenticated trader can open the Canadian–U.S. map, filter a commodity and grade, select a seller's offer and a buyer's bid, review their delivery terms, enter or select freight and fees, calculate a reproducible indicative gross margin in one reference currency/unit, and save the scenario with a complete audit trail. No live bid, offer, freight rate, or buyer availability is invented.

---

# 1. Goals, scope, and non-goals

## 1.1 Business goals

1. Centralize Canadian grain sources and Canadian/U.S. commercial buyers and their facilities.
2. Preserve current and historical quotations, quote confidence, volume, timing, grade, and delivery terms.
3. Identify economically plausible cross-border physical trades quickly, without implying that a quote is executable when it is not.
4. Calculate and compare transparent delivered margins in normalized currency and quantity units.
5. Retain proprietary counterparty, lane, pricing, and trade data securely as a compounding commercial asset.
6. Support an internal team initially, with a data model capable of future white-label/organization separation.
7. Make development reproducible across multiple AI coding agents and a human project owner.

## 1.2 Release 1: must have

- Secure sign-in and organization membership for an internal team.
- Counterparty and facility directory with Canadian province and U.S. state, optional exact geolocation and verification status.
- Map and synchronized sortable facility table, with explicit buyer/seller filters, commodity/grade filters, and selected facilities.
- Manually entered buyer **bids** and seller **offers** with immutable revision history and freshness indicators.
- Quote status: `indicative`, `firm`, `withdrawn`, `expired`, `superseded` (firm status is operationally asserted by a human, not verified automatically).
- Price basis, currency, unit, commodity/grade, min/max volume, quote valid time, delivery window, source, and commercial notes.
- A comparison workspace linking one seller offer and one buyer bid, with editable freight/fees/FX assumptions and basis compatibility checks.
- A unit-aware, currency-aware trade calculation returning gross margin per **delivered** metric tonne and scenario totals; save and reopen a versioned scenario.
- Properly permissioned imports and basic CSV export of scenario results, with data-source provenance.
- Versioned DB migrations, automated golden-number tests, staging deployment, and backups/restore drill.

## 1.3 Release 1: explicitly out of scope

- Automated order placement, contract execution, or commitment to third parties.
- Automated trade or hedge execution, or actualized P&L accounting.
- Guaranteed real-time external grain bid feeds, price scraping, or terminal integration.
- Fully automated legal/compliance determinations, customs filing, or phytosanitary certification.
- Complex rail tariff/routing modeling, dispatch, live truck tracking, and freight tendering.
- Production-grade cash risk engine, derivative hedge booking, AI price prediction, or autonomous negotiation.
- Multi-tenant customer onboarding and public marketplace checkout (data model should accommodate future tenancy).

## 1.4 Planned next releases

**Release 2:** Freight lane library, route geometry and licensed routing provider, saved carrier freight bids, opportunity rankings, bulk quote ingestion, trade conversion and contract recordkeeping.

**Release 3:** Shipment milestones, invoice reconciliation, expected-versus-realized margin, role-based approvals, compliance workflows, price ingest adapters, document extraction with review.

**Release 4 (conditional):** Quantitative opportunity analytics, Python optimization, research and forecasting, controlled runtime AI assistants, rail economics, automated exception alerts, external white-label tenants.

# 2. Users, roles, and workflows

## 2.1 Roles

| Role | Read facilities / quotes | Create quotes / scenarios | Edit counterparties | Approve/execute trades | Manage users/config |
|---|---|---|---|---|---|
| Viewer | Yes | No | No | No | No |
| Analyst | Yes | Scenarios; propose quotes | No | No | No |
| Trader | Yes | Yes | Request/edit per policy | Later approval workflow | No |
| Operations | Yes | Freight and documents | Yes | No | No |
| Org Admin | Yes | Yes | Yes | Authorized workflow only | Yes |

Permissions are checked on the server and, where Supabase Data API exposure is used, reinforced by grants and row-level security. The client role label is never sufficient authorization.

## 2.2 Primary journey: analyze a potential trade

1. Trader filters the map/table to **flaxseed**, optionally a grade, date range and firm/indicative quotes.
2. Trader selects a Canadian seller location and views all active offers, source, freshness, quantity, and delivery terms.
3. Trader selects an eligible U.S. buyer and views corresponding bids.
4. The app checks commodity, quality/grade, timing, quantity, currency/unit, and commercial basis compatibility.
5. Trader chooses an actual FX reference or manually enters a marked assumption; chooses or enters freight and other per-unit costs.
6. The trading engine calculates normalized revenue, acquisition cost, freight, extras, gross margin/tonne and scenario gross margin, showing all assumptions and warnings.
7. Trader saves a named draft, exports the explanation, or flags missing information for follow-up.
8. Saved output remains reproducible if live quotes, FX or freight rates later change.

## 2.3 Secondary journey: maintain quotes

Authorized user creates a counterparty/facility, adds a quote and supporting metadata, and marks source type (`phone`, `email`, `website`, `manual`, `file_import`, `licensed_feed`). Updates create a new quote revision and supersede the previous one rather than overwriting historical economic inputs. A withdrawn/expired quote never silently reappears as firm.

## 2.4 Secondary journey: compare opportunities

Trader sees a ranked **table**, not only a map. The table ranks candidate seller-buyer pairs with provenance, status, location, estimated gross spread, estimated delivered margin, data completeness, freshness, timing match, and confidence warnings. The default is **do not rank as actionable** when required freight, basis, specification, FX, or valid quotes are unavailable. A separate exploratory view may rank incomplete opportunities with explicit estimates.

# 3. Screens and UX specification

| Route | Main purpose | Primary controls |
|---|---|---|
| `/login` | Secure employee access | Email, authentication, MFA |
| `/workspace` | Main map and synchronized table | Commodity, grade, geography, buyer/seller, quote status, valid-as-of |
| `/facilities/:id` | Facility details | Organization, location, contact, service type, quotes, notes, provenance |
| `/quotes` | Quote management | Search, filters, create, revision history, import/export |
| `/scenarios/new` | Trade builder | Seller offer, buyer bid, quantity, FX, freight, fees, validation and margin |
| `/scenarios/:id` | Saved assessment | Input snapshot, calculation version, audit/revisions, export |
| `/counterparties` | Relationship management | Contacts, facilities, role, status, communication log |
| `/admin` | Organization control | Users, roles, data sources, settings, audit views |

### Workspace layout

Desktop: top commodity/date filters; 55–65% interactive map and 35–45% right-hand selection/quote inspector; bottom or alternate full-width opportunities table. At narrower widths, map and table become tabs, with an accessible list alternative. Map pins differentiate supplier offers and buyer bids; no map pin implies an executable current quote just because a facility exists.

### Interface conventions

- Buyer bid vs seller offer must use **words and icons in addition to color**.
- Quote timestamp and `valid_until` appear adjacent to every price.
- Monetary figures always display currency and unit, e.g., `USD 725.00/MT`, never `725` alone.
- Firm/indicative/expired/withdrawn states are visually distinct and accessible.
- Highlight missing delivery terms and specification conflicts before revealing an actionable margin.
- A quote with zero/missing available volume must not pass the valid pairing check.
- Saved scenarios are labeled `Indicative scenario – not an executed trade` until explicitly converted through a later workflow.
- Data tables support keyboard navigation, filtering, sorting, and copying.

# 4. Architecture and boundaries

## 4.1 Runtime flow

```
Browser — React/Vite/MapLibre
   |  HTTPS + Supabase Auth identity
Cloudflare Worker — Hono API
   |  user verification + organization membership + validation
   |  price/basis/quantity compatibility + deterministic trading engine
   |  typed repositories / outbound adapters
Supabase Postgres — PostGIS, quote history, scenarios, audit
Supabase Storage — private supporting documents
External adapters — FX, geocoding, tiles, routing, licensed price data (as added)
```

The frontend calls one documented application API for sensitive operations. Avoid direct browser writes to commercial tables. Keep the system a **modular monolith** initially, not a distributed collection of microservices.

## 4.2 Modules

- `auth-and-organizations`: authenticated actor, tenant resolution, role capabilities.
- `counterparties`: organizations, facilities, contacts and verification.
- `market-data`: quotes, revisions, provider/import provenance.
- `geospatial`: point storage, bbox/radius filtering, map projections.
- `trade-engine`: pure normalization, compatibility and margin functions.
- `scenarios`: snapshots, versions, comparison and exports.
- `freight`: manually entered quotes initially; providers later.
- `documents`: metadata, private attachments, access checks.
- `audit`: security- and finance-relevant event stream.

## 4.3 Database access policy

Use one documented strategy for v1: **server-side API for all private domain reads/writes**. Supabase Auth handles sign-in, storage is accessed via short-lived signed URLs under server authorization, and server API database access uses a minimum-privilege role. If Hyperdrive is adopted, it is a connection pool for PostgreSQL clients—not an automatic way to apply end-user RLS. The API must explicitly filter and authorize `organization_id`, including on nested joins and updates. Set RLS and minimal grants on any exposed tables as defense in depth, with user-context policies where Data API access is allowed. Never use a service-role credential in the browser.

## 4.4 Environment separation

- **Local:** seeded fictional/synthetic data, local Supabase or disposable remote dev project.
- **Staging:** separate Supabase project, staging Worker, test-only accounts and data.
- **Production:** separate resources, restricted operators, approval-gated migrations and deployments.

Production secrets live in platform secret stores, never in Git or AI prompt files. The same migration chain runs across environments.

# 5. Canonical domain language and calculations

## 5.1 Fundamental concepts

- **Counterparty:** Legal/commercial organization or person; can act as buyer, seller, broker or carrier.
- **Facility:** Geocoded physical location of pickup/delivery; multiple facilities can belong to one counterparty.
- **Seller offer:** A seller-originated request for a price for grain being sold by that seller; may be firm or indicative.
- **Buyer bid:** A buyer-originated price for the grain that buyer is willing to purchase; may be firm or indicative.
- **Quote revision:** Immutable economic record of price, currency, quantity, time, specification and delivery basis.
- **Trade scenario:** Reproducible saved assessment; not a contract or execution.
- **Trade:** Contractually negotiated transaction, introduced in subsequent phases behind approval controls.

A facility's `buyer` or `seller` role is not exclusive: some organizations buy and sell depending on product and market.

## 5.2 Mandatory data on every quotation

`id`, `organization_id`, `facility_id`, `counterparty_id`, `side` (`BID`/`OFFER`), `commodity_id`, `grade_id` or recorded equivalent quality spec, `raw_price`, `currency`, `unit`, `delivery_basis`, `quote_status`, `source_type`, `source_reference`, `quoted_at`, `valid_from`, `valid_until`, `delivery_window_start`, `delivery_window_end`, `quantity_min_mt`, `quantity_max_mt`, `recorded_by`, `revision_number` and change metadata. Required fields may be explicitly `UNKNOWN` only where the system labels a quote non-actionable.

For freight and landed costs, store responsibility and applicability (which leg or service is included in a quote) to avoid double-counting freight already included in a delivered bid/offer. Quality/grade compatibility and delivery timing are validated before margin is classified as actionable.

## 5.3 Numeric rules

- Use PostgreSQL `numeric` and a decimal arithmetic library (`decimal.js` or equivalent) in the trading engine. **Do not use JavaScript floating-point money arithmetic.**
- Internal canonical quantity: metric tonnes (`MT`); store original quoted quantity and unit unchanged as well.
- Internal reporting currency for first release: CAD; store source currency and the exact FX `CAD per 1 USD` conversion factor used.
- Currency unit must have explicit pair and direction, `USD/CAD = CAD per USD`. If converting a USD price to CAD: `CAD_price = USD_price × CAD_per_USD`.
- A `USD/bushel` quote cannot normalize without a vetted commodity-specific and applicable contractual pounds-per-bushel convention. The conversion value, source and version must be snapshotted.
- Distinguish U.S. short ton (`2,000 lb`), metric tonne (`1,000 kg`), and other vendor-specific units.
- Freight quoted per load requires an actual contract payload assumption to convert to per-MT; do not infer payload from truck class alone.
- Quantities, rates and totals retain working precision; round only at explicit reporting or settlement boundaries.
- Negative margin is valid and displayed plainly. Unavailable margin is **null plus an error**, never zero.

## 5.4 Baseline economics

For a simple purchase-origin/sell-destination movement with all values normalized to CAD/MT of grain delivered:

```
Revenue_CAD_per_delivered_MT
 = buyer_bid_USD_per_MT * CAD_per_USD

Gross_margin_CAD_per_delivered_MT
 = Revenue - seller_cost - incremental_freight - handling
   - border_cost - other_incremental_costs

Scenario_gross_margin_CAD
 = Gross_margin_CAD_per_delivered_MT * delivered_quantity_MT
```

The production engine must separately model **loaded/purchased quantity** and **delivered/saleable quantity** when shrink, dockage, wastage or quality adjustment is nonzero. Then total economics must use purchase quantity for purchase-side costs and delivered/saleable quantity for sales revenue; do not simply deduct an arbitrary loss factor from margin. V1 defaults loss to zero **only as an explicit user-approved scenario assumption**. Financing, hedging, inventory carrying costs, taxes, company overhead, credit/default risk, and other costs are excluded unless explicitly modeled. Accordingly this is an **indicative gross contribution**, not net profit or booked P&L.

### Golden acceptance fixture (synthetic, not a live trade)

| Input | Value |
|---|---:|
| Seller offer | CAD 820.00 / MT |
| Buyer bid | USD 725.00 / MT |
| FX | CAD 1.360000 / USD 1 |
| Freight | CAD 105.00 / delivered MT |
| Handling and border | CAD 12.00 / delivered MT |
| Other incremental costs | CAD 3.00 / delivered MT |
| Delivered quantity | 42.000 MT |
| Assumed loss | 0.000 MT |
| Revenue in CAD | 725 × 1.36 = CAD 986.00 / MT |
| Total modeled cost | 820 + 105 + 12 + 3 = CAD 940.00 / MT |
| Expected gross margin | **CAD 46.00 / MT** |
| Scenario gross contribution | **CAD 1,932.00** |

Reject the scenario as `BLOCKED_INCOMPLETE` when FX, required freight, or unit normalization is missing; do not replace with zero. If quotes are indicative, scenario output is also indicative even if arithmetic is complete.

### Mandatory calculation warnings

Quote expired; quote withdrawn; nonmatching commodity/grade; uncertain quality specs; insufficient volume; non-overlapping delivery windows; unmatched delivery basis; missing or low-confidence freight; ambiguous unit conversion; FX quote missing/stale; customs/duties not determined; costs double-counted; scenario P&L excludes financing/hedge risk. Blocking errors are distinct from warnings.

## 5.5 Tradability gate

A scenario is *mathematically calculable* only when every required input is known and normalized. It is *potentially actionable* only when quotes are affirmatively designated firm/current by authorized users, quality and delivery terms match, quantity is available, freight and border assumptions are confirmed, and human verification/approval has occurred. No automation executes a physical trade.

# 6. Logical data model

All tenant-owned tables contain `organization_id uuid not null`, with foreign keys and composite tenant checks where useful. All records use `uuid` keys, UTC timestamps, `created_at`, `updated_at`, `created_by`, and auditable state changes. Source and confidence remain first-class fields.

| Table | Essential additional fields / notes |
|---|---|
| `organizations` | display_name, brand_settings JSONB, active; initial one tenant |
| `organization_members` | user_id FK to auth.users, role, status, joined_at, unique(organization_id,user_id) |
| `counterparties` | legal_name, trading_name, types[], primary_country, verification_status, risk_flags |
| `counterparty_contacts` | counterparty_id, name, role, email, phone, confidential scope |
| `facilities` | counterparty_id, facility_type, address, region, country, location geography(Point,4326), geocoding_source, geocoding_confidence |
| `commodities` | canonical code, display_name, active |
| `commodity_grades` | commodity_id, grade_code, specifications JSONB, standard_id/version, compatibility rules |
| `quotes` | current revision pointer, facility_id, side, status; searchable identity shell |
| `quote_revisions` | immutable economic fields from §5.2, notes, valid dates, source, revision, entered_by; snapshot original input |
| `fx_quotes` | base_currency, quote_currency, convention, rate numeric, timestamp, expires_at, source, quality |
| `freight_quotes` | origin_facility_id, dest_facility_id, carrier, mode, quoted amount/unit/currency, payload, route/basis, valid dates |
| `trade_scenarios` | label, status, owner, latest_version_id, created_at |
| `scenario_versions` | immutable JSONB input_snapshot and output_snapshot, engine_version, assumptions, warnings/errors, calculated_at, input hashes |
| `trades` (later) | scenario_id, contract refs, approval status, negotiated quantity, currency, counterparty commitments |
| `trade_events` (later) | state changes, documents, delivery/shipment events, revisions |
| `documents` | attached_entity_type/id, object_key, MIME/size, checksum, classification, uploaded_by |
| `import_batches` | provider, imported_at, file checksum, record counts, success/reject counts |
| `audit_events` | actor_id, action, entity, entity_id, org_id, before/after summary, request_id, timestamp |

### Required constraints and indexes

- FK constraints and tenant-matching relationship checks. One tenant cannot reference another tenant's facility/quote.
- `CHECK` constraints for valid money > 0 where appropriate; FX > 0; valid price unit; min volume >= 0; max volume >= min; valid start <= end.
- Index `(organization_id, side, commodity_id, quote_status)` through current quote view/materialization as needed; `(organization_id, quoted_at desc)`; `(facility_id, created_at desc)` on quote revisions.
- Spatial GiST index on `facilities.location` in PostGIS; PostGIS extension installed in a dedicated schema, not `public`.
- Unique external provider+provider record identifiers within organization, supporting idempotent imports.
- Scenario versions append-only; do not mutate history on re-calc.
- No hard deletes for economic records once referenced by saved scenarios/trades; archive or tombstone instead.
- Build materialized/current quotes projection only after correctness is established; preserve revision source of truth.

### Location governance

Use WGS84 lat/lng and actual facility/address location; distinguish approximate municipality geocoding from exact geocoding. A farmer counterparty's residential location must not be displayed on a map without business need and permission. Store the precision/visibility policy and prefer generalized area display when appropriate.

# 7. HTTP API contract (v1)

API prefix: `/api/v1`. JSON request/response with consistent envelope and UTC ISO 8601 timestamps. Authenticate every private endpoint; resolve and verify tenant membership per request. Server cannot trust `organization_id`, prices, roles, or margins supplied by a browser. Requests may accept an organization selector but must authorize it.

| Method/path | Purpose | Access |
|---|---|---|
| `GET /api/v1/me` | Current user, organizations and role | Signed-in |
| `GET /api/v1/commodities` | Commodity/grade directory | Signed-in |
| `GET /api/v1/facilities?bbox=&side=&commodity=&as_of=` | Paginated geospatial facility search | Signed-in |
| `POST /api/v1/facilities` | Add facility + geocoding metadata | Operations/Admin |
| `GET /api/v1/facilities/{id}` | Facility, counterparty and permitted data | Signed-in |
| `GET /api/v1/counterparties` | Tenant-filtered counterparties | Signed-in |
| `POST /api/v1/counterparties` | Create counterparty | Operations/Admin |
| `GET /api/v1/quotes?commodity=&side=&status=&as_of=` | Search quote revisions/current quotes | Signed-in |
| `POST /api/v1/quotes` | Create with source+terms | Trader/Admin |
| `POST /api/v1/quotes/{id}/revisions` | Append new economic quotation | Trader/Admin |
| `POST /api/v1/quotes/{id}/withdraw` | Withdraw quote; audit | Trader/Admin |
| `GET /api/v1/fx-quotes` | Known reference FX quotes, provenance | Signed-in |
| `POST /api/v1/scenarios/calculate` | Stateless validated calculation, no DB mutation | Analyst+ |
| `POST /api/v1/scenarios` | Save first immutable version | Analyst+ |
| `GET /api/v1/scenarios/{id}` | Load scenario and versions | Signed-in |
| `POST /api/v1/scenarios/{id}/versions` | Save revised input/result snapshot | Analyst+ |
| `GET /api/v1/scenarios/{id}/export.csv` | Export authorized economics | Signed-in |
| `GET /api/v1/audit` | Approved audit history | Admin |

### Example calculation request

```json
{
  "seller_quote_revision_id": "<uuid>",
  "buyer_quote_revision_id": "<uuid>",
  "quantity": { "value": "42.000", "unit": "MT" },
  "fx": {
    "source": "MANUAL_ASSUMPTION",
    "cad_per_usd": "1.360000",
    "observed_at": "2026-10-26T18:00:00Z"
  },
  "costs": [
    { "type": "FREIGHT", "amount": "105.00", "currency": "CAD", "per_unit": "MT_DELIVERED" },
    { "type": "HANDLING_BORDER", "amount": "12.00", "currency": "CAD", "per_unit": "MT_DELIVERED" },
    { "type": "OTHER", "amount": "3.00", "currency": "CAD", "per_unit": "MT_DELIVERED" }
  ],
  "loss_mt": "0.000"
}
```

The quote revision records, NOT caller-submitted arbitrary prices, supply the official economic inputs when referenced by ID. Optional sandbox simulation may accept direct input prices but must clearly label them as `UNVERIFIED_ASSUMPTIONS` and must never attach them to an authoritative quote.

### Example calculation response (with the synthetic fixture)

```json
{
  "calculation_status": "CALCULATED_INDICATIVE",
  "currency": "CAD",
  "quantity_unit": "MT_DELIVERED",
  "delivered_quantity_mt": "42.000",
  "revenue_per_mt": "986.00",
  "acquisition_per_mt": "820.00",
  "incremental_cost_per_mt": "120.00",
  "gross_margin_per_mt": "46.00",
  "scenario_gross_margin": "1932.00",
  "engine_version": "1.0.0",
  "warnings": ["FX_MANUAL_ASSUMPTION", "NO_LOSS_ASSUMED", "NOT_EXECUTED_TRADE"],
  "blocking_errors": []
}
```

Return `422 VALIDATION_FAILED` with typed field errors for malformed/conflicting inputs; `409 QUOTE_CHANGED` when input version is stale; `401` for unauthenticated, `403` for disallowed and `404` for inaccessible records (avoid leaking another tenant's records). Use idempotency keys on state-changing endpoints that may be retried.

# 8. Geospatial, routing, and freight design

Map pins are facilities; eligible bid/offer indicators derive from current quote state. Query the server by viewport bounding box, commodity and status; cluster pins or apply server-side pagination under large results. Selecting origin/destination draws an illustrative connection only; label direct connections distinctly from a verified transport route.

**Phase 1:** Populate verified coordinates (and mark low-confidence matches). Manual freight and border charge entry. No routing estimates represented as carrier prices.

**Phase 2:** Plug in licensed routing API for actual road kilometers and estimated driving time; validate commercial vehicle/border restrictions where supported. Store route provider, version, route coordinates, distance, time and route timestamp. Maintain distinct `map_straight_line_km` and `road_distance_km` fields.

**Phase 3:** Load carrier quotes and lane history. Build mode-specific economics for truck and later rail. Do not treat average price/km as an executable freight quotation. Consider border crossing routing, empty miles, seasonality, tolls, axle and size requirements, weight rules and state/province differences.

# 9. Data ingestion and provenance

**MVP permitted sources:** trader-entered quotations, verified communications, user-supplied licensed CSV/Excel exports, public reference facility information with documented permission, and hand-entered carrier/FX assumptions. No unlicensed automated scraping of protected market price sources.

Each import has `source`, `license_or_permission`, `retrieved_at`, `effective_at`, `checksum`, `record_count`, `import_batch_id`, deduplication key, validation errors and an operator review state. Import into a staging table first, validate unit/grade/location/tenant, and then publish as versioned records. Keep raw source files in restricted storage if agreements allow it.

Make an early operational distinction between **known buyer facility**, **buyer with an indicative published bid**, and **buyer with a currently confirmed executable bid**. The platform may list the first category even when no price exists, but it must not synthesize the other categories.

# 10. Security, reliability, privacy and compliance

## 10.1 Security baseline

- Private GitHub organization repository; protected main branch, required CI and at least one reviewer for financial and permission changes.
- Auth with MFA; restricted employee provisioning; no open public signup in v1.
- Least-privilege API database credentials, tenant authorization on every request, private buckets and time-limited document links.
- RLS and explicit grants on exposed Postgres schemas; security tests for inter-tenant reads, writes, exports and nested-resource access.
- Structured request IDs and audit events on quote revisions, counterparties, saved scenarios and administrative actions.
- Sanitized logs and AI prompts; never log full access tokens or sensitive trade documents.
- Secrets provided via Cloudflare/Supabase secret mechanisms, never Git source control or third-party AI transcripts without approval.
- Dependabot/Renovate equivalent, dependency scanning, PR approval and basic incident runbook.
- Backups and tested restoration with a business-approved recovery objective before live commercial data is relied on.

## 10.2 Privacy and data controls

Classify contact data and trade prices as confidential. Do not publish seller coordinates or phone numbers outside explicitly approved staff roles. White-label tenants should be isolated by organization from day one; do not assume users should be able to discover the contact network of other tenants. Confirm vendor data residency and contractual restrictions before production rollout.

## 10.3 Physical trade/compliance considerations

The platform does not replace customs brokers, CFIA, USDA/APHIS, or other competent authorities. Shipment requirements depend on commodity, intended use, origin, destination and applicable standards; some exports require inspection or phytosanitary documentation while others may not. A compliance checklist is informational and customizable until reviewed for a specific trade. Identify importer/exporter of record and who is responsible for freight, clearance and charges in any eventual contract workflow.

## 10.4 Reliability targets for acceptance (initial engineering targets, not vendor SLAs)

- In staging with **1,000 facilities** and **10,000 quote revisions**, main facility results visible within **3 seconds at p75** on a representative office network; API quote/facility searches under **1.5 seconds p95** for indexed queries in a comparable load test.
- Calculation engine fixture tests run in CI and return deterministic results across local and Workers execution.
- All key user journeys work after refresh and re-authentication; browser does not lose saved scenarios.
- No successful cross-organization access in automated red-team authorization test suite.
- A backup restore exercise is completed prior to storing any irreplaceable real trading data.

# 11. Multi-model development governance

## 11.1 How AI models share knowledge

Git is the source of code truth; specifications and decision records are the source of design intent. A chat transcript is not the source of truth. Use short `AGENTS.md` as central instructions and store the detailed documents in `docs/`. Keep `CLAUDE.md` importing `AGENTS.md`, and configure Gemini CLI's context filename to `AGENTS.md` or use `GEMINI.md` to import it. Confirm agent instructions are actually loaded in each environment before work starts. **Read `docs/AI_CODING_SYSTEM.md` for the October 2026 primary-tool recommendation, agent-task division, parallelism constraints, practical prompts and objective cost/quality comparison.**

## 11.2 Suggested human/agent roles

- **Owner/product lead:** Accepts economic assumptions, prioritizes backlog, owns commercial correctness and merges approved changes.
- **Primary implementer (often Claude via Cursor or native Claude Code):** Delivers a scoped UI, API, migration or bug-fix ticket in an isolated worktree.
- **Independent reviewer (often Codex):** Challenges financial math, authorization, migrations and hidden coupling; writes or requests regression tests.
- **Alternate implementer / second opinion (often Gemini):** Implements discrete tasks, assesses integrations and challenges UX alternatives.
- **Integration owner:** Approves shared contracts, serializes dependent merges and updates the merged-state handoff.

These are process assignments, not claims about permanent model superiority. Rotate roles when useful; the model implementing a high-risk change should not be its sole approver.

## 11.3 Task handoff protocol

1. GitHub Issue documents intent, affected module, prerequisites, acceptance criteria and synthetic examples.
2. Implementer reads `AGENTS.md` and only needed docs; states files being changed, edge cases, and intended test plan.
3. Work occurs on a separate branch/worktree. No concurrent agents write to the same worktree.
4. Implementer supplies PR with change summary, migration notes, screenshots for UI work, test output, business-rule impacts and risk.
5. Independent reviewer actively looks for errors and adds tests for disputed assumptions.
6. CI passes; human owner approves; merge updates architectural decisions/docs. **After merge**, the integration owner updates `docs/HANDOFF.md`; parallel feature branches do not modify it independently.
7. Deploy staging; run the relevant acceptance flow; promote production only after the release gate is met.

**AI must never:** invent quotes or market data, treat hypotheticals as live, auto-execute trades, skip tenant isolation, edit production records ad hoc, bypass CI, commit secrets, or conceal unverified assumptions.

## 11.4 Documentation ownership

- `docs/PRODUCT.md`: user-facing product scope and user journeys.
- `docs/ARCHITECTURE.md`: components, diagram, technical decisions.
- `docs/DATA_MODEL.md`: entities and schema rules.
- `docs/TRADING_RULES.md`: formulas, assumptions and invariants.
- `docs/API.md`: endpoint contracts and error behavior.
- `docs/BUILD_PLAN.md`: ordered stages and issues.
- `docs/ACCEPTANCE_TESTS.md`: cross-model golden fixtures, security gates.
- `docs/DECISIONS.md`: unresolved decisions + dated architecture decisions.
- `docs/HANDOFF.md`: current merged implementation state, last commit, open blockers, next exact task.
- `docs/AI_CODING_SYSTEM.md`: recommended coding tools, task allocation, comparison criteria and daily operating process (non-authoritative for domain logic).

# 12. Repository structure and engineering standards

```
grain-trading-platform/
  AGENTS.md
  CLAUDE.md
  .gemini/settings.json
  README.md
  docs/
    PRODUCT.md
    AI_CODING_SYSTEM.md
    AI_WORKFLOW.md
    ARCHITECTURE.md
    DATA_MODEL.md
    TRADING_RULES.md
    API.md
    BUILD_PLAN.md
    ACCEPTANCE_TESTS.md
    DECISIONS.md
    HANDOFF.md
  apps/
    web/                    # React + Vite SPA, map, table, dialogs
    api/                    # Cloudflare Worker + Hono; same deploy or separate Worker
  packages/
    domain/                 # types, schemas and enums
    trading-engine/         # pure decimal math and validation
    database/               # typed queries/repositories
  supabase/
    migrations/             # all DB changes versioned
    tests/                  # RLS and data invariant tests
  tests/
    e2e/
    fixtures/
  .github/
    workflows/
    ISSUE_TEMPLATE/
    pull_request_template.md
  .env.example              # key names only, no values
```

Keep one `pnpm` workspace, lockfiles in Git, strict TS config, lint/format hooks, named import conventions and consistent error structures. Centralize schemas with Zod or another well-supported validation library. Pin engine calculation version and use decimal strings over JSON rather than JSON numbers when precision matters. Any package addition must be justified in the PR.

### Branch and merge policy

`main` always releasable; branch naming `feat/GT-###-short-name`, `fix/GT-###-short-name`, `docs/GT-###`. Required checks: formatting/lint, typecheck, unit tests, DB schema/RLS tests where relevant, API integration tests, e2e smoke if UI touched, dependency/secrets checks. Financial math, auth, migration, data import and compliance changes need independent human review.

# 13. Execution plan, ordered backlog and acceptance gates

These are **release-readiness gates**, not calendar promises. Phase 0 and the minimum secure Phase 1 foundation must be completed first. Then the team may build a **thin cross-phase vertical slice** using the minimum map, revisioned quotes, deterministic calculation and saved-scenario features from Phases 2–4 before all polish/CSV imports are finished. All comprehensive phase gates still apply before any phase is declared complete. See `docs/BUILD_PLAN.md` and `docs/AI_CODING_SYSTEM.md` §8. Synthetic test records are permitted until validated market data is onboarded.

## Phase 0 — Repository and documentation baseline

**Tickets:** GT-001 create private repo/permissions/protected main; GT-002 install monorepo tooling; GT-003 add AGENTS.md, Claude/Gemini adapters, documentation and PR templates; GT-004 establish CI typecheck/lint/test; GT-005 development/staging secret management.

**Gate:** Fresh clone installs and runs tests; selected implementer and independent reviewer demonstrably read shared instructions, and other tools are checked if used; a sample PR cannot merge with failed CI. No code secrets stored in repo.

## Phase 1 — Infrastructure, auth and database foundation

**Tickets:** GT-010 scaffold React/Vite/Cloudflare Worker/Hono; GT-011 create separate Supabase projects; GT-012 implement auth/session and MFA; GT-013 organizations, memberships and role capabilities; GT-014 migration chain and least-privilege database access; GT-015 PostGIS, facility/commodity/counterparty schema; GT-016 audit infrastructure; GT-017 seeded fictional data, backups and restore runbook.

**Gate:** Users can sign in and switch among only authorized organizations; unauthorized direct API requests fail; tenancy tests pass; migration setup works on a fresh database.

## Phase 2 — Counterparties, facilities, map and table

**Tickets:** GT-020 counterparty CRUD with permissions; GT-021 facility details/geocoding precision; GT-022 viewport/bbox API using PostGIS; GT-023 MapLibre map with licensed tile source; GT-024 responsive synchronized facility table, filters and accessibility; GT-025 synthetic producer/buyer fixtures.

**Gate:** Verified/approximate geolocations display distinctly; map selection updates detail panel and table; tenant isolation holds for geographic queries; mobile/narrow screens remain usable.

## Phase 3 — Versioned quotes and source provenance

**Tickets:** GT-030 quote+quote_revisions migrations; GT-031 bid/offer CRUD, expiry/withdraw/revision; GT-032 quote input validation (grade, price, unit, basis, quantity, dates); GT-033 current quote discovery + facility quote pane; GT-034 provenance and audit; GT-035 CSV quote import staging/rejections.

**Gate:** Quote history is preserved across updates; expired/withdrawn quotes cannot appear active without an explicit historical filter; unsuitable quotes cannot be mislabeled firm or actionable.

## Phase 4 — Trading engine and saved scenarios: FIRST USEFUL RELEASE

**Tickets:** GT-040 decimal-based money/quantity normalization; GT-041 grade/date/quantity/basis compatibility validator; GT-042 pure scenario economics and warnings; GT-043 golden test fixture plus exhaustive boundary tests; GT-044 scenario builder UI; GT-045 server calculation endpoint, immutable saved versions and CSV export; GT-046 human acceptance walkthrough with two fictitious locations.

**Gate:** The synthetic 42 MT example returns exactly CAD 46.00/MT and CAD 1,932.00, and a stale/missing FX, missing freight, unmatched basis or unit yields a visible block/warning as specified. Reloading an old scenario never recalculates it silently against changed market data. An internal tester completes the entire journey without developer intervention.

## Phase 5 — Commercially useful freight and discovery

**Tickets:** GT-050 freight quote/lane data model; GT-051 licensed road routing integration; GT-052 source/time-aware FX connector; GT-053 candidate-match query and rankings; GT-054 comparison table and suitability rules; GT-055 performance tests over representative dataset.

**Gate:** Ranked opportunities differentiate confirmed, estimated and insufficient-data scenarios; shipping cost inclusion is auditable; no inaccurate route or estimated cost is presented as firm carrier freight.

## Phase 6 — Trade management and intelligence (separate release decision)

**Tickets:** GT-060 trade lifecycle and approval authority; GT-061 contract/document storage and access; GT-062 shipment and invoice event tracking; GT-063 expected-vs-realized economics; GT-064 external price-feed adapters where licensed; GT-065 document extraction with human validation; GT-066 scenario and route analytics; GT-067 Python optimization only when justified.

**Gate:** Approved lifecycle definitions, commercial controls, auditability, and operational sign-off. AI cannot execute/approve transactions independently.

# 14. Test strategy and non-negotiable edge cases

| Test class | Minimum cases |
|---|---|
| Quote validity | Firm/current vs indicative; midnight expiration across local time zones; withdrawn/revised quote |
| Unit normalizer | CAD/MT, USD/MT, USD/bushel with explicit commodity lb/bu; reject missing factors; U.S. short tons |
| FX | Source direction; CAD per USD vs inverse; 0 or negative invalid; stale/manual FX warnings |
| Pricing math | Synthetic CAD 46/MT fixture; negative margin; fractional tonne; decimal rounding; quantity loss |
| Quantity | Offer/bid volumes not matched; min > requested; purchase vs saleable metric tonnes |
| Basis | Ex-farm vs delivered; included freight not charged twice; unknown terms block actionable ranking |
| Quality | Incompatible grade/protein/moisture specifications block matches |
| Time | Delivery windows no overlap; quote expired on one side |
| Authorization | Anonymous, forbidden role, cross-tenant ID guessed, cross-tenant map query/export/document URL |
| Durability | Saved scenario keeps source quote revision, FX, fee, conversion factor and engine version after inputs change |
| Import | Duplicate files, invalid units, malformed CSV, incompatible dates, partial row failures, provenance |
| UI | Keyboard navigation, map/table filtering, very small viewport, missing locations |
| Deployment | Fresh migration, staging smoke, rollback and backup restore rehearsal |

Financial tests compare exact decimal output strings and explicitly defined rounding, not fuzzy JS float tolerances. Every bug involving money, authorization or trade status becomes a permanent regression fixture.

# 15. Design decisions requiring commercial sign-off

These are **not implementation blockers for Phase 0–2**, but must be decided before asserting production-grade scenario actionability:

1. **Default pricing conventions:** Which commodities/grades, quote units, and reference standards are first, and which conversion tables/authorities are approved?
2. **Commercial basis vocabulary:** Preferred delivery-term taxonomy; when are origin handling, delivered freight, or unloading included in buyer/seller prices?
3. **Firm quote standard:** What human evidence is needed to mark a bid/offer firm, and for how long is it valid?
4. **FX policy:** Manual deal rate, executable bank quote, or feed reference; what should happen when an FX quote ages out?
5. **Loss/dockage and quality adjustments:** Which charges/quantity basis apply to specific commodities and grades?
6. **Border/compliance ownership:** Who is importer of record, who arranges customs broker, and which cost placeholders are required before trade approval?
7. **Data rights:** Which external prices/data are licensed for storage, commercial display and derivative modeling?
8. **Internal confidentiality:** Whether exact farm addresses or farmer private contacts can be viewed by all employees.
9. **Multi-tenant branding:** Will white-label mean separate company databases/domains or one strictly isolated database with branded organizations?
10. **Release governance:** Who can approve new trade economics and database/schema production changes?

**Proposed safe defaults:** CAD per MT reporting, manually verified quote data, manual freight, zero loss *only if explicitly acknowledged*, no automatic execution, one internal organization initially, and an organization-aware schema.

# 16. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Stale buyer prices look executable | Quote status, timestamps, explicit owner verification, hard actionability gate |
| Wrong unit/FX conversion creates imaginary margin | Canonical typed values, source conversion table, exact decimal golden tests |
| Freight double-counting from delivery bases | Explicit cost inclusion and basis compatibility validator |
| AI introduces unreviewed financial logic | Pure engine, independent agent reviewer + human review, CI and versioned snapshots |
| Tenant data leakage | API membership checks, grants/RLS, authorization integration tests |
| Invalid geocoding exposes private farms | Confidence/precision, location redaction/generalization policies |
| Commercial feeds prohibited from reuse | Provenance and licensing registry before ingest |
| Over-building AI/automation before product-market fit | Phase gates; human-in-the-loop; no proprietary orchestration framework initially |
| Inability to restore critical trading records | Separate environments, backup verification and restore drills |
| Vendor lock-in | Standard Postgres, domain package isolated from Workers, MapLibre, provider adapters |

# 17. Concrete first implementation task for the coding team

**Issue GT-001 through GT-005 — Repository Bootstrap:** Create the private GitHub repo and scaffolding, copy this document pack, configure pnpm/TypeScript strict mode, initial React/Hono Cloudflare template, lint/test/typecheck CI, default branch protection, separate dev/staging secrets, and project instruction loading for the chosen implementer and independent reviewer (plus optional additional agents actually in use). Add a read-only health endpoint and one Vitest passing test. Do not build the map, quote ingestion or live calculations until Phase 0 acceptance is verified.

**Phase 4 target demonstration (also the early thin vertical-slice milestone):** Using fictional quote IDs, create and save the 42-MT golden scenario, then revise the buyer quote and show that the prior saved scenario still displays CAD 1,932.00 with its original assumptions. From the map, click origin/destination, calculate again and explicitly indicate whether the revised quote changed the economics.

# 18. Verification and reference documentation

Vendor capabilities were checked against public technical documentation available 26 October 2026; URLs are implementation references, not claims of any subscribed data feed or production service agreement.

- Cloudflare React/Vite Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/react/
- Cloudflare Hono Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/hono/
- Cloudflare Hyperdrive to Supabase: https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- Supabase PostGIS: https://supabase.com/docs/guides/database/extensions/postgis
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- MapLibre: https://maplibre.org/maplibre-gl-js/docs/
- Codex repository instructions: https://developers.openai.com/cookbook/examples/codex/iterating-development-workflows-with-codex
- Gemini CLI context configuration: https://geminicli.com/docs/reference/configuration/
- Cursor 3 agent environment: https://cursor.com/changelog/3-0
- Claude Code multi-worktree execution: https://support.claude.com/en/articles/14554000-claude-code-power-user-tips
- Google Antigravity 2.0: https://www.antigravity.google/blog/introducing-google-antigravity-2-0
- CFIA phytosanitary exports: https://inspection.canada.ca/en/exporting-food-plants-animals/plant-exports/phytosanitary-certificates

---

**Specification rule:** When a new business decision conflicts with an existing line of this document, update the relevant decision record, domain contract, acceptance test, and affected implementation in the *same approved pull request*. Never silently change the meaning of a historical trade calculation.
