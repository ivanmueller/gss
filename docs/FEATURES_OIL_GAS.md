# Oil and gas: features to build

The oil and gas side of the platform, on its own map page (`map.torvenco.com`, F-238). Asked by the owner on 2026-11-18: as the platform expands beyond grain, this page tracks oil and gas production across Canada. Built from the owner's study of the public data behind such a map (2026-11-18, kept by the owner); that study covers **Alberta only**, from free government sources.

Same rules as `docs/FEATURES.md` (IDs never reused, every request recorded before code, statuses as there) and as the rest of the platform: nothing invented; every dataset shows its source and date; **each source's terms of use and any price are read from its own published page and recorded in `docs/DECISIONS.md` before it is used** (the links and terms below are the study's findings, not yet checked by an agent); sources are fetched by the Worker, never the browser; no data copied from other companies' compiled products, only from the government sources themselves.

## Status

| ID | Feature | Status |
|---|---|---|
| F-239 | The oil and gas map page: empty, with map styles and layers | In progress (`feat/f-239-oil-gas-map`) |
| F-240 | Alberta reference layers: township grid and formation outlines | Needs owner input |
| F-241 | Crown agreements, offset notices and freehold minerals as live map layers | Needs owner input |
| F-242 | Crown land sales: upcoming parcels and results | Needs owner input |
| F-243 | Wells, new licences and rig activity (AER) | Needs owner input |
| F-244 | Companies across sources: buyers, holders and licensees | Needs owner input |
| F-245 | Company, formation and weekly summaries | Needs owner input |
| F-246 | Other provinces: British Columbia, Saskatchewan, Manitoba and beyond | Needs owner input |

## Two things that shape the order

1. **Showing is cheap; storing is not.** The province publishes several of these datasets as live ArcGIS map services, and the platform already shows live ArcGIS layers, fetched by the Worker by map square (F-107, F-141). Those can appear on the map with no database work (F-240, F-241). Searching, history, totals and joins (who bought what, which wells sit on which land) need the data stored, and at Alberta's size (hundreds of thousands of wells, every agreement tract, sales since 2003) that will not fit the Supabase free plan's database (a cost: the owner's decision).
2. **Some files are too large for the Worker.** The AER's full well list (ST37) is a 1.23 GB geodatabase or a 170 MB Excel package, monthly; the Worker has 128 MB of memory. Loading it needs another kind of job (for example a scheduled GitHub Actions run), an architecture decision (`AGENTS.md` rule 9) before building F-243.

## F-239 — The oil and gas map page

**Status:** In progress (`feat/f-239-oil-gas-map`). Normal risk (screens only). **Asked:** 2026-11-18, after seeing F-238 on staging: "clean everything in this map. I did not ask you to put counterparties. We can potentially leave map layers … Let's clear the map so that it's still the same structure, but there's no data on the map yet."

**Built:** the full-page map at `map.torvenco.com` and `/map` shows no companies; it starts on Canada, with the map styles (street map, satellite) and the team's map layers (Layers button), as before. Signed-in members only.

**Open:** whether the grain map layers (rail lines, crop areas) stay offered on this page or the oil and gas page gets its own list of layers.

## F-240 — Alberta reference layers: township grid and formation outlines

**Status:** Needs owner input. **What:** the layers that turn land descriptions and formation names into shapes:
- the **Alberta Township System** grid (township, section, quarter section, legal subdivision), from the province's ATS map service (also AltaLIS's ATS product);
- **formation outlines**: the Alberta Geological Survey's shale plays (Digital Dataset 2013-0024: Duvernay, Muskwa, Montney, Basal Banff/Exshaw, North Nordegg, Wilrich) and its Geological Framework of Alberta, version 3 (about 90 geological units, among them Cardium, Mannville, Wabamun, Leduc).

**How:** the grid as a live ArcGIS layer (no storage); the outlines as file layers or live layers, as the AGS publishes them. Credit line on the map: "Contains information licensed under the Open Government Licence – Alberta", plus the AGS as source.

**Questions:** which formations matter to the desk first; whether a search box for a legal land description (for example SE-34-62-2-W4) is wanted now (that needs the grid stored, or a lookup through the service).

## F-241 — Crown agreements, offset notices and freehold minerals as live layers

**Status:** Needs owner input. **What:** on the map, from the province's public map services, read live:
- **Crown agreements** (petroleum and natural gas; oil sands): each tract's holder (designated representative), partners, zones, term, continuation and expiry, area;
- **offset notices** (all, or open only): deadline, holder, oil or gas, zone, status and how each ended;
- **freehold (non-Crown) mineral land**, with national parks and reserves.

**How:** each as a map layer added on Team → Add map layer (F-107), drawn as the province draws it, clicking a tract shows its details; no storage, so no history, totals or search yet (those come with F-242 to F-245). Requests stay small and slow (the services cap each request at 1,000 records; they are production government servers).

**Questions:** which of the three first; whether expiring agreements (for example within 12 months) should be highlighted (that needs the data stored).

## F-242 — Crown land sales: upcoming parcels and results

**Status:** Needs owner input. **What:** Alberta Energy and Minerals' public offerings: each sale's posted parcels (notice), corrections and withdrawals, and results (bonus, price per hectare, buyer), for petroleum and natural gas and oil sands, from January 2003 (older years only as PDFs). Per parcel: sale date, contract number, commodity, legal land description, hectares, rights wording, lease or licence, region, bonus, buyer.

**How:** a scheduled Worker job fetching the province's notice, correction and result files (XML and CSV) by sale date, twice a day; history loaded once; land matched to the township grid (F-240) and rights wording to formations. Stored: a migration, row level security and pgTAP tests, as every table. **Buyers are often land brokers**: the company that ends up holding the land comes from the agreements (F-241, F-244).

**Questions:** how far back (2003 as published in files, or recent years only, cheaper); whether sale dates appear as reminders or follow-ups; the storage cost decision above.

## F-243 — Wells, new licences and rig activity (AER)

**Status:** Needs owner input. **What:** from the Alberta Energy Regulator's free reports:
- **new well licences** (ST1, daily): licensee, target zone, horizontal or vertical, projected depth, surface location, cancellations;
- **rig activity** (ST49, daily): rigs moving onto licences, activity, contractor and rig number;
- **every well** (ST37, monthly): status, licensee, field and pool, spud date;
- **codes** (ST103 field, pool and formation codes; ST104 licensee codes).

**How:** daily files are overwritten after a week, so a job must **save every daily file from the first day** (older issues are sold by the AER). The well list needs the large-file job (architecture decision above). The AER calls its daily lists preliminary: shown as such.

**Questions:** daily licences and rigs first (small files, a Worker job), the full well list later?; the AER's own terms of use read and recorded first.

## F-244 — Companies across sources

**Status:** Needs owner input. **What:** one company list linking the names each source uses: sale buyers (name only), agreement holders and partners (names), well licensees and drilling contractors (AER business associate codes, ST104). Aliases with the dates they apply (agreements and licences change hands), known land brokers flagged, a person able to correct a match.

**Questions:** whether these companies join GSS's counterparties (a producer as a seller of crude, a buyer of services) or stay a separate reference list (as Grains is).

## F-245 — Company, formation and weekly summaries

**Status:** Needs owner input. Built from F-241 to F-244 once stored: per company (land held, expiring agreements, partners, wells by formation, licences in the last 90 days, land won by a broker and later transferred); per formation (parcels sold, bonus by year, largest holders, new licences); per week (bonus at sales, parcels sold, new licences, wells spudded). Computed by the Worker from stored public data, never predicted.

## F-246 — Other provinces

**Status:** Needs owner input. The study covers Alberta only; "across Canada" needs each province's regulator and mineral-tenure data (British Columbia, Saskatchewan, Manitoba, and offshore Newfoundland and Labrador and Nova Scotia), each found and checked from its own pages, with its terms, before anything is built. Not started.

## Questions for the owner (before F-240 onward)

1. **What the desk does with it:** trading crude or natural gas physically, selling to producers, or market and land intelligence? It decides what to build first and whether these companies become counterparties (F-244).
2. **Alberta first?** The study's sources are Alberta's; other provinces need their own study (F-246).
3. **Live layers first (F-240, F-241)?** Quick and free, but no history, totals or search.
4. **Storage:** stored history (F-242 to F-245) needs a paid Supabase plan (its price read from Supabase's pricing page when decided) and a job for the AER's large files.
5. **Who may open the page:** everyone on the team, as now, or some roles only.
6. **The platform's mission:** `AGENTS.md` and the specification describe a grain trading platform; a lasting oil and gas side is a change to them (governance: reviewed and approved by the owner) once its first features are agreed.
