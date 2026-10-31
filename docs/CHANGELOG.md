# Documentation pack changelog

## 2026-10-31 — Codex's review of #93

- `docs/DECISIONS.md`: the deleting admin's membership held until the delete is done; nothing kept unless the company itself is deleted; late answers not kept after a delete.

## 2026-10-31 — Handoff record of #93

- `docs/HANDOFF.md`: admins delete archived counterparties (ivanmueller/gss#93) with its CI and Deploy staging runs, and Codex's review of it.

## 2026-10-31 — Admins delete archived counterparties

- `docs/DECISIONS.md`: who may delete, what goes with a counterparty, and why one with history stays archived.
- `docs/DATA_MODEL.md`: migration `20261031010000_counterparty_deletion.sql`.
- `docs/API.md`: `DELETE /api/v1/counterparties/{id}`.
- `docs/PRODUCT.md`, `README.md`, `AGENTS.md`: Delete beside Restore for admins.

## 2026-10-31 — Handoff record of #89 to #92

- `docs/HANDOFF.md`: Codex's reviews of #88 fixed (ivanmueller/gss#89 to #92) with their CI and Deploy staging runs.

## 2026-10-30 — Codex's fourth review of #88

- `docs/DECISIONS.md`: the plan kept only once made with its companies locked; the same file may be imported again.
- `docs/DATA_MODEL.md`: migration `20261030090000_import_content_repeatable.sql`.
- `docs/API.md`: no `ALREADY_IMPORTED`; a repeated file adds only what the list lacks.

## 2026-10-30 — Codex's third review of #88

- `docs/DECISIONS.md`: a company archived during an import makes it plan again; no empty import recorded.

## 2026-10-30 — Codex's second review of #88

- `docs/DECISIONS.md`: one import at a time per organization, matched under the lock; a slash splits only two whole numbers; the race test on two connections.
- `docs/DATA_MODEL.md`: migration `20261030080000_counterparty_import_lock.sql`.
- `docs/API.md`: the import matched again under the lock.

## 2026-10-30 — Handoff record of #88

- `docs/HANDOFF.md`: companies with several locations in an import (ivanmueller/gss#88) with their CI and Deploy staging runs, and Codex's review of it.

## 2026-10-30 — Codex's review of #88

- `docs/DECISIONS.md`: names in other scripts kept apart; locations without a name or address matched by coordinates; additions matched again under the import's lock; notes too long refused on the Check step; two numbers with a slash split.
- `README.md`: a slash between two company phone numbers.

## 2026-10-30 — Companies with several locations in an import

- `docs/DECISIONS.md`: names matched loosely; a later file's new locations, contacts and grains added to companies already listed; Canada and the US left as they are; City or Town and two-phone cells.
- `docs/DATA_MODEL.md`: migration `20261030070000_facility_import_batch.sql`.
- `docs/API.md`, `docs/PRODUCT.md`, `README.md`: the import's matching and additions.

## 2026-10-30 — Handoff record of #87

- `docs/HANDOFF.md`: Codex's findings on #85 fixed (ivanmueller/gss#87) with their CI and Deploy staging runs.

## 2026-10-30 — Codex's review of #85

- `docs/DECISIONS.md`: kept answers per person and forgotten on any sign-out; logos kept per sign-in.
- `docs/API.md`: the logo's `Vary: Authorization`.

## 2026-10-30 — Handoff record of #86

- `docs/HANDOFF.md`: the documents update (ivanmueller/gss#86) with its CI and Deploy staging runs, and Codex's review of #85.

## 2026-10-30 — Handoff record of #85; documents brought up to date

- `docs/HANDOFF.md`: the Counterparties changes (ivanmueller/gss#85) with their CI and Deploy staging runs; #84's `main` run settled by #186; the status summary, GT-020 and GT-021 and the owner's staging check brought up to #85.
- `AGENTS.md`: the status line with the company phone, rail or truck access, verified commodities, markets and tiers, and follow-up removal.
- `README.md`: the Commodities picker and verified commodities; Add by hand.
- `docs/DESIGN_SYSTEM.md`: dropdowns: `MultiPicker`.

## 2026-10-30 — Counterparties: pickers, markets and tiers, the map, the + window, kept answers

- `docs/DECISIONS.md`: the owner's eight changes and answers (markets and tiers; several commodities; the map without a list; the + window in two steps; no trading name; kept answers; grains from a spreadsheet).
- `docs/DATA_MODEL.md`: migration `20261030060000_counterparty_market_tier.sql`; `counterparties.markets`, `tier`.
- `docs/API.md`: `markets` and `tier`; the logo kept by checksum.
- `docs/PRODUCT.md`, `docs/DESIGN_SYSTEM.md`, `README.md`: the pickers, the map view, the + window, `MultiPicker` and `animate-dialog-in`.

## 2026-10-30 — Handoff record of #84

- `docs/HANDOFF.md`: Codex's P3 on #83 fixed (ivanmueller/gss#84); CI run #184 on `main` red in the freight browser test, not this change, to be re-run.

## 2026-10-30 — Handoff record of #83

- `docs/HANDOFF.md`: removing follow-ups, the simpler locations map, shorter coordinates and Added (ivanmueller/gss#83) with their CI and Deploy staging runs and Codex's review; the owner's check on staging extended to #83.

## 2026-10-30 — Removing follow-ups, a simpler locations map, shorter coordinates and Added

- `docs/DECISIONS.md`: the owner's request: admins remove follow-ups (kept, never deleted); the small locations map without road names and highway numbers, closer; coordinates without their source; Added without the weekday.
- `docs/DATA_MODEL.md`: migration `20261030050000_follow_up_removal.sql`; `follow_ups.removed_*`.
- `docs/API.md`: `POST /api/v1/follow-ups/{id}/remove`.
- `docs/PRODUCT.md`, `README.md`: Remove on a follow-up; the counterparty page's map, coordinates and Added.

## 2026-10-30 — Handoff record of #82

- `docs/HANDOFF.md`: the company phone, rail and truck, coordinates when adding, the + window and verified commodities (ivanmueller/gss#82) with their CI and Deploy staging runs; the owner's check on staging and next request in the next task.

## 2026-10-30 — Company phone, rail and truck, coordinates when adding, the + window, verified commodities

- `docs/DECISIONS.md`: the owner's request and answers: a company phone; rail or truck access by location, never from a spreadsheet; coordinates found when counterparties and locations are added, sure results saved, doubtful ones asked; adding and importing in the + window; commodities from a spreadsheet unverified until anyone on the team verifies them.
- `docs/DATA_MODEL.md`: migration `20261030040000_phone_access_verified_commodities.sql`; `counterparties.phone`, `facilities.transport_access`, `counterparty_commodities.verified_by`/`verified_at`.
- `docs/API.md`: `companyPhone`, `transportAccess`, `verify` and `verifiedAt`; `counterpartyId` and `importBatchId` on the geocoding lookup.
- `docs/PRODUCT.md`, `README.md`: the + window's two tabs, the company page's phone, badges and Find coordinates; the coordinates page gone.
- `AGENTS.md`: the geocoding line.

## 2026-10-30 — Handoff record of #81

- `docs/HANDOFF.md`: the handoff record of #80 (ivanmueller/gss#81) with its CI and Deploy staging runs; the owner's next request (company phone, coordinates at add and import, rail and truck access, adding in the + window, verified commodities) in the next task.

## 2026-10-30 — Handoff record of #80

- `docs/HANDOFF.md`: the Counterparties toolbar (ivanmueller/gss#80) with its CI and Deploy staging runs; the owner's check on staging extended to #79 and #80.
- `AGENTS.md`: the status line with the main contact, the next follow-up and last contact, and what each counterparty buys or sells.

## 2026-10-30 — Counterparties toolbar: commodity first, views as icons

- `docs/DECISIONS.md` and `docs/PRODUCT.md`: the commodity dropdown before All / Buyers / Sellers / Carriers; Logos, Table and Map as icons; `README.md` likewise.

## 2026-10-30 — Handoff record of #79

- `docs/HANDOFF.md`: the + button for adding counterparties (ivanmueller/gss#79) with its CI and Deploy staging runs.

## 2026-10-30 — One + button for adding counterparties

- `docs/DECISIONS.md`: the owner's request, a + button that opens a window with Add by hand and Import spreadsheet.
- `docs/PRODUCT.md`: the Counterparties toolbar; `docs/DESIGN_SYSTEM.md`: the `Dialog` component.
- `README.md`: the + button, the Commodities column and box, the main contact and the commodity dropdown.

## 2026-10-30 — Handoff record of #78

- `docs/HANDOFF.md`: what counterparties buy and sell, the commodity filter and the lighter header (ivanmueller/gss#78), its CI and Deploy staging runs and Codex's review; the next task, the owner's check on staging.

## 2026-10-30 — What counterparties buy and sell

- `docs/DECISIONS.md`: the owner's answers (a list kept by hand, anyone can change it, the 20 commodities, a filter, an import column), the next follow-up and last contact in the header instead of four boxes, freight's Show and Hide in one place.
- `docs/API.md`: `PATCH /api/v1/counterparties/{id}/commodities`; `buys`, `sells` and `commodities` in the responses.
- `docs/DATA_MODEL.md`: `app.counterparty_commodities` and migration `20261030020000_counterparty_commodities.sql`.
- `docs/PRODUCT.md`: the commodity filter and the counterparty page's top and Commodities box.
- `docs/DATA_MODEL.md`: after Codex's review of ivanmueller/gss#78, the commodity list's key and the one-main-contact index keyed by organization (migration `20261030030000_main_contact_index_by_organization.sql`), and the archived check reading only the caller's organization; `docs/DECISIONS.md`: Feed wheat not read as a commodity.

## 2026-10-30 — Handoff record of #77

- `docs/HANDOFF.md`: ivanmueller/gss#77 (the race tests for the main contact) with its CI and Deploy staging runs.

## 2026-10-30 — Handoff record of #76

- `docs/HANDOFF.md`: the redesigned page for buyers and sellers with a main contact (ivanmueller/gss#76), its CI and Deploy staging runs and Codex's review; the next task, the owner's check on staging.

## 2026-10-30 — A redesigned page for buyers and sellers

- `docs/DECISIONS.md`: the owner's approved layout and answers (two columns, Log contact first, a main contact, a small satellite map, freight folded).
- `docs/API.md`: `PUT /api/v1/counterparties/{id}/main-contact` and contacts' `isMain`.
- `docs/DATA_MODEL.md`: `counterparty_contacts.is_main` and migration `20261030010000_counterparty_main_contact.sql`.
- `docs/PRODUCT.md`: the counterparty page for buyers, sellers and brokers.

## 2026-10-29 — Handoff record of #75

- `docs/HANDOFF.md`: ivanmueller/gss#75 with its CI and Deploy staging runs; the next task, the owner's choice of a redesigned counterparty page for buyers and sellers.

## 2026-10-29 — Handoff record of #74

- `docs/HANDOFF.md`: ivanmueller/gss#74 with its CI and Deploy staging runs; #73's runs on `main` green; the owner's check of times in MT on staging.

## 2026-10-29 — Handoff record of #72 and #73

- `docs/HANDOFF.md`: Alberta time on every screen (ivanmueller/gss#73) and the handoff record of #71 (#72), with their CI and Deploy staging runs; the next task, the owner's check on staging of times in MT and of the CRM.

## 2026-10-29 — Alberta time on every screen

- `docs/DECISIONS.md`: the owner's decision: every time typed and shown in Alberta time (MT), UTC−6 all year from 8 March 2026, stored in UTC; saved follow-ups keep their moment; the exchange rate's age still counted in Ottawa days.
- `AGENTS.md`, `README.md`, `docs/API.md`, `docs/PRODUCT.md`, `docs/BUILD_PLAN.md`, `docs/DESIGN_SYSTEM.md`: Alberta time in place of Central time and UTC.

## 2026-10-29 — Handoff record of #70

- `docs/HANDOFF.md`: Codex's fix of the CRM's insert grants (ivanmueller/gss#70), CI runs #154 and #155 and Deploy staging run #67; the owner's decisions on sign-in (keep the authenticator; no texted codes; no iPhone experiment); the next task (the owner's answer on Central time after Manitoba's change, the owner's check on staging).
- `AGENTS.md`: the status line with the CRM.

## 2026-10-29 — Codex's review of the CRM

- `docs/DATA_MODEL.md`: migration `20261029080000_crm_insert_column_grants.sql` (insert grants by column on the CRM tables; the database's own times).

## 2026-10-29 — A CRM for counterparties (GT-027)

- `docs/DECISIONS.md`: the owner's request and answers, and the choices made (who may do what, corrections as versions, follow-ups changed while open and final once done, Central time, anyone on the team responsible, archived counterparties, the menu's count, what is left out).
- `docs/DATA_MODEL.md`: `contact_log_entries`, `contact_log_revisions` and `follow_ups`; migration `20261029070000_counterparty_crm.sql`.
- `docs/API.md`: `/api/v1/contact-log` and `/api/v1/follow-ups` (with `/count` and `/team`).
- `docs/PRODUCT.md`: the counterparty page's follow-ups and contact history, the `/follow-ups` page and the menu's count.
- `docs/BUILD_PLAN.md`: GT-027 in Phase 2, built.
- `docs/DESIGN_SYSTEM.md`: `CounterpartyCrm`, `CrmForms`, `FollowUpItem`, `DueBadge`; a count beside a menu item.
- `README.md`: "Contact log and follow-ups".

## 2026-10-29 — Handoff record of #64 to #66

- `docs/HANDOFF.md`: the website field (ivanmueller/gss#65, #66) with Codex's two reviews and the preview's removal, the handoff record of #63 (#64); CI runs #138 to #145 and Deploy staging runs #61 to #63; the owner's checks on staging (Logos and searchable pickers, the Freight page, a stored Bank of Canada rate); the next task.
- `AGENTS.md`: the status line with carriers, websites and Freight.
- `docs/BUILD_PLAN.md`: websites in GT-020; the Bank of Canada FX connector done.

## 2026-10-29 — No website preview (owner's decision)

- `docs/DECISIONS.md`: the website entry rewritten as built, with the preview removed and why; the review's address rules kept.
- `docs/API.md`: `GET /api/v1/counterparties/{id}/website-preview` removed.
- `docs/ARCHITECTURE.md`: counterparty websites no longer among the Worker's outbound adapters.
- `docs/DESIGN_SYSTEM.md`: `Dialog` removed.
- `docs/PRODUCT.md`, `README.md` ("Counterparties"): the website link only.

## 2026-10-29 — Codex's review of the website field

- `docs/DATA_MODEL.md`: migration `20261029060000_counterparty_website_rules.sql` (printable ASCII after the site name; no international labels).
- `docs/DECISIONS.md`: ports and user names refused as written, also with a tab or line break inside; the database holding site names to the same rules; site names in plain letters only; the preview without `allow-same-origin`.
- `README.md` ("Counterparties"): plain-letter site names.
- `docs/API.md`: the preview check refuses the app's own address and redirects written with a port or user name.

## 2026-10-29 — A website on each counterparty

- `docs/DECISIONS.md`: the owner's request and the choices made (public web addresses only, the Worker's check of whether a site may be previewed, the sandboxed preview).
- `docs/DATA_MODEL.md`: `website` on counterparties; migration `20261029050000_counterparty_website.sql`.
- `docs/API.md`: `website` on a counterparty; `GET /api/v1/counterparties/{id}/website-preview`.
- `docs/DESIGN_SYSTEM.md`: `Dialog`.
- `docs/ARCHITECTURE.md`: the website check among the Worker's outbound adapters.
- `docs/PRODUCT.md`, `README.md` ("Counterparties"): the website link and Preview.

## 2026-10-29 — Counterparties open on Logos; searchable counterparty pickers

- `docs/DECISIONS.md`: the owner's request and the choices made (Logos first, the map kept as a view, `SearchSelect`).
- `docs/DESIGN_SYSTEM.md`: `SearchSelect`.
- `docs/PRODUCT.md`, `README.md` ("Counterparties"): the Logos default.

## 2026-10-29 — A bid's or offer's quantities are never NaN

- `docs/DATA_MODEL.md`: migration `20261029040000_quote_quantities_not_nan.sql`.

## 2026-10-29 — A freight payload is never NaN

- `docs/DATA_MODEL.md`: migration `20261029030000_freight_payload_not_nan.sql` (Codex's review of ivanmueller/gss#58).

## 2026-10-29 — Carrier freight rates by route (part of GT-050)

- `docs/DECISIONS.md`: the owner's answers (units vary by carrier; routes are from one location to another), and the choices made: carriers in Counterparties, who enters freight, a rate per load needs its payload, revisions.
- `docs/DATA_MODEL.md`: `freight_quotes` and `freight_quote_revisions` as built.
- `docs/API.md`: `/api/v1/freight-quotes`; `LOCATION_HAS_FREIGHT`.
- `docs/PRODUCT.md`, `docs/BUILD_PLAN.md`, `README.md` ("Counterparties", "Freight"): the Freight pages and the Carriers filter.

## 2026-10-29 — Handoff record of #55; ArcGIS map layers on the list

- `docs/HANDOFF.md`: ivanmueller/gss#55 (Codex's finding on #54 fixed), CI runs #119 and #120, Deploy staging run #52; GT-026; the next task and the owner's backlog.
- `docs/BUILD_PLAN.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`: map overlay layers from ArcGIS (GT-026), requested and not started, with the proposed approach.
- `AGENTS.md`, `README.md`: the Bank of Canada FX connector built; ArcGIS layers requested.

## 2026-10-29 — Handoff record of #54

- `docs/HANDOFF.md`: ivanmueller/gss#54 (the Bank of Canada FX connector), CI run #118 and Deploy staging run #51, the scheduled job in "How staging is wired", GT-052, the next task.

## 2026-10-29 — Bank of Canada FX connector (GT-052)

- `docs/DECISIONS.md`: when the rate is fetched and stored, why the table has no organization, the out-of-date rule, what the screen shows.
- `docs/API.md`: `GET /api/v1/fx-quotes`.
- `docs/DATA_MODEL.md`: `fx_quotes` as built.
- `docs/ARCHITECTURE.md`, `docs/BUILD_PLAN.md`, `docs/PRODUCT.md`, `docs/REFERENCES.md`, `README.md` ("Exchange rate", "Workspace"): the connector built.

## 2026-10-29 — Handoff record of #53

- `docs/HANDOFF.md`: ivanmueller/gss#53, CI runs #116 and #117 and Deploy staging run #50.

## 2026-10-29 — Status checked after the dropdown change

- `AGENTS.md`: Phase 2 and most of Phase 3 on staging.
- `docs/HANDOFF.md`: ivanmueller/gss#52 and Deploy staging run #49, the status line, the tests of #50–#52, the next task (the Bank of Canada FX connector).

## 2026-10-29 — One dropdown style

- `docs/DESIGN_SYSTEM.md`: `Select`, the one dropdown for a single choice, and the rule that every dropdown shares the commodity picker's look.
- `docs/DECISIONS.md`: why the browser's own dropdown was replaced.

## 2026-10-29 — Authenticator setup by device

- `docs/DECISIONS.md`: the setup screen by device (computer, iPhone, Android), and why the iPhone button now says Apple Passwords.
- `README.md` and `docs/PRODUCT.md`: the new buttons at first sign-in.

## 2026-10-28 — Documents brought up to date after bids and offers

The owner asked for every document to be current. Updated:

- `README.md`: what staging has (Bids & offers, the workspace on live quotes), a "Bids and offers" section, the workspace's pins and what is left out of the order book, the layout list.
- `docs/BUILD_PLAN.md`: Phase 3 mostly done, the Bank of Canada FX connector next.
- `docs/DESIGN_SYSTEM.md`: only Scenarios is still planned in the menu; the Demo data switch against live data; the quote components.
- `docs/DECISIONS.md`: notes on three entries overtaken the same day (provisional view types, the synthetic-only workspace, the slice that left the workspace on made-up data).
- `docs/HANDOFF.md`: ivanmueller/gss#49 and Deploy staging run #46, the status line, GT-024, the FX note and the next task.
- `AGENTS.md`: the FX connector is next.

## 2026-10-28 — Live bids and offers in the workspace

- `docs/DECISIONS.md`: the workspace on GSS's live bids and offers (kept in step, where each sits, CAD per tonne only in the book).
- `docs/PRODUCT.md`: the workspace paragraph.
- `docs/API.md`: a quote's location carries its coordinates.

## 2026-10-28 — Bids and offers

- `docs/DECISIONS.md`: bids and offers with a full revision history, linked to a counterparty (who enters them, revisions never changed, withdrawn is final, the terms recorded, commodities, what is not in this slice).
- `docs/DATA_MODEL.md`: migration `20261028040000_quotes.sql`.
- `docs/API.md`: `/api/v1/commodities` and `/api/v1/quotes`, and `LOCATION_HAS_QUOTES`.
- `docs/PRODUCT.md`: the `/quotes` pages and the counterparty page's bids and offers.
- `README.md`: reset the local database before running the browser tests again.

## 2026-10-28 — Documents brought up to date again

The owner asked for every document to be current. Updated:

- `docs/BUILD_PLAN.md`: a "Where the build stands" table by phase; the Phase 1 gate notes one organization only.
- `docs/DECISIONS.md`: the day's smaller choices (PNG, JPG or WebP logos; Open in authenticator app; leaf and coral order book; Figtree for prices; the counterparties toolbar), and notes on the earlier entries they replace.
- `docs/PRODUCT.md`: sign-in, the Team page's add form, logo formats, the counterparties toolbar and the order book's colours and font.
- `docs/DESIGN_SYSTEM.md`: the leaf and coral ramps and the `-accent` tokens.
- `docs/HANDOFF.md`: ivanmueller/gss#43 and #44, the status line, logins made from the app, the tests of #41–#44.

## 2026-10-28 — Order book colours and price font

- `docs/DESIGN_SYSTEM.md`: bids and asks in the owner's reference leaf green and coral, with their own ramps; Figtree for prices.
- `docs/DESIGN_SYSTEM.md`: the order book's prices and spreads in Figtree semibold (owner's request, after seeing medium).

## 2026-10-28 — Authenticator link and WebP logos

- `README.md`: **Open in authenticator app** when setting up sign-in on a phone; logos may also be WebP (saved as a PNG, like a JPG).

## 2026-10-28 — Documents brought in line with what is built

The owner asked whether every document was up to date. Updated:

- `README.md` and `AGENTS.md`: the status lines (the Team page, counterparty editing, the map view); `AGENTS.md` also records that the platform only ever serves GSS staff.
- `MASTER_PROJECT_SPECIFICATION.md` and `docs/PRODUCT.md`: "multi-tenant onboarding (data model should accommodate future tenancy)" replaced by the owner's decision that only GSS ever uses the platform.
- `docs/DATA_MODEL.md` and the specification: one organization row, GSS.
- `docs/API.md`: 404s described without other organizations.
- `docs/ARCHITECTURE.md`: the staging Worker's secrets and what each may do.
- `docs/HANDOFF.md`: ivanmueller/gss#39, the people and secrets on staging, the map and geocoding checks the owner confirmed.

Engineering rules that speak of "tenant isolation" (`AGENTS.md` rule 4, `docs/ACCEPTANCE_TESTS.md`, `docs/ARCHITECTURE.md`) are unchanged: they describe how the database keeps out anyone who is not active GSS staff, and their tests stay (decision of 2026-10-27).

## 2026-10-28 — Logins from the Team page

- `README.md`: adding a person from the app, and the Supabase secret key on the Worker.
- `docs/API.md`: `POST /api/v1/members` making logins, `POST /api/v1/me/password`.
- `docs/DECISIONS.md`: the owner's choices (admin as the top role, temporary passwords, names at first sign-in).

## 2026-10-28 — Member management

- `README.md`: adding a person (login in Supabase, then **Team → Add a person**).
- `docs/API.md`, `docs/DATA_MODEL.md`, `docs/PRODUCT.md`, `docs/DESIGN_SYSTEM.md`: the members endpoints, migration `20261028020000_member_management.sql`, the `/team` route, the menu.
- `docs/DECISIONS.md`: the owner's choices.

## 2026-10-28 — Counterparty editing, buyers and sellers, the map in Counterparties

Documents updated for counterparty editing (owner's request; see `docs/DECISIONS.md`, 2026-10-28):

- `README.md`: the Counterparties section (add by hand, edit, archive, the import's column choice and buyers/sellers choice) and the map as a view of Counterparties.
- `docs/API.md`: the new endpoints, the `type` filter on `GET /facilities`, `defaultTypes` on the import, and the error codes of edits.
- `docs/DATA_MODEL.md`: migration `20261028010000_counterparty_editing.sql`.
- `docs/PRODUCT.md`: the counterparty routes; `/map` and `/map/coordinates` now forward to Counterparties.
- `docs/DESIGN_SYSTEM.md`: pin colours for buyers, sellers and both; the new components.
- `docs/DECISIONS.md`: the owner's choices of 2026-10-28.
- `AGENTS.md`: the status line.

## 2026-10-27 — Documents brought up to date with the owner's decisions

The owner asked for every project file to match the decisions and changes merged on 27 October (ivanmueller/gss#23 to ivanmueller/gss#29). Updated:

- `README.md`:
  - a current status line (it still said there was no database or sign-in);
  - a "Workspace" section: the order book, the Demo data switch, the FX rate;
  - the database connection through Hyperdrive, with `DATABASE_URL` as a local fallback only;
  - the shared money code in `packages/domain`.
- `AGENTS.md`:
  - status;
  - the FX decision under the intended architecture;
  - how synthetic data is labelled in the web app (the Demo tag).
- FX source, the Bank of Canada daily rate (owner's decision), recorded in:
  - `docs/ARCHITECTURE.md`, `docs/API.md` and `docs/DATA_MODEL.md`;
  - `docs/TRADING_RULES.md` and its copy in the specification, which also gain the stale-rate rule and display rounding;
  - `docs/BUILD_PLAN.md` (GT-052 pulled forward);
  - `docs/REFERENCES.md`.
- `MASTER_PROJECT_SPECIFICATION.md`:
  - version line;
  - FX as a permitted data source;
  - the order book as the right-hand panel, with a pointer to its owner-approved exceptions to three interface conventions;
  - references.
- Other docs:
  - `docs/PRODUCT.md` and `docs/AI_CODING_SYSTEM.md`: the quote inspector is now the order book;
  - `docs/DECISIONS.md`: pointers on entries that later decisions changed.

Product rules, formulas and schemas are unchanged apart from recording these decisions.

## 2026-10-26 — AI coding workflow pack integrated into the repository

The pack update below arrived after the Phase 0 bootstrap (ivanmueller/gss#1) had merged, so three of its files were merged by hand rather than copied:

- `README.md` and `AGENTS.md`: the pack text is adopted; the repository's Phase 0 status line, quick start, layout and Commands section are kept.
- `docs/HANDOFF.md`: the pack's "documentation pack only" status is not adopted because it no longer matches `main`. The file records the merged bootstrap, the revised Phase 0 gate and the pack's new next step (choose the implementer and reviewer, optionally after the tool comparison).

Every other pack file is copied unchanged. The note below that no application tests were executed describes the pack itself; the repository's test and CI results are in `docs/HANDOFF.md`.

## 2026-10-26 — AI coding workflow refinement

**Scope:** Documentation-only update to the initial repository starter. No application, credentials, CI system, migrations or live data were added, and **no application tests have been executed**.

### Added

- `docs/AI_CODING_SYSTEM.md`: concrete multi-model coding setup (Cursor 3/Claude/Codex/Gemini), Claude Code and Antigravity alternatives, tool evaluation rubric, worktree routing, independent PR review, prompt templates, frontend verification, security gates, budget control and early end-to-end vertical-slice path.
- This changelog to make the ZIP revision auditable.

### Updated

- `README.md`: new developer onboarding route and tool-choice link.
- `AGENTS.md`: agreed contracts before parallel edits; single integration owner updates handoff after merge.
- `docs/AI_WORKFLOW.md`: role-agnostic governance and explicit handoff ownership.
- `docs/BUILD_PLAN.md`: early thin-slice milestone across minimal Phase 2–4 scope **after** mandatory Phase 0 and secure Phase 1 prerequisites; all full phase gates retained.
- `MASTER_PROJECT_SPECIFICATION.md`: aligned AI collaboration roles, handoff ownership, repo tree, reference links and thin-slice approach. Core trading/business rules, technology stack and schemas preserved.
- `docs/HANDOFF.md`: consistent documentation-only status and next step.
- `docs/REFERENCES.md`: current official agent-platform reference links.
- GitHub issue and pull-request templates: owned-file scope, shared contracts, reviewer and evidence fields; integration owner handles merged-state handoff.

### Deliberately not changed

- Product scope, trading formulas, commodity conversion policies, quote schemas, cross-tenant isolation rules or deployment choices.
- No `.cursor` or Antigravity-specific configuration added: the existing `AGENTS.md` provides portable instructions; add vendor-specific config **only when a proven recurring need appears**.
- No custom orchestration framework, automatic execution agent, billing configuration or cloud permissions.
