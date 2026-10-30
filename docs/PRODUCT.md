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
- Use by any company other than GSS: the platform only ever serves GSS staff (owner's decision, 2026-10-27 and 2026-10-28, `docs/DECISIONS.md`). No public marketplace checkout.

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
| `/login` (implemented) | Secure employee access | Email and password, then an authenticator code; at first sign-in, set up the authenticator (a computer: QR code and key; an iPhone: **Copy setup key** or **Save in Apple Passwords**; Android: **Open in authenticator app** or **Copy setup key**), choose a password and give a name |
| `/workspace` | Main map and synchronized table | Commodity, grade, geography, buyer/seller, quote status, valid-as-of |
| `/facilities/:id` | Facility details | Organization, location, contact, service type, quotes, notes, provenance |
| `/quotes` (implemented, without import and export) | Bids and offers: live ones by default | All / Bids / Offers, commodity, include withdrawn and expired; New bid or offer for traders and admins |
| `/quotes/new` (implemented) | Enter a bid or offer | Side, counterparty (buyers or sellers, and brokers), optional location, commodity, then the terms; `?counterparty=&side=` from a counterparty's page |
| `/quotes/:id` (implemented) | One bid or offer | Current terms, Record new terms (a new revision), Withdraw (after a confirmation), revision history |
| `/freight` (implemented) | Carrier freight rates by route: live ones by default | All / Truck / Rail, carrier, include withdrawn and expired; New freight rate for traders, operations and admins |
| `/freight/new` (implemented) | Enter a carrier's rate | Carrier, truck or rail, from (company, then location) and to (company, then location), then the terms: rate as quoted with its currency and unit (per tonne, short ton, bushel, hundredweight or load; a load's payload for a rate per load), firm or indicative, what it includes, quoted and valid-until times, source; `?carrier=` from a carrier's page |
| `/freight/:id` (implemented) | One freight rate | Route, current terms, Record new terms (a new revision), Withdraw (after a confirmation), revision history |
| `/scenarios/new` | Trade builder | Seller offer, buyer bid, quantity, FX, freight, fees, validation and margin |
| `/scenarios/:id` | Saved assessment | Input snapshot, calculation version, audit/revisions, export |
| `/counterparties` (implemented; the communication log is on each counterparty's page) | Relationship management: buyers, sellers and carriers by logo (the default), as a table or on a map | Search, a commodity (who buys it among buyers, sells it among sellers; 2026-10-30), All / Buyers / Sellers / Carriers, Logos / Table / Map as icons (named on hover and for screen readers) and show archived; for operations and admin, one + button that opens a window where counterparties are added: **Add one** (the form) or **Import spreadsheet** (choose the file, match the columns, check, coordinates), with coordinates found from the addresses at the end (2026-10-30; `/counterparties/new` and `/counterparties/import` open it on their tab) |
| `/counterparties?view=map` (implemented) | The organization's counterparty locations on a Mapbox map, with a list; replaces the former `/map` page (owner's request, 2026-10-28) | Street or satellite map, pan and zoom, select a pin; buyers green, sellers red, both blue |
| `/counterparties/:id` (implemented; for buyers, sellers and brokers redesigned on 2026-10-30: the top with Log contact, New bid or New offer, Plan follow-up and More actions, and below them the main contact, the next follow-up and the last contact; two columns on a computer, bids and offers, follow-ups and history on the left, contacts, what they buy or sell (kept by anyone on the team), locations with a small satellite map, details and folded freight on the right; carriers keep the page below) | One counterparty | Its website as a link that opens in a new tab and its company phone to call beside it; each location's rail or truck access (Rail, Truck badges); Find coordinates for locations without them (sure results saved, doubtful ones asked about), also straight after adding a location without coordinates; commodities from a spreadsheet unverified (grey, dashed) until someone clicks one and verifies it, verified ones in the buy or sell colour; edit details (website included), archive and restore; add, edit and remove contacts and locations; logo as PNG, JPG or WebP, saved as PNG (operations and admin); its bids and offers, with New bid / New offer for traders and admins; its follow-ups (open ones soonest due first, overdue and due today marked in words, done ones on request) and contact history (latest first, corrections kept as earlier versions), with Log contact (when, how: call, email, meeting or visit, who was spoken to, notes, and optionally a follow-up), Plan follow-up, Edit, Correct and Mark done (owner's request, 2026-10-29); for admins, Remove on a follow-up, open or done, after a confirmation (2026-10-30); coordinates shown with their precision only; Added without the weekday; the small map of its locations without road names, highway numbers or points of interest, starting closer (2026-10-30) |
| `/follow-ups` (implemented) | Follow-ups across counterparties (owner's request, 2026-10-29), times in Alberta time (MT) | Mine / Everyone, include done; grouped Overdue, Due today, Coming up (and Done); Mark done and Edit; each links to its counterparty |
| `/team` (implemented) | The organization's members, for its admins (owner's request, 2026-10-28) | Add a person by first and last name, email and role (the app makes their login and shows a temporary password once; a login made in Supabase is added by email); edit names and role; suspend and reactivate; what each role may do |
| `/admin` | Organization control | Data sources, settings, audit views (users and roles: `/team`) |

### Workspace layout

Desktop: top commodity/date filters; 55–65% interactive map and 35–45% right-hand selection/quote inspector (implemented as the order book below); bottom or alternate full-width opportunities table. At narrower widths, map and table become tabs, with an accessible list alternative. Map pins differentiate supplier offers and buyer bids; no map pin implies an executable current quote just because a facility exists.

Implemented (owner's request; on GSS's live bids and offers, or on made-up data while Demo data is on): a commodity picker (one, several or all) and a sellers/buyers filter above a Mapbox map that fills the centre of the page; an order book flush against the map's right side from 1,280 px, with an arrow tab that slides it away and back (below the map from 1,024 px); the facility table below. The order book shows, per commodity and grade, the live asks (sellers, left) and bids (buyers, right), best first, all in CAD, as boxes tinted soft coral (asks) and leaf green (bids), the colours of the owner's reference, with the name, place, price per tonne (in Figtree semibold) and quantity (indicative prices marked with a dashed circle, converted ones with "FX"), and the gross spread (best bid minus best ask) in each commodity's heading. USD quotes are converted at a CAD/USD rate (the Bank of Canada's latest daily rate for real quotes, named with its day in the FX note, the book's footer and the selection details; the golden fixture's synthetic 1.360000 for the demo) and keep their original price and the rate, shown on selection; without a rate they are left out with a warning, never priced at zero. Expired or past-due quotes are not shown. Quoted and valid-until times are in the selection details and the table rather than the book. The page has no heading text, notes or labels of its own. With the **Demo data** switch in the profile menu off it shows GSS's live bids and offers, kept in step every minute and whenever the page is shown again; USD prices without a current Bank of Canada rate (none yet, or more than four days old) and prices not per tonne stay out of the book with a note and are listed in the table as quoted. With the switch on it shows made-up data only, with a **Demo** tag beside the GSS name. Picking a pin, a row or an order-book entry selects the facility everywhere and shows its details at the top of the order book. Phones get Map, Order book and Facilities tabs.

### App frame (implemented)

A menu down the left side (the GSS logo slot and name at the top, then the pages, with the signed-in person's follow-ups overdue or due today counted beside **Follow-ups**; planned pages greyed out under "Coming next"), folding into a slide-over panel below 1,024 px. A top bar with only a connection dot (red, with the words "Server unreachable", when the API does not answer) and a profile icon that opens "Signed in as", a Demo data switch, a Dark mode switch and Sign out; a rejected session shows a red notice at the top of the page. Look, tokens and components: `docs/DESIGN_SYSTEM.md`.

### Interface conventions

- Buyer bid vs seller offer must use **words and icons in addition to color**.
- Quote timestamp and `valid_until` appear adjacent to every price. Exception (owner's decision, 2026-10-27, `docs/DECISIONS.md`): the workspace order book leaves them out to stay compact; they are one click away in the selection details and shown in the facility table.
- A price converted to CAD shows that it was converted, and the original price and rate stay one click (or hover) away.
- Monetary figures always display currency and unit, e.g., `USD 725.00/MT`, never `725` alone. Exception (owner's decision, 2026-10-27): the workspace order book states the currency (CAD) once in its heading and shows each price per tonne ("805.00/MT"); screen readers still hear the currency with every price.
- Firm/indicative/expired/withdrawn states are visually distinct and accessible. In the order book (owner's decision, 2026-10-27), an indicative price carries a small dashed-circle mark explained in the book's footer, a firm price carries none, and screen readers hear the status in words.
- Highlight missing delivery terms and specification conflicts before revealing an actionable margin.
- A quote with zero/missing available volume must not pass the valid pairing check.
- Saved scenarios are labeled `Indicative scenario – not an executed trade` until explicitly converted through a later workflow.
- Data tables support keyboard navigation, filtering, sorting, and copying.

