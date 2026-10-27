# Logical database model

Design-level schema contract. Executable migrations become authoritative when implemented; update this doc with migrations.

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

## Implemented in migrations

Migrations in `supabase/migrations/` are authoritative for what exists; this list tracks them.

| Migration | Adds |
|---|---|
| `20261027020000_app_schema_and_api_role.sql` | Private `app` schema; `app_api` role (no login, no RLS bypass); `app.current_user_id()` reading the transaction's `app.user_id`; `app.touch_updated_at()` trigger function. |
| `20261027020100_organizations_and_members.sql` | `app.organizations` (display_name, brand_settings, active); `app.organization_members` (role enum `viewer`/`analyst`/`trader`/`operations`/`org_admin` from §2.1, status enum `invited`/`active`/`suspended`, joined_at required once joined, unique per organization and user); `app.is_active_member(org)`; RLS read policies for `app_api`; no writes through `app_api` yet. |

| `20261027030000_audit_events.sql` | `app.audit_events` (organization, actor, action, entity, entity id, changed column names, request id) and the `app.record_audit_event()` trigger; no access for `app_api`. |
| `20261027030100_counterparty_directory.sql` | PostGIS in `extensions`; `app.counterparties` (legal and trading name, types `buyer`/`seller`/`broker`/`carrier`, primary country, verification `unverified`/`pending`/`verified`, notes, source, import batch; legal name unique per organization and country ignoring case); `app.counterparty_contacts` (name, role, email, phone); `app.facilities` (name, type, address, city, region, postal code, country, latitude/longitude with `exact`/`approximate` precision, derived `geography(Point, 4326)` with a GiST index); `app.counterparty_logos` (PNG up to 512 KB, checksum); `app.import_batches`; tenant-matching foreign keys; `app.has_role()` and `app.can_edit_directory()`; RLS read for active members and insert for operations/org_admin; every change audited. |

Not yet implemented from this model: role capabilities beyond the directory (§2.1 table), member management, `risk_flags`, contacts' confidential scope, and every quote, FX, freight, scenario and trade table.

