# Features and tests tracker

One list of what GSS has, what is still to build, what the owner still has to check on staging, and what the tests cover. Read it at the start of every session, together with `docs/HANDOFF.md` (which records each merge in detail). The design intent stays in `MASTER_PROJECT_SPECIFICATION.md` and the tickets in `docs/BUILD_PLAN.md`; this file only tracks them.

## How to use this file

**Statuses**

| Status | Meaning |
|---|---|
| **Needs owner input** | Cannot start until the owner answers the questions listed with it. |
| **Planned** | Agreed and defined; not started. |
| **In progress** | A branch or pull request exists (named with it). |
| **Live, check pending** | Merged and deployed to staging; the owner has not checked it yet. |
| **Checked** | The owner checked it on staging (date given). |
| **Offered** | Suggested by an agent, not asked for; built only if the owner says so. |

**Rules**

1. Each item has a stable ID (`F-###`), never reused or renumbered. A ticket from `docs/BUILD_PLAN.md` (`GT-###`) is named beside it when there is one.
2. A new request from the owner is added here before any code is written, under "To build", with its open questions. Never fill in an answer that is the owner's to give (costs, privacy, retention, prices, tables).
3. A pull request names the IDs it works on. After each verified merge, the same commit that records the merge in `docs/HANDOFF.md` updates the statuses here (to **Live, check pending**) and adds the owner's checks to "Owner checks on staging".
4. When the owner reports a check done, mark it **Checked** with the date. When a check fails, the item goes back to **In progress** with what was wrong.
5. Never mark something built or checked that is not; never move an item to **Checked** on an agent's own test.
6. No real business data in this file (names, contacts, phone numbers, prices): the repository is public.

## 1. To build

### Owner's list (2026-11-06)

| ID | Feature | Status | What it needs before work starts |
|---|---|---|---|
| F-101 | **Change map markers** | Needs owner input | Today every place is a round dot: buyers in the bid colour, sellers in the ask colour, filled for an exact location and hollow for an approximate one. Which maps (Workspace, Counterparties map view, a company's small map, lanes), and what should change: shape, colour, logo in the marker, size, grouping of close places, labels? |
| F-102 | **CSV template for importing buyers and sellers** | Planned | A **Download template** link in the + window's Import spreadsheet step: a CSV with the column headers the import recognizes, the required ones marked (today **Company name** and **Country**), and one made-up example row. One template for buyers and sellers, or one each (sellers have Grain type, Seller kind, Tonnes a year, Organic certificate; buyers have Market)? The carrier sheet could get its own. |
| F-103 | **Buying frequency and contracts** | Needs owner input | What to record: how often each buyer buys (e.g. monthly, by season), its usual tonnes, standing contracts (start, end, tonnes, commodity)? Entered by hand, or counted from bids, offers and the contact log? Shown where (buyer's page, a filter on Counterparties)? Contract documents themselves are Phase 6 (GT-061). |
| F-104 | **Backload strategy** | Needs owner input | Our reading: when a carrier delivers to a buyer, find a load for the trip back (or the reverse), from carriers' lanes and freight rates and sellers near the drop-off. To confirm: which direction, how near is "near", and whether it should suggest loads or only show them on the map. Relates to candidate matching (GT-053). |
| F-105 | **Buyer verification checklist, split view** | Needs owner input | A list of what to confirm before a buyer counts as verified: its facility on the map, the grains it takes (from the 20 commodities, with the verified grains already built), the type of buyer (its markets: Pet, Bird, Equine…), and more. Shown as a split view: the checklist on one side, the map and details on the other. To decide: the full checklist, who may verify (today anyone on the team verifies grains), whether a buyer is "verified" only when every item is ticked, and whether the split view replaces the buyer's page or is a separate review screen. |
| F-106 | **Trading engine and saved trade scenarios** | Planned | GT-040 to GT-046 (Phase 4). Decimal arithmetic only; missing FX, freight or unit conversion blocks the margin; saved scenarios never recalculated in place. Gate: the synthetic 42 MT example returns exactly CAD 46.00/MT and CAD 1,932.00 (`docs/ACCEPTANCE_TESTS.md`). Codex review (money). |
| F-107 | **Map layers from ArcGIS, the Government of Canada and files** | Live, check pending (ivanmueller/gss#175; F-214) | GT-026; asked 2026-10-29, widened 2026-11-07, all questions answered the same day (`docs/DECISIONS.md`): an **Add map layer** form for admins (a web address or a GeoJSON, KML or zipped shapefile file; name, colour, source and terms link); one list for the team, each person switching layers on and off, several at once; on the Workspace map and Counterparties → map view (a company's small map maybe later); clicking a shape shows its details; no sign-ins. First layer: North American Rail Network Lines from its live ArcGIS service, once its terms are recorded, each railroad in its own colour (the owner's request of 2026-11-07, kept with the layer). A layer shown only once its source and terms are recorded. New table, Storage and RLS: Codex review. |
| F-108 | **Bushel price conversion** | Needs owner input | The owner's approved pounds-per-bushel table (`docs/TRADING_RULES.md` §5.3). Until then bushel prices stay out of the order book. Codex review (money). |
| F-109 | **Audit history page** | Planned | GT-016. Who changed what and when, from the audit trail the database already keeps; admins only? (owner to confirm). |
| F-110 | **Backups and a restore drill** | Needs owner input | GT-017. Needs a paid Supabase plan (a cost: the owner's decision). Until then the source spreadsheets are the backup. |
| F-111 | **Stop other sites showing the app inside their pages** | Offered | Small and optional: headers that refuse framing. No owner input needed beyond yes or no. |
| F-112 | **Verify USD rate tracking** | Planned | A check of the Bank of Canada connector (GT-052, built): a rate stored for each business day (the Worker fetches at 14:15 and 22:15 UTC), the workspace labelling the rate's day, USD bids and offers converted at it, and left out with a note when the rate is more than four days old. If gaps are found, fix them; a page listing the stored rates is possible if wanted. |
| F-113 | **Daily market report and news** | Needs owner input | One page (and possibly a morning email) gathering what matters to the desk each day: grain futures, weather in growing and delivery areas, world news affecting grain, and crop statistics. Sources named by the owner: Reuters, Barchart, DTN and Bloomberg (commercial, licensed feeds), and USDA, Statistics Canada, Agriculture and Agri-Food Canada and Environment Canada's weather (public agencies). Before any work: each source's data access, terms of use and price checked from its own published pages (never assumed) and recorded in `docs/DECISIONS.md`; the owner chooses which paid feeds to buy (a cost). To decide: which commodities, futures contracts and regions; whether prices are only shown or also used in calculations (shown only until GT-064, licensed price-feed adapters, is approved; never used as a GSS bid or offer); one daily report or live through the day; and whether Claude may write a short summary of the news (a new use of Anthropic's API, needing the owner's decision and the same rules as the company summaries: no number or price in Claude's own words). Every item shows its source and time; nothing predicted. Keys for paid feeds are Worker secrets the owner adds; every feed is fetched by the Worker, never the browser. |
| F-114 | **Email through the platform** | Needs owner input | A person writes and sends an email to a counterparty's contact from its page, and it is logged in the contact history (the contact log already has an email channel, entered by hand today). To decide first: send from the team's own mailboxes (connecting Google Workspace or Microsoft 365, so emails appear in each person's Sent folder and replies arrive as usual) or from a sending service with a GSS address; whether replies are brought back into the contact history automatically; attachments; saved templates; who may send; how long emails are kept (privacy and retention are the owner's decisions); the cost. Each provider's terms and price checked from its published pages and recorded in `docs/DECISIONS.md`. Called from the Worker only, keys as Worker secrets the owner adds. Claude never sends an email and never sends a contract offer (`AGENTS.md` rule 8); at most it drafts one a person reviews and sends, if the owner approves that use. Codex review (sign-in to mailboxes, privacy). |
| F-115 | **Claude's drafts in their own sections** | Live, check pending (ivanmueller/gss#165; F-211) | Asked for 2026-11-06; the owner's answers the same day are in `docs/DECISIONS.md`: drafts stay drafts and are shown, marked as Claude's, in Contacts, Bids and offers and Follow-ups on the company's page and on the main Bids & offers and Follow-ups pages, no longer under the call; **Verify** saves one as it is in one click (one transaction, the usual checks and permissions, nothing added that was not said), a draft missing a required detail opening the usual form instead, whose save is verified the same way; same roles as today; Dismiss stays. Never in the order book or the follow-up count. Codex review (money, phone numbers). |
| F-116 | **Claude's drafts: Claude's colours, folded** | Live, check pending (ivanmueller/gss#167, #170; F-213) | Asked for 2026-11-06 with a screenshot of a buyer's page, all answered: (1) no violet and no "Claude's draft" pill in the corner; a light, clean, professional look in Claude's warm colours (terracotta on cream) with Claude's logo (first a mark drawn for GSS; the owner then supplied Claude's logo and chose to use it, 2026-11-06), used everywhere Claude appears (drafts, the Summary's "Drafted by Claude", Claude's notes under a call); (2) each draft folded to its main information, a click opening the transcript lines and the rest; (3) wording and (4) buttons unchanged. A Check this or a missing detail stays visible while folded, so it is seen before Verify. |

### Earlier requests and offers still open

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-120 | **Texting through the platform** (Telnyx) | Needs owner input | Approved 2026-11-02 (`docs/DECISIONS.md`) and asked for again 2026-11-06. A person texts a counterparty's contact from its page (beside Call on a phone number), and replies come back to the same conversation; every text sent or received logged in the contact history. Callbacks moved to F-132. Telnyx called from the Worker only; its webhooks accepted only with a valid signature. Owner decisions first: the sending number (GSS's Telnyx number or another), who on the team may text, whether texts are kept and for how long, attachments (photos) or not, the cost. The sending rules (business registration for texting, opt-outs such as STOP) checked from Telnyx's and the regulators' published pages, not recalled. Claude never sends a text; at most it drafts one a person sends, if the owner approves that use. Codex review (phone). |
| F-132 | **Callbacks to GSS's number** (Telnyx) | Live, check pending (F-212) | Built in ivanmueller/gss#164 (F-017 below; the owner's answers and Codex's reviews in `docs/DECISIONS.md`, 2026-11-06). Codex's third review of the merged commit found one more P2 (a join refused when sent again, before the caller's hang-up arrives, ended the call and hung up both legs), fixed in ivanmueller/gss#168 (`20261107030000_callback_join_refused.sql`); Codex's re-review found nothing more. |
| F-133 | **Map layers panel: each railroad on or off** | Live, check pending (ivanmueller/gss#176; F-215) | Asked 2026-11-07 with a screenshot of ArcGIS's map viewer: see which layers are on and, within a layer, switch values on and off (each railroad), to look at one rail line alone. Where it goes was left to us: a Layers panel over the map (Workspace and Counterparties → map view) listing each layer with an on/off switch and, under a layer coloured by a field, every value with a tick box, a search, Show all and Hide all; kept per person in their browser; the legend under the map shows what is on. |
| F-134 | **Map layers: the whole network when zoomed out** | Live, check pending (ivanmueller/gss#176; F-215) | Asked 2026-11-07 with a screenshot: zoomed out, North American Rail Network Lines shows scattered pieces. Cause: a map square holds at most 4,000 of the tens of thousands of rail pieces in a dense square. Fix: when an ArcGIS layer is added (or on request), an admin's browser reads the whole layer once through the Worker, joins each value's pieces into lines and simplifies them, and stores one zoomed-out view with the layer; zoomed out the map draws that view, zoomed in the live squares as now. |
| F-135 | **Map layers: colour of anything else optional; edit a layer** | Live, check pending (ivanmueller/gss#176; F-215) | Asked 2026-11-07, left to us: when a layer is coloured by a field, values without a colour of their own are grey and the form no longer asks for that colour; one colour is asked only for a layer in one colour. Also an Edit on each layer on Team (name, source, terms, Colour by), so a layer coloured by the wrong field (TRACKS instead of RROWNER1, the railroad) is fixed without removing it. |
| F-137 | **A railroad's lines as on ArcGIS: shared track and trackage rights** | Live, check pending (ivanmueller/gss#178; F-216) | Asked 2026-11-08 with screenshots: CPKC alone breaks around Houston on GSS's map but not on ArcGIS. Cause: GSS shows a line under its first owner only (RROWNER1); the publisher's CPKC view (read 2026-11-08) takes main lines and industry track (NET M or I) where CPKC is any of the three owners (RROWNER1 to 3) or any of the nine trackage-rights holders (TRKRGHTS1 to 9), so the Houston to Beaumont and Dallas lines (owned by others, run on by CPKC) show. The owner's answers (2026-11-08), all as suggested: (1) a railroad's lines include track it co-owns and track it has rights on, as ArcGIS yes; (2) a line shared by several railroads is coloured by its first owner when all are shown, and by the chosen railroad when only some are ; (3) main lines and industry track only, as ArcGIS's views (yards and sidings left out). Also, without a decision: after Check, the add form says how many pieces a layer has, and each layer on Team shows its web address (the owner had added the CPKC-only view by mistake, 2026-11-07); the zoomed-out view's lines numbered uniquely (they repeated from part to part). |
| F-136 | **Large file layers on Cloudflare's free plan** | Offered | A file layer is sent whole (up to 5 MB) and checked by the Worker in one request; on the free plan (about 10 ms of computing per request) a file over roughly 200 KB may be refused. Fix if wanted: send files in parts, as zoomed-out views are (F-134). Or the paid plan (a cost: the owner's decision). |
| F-138 | **Map layers presented as on ArcGIS** | Live, check pending (ivanmueller/gss#179; F-217); Codex's later fixes on branch `claude/relaxed-turing-2931q8` | Asked 2026-11-08: every map layer added should look as ArcGIS presents it. Found the same day: what ArcGIS shows (each railroad its own layer and colour, a filter per layer, line widths, the order of layers) is set in the ArcGIS map (a "web map", such as the National Rail Network Map), not in the data service, whose own drawing is one plain colour (the CPKC view: thin blue). Proposed: (a) add a layer, or a whole set of layers, from an ArcGIS map's link, each with the map's own name, filter, colours, line width and order; (b) a layer added from a service alone takes the service's own drawing (colours by value when it has them) instead of GSS's. The owner's answers (2026-11-08): (1) both, from an ArcGIS map's link; (3) a layer from an ArcGIS map comes in exactly as ArcGIS has it; changing it in GSS is welcome later but not a priority; (4) layers show at the zooms ArcGIS shows them. (2) the owner gave the data's link; the map in the owner's screenshot was found on ArcGIS's catalogue (2026-11-08): "National Rail Network Map", item 96ec03e4fc8546bd8a864e39a2c3fc41, published by the U.S. Surface Transportation Board from U.S. DOT NTAD data: nine layers (Amtrak Lines, kept inside the map; Other Rail Lines, grey from its own catalogue entry; Norfolk Southern, CSX, CN, Union Pacific, BNSF and CPKC, each the publisher's view of that railroad in one colour; Amtrak Routes). ArcGIS takes a layer's style from the map, then from the layer's catalogue entry, then from the data; GSS will do the same. Built (ivanmueller/gss#179, 2026-11-08): Team → Map layers → Add map layer → **ArcGIS map**: paste the map's link (or its item page, an app built on it, or its id) → **Read map** lists its layers top first with ArcGIS's colours, line widths, opacity, zoom range and filter (from the map, else the layer's own catalogue entry, else its service), the pieces each has, and the ones GSS does not take (vector tiles, scenes…) with the reason; the source and terms come from the map's ArcGIS page and can be changed; **Add N layers** adds them bottom to top, then prepares each live layer's zoomed-out view. On the maps, the Layers panel lists a map's layers together under its title with one switch; each is drawn with ArcGIS's width, opacity and zooms, in ArcGIS's order. Migration `20261108020000_map_layer_arcgis_maps.sql`. Not yet: changing these on GSS (the owner: later); patterns, symbols along a line and pictures (drawn in their main colour, marked "roughly" on the form); a layer added by its web address alone still takes GSS's colours (b). |
| F-121 | **Hang up** button in the live call box | Offered | For calls placed from the platform and callbacks to GSS's number alike (both show in the call box since #164). A change to the calling commands; Codex review. |
| F-122 | **Quote import from files** | Planned | GT-035. |
| F-123 | **Grades as a list** | Planned | GT-015. |
| F-124 | **Typical use of each grain class** (feed, milling, malting, pet and bird) | Offered | From a published source or the owner's list, never from memory. |
| F-125 | **Ontario's Eastern wheat classes** on Grains | Offered | Left out by the owner's choice (2026-11-05); add if a buyer asks for Ontario winter wheat. |
| F-126 | Column-limited insert grants on the bid, offer and freight revision tables | Offered | Hardening; no check depends on `created_at` there today. |
| F-127 | Lock "What they buy / sell" while a company is being archived | Offered | The pattern of Codex's first finding on the lanes; not reported or tested. |
| F-128 | Licensed road routing | Planned | GT-051 (Phase 5). |
| F-129 | Candidate matching and comparison | Planned | GT-053, GT-054, GT-055 (Phase 5). |
| F-130 | Production deployment | Planned | After the owner's go-ahead; backups (F-110) first. |
| F-131 | Farm-location visibility | Planned | Specification §6; deferred by the owner until farms are added. |

Phase 6 (trade lifecycle, contracts, shipments, invoices; GT-060 to GT-067) waits for a separate release decision.

## 2. Owner checks on staging

Built and deployed, not yet checked by the owner. Details and click paths are in `docs/HANDOFF.md`, "Next exact task".

| ID | What to check | Pull requests |
|---|---|---|
| F-201 | **Company summaries**: fixed titles ("Latest contact", "Live bids and offers", "Waiting on GSS"…) followed by the records' own text; notes whole. How many are still waiting or stopped: the read-only query below (Supabase → gss-staging → SQL Editor → New query → Run); why one stopped: Cloudflare → Workers & Pages → grain-trading-api-staging → Logs, search `Summary not`. | #151 to #160 |
| F-202 | **Claude's notes under a call**: a call's entry with the Voicemail badge, Claude's notes and **Use as notes**. Claude's drafts are no longer under the call: they are checked under F-211 and F-213. | #140 onward |
| F-203 | A buyer's page: Make main, Log contact, Edit under What they buy, the small map, ⋯ → Edit details, on a phone; the CRM flow (a follow-up due in the past, the count beside Follow-ups, Correct, Mark done). | #76, #78 |
| F-204 | The + window, company phone, Served by, Find coordinates, verifying a commodity, removing a follow-up (admins), the Commodities, Market and Tier pickers. | #82 to #85 |
| F-205 | Imports: one company with several locations, a second file adding to it, the same file again, changes on the Check step, a change made meanwhile; deleting an archived company; Paste logo; phone formatting. | #88 to #96 |
| F-206 | A carrier's page, lanes and their map, equipment, the Delivers to filter; a carrier added by hand. | #98, #99 |
| F-207 | The carrier spreadsheet: found columns, unverified lanes, Verify. | #101 to #104 |
| F-208 | The counterparty page's top, logo, phone menu, the live call box, the contact history's two lines, Pin, Edit, Remove; the caller's and contact's names the right way round on a transcript; the Telnyx invoice. | #121 to #123 |
| F-209 | Undo the sellers' import, import the corrected sellers' sheet, a seller added by hand, Back keeping the list as it was. | #125 to #133 |
| F-210 | Grains: the tiles, search, a grain's window, a class, Close, a verified grain's badge opening its grain. | #135 to #138 |
| F-211 | **Claude's drafts in their sections**: on a company with a recent call, Claude's drafts in Bids and offers, Follow-ups and Contacts (in Claude's colours since #167, F-213); **Verify** on a complete one (it joins the normal list; the count beside Follow-ups updates for a follow-up); a draft "Not heard on the call" offering **Finish in the form**, saved from there; **Dismiss**; the same drafts on the main Bids & offers and Follow-ups pages; none under the call. | #165 |
| F-212 | **Callbacks to GSS's number**: Team → Callbacks to GSS's number → Callbacks go to → a person → Turn on callbacks; from a second phone that a test company's page called, call GSS's number: your cell rings, press 1, connected, logged in your name; again without answering: the callbacks person, then the voicemail and a follow-up; from a number never called: Follow-ups → Calls to GSS's number → Link to a company; the live call box on any page; whether a caller is cut off before the voicemail message. | #164 |
| F-213 | **Claude's drafts in Claude's colours**: a draft folded to its main information, in terracotta on cream with Claude's logo beside "Drafted by Claude" (also on the Summary and Claude's notes under a call); Check this and anything not heard still shown folded; the chevron opening the call and transcript lines; buttons under the text on a phone. | #167, #170 |
| F-214 | **Map layers**: Team → Map layers → Add map layer (a web address with Check, and a small KML or GeoJSON file); its source and terms; Colour by a field; Layers on the Workspace map and Counterparties → map view, two layers at once; their colours and source under the map; clicking a line for its details; Remove. | #175 |
| F-215 | **Layers panel, zoomed-out view, Edit**: Team → Map layers → Edit on the rail layer, Colour by RROWNER1, Save ("saving part 27 of 27"); Layers panel on both maps, a layer's values (Hide all, then CN alone, search), the legend's hidden count; zoomed out, the whole network; zoomed in past 7, the detailed lines; a line clicked zoomed out shows its railroad; Prepare again. | #176 |
| F-216 | **A railroad's lines as on ArcGIS**: Team → Map layers → Edit on the full rail layer → Change → Use ArcGIS's railroad settings → Save (the zoomed-out view prepared again); Layers → the rail layer → Hide all, then CPKC alone: around Houston the lines to Beaumont and Dallas show, as on ArcGIS; a shared line coloured by its first owner when all are shown; the layer's piece count and web address on Team. | #178 |
| F-217 | **Layers from an ArcGIS map**: Team → Map layers → Add map layer → ArcGIS map → the National Rail Network Map's link → Read map (nine layers, top first, with their colours and pieces) → Add 9 layers (done by the owner on staging, 2026-11-08: 9 of 9 added, Amtrak Routes' zoomed-out view to prepare again); then Prepare zoomed-out view on Amtrak Routes; Workspace map → Layers → the map's switch, each railroad in ArcGIS's colour and width, compared with ArcGIS zoomed out and in. | #179 |

### Company summaries: how many are done, waiting or stopped (F-201)

Read only; it changes nothing. `still_waiting` should fall toward 0 (a company waits up to an hour after new activity); `stopped_after_5_tries` counts the failed ones.

```sql
select
  count(*) as companies_with_history,
  count(*) filter (where s.written_at >= timestamptz '2026-11-06 04:53:08+00') as written_under_final_rules,
  count(*) filter (where (s.source_at is null or s.source_at < a.activity_at) and coalesce(s.attempts, 0) < 5) as still_waiting,
  count(*) filter (where (s.source_at is null or s.source_at < a.activity_at) and s.attempts >= 5) as stopped_after_5_tries
from app.counterparties c
left join app.counterparty_summaries s on s.counterparty_id = c.id
cross join lateral (select app.counterparty_activity_at(c.organization_id, c.id) as activity_at) a
where c.archived_at is null and a.activity_at is not null;
```

## 3. Built and live

| ID | Feature | Status | Main tests |
|---|---|---|---|
| F-001 | Sign-in with email, password and an authenticator app; Team page | Live | `auth.spec.ts`, `team.spec.ts`; `member_management`, `tenancy` (pgTAP); `members`, `logins` (API) |
| F-002 | Counterparty directory (buyers, sellers, brokers, carriers), editing, archiving, deleting | Live | `counterparties.spec.ts`; `counterparties`, `counterparty_editing`, `counterparty_deletion` (pgTAP); `directory`, `editing` (API) |
| F-003 | Spreadsheet import, updates from a later file, Undo an import | Live | `counterparties.spec.ts`; `facility_import_batch`, `counterparty_import_lock`, `undo_import` (pgTAP); `undo-import` (API); `ImportSpreadsheet.test.tsx` |
| F-004 | Map view (Mapbox) and coordinates with Geocodio | Live | `facility_map`, `facility_geocoding` (pgTAP); `coordinates`, `geocoding`, `facilities` (API) |
| F-005 | Website, logos, company phone, phone format, rail or truck per location | Checked 2026-10-29 (website) | `counterparty_website`, `phone_format`, `counterparty_phone_access_verified` (pgTAP); `website`, `phone` (API) |
| F-006 | What each company buys or sells, markets, tier, seller details | Live | `counterparty_commodities`, `counterparty_market_tier`, `seller_details` (pgTAP) |
| F-007 | Bids and offers with revision history | Live | `counterparties.spec.ts`; `quotes` (pgTAP); `quotes` (API) |
| F-008 | Workspace map and order book in CAD per tonne; Demo data switch | Live | `desktop.spec.ts`, `phone.spec.ts`; `orderBook`, `workspaceQuotes` (web) |
| F-009 | Bank of Canada USD/CAD rate (GT-052) | Checked 2026-10-29 (a stored rate) — see F-112 | `fx_quotes` (pgTAP); `fx` (API, domain, web) |
| F-010 | Freight rates, carriers, lanes and equipment | Checked 2026-10-29 (Freight page) | `counterparties.spec.ts`; `freight_quotes`, `carrier_lanes`, `lane_verification` (pgTAP); `freight`, `lanes` (API) |
| F-011 | CRM: contact history, follow-ups, Follow-ups page, main contact, pins and removals | Live | `counterparties.spec.ts`; `counterparty_crm`, `follow_up_removal`, `contact_log_pins_removals`, `counterparty_main_contact` (pgTAP); `crm` (API) |
| F-012 | Alberta time on every screen | Checked 2026-10-29 | `alberta` (domain), `time` (web) |
| F-013 | Calling through Telnyx, recordings and transcripts by side | Checked 2026-11-03 (transcripts) | `telnyx_calls`, `call_commands`, `call_recordings` (pgTAP); `calls`, `call-steps` (API) |
| F-014 | Claude's reading of call transcripts (drafts) | Live, check pending (F-202) | `call_readings` (pgTAP); `readings` (API, domain) |
| F-015 | Company summaries | Live, check pending (F-201) | `counterparty_summaries`, `counterparty_summary_retries` (pgTAP); `summaries` (API, domain) |
| F-016 | Grains reference (19 grains, classes, grades, varieties) | Live, check pending (F-210) | `grains`, `grainClasses`, `grainWindow`, `grainLinks` (web); `scripts/check-grains.js` |
| F-017 | Callbacks to GSS's number (F-132) | Live, check pending (F-212) | `callbacks` (pgTAP); `callbacks` (API, API database); `Callbacks.test.tsx` (web) |

Test file names are short: `*.spec.ts` are browser tests in `tests/e2e/specs/`; "pgTAP" files are `supabase/tests/database/<name>.test.sql`; "API" files are `apps/api/src/<name>.test.ts` and `<name>.db.test.ts`; "domain" files are in `packages/domain/src/`; "web" files are in `apps/web/src/lib/` and `apps/web/src/components/`.

## 4. Tests and maintenance

### What CI runs

`pnpm check` (format, lint, typecheck, unit tests of domain, API and web), the API's database tests, the pgTAP database tests and the Playwright browser tests, on every pull request and on `main`. Test counts for each merge are in `docs/HANDOFF.md`, "Tests run on the merged state".

### Open test and CI issues

| ID | Issue | Status |
|---|---|---|
| T-01 | Browser test "enters an offer, records new terms, and withdraws it" failed once (CI run #331, `counterparties.spec.ts:562`): after the withdrawal, "No live bids or offers here." not seen within 5 seconds. The test's fault, not the app's; likely cause: the Bids & offers list showing its kept answer, with the offer still live, before it refreshes. | Planned: confirm the cause locally, then forget kept quote lists after a withdrawal or new terms and wait on the offer's own row. |
| T-02 | CI's local database refused its port (runs #342, #357, #367), with nothing listening on it: the port lies in Linux's range for outgoing connections. | Retries added in #159 did not help on #367; #162 reserves ports 54320 to 54329 as the job's first step. Its first run on `main` (#371) started the database at the first try and passed. Watch a few more runs before calling it fixed. |
| T-03 | Browser tests missing for: Grains, calling, callbacks and transcripts (needs a fake Telnyx), Claude's drafts and summaries (needs a fake Anthropic), lanes map and map layers (no Mapbox token in CI). | Planned, one area at a time. |

### Dependency updates

| ID | Pull request | Status |
|---|---|---|
| D-01 | Dependabot #112: minor and patch updates (wrangler, eslint, mapbox-gl, lucide-react, Playwright, Workers types) | Fails lint at `FacilityMap.tsx`; closed by Dependabot on 2026-11-07 (its 3-day release-age rule refused `@anthropic-ai/sdk` 1.5.0, so no update resolved); expected to reopen at its next weekly run after 2026-11-08, then redo with the lint fixed. |
| D-02 | Dependabot #113: postgres (the Worker's database library) 3 → 4, a major version | To test on its own branch with all database tests; Codex review. |
| D-03 | Dependabot #114: `@types/node` 22 → 26 | Not wanted: CI and deploys run Node 22. Close, and tell Dependabot to skip major `@types/node` updates. |
