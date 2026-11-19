# Oil and gas: features to build

The oil and gas side of the platform, on its own map page (`map.torvenco.com`, F-238). Asked by the owner on 2026-11-18: as the platform expands beyond grain, this page tracks oil and gas production across Canada. Built from the owner's study of the public data behind such a map (2026-11-18, kept by the owner); that study covers **Alberta only**, from free government sources.

Same rules as `docs/FEATURES.md` (IDs never reused, every request recorded before code, statuses as there) and as the rest of the platform: nothing invented; every dataset shows its source and date; **each source's terms of use and any price are read from its own published page and recorded in `docs/DECISIONS.md` before it is used** (the links and terms below are the study's findings, not yet checked by an agent); sources are fetched by the Worker, never the browser; no data copied from other companies' compiled products, only from the government sources themselves.

## Status

| ID | Feature | Status |
|---|---|---|
| F-239 | The oil and gas map page: empty, with map styles and layers | Live, check pending (ivanmueller/gss#260 and #266, 2026-11-18) |
| F-247 | Oil and gas map layers: their own system, added from a Settings button on the oil and gas map | Live, check pending: its database (parts 1a and 1b, ivanmueller/gss#263 and #264, 2026-11-18) and Settings and layers (part 2, ivanmueller/gss#268, 2026-11-19, merged by the owner without Codex's approval: see F-248) |
| F-248 | What was left open when F-247 part 2 was merged, to fix or review again | To do (2 open findings, 6 things to look at again) |
| F-240 | Alberta reference layers: township grid and formation outlines | Planned (after F-247) |
| F-241 | Crown agreements, offset notices and freehold minerals as live map layers | Planned |
| F-242 | Crown land sales: upcoming parcels and results | Needs owner input |
| F-243 | Wells, new licences and rig activity (AER) | Needs owner input |
| F-244 | Companies across sources: buyers, holders and licensees | Needs owner input |
| F-245 | Company, formation and weekly summaries | Needs owner input |
| F-246 | Other provinces: British Columbia, Saskatchewan, Manitoba and beyond | Needs owner input |

## Two things that shape the order

1. **Showing is cheap; storing is not.** The province publishes several of these datasets as live ArcGIS map services, and the platform already shows live ArcGIS layers, fetched by the Worker by map square (F-107, F-141). Those can appear on the map with no database work (F-240, F-241). Searching, history, totals and joins (who bought what, which wells sit on which land) need the data stored, and at Alberta's size (hundreds of thousands of wells, every agreement tract, sales since 2003) that will not fit the Supabase free plan's database (a cost: the owner's decision).
2. **Some files are too large for the Worker.** The AER's full well list (ST37) is a 1.23 GB geodatabase or a 170 MB Excel package, monthly; the Worker has 128 MB of memory. Loading it needs another kind of job (for example a scheduled GitHub Actions run), an architecture decision (`AGENTS.md` rule 9) before building F-243.

## F-239 — The oil and gas map page

**Status:** Live, check pending (merged as ivanmueller/gss#260 on 2026-11-18, register `docs/reviews/F-239.md`; grain's layers removed from the page in ivanmueller/gss#266 the same day, register `docs/reviews/F-239-2.md`). Normal risk (screens only). **Asked:** 2026-11-18, after seeing F-238 on staging: "clean everything in this map. I did not ask you to put counterparties. We can potentially leave map layers … Let's clear the map so that it's still the same structure, but there's no data on the map yet."

**Built:** the full-page map at `map.torvenco.com` and `/map` shows no companies; it starts on Canada, with the map styles (street map, satellite). Signed-in members only. Grain's map layers are no longer offered there (owner, 2026-11-18, on seeing them on staging); the Layers button returns with oil and gas's own layers (F-247 part 2).

**Owner's answer (2026-11-18):** oil and gas has its own layers (F-247); until they are built the oil and gas map has no Layers button.

**Owner check on staging:** open `https://map.torvenco.com` (Ctrl+F5 if the old page shows): Canada filling the window, no pins, the map style switch top left, no Layers button.

## F-247 — Oil and gas map layers: their own system

**Status:** Live, check pending. Part 2 (the Settings button and the layers) was merged as ivanmueller/gss#268 on 2026-11-19 by the owner himself, past the Merge policy check: Codex's last review (round 23 of 23) had not approved; what was left open is F-248 below. CI on the merged code passed (run #687). **Owner check on staging:** open `https://map.torvenco.com` (Ctrl+F5 if the old page shows) → **Settings** (admins) → **Add map layer** → paste the address of a live Alberta ArcGIS layer → **Check** → fill in who publishes it and its terms → tick **On when the map opens** if wanted → **Add layer**; it then shows under **Layers** and on the map. Earlier: Part 1, the oil and gas database `petroleum-staging` wired to CI, deploy and the Worker, is live (1a ivanmueller/gss#263, 1b ivanmueller/gss#264, 2026-11-18; the owner's setup steps 1 to 5 done the same day; the deploy of #264 proved the connection). Part 2 (Settings button and layers) next: high risk, Codex design review before code. **Asked:** 2026-11-18, after the first attempt (F-240 part 1, ivanmueller/gss#261, closed unmerged): one list of layers shared by grain and oil and gas, marked by area. Codex's final reviews kept finding new edge cases of that sharing (browser tabs running the previous app, the shared Team list); the owner: "Why can't we just build our own map layer input system on the oil/gas side? That way we don't mix it up with the grain one … The oil/gas side can have its own settings etc?"

**Owner's answers (2026-11-18):**
1. **Where:** a **Settings** button on the oil and gas map (`map.torvenco.com`), where layers are added and managed; not on Team.
2. **Who adds layers:** admins. (Everyone on the team opens the map and switches layers on and off.)

**Owner's answers (2026-11-18, second round):**
3. **Which layers first:** live layers from Alberta's government ArcGIS services only (township grid, formations, Crown agreements). Uploaded files and whole ArcGIS maps from a link come later.
4. **What Settings holds:** layers only for now; other settings later.
5. **Where the records live:** in the owner's new Supabase project **`petroleum-staging`** (same Supabase organization as `gss-staging`), the database for everything on the oil and gas side, from the first table on. Project ref `ubgyatbzjctsgzcsvwgc`, session pooler host `aws-1-us-east-2.pooler.supabase.com` (U.S. East, Ohio).
6. **Sign-in:** the same as GSS (the same people, password and authenticator app; GSS's admins are admins here); the petroleum project holds no user accounts.

**Owner's answers (2026-11-18, third round, for part 2):**
7. **First layers:** from the owner's document of Alberta's public data sources: the Alberta Township System service, the mineral agreement service (petroleum and natural gas, oil sands), the offset notice layers and the non-Crown mineral ownership service, all live ArcGIS services of the Government of Alberta under the Open Government Licence – Alberta. Admins add them in Settings; none is built in.
8. **On or off at first:** an admin chooses, per layer in Settings, whether it is on when the map opens; the choice applies to everyone who opens the page. The owner, 2026-11-19: always the admin's setting. Every time anyone opens the map, layers start as the admin set them; a person's own switching lasts only until they close or reload the page.

**Plan (draft for Codex's design review).** Two pull requests.

*Part 1: the petroleum database wired to the Worker* (high risk and governance: database, Worker, CI and deploy workflows; held for the owner's approval of the exact commit). Codex's design review (register `docs/reviews/F-247-1.md`, 6 findings) changed the plan as below. Two pull requests, because a Worker binding must name a Hyperdrive configuration that exists: **1a** (branch `feat/f-247-petroleum-db`) everything but the binding; **1b** the binding.
- **Sign-in stays GSS's** (`gss-staging`'s Supabase Auth, as on every page): the petroleum project has no users and no sign-in of its own. The Worker checks the session and the person's membership and role in `gss-staging` exactly as today, then queries the petroleum database. The browser never talks to the petroleum project (no keys for it in the web app).
- **Files:** `petroleum/supabase/` (its own `config.toml`, `migrations/`, `tests/database/`), run with the Supabase CLI's `--workdir petroleum`; the merge gate treats `petroleum/supabase/` as high risk and applies the same rules as to grain's database (migrations only added, each new one with pgTAP tests in its own folder). New functions are not executable by anyone by default.
- **Database:** schema `petro`; role `petro_api` (no login in migrations; its password set by SQL on `petroleum-staging` by the owner, never committed), revoked from `public`, `anon`, `authenticated` and `service_role` as in `app`. Every table enables row level security keyed on `petro.current_organization_id()` and `petro.current_member_role()`, which read transaction-local settings the Worker sets (`set_config(..., true)`) from the membership it has just checked in `gss-staging`. The petroleum database therefore trusts the Worker for who is asking: recorded as an architecture decision in `docs/DECISIONS.md`. Writes go through functions that refuse anyone but an admin; pgTAP tests for those refusals and for another organization's rows.
- **Worker:** routes `GET /api/v1/petroleum/ready` (public, reads no data: reachable and migrated, for the deploy's smoke test) and `GET /api/v1/petroleum/health` (signed in; a person without an active membership is refused before the oil and gas database is opened); without a connection they answer "not set up" and grain is untouched. A second Hyperdrive configuration `gss-petroleum-staging` (the **Set up Hyperdrive (staging)** workflow with the choice `petroleum` and the secret `PETROLEUM_HYPERDRIVE_URL`; a login for the other database is refused), its binding `PETROLEUM` added in 1b.
- **CI:** the petroleum migrations applied to a second database (`petroleum`) inside the same local Supabase, its pgTAP tests, then the API's database tests as `petro_api`; the local connection for the Worker's future binding supplied.
- **Deploy:** every deploy applies the petroleum migrations not yet run; on a release from a push a failure is a warning (grain still deploys), on a run started by hand it fails the run. The Worker's oil and gas routes check the database's schema version and answer "not ready" until it has the version the code needs (Codex's final review, round 3). Skipped with a notice while `PETROLEUM_STAGING_DB_URL` is missing. The smoke test calls `/api/v1/petroleum/ready`; once the Worker has its binding, "not set up" fails it. After a release that changes the oil and gas side, the owner runs Deploy staging by hand to prove the connection, at Claude's request with the click path (agents may not start workflows).
- **Owner steps, in this order** (exact click paths given then): (1) **before 1a merges, and confirmed by the owner to Claude before the pull request is marked ready** (F-247-1-R17-01): the `staging` environment limited to `main`; `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` stored as secrets of that environment and their repository-level copies deleted (that token deploys the Worker and manages its Hyperdrive connections); and, as a secret of that environment only, `PETROLEUM_STAGING_DB_URL` (the `postgres` login, for migrations); (2) 1a merges and its deploy applies the first migration (Claude checks the log); (3) in `petroleum-staging`'s SQL editor, `alter role petro_api with login password '…'` (a password the owner makes up, never in chat); (4) the `staging` environment secret `PETROLEUM_HYPERDRIVE_URL` (`petro_api.ubgyatbzjctsgzcsvwgc` at the session pooler); (5) run **Set up Hyperdrive (staging)** with `petroleum` and tell Claude the configuration id it prints (not secret); then 1b; (6) after 1b merges, run **Deploy staging** once by hand (GitHub → Actions → Deploy staging → Run workflow), which fails unless the Worker reaches the oil and gas database.

*Part 2: oil and gas layers* (high risk: database and Worker).
- **Table** `petro.map_layers`: name, ArcGIS service address and layer, source, terms of use and their link (required before a layer is shown, F-107), on or off when the map opens, who added it and when (UTC); removal marked, never deleted; every addition, change and removal kept in `petro.map_layer_history`. Writes are inserts and column-limited updates under admin-only row level security, as on grain's `app.map_layers` (not functions, as first drafted). At most 200 layers.
- **API** under `/api/v1/petroleum/layers`: list (members); add, change, remove (admins). Grain's layer routes now run over a backend (`layerRoutes` in `apps/api/src/map-layers.ts`): grain's database, or the oil and gas database behind grain's membership check; the ArcGIS fetching by map square and drawing rules (F-107, F-141) are the same code. Not offered on the oil and gas side yet: files, WMS, whole ArcGIS maps, zoomed-out views. Grain's `app.map_layers`, Team page and maps unchanged.
- **Screens:** a **Settings** button on the oil and gas map (admins), a Layers list there to add an ArcGIS layer from its address (the Worker reads its name and fields), set its source and terms, choose **On when the map opens**, and remove it; the **Layers** button on the oil and gas map lists only these layers. The same screens as grain's, told which list they work on (`apps/web/src/lib/layerApi.ts`). Each visit starts from the admin's choice; a person's switching is not remembered (answer 8).
- **Tests:** pgTAP (admins only write, other organizations denied), API unit and database tests, a browser test of adding and showing a layer.

## F-248 — What was left open when F-247 part 2 was merged

**Status:** To do. **Why this exists:** ivanmueller/gss#268 went through 23 Codex review rounds over 2026-11-19 without an approval. The owner stopped the fixing and merged it himself. Everything Codex found in rounds 1 to 22 was fixed and checked by Codex, except the two findings below. The full record, finding by finding, is `docs/reviews/F-247-2.md`.

**A. Open findings (not fixed, known when merged):**

1. **Too many picture layers in one view (F-247-2-R22-01, R23-01).** One view loads at most 600 map squares across the layers that are on; a layer there is no room for shows "Too many layers are on to load this one here: zoom in, or switch some layers off." Picture layers (heat maps, pre-drawn maps) are counted as if their squares were as big as those of lines and areas, but theirs are about four times smaller, so with a great many picture layers on at once (dozens), one view can still ask for more than 600 pictures. Effect: a slow map, in that case only. Fix: count a picture layer by its own picture squares (`layersLeftOut` in `apps/web/src/lib/mapLayers.ts`).
2. **A picture layer's finest level, 23, is refused (F-247-2-R23-02).** A pre-drawn ArcGIS layer whose finest level is 23 is accepted when it is added, but the Worker refuses requests for squares above level 22 (`isTile` in `packages/domain/src/mapLayers.ts`), so that layer does not get sharper at the closest zoom. The same on grain's maps, before this work. Fix: one highest level in the check of a new layer, the map and the Worker.

**B. To look at again (built and reviewed, but worth a second look on staging):**

3. **Grain's maps changed too.** The layer code is shared, so these now also apply to the Workspace map and Counterparties → map view: the browser asks the Worker before reusing a square, picture or legend (the Worker answers "unchanged" after checking the person is still a member); a layer switched off drops what the page kept of it; one view loads at most 600 squares, with the note above; requests for a view the map has left are cancelled; a removed layer leaves an open map; the page forgets an answer it kept once the server refuses the same request. **Owner check:** Workspace → the map → **Layers**: switch grain's layers on and off, move and zoom the map; they should draw as before.
4. **Limits chosen along the way, not asked of the owner:** after a refusal the page reads its list of layers again at most once every 10 seconds, and asks the map again for what it dropped at most once a minute; before the map has said what is in view, each layer counts for 12 squares (so at most 50 layers start loading when the map opens).
5. **No ceiling by size.** The 600 squares are a count; a square can be up to 8 MB from the Worker. Very dense layers could still be heavy for a browser.
6. **Grain's terms-link check is still case-sensitive** (F-247-2-R1-02's follow-up): on Team → Map layers a terms link typed with capital letters in "HTTPS://" fails with a database error instead of being saved. Fixed on the oil and gas side only; grain needs its own small migration.
7. **Not tried by hand on staging before merging:** adding, changing and removing a layer in Settings; a layer in one colour with an "Only where" limit; a picture layer with its legend. The automated tests cover them; the owner's check under F-247 above covers the first.
8. **The review process itself (agreed with the owner, 2026-11-19, not yet done):** change the review rules so a final review blocks a merge only on problems in the lines a pull request changes, and problems it finds in older code go to this list instead; smaller pull requests; one stated rule in the plan for anything a page keeps from the server. A governance pull request, to be approved by the owner: F-251 in `docs/FEATURES.md` (round 5 the last, the owner's answer of 2026-11-19).

## F-240 — Alberta reference layers: township grid and formation outlines

**Status:** Planned (after F-247). The first attempt at its part 1 (layers kept apart, ivanmueller/gss#261) was closed unmerged on 2026-11-18 in favour of F-247; its branch `feat/f-240-oil-gas-layers` and register `docs/reviews/F-240.md` (on that branch) are kept for reference. **What:** the layers that turn land descriptions and formation names into shapes:
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

## Owner's answers (2026-11-18)

1. **Purpose:** land and market analysis and intelligence (not trading oil or gas). So the companies here stay a reference list, not GSS's counterparties, unless the owner later says otherwise (F-244).
2. **Alberta first.** Other provinces later (F-246).
3. **Live layers first:** "if you think it's smartest; we can continue exploring the best way forward." The agent's recommendation: yes, F-240 then F-241, free and quick, while the stored data is planned.
4. **Storage:** open to a paid database plan; the owner's wish is to load as much as the free plan holds, build with it, and buy the Pro plan once it is full. **Caution (agent):** the oil and gas tables would share the staging database that holds GSS's real grain records; a full database on the free plan is restricted by Supabase, which could stop saving bids, calls and email. Proposed instead: a size budget well under the free plan's limit (the limit and Supabase's behaviour read from its own pages first), each load measured, and the paid plan bought before the budget is reached. To confirm with the owner when F-242 is planned.
5. **Who may open the page:** everyone on the team.
6. **Layers:** oil and gas has its own layers, apart from grain's. First built as one shared list marked by area (ivanmueller/gss#261, closed unmerged); then, at the owner's request, a separate system with a Settings button on the oil and gas map, admins adding layers (F-247).

## Questions as first asked (2026-11-18)

1. **What the desk does with it:** trading crude or natural gas physically, selling to producers, or market and land intelligence? It decides what to build first and whether these companies become counterparties (F-244).
2. **Alberta first?** The study's sources are Alberta's; other provinces need their own study (F-246).
3. **Live layers first (F-240, F-241)?** Quick and free, but no history, totals or search.
4. **Storage:** stored history (F-242 to F-245) needs a paid Supabase plan (its price read from Supabase's pricing page when decided) and a job for the AER's large files.
5. **Who may open the page:** everyone on the team, as now, or some roles only.
6. **The platform's mission:** `AGENTS.md` and the specification describe a grain trading platform; a lasting oil and gas side is a change to them (governance: reviewed and approved by the owner) once its first features are agreed.
