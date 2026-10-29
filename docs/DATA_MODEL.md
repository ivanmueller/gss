# Logical database model

Design-level schema contract. Executable migrations become authoritative when implemented; update this doc with migrations.

# 6. Logical data model

All tenant-owned tables contain `organization_id uuid not null`, with foreign keys and composite tenant checks where useful. All records use `uuid` keys, UTC timestamps, `created_at`, `updated_at`, `created_by`, and auditable state changes. Source and confidence remain first-class fields.

| Table | Essential additional fields / notes |
|---|---|
| `organizations` | display_name, brand_settings JSONB, active; one row, GSS (its staff are its members) |
| `organization_members` | user_id FK to auth.users, role, status, joined_at, unique(organization_id,user_id) |
| `counterparties` | legal_name, trading_name, types[], primary_country, verification_status, risk_flags |
| `counterparty_contacts` | counterparty_id, name, role, email, phone, confidential scope |
| `facilities` | counterparty_id, facility_type, address, region, country, location geography(Point,4326), geocoding_source, geocoding_confidence |
| `commodities` | canonical code, display_name, active |
| `commodity_grades` | commodity_id, grade_code, specifications JSONB, standard_id/version, compatibility rules |
| `quotes` | current revision pointer, facility_id, side, status; searchable identity shell |
| `quote_revisions` | immutable economic fields from §5.2, notes, valid dates, source, revision, entered_by; snapshot original input |
| `fx_quotes` | Built (`20261029010000_fx_quotes.sql`): base_currency `USD`, quote_currency `CAD` (the rate is CAD per 1 USD), rate numeric as published, rate_date (the business day), source `bank_of_canada`, source_series `FXUSDCAD`, fetched_at; one row per day, never changed or deleted (triggers). Public reference data, so no organization_id; read by signed-in users, written only by `app.record_bank_of_canada_rate()` from the Worker's scheduled job. Staleness (more than four days) is computed when read, not stored as expires_at (owner's decision, `docs/DECISIONS.md`) |
| `freight_quotes` | Built (`20261029020000_freight_quotes.sql`) as `freight_quotes` (carrier counterparty, origin and destination facility, mode `truck`/`rail`, withdrawn; never deleted) and `freight_quote_revisions` (rate as entered, currency, unit `MT`/`ST`/`BU`/`CWT`/`LOAD`, payload and its unit for a rate per load only, what the rate includes, firm or indicative, quoted, valid-from and valid-until times, source, notes, recorder; never changed). Route geometry and routing-provider data come later (GT-051) |
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

## Implemented in migrations

Migrations in `supabase/migrations/` are authoritative for what exists; this list tracks them.

| Migration | Adds |
|---|---|
| `20261027020000_app_schema_and_api_role.sql` | Private `app` schema; `app_api` role (no login, no RLS bypass); `app.current_user_id()` reading the transaction's `app.user_id`; `app.touch_updated_at()` trigger function. |
| `20261027020100_organizations_and_members.sql` | `app.organizations` (display_name, brand_settings, active); `app.organization_members` (role enum `viewer`/`analyst`/`trader`/`operations`/`org_admin` from §2.1, status enum `invited`/`active`/`suspended`, joined_at required once joined, unique per organization and user); `app.is_active_member(org)`; RLS read policies for `app_api`; no writes through `app_api` yet. |
| `20261027030000_audit_events.sql` | `app.audit_events` (organization, actor, action, entity, entity id, changed column names, request id) and the `app.record_audit_event()` trigger; no access for `app_api`. |
| `20261027030100_counterparty_directory.sql` | PostGIS in `extensions`; `app.counterparties` (legal and trading name, types `buyer`/`seller`/`broker`/`carrier`, primary country, verification `unverified`/`pending`/`verified`, notes, source, import batch; legal name unique per organization and country ignoring case); `app.counterparty_contacts` (name, role, email, phone); `app.facilities` (name, type, address, city, region, postal code, country, latitude/longitude with `exact`/`approximate` precision, derived `geography(Point, 4326)` with a GiST index); `app.counterparty_logos` (PNG up to 512 KB, checksum); `app.import_batches`; tenant-matching foreign keys; `app.has_role()` and `app.can_edit_directory()`; RLS read for active members and insert for operations/org_admin; every change audited. |
| `20261027040000_facility_map_search.sql` | `app.location_in_bbox(location, west, south, east, north)`: whether a facility's point lies in a map view's longitude/latitude box, edges included (PostGIS `ST_Intersects`). Standard-SQL body resolved at migration time, so `app_api` can execute it without access to the `extensions` schema. |
| `20261027050000_facility_geocoding.sql` | `facilities.geocoding_accuracy` (Geocodio's accuracy type) and `geocoding_confidence` (0–1), only with coordinates; an update policy and column grants letting operations and org_admin members fill in the location columns of a facility that has none, never overwriting existing coordinates. |
| `20261028010000_counterparty_editing.sql` | `counterparties.archived_at` (archived, never deleted); update policies for operations and org_admin on counterparties, contacts and facilities, delete policies on contacts and facilities, and column grants that keep records in their organization and counterparty; the facility policy that only filled in missing coordinates is replaced by one that allows corrections, and the trigger `app.keep_existing_coordinates()` keeps a geocoding result from replacing existing coordinates. |
| `20261028020000_member_management.sql` | Insert and update policies on `app.organization_members` for active org admins (role and status only; never deleted, never back to invited); the trigger `app.keep_an_active_admin()` (SQLSTATE `GS001`) keeps an active admin per organization; SECURITY DEFINER functions for admins only: `app.find_login` (a login by email), `app.member_directory` (members with email and names) and `app.set_member_name` (writes only the first and last name of a member's login, audited as `member_names`); memberships audited; `app.is_org_admin()`. `app_api` still has no access to the `auth` schema. |
| `20261028030000_member_name_version.sql` | `app.set_member_name` also touches the membership row, so a name change moves the version an edit is checked against (Codex's finding on ivanmueller/gss#37); `app.record_audit_event()` no longer records updates that change nothing but `updated_at`. |
| `20261028040000_quotes.sql` | `app.commodities` (code, display name, active, order; one shared list of 20, codes and names only); `app.quotes` (organization, counterparty, optional location of that counterparty by a tenant- and counterparty-matching key, side `bid`/`offer`, commodity, withdrawn time, who and their name; never deleted, only withdrawn, once); `app.quote_revisions` (the §5.2 terms: firm or indicative, price as entered (`numeric`, above zero, up to 12 decimals), CAD or USD, unit `MT`/`ST`/`BU`/`CWT`, grade, delivery basis and its place, minimum and available tonnes, delivery window, quoted, valid-from and valid-until times, source and its details, notes, who recorded it and their name), numbered 1, 2, … by the trigger `app.number_quote_revision()` (which also refuses a withdrawn quote, SQLSTATE `GS002`) and never changed, deleted or emptied, even by the table owner (`app.keep_quote_revisions()`); `app.keep_quote_identity()` lets an update only withdraw; `app.can_enter_quotes()` (trader, org_admin); RLS read for active members, insert for traders and admins (a new quote only for a counterparty that is not archived); both audited. A location with quotes cannot be removed (`quotes_facility_fkey`). |
| `20261029020000_freight_quotes.sql` | `app.freight_quotes` (organization, carrier counterparty, origin and destination locations by tenant-matching keys (`facilities_organization_key`, new), never the same location, mode `truck`/`rail`, withdrawn time, who and their name; never deleted, only withdrawn, once) and `app.freight_quote_revisions` (firm or indicative, rate as entered (`numeric`, above zero, up to 12 decimals), CAD or USD, unit `MT`/`ST`/`BU`/`CWT`/`LOAD`, `payload` (above zero, 3 decimals) and `payload_unit` (`MT`/`ST`/`LB`) required for a rate per load and only then, `inclusions`, quoted, valid-from and valid-until times, source and its details, notes, recorder and their name), numbered by `app.number_freight_revision()` (which also refuses a withdrawn rate, SQLSTATE `GS003`) and never changed, deleted or emptied (`app.keep_freight_revisions()`); `app.keep_freight_identity()` lets an update only withdraw; `app.can_enter_freight()` (trader, operations, org_admin); RLS read for active members, insert for those roles (a new rate only from a carrier that is not archived, between locations of counterparties that are not archived); both audited. A location on a route cannot be removed (`freight_quotes_origin_fkey`, `freight_quotes_destination_fkey`). |

Not yet implemented from this model: role capabilities beyond the directory, team and quotes (§2.1 table; analysts' proposed quotes), invitations by email, `risk_flags`, contacts' confidential scope, an `updated_by` column (who changed a record is in the audit trail), grades as a table of their own (a revision records the grade as text), and every scenario and trade table.

