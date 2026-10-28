# HTTP API contract

Proposed v1 routes. Keep OpenAPI and Zod validators in sync when implementation begins.

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
| `GET /api/v1/fx-quotes` | Known reference FX quotes, provenance (the Bank of Canada daily USD/CAD rate, owner's decision) | Signed-in |
| `POST /api/v1/scenarios/calculate` | Stateless validated calculation, no DB mutation | Analyst+ |
| `POST /api/v1/scenarios` | Save first immutable version | Analyst+ |
| `GET /api/v1/scenarios/{id}` | Load scenario and versions | Signed-in |
| `POST /api/v1/scenarios/{id}/versions` | Save revised input/result snapshot | Analyst+ |
| `GET /api/v1/scenarios/{id}/export.csv` | Export authorized economics | Signed-in |
| `GET /api/v1/audit` | Approved audit history | Admin |

### Implemented so far

| Method/path | Notes |
|---|---|
| `GET /api/v1/health` | Public liveness probe. |
| `GET /api/v1/me` | The verified user and their active organizations with roles. |
| `GET /api/v1/counterparties?organization_id=` | Counterparties visible to the user (up to 5,000, with `truncated`), with contact and location counts, regions, logo checksum and `archivedAt` (archived ones included; the web app hides them unless asked). |
| `GET /api/v1/counterparties/{id}` | One counterparty with contacts and facilities; 404 when missing or in another organization. The counterparty and each contact and facility carry a `version` (last change time to the microsecond, e.g. `2026-10-28T14:05:09.123456Z`); facilities also carry `geocodingSource`. |
| `GET /api/v1/members?organization_id=` | The organization's members with email, first and last name, role, status, joined time, `version` and `isYou`. Org admins only (403 otherwise). |
| `POST /api/v1/members` | Body: `organizationId`, `email`, `role`. Adds the person whose login has this email (ignoring case) as an active member. 201 `{ id }`; 404 `NO_ACCOUNT` when no login has the email (create it in the Supabase dashboard first); 409 `ALREADY_MEMBER`. Org admins only. |
| `PATCH /api/v1/members/{id}` | Body: `organizationId`, `version`, and any of `role`, `status` (`active` or `suspended`), `firstName`, `lastName` (empty or null removes a name). 409 `RECORD_CHANGED`; 409 `OWN_MEMBERSHIP` for an admin's own role or status; 409 `LAST_ADMIN` when the organization would have no active admin. Memberships are never deleted. Org admins only. |
| `POST /api/v1/counterparties` | Body: `organizationId`, `values` (the import's field ids: the company, optionally one contact and one location). A type is required; a location with only its country is ignored. 201 `{ id }`. Operations/Admin. |
| `PATCH /api/v1/counterparties/{id}` | Body: `version`, `values` (the company fields only). Answers the counterparty as it now is. Operations/Admin. |
| `POST /api/v1/counterparties/{id}/archive`, `.../restore` | Archives or restores; archived counterparties are left off the map and out of Find coordinates, and cannot be changed until restored. Never deleted. Operations/Admin. |
| `POST /api/v1/counterparties/{id}/contacts`, `PATCH`/`DELETE .../contacts/{contactId}` | Adds, corrects (body `version`, `values`) or removes a contact; answers the counterparty. Operations/Admin. |
| `POST /api/v1/counterparties/{id}/facilities`, `PATCH`/`DELETE .../facilities/{facilityId}` | Adds, corrects or removes a location, as for contacts. A location's country is its counterparty's unless given; it needs at least a name, address, city, province or state, postal code or coordinates. Changed coordinates get the source `manual`. Operations/Admin. |
| `GET /api/v1/counterparties/{id}/logo` | The PNG logo (`image/png`, `nosniff`, sandboxing CSP, ETag). |
| `PUT /api/v1/counterparties/{id}/logo` | Body: the PNG itself (`Content-Type: image/png`, at most 512 KB). Operations/Admin. |
| `GET /api/v1/facilities?bbox=&organization_id=&type=` | Located facilities inside a map view, for map pins, of counterparties that are not archived; with `type` (`buyer`, `seller`, `broker`, `carrier`), only those of counterparties of that type. `bbox` is `west,south,east,north` in degrees with west < east and south < north (a view across the antimeridian is sent as two requests). Each facility has its counterparty's id, names and types, its name, type, city, region and country, coordinates as text and `exact`/`approximate` precision. Up to 5,000, with `truncated`; `withoutCoordinates` counts the user's facilities that no map can show. The quote filters `side`, `commodity` and `as_of` arrive with quotes. |
| `POST /api/v1/facilities/geocode` | Body: `organizationId`. Looks up with Geocodio the addresses of the organization's facilities without coordinates (up to 1,000; `truncated` beyond) and returns, per facility, a signed `match` (latitude and longitude as six-decimal text, `exact`/`approximate` precision, Geocodio's accuracy type and confidence, the matched address, whether it lies in the facility's province or state, `facilityVersion` (the facility's version when looked up), `expiresAt` an hour ahead) or a `miss` (`NO_ADDRESS`, `NOT_FOUND`, `TOO_VAGUE`, `OTHER_COUNTRY`). Saves nothing. 503 `GEOCODING_NOT_CONFIGURED` without the Worker secret `GEOCODIO_API_KEY`; 502 `GEOCODER_REFUSED` or `GEOCODER_UNAVAILABLE` when Geocodio fails. Operations/Admin. |
| `POST /api/v1/facilities/coordinates` | Body: `organizationId`, `matches` (1–1,000, each exactly as `/geocode` signed it, with `facilityId`). Saves them for facilities that still have no coordinates, are unchanged since the lookup (same `facilityVersion`, so a result for an old address never lands on a corrected one) and whose counterparty is not archived; answers `saved` and `skipped`. 422 `INVALID_MATCH` for a match not signed by this API for this organization, or changed; 422 `MATCH_EXPIRED` after an hour. Operations/Admin. |
| `POST /api/v1/counterparties/import` | Body: `organizationId`, `fileName`, `commit`, optional `defaultTypes` (the types of rows without one; buyer when left out), `rows` (`line` plus values keyed by field; see `packages/domain/src/directory.ts`). `commit: false` returns the review without writing; `commit: true` creates the new counterparties in one transaction (201), or answers 422 when a row has problems, 409 `NOTHING_TO_IMPORT` or `ALREADY_IMPORTED`. Operations/Admin. |

Every response has an `X-Request-Id` header; writes record it in the audit trail.

Edits answer `422 VALIDATION_FAILED` with `issues` (each a `field`, one of the import's field ids or null, and a `message`), `404` for a record that is missing or in another organization, `403` for a member who may not edit, `409 RECORD_CHANGED` when the `version` is no longer current, `409 ARCHIVED` for an archived counterparty and `409 DUPLICATE_NAME` when another counterparty in the organization has the legal name in that country (ignoring case). Each edit first locks its counterparty, so archiving and an edit under it happen one after the other and an edit never lands on a counterparty archived meanwhile. Edits are never retried by the API when the connection is lost.

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

