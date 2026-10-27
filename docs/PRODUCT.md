# Product specification

Approved product intent and user experience boundaries; refer to `../MASTER_PROJECT_SPECIFICATION.md` for the baseline.

# 1. Goals, scope, and non-goals

## 1.1 Business goals

1. Centralize Canadian grain sources and Canadian/U.S. commercial buyers and their facilities.
2. Preserve current and historical quotations, quote confidence, volume, timing, grade, and delivery terms.
3. Identify economically plausible cross-border physical trades quickly, without implying that a quote is executable when it is not.
4. Calculate and compare transparent delivered margins in normalized currency and quantity units.
5. Retain proprietary counterparty, lane, pricing, and trade data securely as a compounding commercial asset.
6. Serve one internal trading team, the owner's shop. White-label and multi-company use is out of scope (owner's decision, 2026-10-27, `docs/DECISIONS.md`).
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

**Release 4 (conditional):** Quantitative opportunity analytics, Python optimization, research and forecasting, controlled runtime AI assistants, rail economics, automated exception alerts.

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
| `/map` (implemented) | The organization's counterparty locations on a Mapbox map, with a list | Street or satellite map, pan and zoom, select a pin |
| `/map/coordinates` (implemented) | Find coordinates for locations without them (Geocodio), review, save | Look up addresses, tick or untick each result, save; operations and admin only |
| `/admin` | Organization control | Users, roles, data sources, settings, audit views |

### Workspace layout

Desktop: top commodity/date filters; 55–65% interactive map and 35–45% right-hand selection/quote inspector; bottom or alternate full-width opportunities table. At narrower widths, map and table become tabs, with an accessible list alternative. Map pins differentiate supplier offers and buyer bids; no map pin implies an executable current quote just because a facility exists.

### App frame (implemented)

A menu down the left side (the GSS logo slot and name at the top, then the pages; planned pages greyed out under "Coming next"), folding into a slide-over panel below 1,024 px. A top bar with only a connection dot (red, with the words "Server unreachable", when the API does not answer) and a profile icon that opens "Signed in as", a Dark mode switch and Sign out; a rejected session shows a red notice at the top of the page. Look, tokens and components: `docs/DESIGN_SYSTEM.md`.

### Interface conventions

- Buyer bid vs seller offer must use **words and icons in addition to color**.
- Quote timestamp and `valid_until` appear adjacent to every price.
- Monetary figures always display currency and unit, e.g., `USD 725.00/MT`, never `725` alone.
- Firm/indicative/expired/withdrawn states are visually distinct and accessible.
- Highlight missing delivery terms and specification conflicts before revealing an actionable margin.
- A quote with zero/missing available volume must not pass the valid pairing check.
- Saved scenarios are labeled `Indicative scenario – not an executed trade` until explicitly converted through a later workflow.
- Data tables support keyboard navigation, filtering, sorting, and copying.

