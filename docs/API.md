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
| `GET /api/v1/freight-quotes?carrier_id=&facility_id=&mode=&status=` | Carrier freight rates by route, as quoted | Signed-in |
| `POST /api/v1/freight-quotes` | A carrier's rate on a route, with its source and terms | Trader/Operations/Admin |
| `POST /api/v1/freight-quotes/{id}/revisions` | Append new freight terms | Trader/Operations/Admin |
| `POST /api/v1/freight-quotes/{id}/withdraw` | Withdraw a freight rate; audit | Trader/Operations/Admin |
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
| `GET /api/v1/counterparties?organization_id=` | Counterparties visible to the user (up to 5,000, with `truncated`), with contact and location counts, regions, logo checksum, `archivedAt` (archived ones included; the web app hides them unless asked), and `buys` and `sells` (commodity codes, for the commodity filter). |
| `GET /api/v1/counterparties/{id}` | One counterparty with contacts and facilities; 404 when missing or not visible to the user (for example a suspended member). The counterparty and each contact and facility carry a `version` (last change time to the microsecond, e.g. `2026-10-28T14:05:09.123456Z`); facilities also carry `geocodingSource`. The counterparty also carries `website` (or null), `notes` and `commodities` (`{ code, name, direction }`, buys first, in the commodity list's order). |
| `GET /api/v1/members?organization_id=` | The organization's members with email, first and last name, role, status, joined time, `version` and `isYou`. Admins only (403 otherwise). |
| `POST /api/v1/members` | Body: `organizationId`, `email`, `role`, optional `firstName`, `lastName`. Adds the person whose login has this email (ignoring case), setting the names given; without a login, makes one (confirmed, with the names and a temporary password, marked to choose a new one) through Supabase Auth's admin API and answers 201 `{ id, temporaryPassword }`, the password shown only this once. 422 `NAME_REQUIRED` (a new login needs a first name); 503 `LOGINS_NOT_CONFIGURED` without the Worker secret `SUPABASE_SECRET_KEY`; 502 `LOGIN_SERVICE_FAILED`; 409 `ALREADY_MEMBER`. Admins only. |
| `POST /api/v1/me/password` | Body: `password` (12 to 72 characters). For a login made with a temporary password only (409 `NOT_NEEDED` otherwise): sets the person's own password and clears the mark in one Supabase Auth admin call. 422 `WEAK_PASSWORD`. `GET /api/v1/me` returns `mustChangePassword`. |
| `PATCH /api/v1/members/{id}` | Body: `organizationId`, `version`, and any of `role`, `status` (`active` or `suspended`), `firstName`, `lastName` (empty or null removes a name). 409 `RECORD_CHANGED`; 409 `OWN_MEMBERSHIP` for an admin's own role or status; 409 `LAST_ADMIN` when the organization would have no active admin. Memberships are never deleted. Admins only. |
| `POST /api/v1/counterparties` | Body: `organizationId`, `values` (the import's field ids: the company, including `companyPhone`, `markets` (names or codes separated by commas or semicolons) and `tier` (A, B or C), optionally one contact and one location), optional `transportAccess` (`rail`, `truck`, `rail_and_truck` or null) for that location. A type is required; a location with only its country is ignored. Commodities given are verified by the person adding them. 201 `{ id }`. Operations/Admin. |
| `PATCH /api/v1/counterparties/{id}` | Body: `version`, `values` (the company fields only, including `website` and `companyPhone`: `example.com` is saved as `https://example.com`; other schemes, user names, ports, number addresses and private names are refused by field). Answers the counterparty as it now is. Operations/Admin. |
| `POST /api/v1/counterparties/{id}/archive`, `.../restore` | Archives or restores; archived counterparties are left off the map and out of Find coordinates, and cannot be changed until restored. Never deleted. Operations/Admin. |
| `POST /api/v1/counterparties/{id}/contacts`, `PATCH`/`DELETE .../contacts/{contactId}` | Adds, corrects (body `version`, `values`) or removes a contact; answers the counterparty. Operations/Admin. |
| `PATCH /api/v1/counterparties/{id}/commodities` | Body `{ add, remove, verify }` (`verify` optional), each a list of `{ commodity, direction }` (one of the 20 commodity codes; `buys` or `sells`); one added is verified by the person adding it; `verify` verifies listed unverified ones (from a spreadsheet) in the person's name; adding one already listed, removing one not listed or verifying one already verified changes nothing; each commodity on the counterparty carries `verifiedAt` (null while unverified); answers the counterparty. 404 out of reach, 409 `ARCHIVED`, 422 for a code off the list or an empty change. Any active member. |
| `PUT /api/v1/counterparties/{id}/main-contact` | Body `{ contactId }`: makes one of its contacts the main contact (any other stops being it), or none with `null`; answers the counterparty, whose contacts carry `isMain` (the main contact listed first). 404 for a contact of another counterparty or organization, 409 `ARCHIVED`. Operations/Admin. |
| `POST /api/v1/counterparties/{id}/facilities`, `PATCH`/`DELETE .../facilities/{facilityId}` | Adds, corrects or removes a location, as for contacts, with an optional `transportAccess` beside `values` (`rail`, `truck`, `rail_and_truck`, or null for not known; left out of a correction, it is kept). A location's country is its counterparty's unless given; it needs at least a name, address, city, province or state, postal code or coordinates. Changed coordinates get the source `manual`. Operations/Admin. |
| `GET /api/v1/counterparties/{id}/logo` | The PNG logo (`image/png`, `nosniff`, sandboxing CSP, ETag). Asked for with `?v=` its checksum (`logoSha256`), it is sent `private, max-age=31536000, immutable`, as a new logo has a new checksum; otherwise `private, no-cache`. Always `Vary: Authorization`, so a browser keeps it per sign-in. |
| `PUT /api/v1/counterparties/{id}/logo` | Body: the PNG itself (`Content-Type: image/png`, at most 512 KB). Operations/Admin. |
| `GET /api/v1/facilities?bbox=&organization_id=&type=` | Located facilities inside a map view, for map pins, of counterparties that are not archived; with `type` (`buyer`, `seller`, `broker`, `carrier`), only those of counterparties of that type. `bbox` is `west,south,east,north` in degrees with west < east and south < north (a view across the antimeridian is sent as two requests). Each facility has its counterparty's id, names and types, its name, type, city, region and country, coordinates as text and `exact`/`approximate` precision. Up to 5,000, with `truncated`; `withoutCoordinates` counts the user's facilities that no map can show. The quote filters `side`, `commodity` and `as_of` arrive with quotes. |
| `POST /api/v1/facilities/geocode` | Body: `organizationId`, and optionally `counterpartyId` (one counterparty's locations: after adding it by hand, or from its page) or `importBatchId` (one import's), not both. Looks up with Geocodio the addresses of those facilities without coordinates (up to 1,000; `truncated` beyond) and returns, per facility, a signed `match` (latitude and longitude as six-decimal text, `exact`/`approximate` precision, Geocodio's accuracy type and confidence, the matched address, whether it lies in the facility's province or state, `facilityVersion` (the facility's version when looked up), `expiresAt` an hour ahead) or a `miss` (`NO_ADDRESS`, `NOT_FOUND`, `TOO_VAGUE`, `OTHER_COUNTRY`). Saves nothing. 503 `GEOCODING_NOT_CONFIGURED` without the Worker secret `GEOCODIO_API_KEY`; 502 `GEOCODER_REFUSED` or `GEOCODER_UNAVAILABLE` when Geocodio fails. Operations/Admin. |
| `POST /api/v1/facilities/coordinates` | Body: `organizationId`, `matches` (1–1,000, each exactly as `/geocode` signed it, with `facilityId`). Saves them for facilities that still have no coordinates, are unchanged since the lookup (same `facilityVersion`, so a result for an old address never lands on a corrected one) and whose counterparty is not archived; answers `saved` and `skipped`. 422 `INVALID_MATCH` for a match not signed by this API for this organization, or changed; 422 `MATCH_EXPIRED` after an hour. Operations/Admin. |
| `GET /api/v1/fx-quotes` | The Bank of Canada's latest USD/CAD rates, newest day first (up to 10): `{ rates: [{ base: 'USD', quote: 'CAD', rate, rateDate, source: 'bank_of_canada', series: 'FXUSDCAD', fetchedAt }] }`. `rate` is CAD per 1 USD as decimal text exactly as published ("1.3912"); `rateDate` the business day it averages (YYYY-MM-DD). Whether it is stale (more than four calendar days old in Ottawa) is decided by the reader with `isFxRateStale` in `packages/domain`. Rates are stored by the Worker's scheduled job, never through the API. Signed-in. |
| `GET /api/v1/commodities` | The commodity list for the bid and offer forms: `code` and `name`, in a fixed order. Signed-in. |
| `GET /api/v1/quotes?organization_id=&counterparty_id=&side=&commodity=&status=` | Bids and offers with their latest terms, newest quoted first (up to 2,000, with `truncated`). `status=live` (the default) gives only firm and indicative quotes still valid now; `status=all` adds withdrawn and expired ones. Each has `side` (`bid`/`offer`), `commodity`, `counterparty` (id, names, `archived`), `facility` (or null; with `latitude` and `longitude` as decimal text and `locationPrecision`, null without coordinates), `status` (`firm`, `indicative`, `expired` or `withdrawn`, by the database's clock), `withdrawnAt` and `current`, the latest revision: `revisionNumber`, `firmness`, `price` (decimal text as entered), `currency` (`CAD`/`USD`), `priceUnit` (`MT`, `ST`, `BU`, `CWT`), `grade`, `deliveryBasis` (`delivered`, `fob`, `ex_farm`, `ex_elevator`, `other`), `basisLocation`, `quantityMinMt`, `quantityMaxMt` (decimal text, tonnes), `deliveryStart`, `deliveryEnd` (dates), `quotedAt`, `validUntil`, `sourceType`, `sourceReference`, `notes`, `recordedByName`, `recordedAt`. Signed-in. |
| `GET /api/v1/quotes/{id}` | One quote as above, with `revisions` (every revision, newest first) and `withdrawnByName`. 404 when missing or not visible. |
| `POST /api/v1/quotes` | Body: `organizationId`, `counterpartyId`, optional `facilityId` (one of that counterparty's locations), `side`, `commodity` (a code), `values` (the form's fields; see `packages/domain/src/quotes.ts`). Times are UTC instants; `quotedAt` defaults to now and may not be in the future; `validUntil` must be later than now. 201 with the quote. 422 `VALIDATION_FAILED` with `issues` (`field`, `message`); 422 `COUNTERPARTY_NOT_FOUND`, `FACILITY_NOT_FOUND`, `COMMODITY_NOT_FOUND`; 422 `WRONG_COUNTERPARTY_TYPE` (a bid needs a buyer or broker, an offer a seller or broker); 409 `ARCHIVED`. Traders and admins (403 otherwise). The recorder's name comes from their login, never from the request. |
| `POST /api/v1/quotes/{id}/revisions` | Body: `basedOnRevision` (the revision number on screen), `values`. Appends a revision; earlier ones are never changed. 201 with the quote. 409 `QUOTE_CHANGED` (with `currentRevision`) when someone recorded newer terms meanwhile; 409 `WITHDRAWN`; 409 `ARCHIVED`. Traders and admins. |
| `POST /api/v1/quotes/{id}/withdraw` | Withdraws for good (doing it again changes nothing); the quote and its history stay readable. Answers the quote. Traders and admins. |
| `GET /api/v1/freight-quotes?organization_id=&carrier_id=&facility_id=&counterparty_id=&mode=&status=` | Carrier freight rates with their latest terms, newest quoted first (up to 2,000, with `truncated`): `{ freight: [...] }`. `facility_id` finds routes that start or end at that location, `counterparty_id` routes that start or end at any of that counterparty's locations; `mode` is `truck` or `rail`. `status=live` (the default) gives only firm and indicative rates still valid now; `status=all` adds withdrawn and expired ones. Each has `mode`, `carrier` (id, names, `archived`), `origin` and `destination` (the location's id, name, city, region, country and its `counterparty`: id, legal name, `archived`), `status` (`firm`, `indicative`, `expired` or `withdrawn`), `withdrawnAt` and `current`: `revisionNumber`, `firmness`, `rate` (decimal text as entered), `currency` (`CAD`/`USD`), `rateUnit` (`MT`, `ST`, `BU`, `CWT`, `LOAD`), `payload` and `payloadUnit` (`MT`, `ST`, `LB`; only for a rate per load, otherwise null), `inclusions` (what the rate includes), `quotedAt`, `validUntil`, `sourceType`, `sourceReference`, `notes`, `recordedByName`, `recordedAt`. Nothing is converted. Signed-in. |
| `GET /api/v1/freight-quotes/{id}` | One freight rate as above, with `revisions` (every revision, newest first) and `withdrawnByName`. 404 when missing or not visible. |
| `POST /api/v1/freight-quotes` | Body: `organizationId`, `carrierId` (a counterparty marked as a carrier), `originFacilityId`, `destinationFacilityId` (two different locations in the directory), `mode`, `values` (the form's fields; see `packages/domain/src/freight.ts`). A rate per load needs its `payload` and `payloadUnit`; for other units they are left out. Times as for quotes. 201 with the rate. 422 `VALIDATION_FAILED` with `issues`; 422 `CARRIER_NOT_FOUND`, `NOT_A_CARRIER`, `ORIGIN_NOT_FOUND`, `DESTINATION_NOT_FOUND`, `SAME_LOCATION`; 409 `ARCHIVED` (the carrier or a counterparty of the route). Traders, operations and admins (403 otherwise). The recorder's name comes from their login. |
| `POST /api/v1/freight-quotes/{id}/revisions` | Body: `basedOnRevision`, `values`. Appends a revision; earlier ones are never changed. 201 with the rate. 409 `QUOTE_CHANGED` (with `currentRevision`), `WITHDRAWN`, `ARCHIVED` (the carrier). Traders, operations and admins. |
| `POST /api/v1/freight-quotes/{id}/withdraw` | Withdraws for good (doing it again changes nothing); the rate and its history stay readable. Traders, operations and admins. |
| `GET /api/v1/contact-log?counterparty_id=` | A counterparty's contact log, latest contact first (up to 1,000 entries, with `truncated`): `{ entries: [{ id, counterpartyId, createdAt, current, revisions }] }`, `current` being the latest version and `revisions` every version, newest first, each with `revisionNumber`, `occurredAt`, `channel` (`call`, `email`, `meeting`, `visit`), `contactName`, `notes`, `recordedByName`, `recordedAt`. Empty for a counterparty that is not visible. Signed-in. |
| `GET /api/v1/contact-log/{id}` | One entry as above; 404 when missing or not visible. |
| `POST /api/v1/contact-log` | Body: `counterpartyId`, `values` (`occurredAt`, a UTC instant, now when left out and never in the future; `channel`; `contactName`; optional `notes`, up to 5,000 characters), optional `followUp` (`task`, `dueAt`, `assignedTo`, as for `POST /api/v1/follow-ups`), saved together. 201 `{ entry, followUpId }`. 422 `VALIDATION_FAILED` with `issues` (`field`, `message`) for both forms; 422 `NOT_A_MEMBER` when the person responsible is not an active member; 404 for a counterparty that is not visible; 409 `ARCHIVED`. Traders, operations and admins (403 otherwise). The recorder's name comes from their login. |
| `POST /api/v1/contact-log/{id}/revisions` | A correction. Body: `basedOnRevision` (the version on screen), `values`. Appends a version; earlier ones are never changed. 201 with the entry. 409 `ENTRY_CHANGED` (with `currentRevision`) when someone corrected it meanwhile; 409 `ARCHIVED`. Traders, operations and admins. |
| `GET /api/v1/follow-ups?organization_id=&counterparty_id=&assigned_to=&status=` | Follow-ups, open ones soonest due first, then done ones (up to 1,000, with `truncated`): `{ followUps: [{ id, counterparty: { id, legalName, tradingName, archived }, contactLogEntryId, task, dueAt, assignedTo: { userId, name }, createdByName, createdAt, doneAt, doneByName, version }] }`. `assigned_to` is `me` or a user id; `status` is `open` (the default), `done` or `all`. Signed-in. |
| `GET /api/v1/follow-ups/count?organization_id=` | For the menu: the signed-in person's open follow-ups `overdue` (due time passed) and `dueToday` (due later today in Alberta time). Signed-in. |
| `GET /api/v1/follow-ups/team?organization_id=` | Who can be made responsible: `{ members: [{ userId, name }] }`, the organization's active members by name (first and last name, or email without one); empty for anyone who is not an active member. Signed-in. |
| `GET /api/v1/follow-ups/{id}` | One follow-up as above; 404 when missing or not visible. |
| `POST /api/v1/follow-ups` | Body: `counterpartyId`, `values` (`task`; `dueAt`, a UTC instant from 2000 to before 2100, past allowed; `assignedTo`, an active member's user id). 201 with the follow-up. 422 `VALIDATION_FAILED`, `NOT_A_MEMBER`; 404; 409 `ARCHIVED`. Traders, operations and admins. |
| `PATCH /api/v1/follow-ups/{id}` | Body: `version`, `values` as above. Changes an open follow-up; answers it. 409 `RECORD_CHANGED`, `DONE`, `ARCHIVED`; 422 `NOT_A_MEMBER`. Traders, operations and admins. |
| `POST /api/v1/follow-ups/{id}/remove` | Removes a follow-up, open or done, for an admin of its organization: kept in the database with who removed it and when, and left out of every list, count and read from then on. 200 `{ id, removed: true }`; 403 for anyone else; 404 for one removed already or out of reach. |
| `POST /api/v1/follow-ups/{id}/done` | Marks it done for good, in the signed-in person's name (doing it again changes nothing); answers it. Traders, operations and admins, or the person responsible whatever their role. |
| `POST /api/v1/counterparties/import` | Body: `organizationId`, `fileName`, `commit`, optional `defaultTypes` (the types of rows without one; buyer when left out), `rows` (`line` plus values keyed by field; see `packages/domain/src/directory.ts`). `commit: false` returns the review without writing; `commit: true` creates the new counterparties and adds the file's new locations, contacts and commodities to those already in the list (not archived ones; their own details untouched) in one transaction (201), matched again against the list as it is then, under the organization's import lock, so two imports at once wait for each other and the answer says what was written; or answers 422 when a row has problems, or 409 `NOTHING_TO_IMPORT` (no new company and nothing new for listed ones; nothing is recorded). The same file may be imported again: it adds only what the list still lacks, such as a location skipped while its company was archived. Companies match by country and their name read by `companyNameKey` (case, punctuation, spacing, "&", Ltd/Inc/Corp/Co endings); the summary adds `existingWithAdditions`, `addedFacilities`, `addedContacts`, `addedCommodities`, and each company's `status` is `new`, `existing` (its `facilities` and `contacts` then count only the new ones) or `archived`. Operations/Admin. |

Every response has an `X-Request-Id` header; writes record it in the audit trail.

Edits answer `422 VALIDATION_FAILED` with `issues` (each a `field`, one of the import's field ids or null, and a `message`), `404` for a record that is missing or not visible to the user, `403` for a member who may not edit, `409 RECORD_CHANGED` when the `version` is no longer current, `409 ARCHIVED` for an archived counterparty and `409 DUPLICATE_NAME` when another counterparty in the organization has the legal name in that country (ignoring case), and removing a location with bids or offers answers `409 LOCATION_HAS_QUOTES`, one where freight rates start or end `409 LOCATION_HAS_FREIGHT`. Each edit first locks its counterparty, so archiving and an edit under it happen one after the other and an edit never lands on a counterparty archived meanwhile. Edits are never retried by the API when the connection is lost.

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

