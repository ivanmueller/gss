# Architecture and operations

See shared technical baseline, privacy requirements and transport-adapter sequencing.

# 4. Architecture and boundaries

## 4.1 Runtime flow

```
Browser — React/Vite/Mapbox GL JS
   |  HTTPS + Supabase Auth identity
Cloudflare Worker — Hono API
   |  user verification + organization membership + validation
   |  price/basis/quantity compatibility + deterministic trading engine
   |  typed repositories / outbound adapters
Supabase Postgres — PostGIS, quote history, scenarios, audit
Supabase Storage — private supporting documents
External adapters — Mapbox tiles (browser), Geocodio geocoding (Worker), Bank of Canada daily FX (Worker scheduled job, GT-052); ArcGIS map layers (requested, GT-026); routing, licensed price data (as added)
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

Use one documented strategy for v1: **server-side API for all private domain reads/writes**. Supabase Auth handles sign-in, storage is accessed via short-lived signed URLs under server authorization, and server API database access uses a minimum-privilege role. Staging connects through Cloudflare Hyperdrive (`docs/DECISIONS.md`), which is a connection pool for PostgreSQL clients, not an automatic way to apply end-user RLS. The API must explicitly filter and authorize `organization_id`, including on nested joins and updates. Set RLS and minimal grants on any exposed tables as defense in depth, with user-context policies where Data API access is allowed. Never use a service-role credential in the browser.

## 4.4 Environment separation

- **Local:** seeded fictional/synthetic data, local Supabase or disposable remote dev project.
- **Staging:** separate Supabase project, staging Worker, test-only accounts and data.
- **Production:** separate resources, restricted operators, approval-gated migrations and deployments.

Production secrets live in platform secret stores, never in Git or AI prompt files. The staging Worker's secrets: `GEOCODIO_API_KEY` (address lookups) and `SUPABASE_SECRET_KEY` (only to make logins from the Team page and set a person's own password, in `apps/api/src/logins.ts`; never for data, which the API reads and writes as `app_api` under row level security). The database connection comes through the Hyperdrive binding. The same migration chain runs across environments.

# 8. Geospatial, routing, and freight design

Map pins are facilities; eligible bid/offer indicators derive from current quote state. Query the server by viewport bounding box, commodity and status; cluster pins or apply server-side pagination under large results. Selecting origin/destination draws an illustrative connection only; label direct connections distinctly from a verified transport route.

**Phase 1:** Populate verified coordinates (and mark low-confidence matches). Manual freight and border charge entry. No routing estimates represented as carrier prices.

**Phase 2:** Plug in licensed routing API for actual road kilometers and estimated driving time; validate commercial vehicle/border restrictions where supported. Store route provider, version, route coordinates, distance, time and route timestamp. Maintain distinct `map_straight_line_km` and `road_distance_km` fields.

**Phase 3:** Load carrier quotes and lane history. Build mode-specific economics for truck and later rail. Do not treat average price/km as an executable freight quotation. Consider border crossing routing, empty miles, seasonality, tolls, axle and size requirements, weight rules and state/province differences.

# 10. Security, reliability, privacy and compliance

## 10.1 Security baseline

- GitHub repository (public by the owner's choice, so no real data or secrets in Git); protected main branch, required CI and at least one reviewer for financial and permission changes.
- Auth with MFA; restricted employee provisioning; no open public signup in v1.
- Least-privilege API database credentials, tenant authorization on every request, private buckets and time-limited document links.
- RLS and explicit grants on exposed Postgres schemas; security tests for inter-tenant reads, writes, exports and nested-resource access.
- Structured request IDs and audit events on quote revisions, counterparties, saved scenarios and administrative actions.
- Sanitized logs and AI prompts; never log full access tokens or sensitive trade documents.
- Secrets provided via Cloudflare/Supabase secret mechanisms, never Git source control or third-party AI transcripts without approval.
- Dependabot/Renovate equivalent, dependency scanning, PR approval and basic incident runbook.
- Backups and tested restoration with a business-approved recovery objective before live commercial data is relied on.

## 10.2 Privacy and data controls

Classify contact data and trade prices as confidential. Do not publish seller coordinates or phone numbers outside explicitly approved staff roles. Records belong to the shop's one organization and are visible only to its active members. Confirm vendor data residency and contractual restrictions before production rollout.

## 10.3 Physical trade/compliance considerations

The platform does not replace customs brokers, CFIA, USDA/APHIS, or other competent authorities. Shipment requirements depend on commodity, intended use, origin, destination and applicable standards; some exports require inspection or phytosanitary documentation while others may not. A compliance checklist is informational and customizable until reviewed for a specific trade. Identify importer/exporter of record and who is responsible for freight, clearance and charges in any eventual contract workflow.

## 10.4 Reliability targets for acceptance (initial engineering targets, not vendor SLAs)

- In staging with **1,000 facilities** and **10,000 quote revisions**, main facility results visible within **3 seconds at p75** on a representative office network; API quote/facility searches under **1.5 seconds p95** for indexed queries in a comparable load test.
- Calculation engine fixture tests run in CI and return deterministic results across local and Workers execution.
- All key user journeys work after refresh and re-authentication; browser does not lose saved scenarios.
- No successful cross-organization access in automated red-team authorization test suite.
- A backup restore exercise is completed prior to storing any irreplaceable real trading data.

