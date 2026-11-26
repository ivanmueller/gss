# Splitting the oil and gas side into its own platform: proposal (F-313)

**Status:** a proposal for the owner's decision. Nothing here is built or decided. Written by Claude on 2026-11-25 against `main` at `1e1d1bf` (ivanmueller/gss#380). Asked by the owner on 2026-11-25: separate the two sides completely; the oil and gas side becomes its own repository, built and reviewed under the strict Claude + Codex process again; grain stays here as its own thing.

**Revision 6 (2026-11-26), after the owner's further answers.** The new platform has no connection to GSS; the permission covers people outside GSS, downloads and exports (3.1); people will most likely have their own organizations, later (4.3). The owner's own order is "migrate all the code over, get it running, and then … disconnect the old version": that is simpler than the piece-by-piece move of section 4.4, so **how the code moves is now the first open decision** (section 6), with Claude's recommendation. Earlier: revision 5 recorded that the owner holds permission; revisions 3 and 4 took in Codex's two reviews (section 7); revision 2 was merged as ivanmueller/gss#381.

## 1. The recommendation in short

1. **Split, and do it now.** The longer it waits, the more unreviewed code and shared wiring there is to untangle.
2. **A new private repository, started from a clean copy of the foundation.** Its main branch starts fresh; this repository stays, tagged, as the record every moved file is compared with (4.8).
3. **The oil and gas code moves over in slices, each slice one pull request that Codex reviews.** The move is the audit: nothing enters the new repository unreviewed. A small first release is proved from end to end before the rest follows.
4. **Its own sign-in and database in one new Supabase project, in its own Supabase organization, on a paid plan;** its own Cloudflare Worker, its own secrets and keys. No grain credential ever enters the new repository.
5. **No shared code between the two repositories.** What both need is copied once; after that each goes its own way.
6. **Look and layout: the page's frame is agreed early, the panels move as they are, the redesign comes after** as separate reviewed work.
7. **Settled first:** a short product specification and which stored records must survive. The owner holds permission for the data (2026-11-26); what it covers is written down so the screens can follow it (3.1). People get in through a new sign-in and an approved list.
8. **Grain:** the oil and gas code is removed from this repository only after the new platform has taken over `map.torvenco.com` and a stated waiting period has passed. Until then the old page stays whole, so the move can be undone.

## 2. Where things stand (checked in the repository)

**Already separate**

- The oil and gas database: Supabase project `petroleum-staging`, schema `petro`, role `petro_api`, 26 migrations and 23 pgTAP test files in `petroleum/supabase/`. It holds no user accounts. It holds published reference data, part of it under restricted terms (3.1), and records that exist nowhere else (below).
- The Worker's connection to it: the Hyperdrive binding `PETROLEUM` (`apps/api/wrangler.jsonc`), in the same Worker as grain.
- The tracker: `docs/FEATURES_OIL_GAS.md`.
- Its map layers' records (`petro.map_layers`), since F-247; the code that handles them is shared.

**Still shared**

| Shared thing | Where | What it means for a split |
|---|---|---|
| Sign-in and membership | `gss-staging`'s Supabase Auth and `app.organization_members`; the Worker checks them, then sets the person, organization and role for the oil and gas database by `set_config` (F-247, `docs/DECISIONS.md`) | The new platform needs its own users. Today the oil and gas database trusts the Worker for who is asking |
| One Worker and one web app | `grain-trading-api-staging`; `apps/api/src/index.ts` mounts `/petroleum`, its public readiness route and Ask beside grain's routes; `apps/web/src/lib/router.tsx` shows the map at a host starting with `map.` **and at `/map` on any address**, the Worker's own `workers.dev` address included | A second Worker and web app. Moving the domain alone leaves the old map and its routes reachable. The map page also runs grain's follow-up count and incoming-call box (`App.tsx`); those stay behind |
| The map itself | `apps/web/src/components/FacilityMap.tsx` draws grain's five maps and the oil and gas page, and imports the oil and gas drawing code (land, wells, facilities, pipelines, rigs, geology, the grid) | Separated on both sides: a renderer without grain's pins there, without oil and gas here (4.7) |
| One domain package | `packages/domain/src/`, about 18,800 lines of code and 12,500 of tests, both sides mixed in one `@grain/domain` | Sorted file by file |
| The map-layer machinery | `apps/api/src/map-layers.ts`, `packages/domain/src/mapLayers.ts`, `apps/web/src/lib/mapLayers.ts` and `layerApi.ts`, the Settings screens | Copied; the two copies then differ |
| The database size limit | Both projects are in one Supabase organization on the free plan; loaders stop at 450 MB combined, and **sign in to grain's database to measure it** (`SUPABASE_STAGING_DB_URL` in every `load-*.yml`) | Grain's login must not follow the loaders; the new guard measures its own project only |
| CI, the Merge policy, deploys, data loads, the schedule | `.github/workflows/` (eleven `load-*.yml` workflows are oil and gas only); the Worker fetches the AER's lists on the schedule of grain's exchange rate (`apps/api/src/index.ts`, `scheduled`); three loads run by themselves: licence transfers daily, frac monthly, prices twice a month (`cron` in `load-licences.yml`, `load-frac.yml`, `load-prices.yml`) | Copied and cut down on each side; at cutover each scheduled job has one stated owner (4.4) |
| Keys and accounts | `MAPBOX_PUBLIC_TOKEN`, `ANTHROPIC_API_KEY`, `GEOCODIO_API_KEY` (Ask's place names), the Supabase address, publishable key and admin secret, `CLOUDFLARE_API_TOKEN` | New ones for the new platform, the Cloudflare token limited to the new Worker |
| One routes file, one database opener, one map page | `apps/api/src/petroleum.ts` imports every module; `petroleum-db.ts` opens every module's queries; `FullPageMap.tsx` holds every panel; `lib/gridMap.ts` names the wells', sales', facilities' and pipelines' layers | None can move whole in a first slice: each is rebuilt as a small frame that every slice adds its part to |

**Modules that read one another's tables or answers:** production reads the wells (`petro.st37_wells`), and its loader lists them; geology reads the wells and the formation grids, and its loader keeps only the wells near ours; operators reads the wells, facilities, pipelines and land agreements; land and land sales read each other's tables; the wells read the fields and pools, and their loader also reads Petrinex's Well Licence file; a well's royalty estimate needs its production, the prices **and its frac data** (`WellRoyalty.tsx`); Ask the map uses the settings of every panel. This sets the order of section 4.4.

**Records that cannot be fetched again:**

- the AER's daily licence and rig files **as they were captured** since 2026-11-19: when each was seen, and each versioned reading (`petro.aer_list_files` and the tables read from them). Part of their contents can be read again from the AER's ST1 and ST49 archives; the record of what was seen when cannot;
- licence transfers, worked out by comparing each day's three licence lists (wells, facilities, pipelines) with the day before (`load-licences.yml`, `packages/domain/src/licenceHolders.ts`). Carrying the history on needs the last holdings and the chain of loads too, not only the transfers found;
- the layers admins added, their sources, terms and defaults, and every change and removal with who made it (`petro.map_layers`, `petro.map_layer_history`);
- production months that leave the window Petrinex gives free: each load deletes all rows and reads from January of the fourth year back (`load-petrinex.yml`, `scripts/load-petrinex.js`). Nothing older is stored today as far as the repository shows; from January 2027 the months of 2022 would be deleted at the next load. If the owner wants months kept once loaded, the new loader must replace only the months it fetched;
- the land held on a past day: each load replaces the copy;
- the record of every load (the `*_loads` tables).

**Shipped with the app, not fetched:** the township outlines (`apps/web/public/grid/alberta-townships.json`, built by `scripts/build-township-grid.js`); only sections and finer squares are fetched live.

**Not to move:** `petro.wells` and its job (F-243 part 3), built and switched off; `petro.well_injection` and the Stettler wells, created and removed again.

**Size of the oil and gas side (approximate):** 7,700 lines of API code with 7,900 lines of tests; 2,550 lines of SQL; 6,200 lines of loader scripts and their tests; the map page, about 30 components and about 15 `lib` files on the web side; a share of the domain package.

**How it was built:** the light process started on 2026-11-19 with ivanmueller/gss#271. Pull requests #271 to #380, about 110 in six days, were merged without a Codex review, and most of them are oil and gas. The last strictly reviewed oil and gas work was F-247 part 2 (ivanmueller/gss#268): 23 review rounds without an approval, merged by the owner, with two findings still open (F-248).

## 3. What worries me

### 3.1 The data's terms, and the owner's permission

**The owner, 2026-11-26: "I have permission for data", so this "shouldn't be part of any of the decisions".** Permission is therefore not a gate, a risk or a decision in this plan. Revisions 1 to 4 treated it as the largest open risk, and revision 4 held every restricted feed out of the new project until a publisher answered; both are withdrawn on the owner's word, recorded in `docs/DECISIONS.md` (2026-11-26).

**What the record said before,** so the change is clear: the AER's and Petrinex's data and part of the price data were used on the owner's own reading, for a non-commercial side project shown to GSS staff, with the note "If the tool is ever sold or used in a company's business, consent is asked of Petrinex first" (`docs/DECISIONS.md`, 2026-11-19, 2026-11-20, 2026-11-23).

**What the permission covers (the owner, 2026-11-26):** people outside GSS, and downloading and exporting. So the new platform is not limited to GSS staff, and an export may be built; it does not exist today, so it is a new feature after the move, not part of it. Who gave the permission and when is not recorded here, and nothing of the permission itself goes into Git. Each screen keeps naming its source as today's does, which the publishers' pages ask for in any case: the source with its date, "preliminary, not an official version" on the AER's data, "Petrinex public data, © Government of Alberta", the open licence's attribution line.

**The feeds and what each is shown with** (from `docs/DECISIONS.md` and `docs/FEATURES_OIL_GAS.md`):

| Feed | Publisher | Shown with |
|---|---|---|
| Township grid: the outlines file and the live squares; Crown agreements, offset notices, non-Crown minerals; land sales; monthly reference price calculations | Government of Alberta | "Contains information licensed under the Open Government Licence – Alberta" |
| Gas reference price archive, oil par prices, information letters | Government of Alberta (`alberta.ca`) | The Government of Alberta as the source, unmodified, not an official version |
| Geological Framework (depths), Table of Formations, shale outlines, formation tops, Rock-Eval samples | Alberta Geological Survey | The Survey acknowledged as the source, its caveats kept |
| ST37 wells; ST103 fields and pools; ST1 daily licences and their archives; ST49 rigs and the monthly rig archives; the list of every licence used to place rigs; the three licence lists behind transfers; ST102 facilities; pipelines; frac summary data | Alberta Energy Regulator | The AER as the source with each file's date; preliminary, not an official version |
| Well Licence file (read by the wells' loader); Conventional Volumetric Data (monthly production) | Petrinex | "Petrinex public data, © Government of Alberta" |
| Layers admins added | each layer's own publisher | each layer's recorded source and terms |

**What this means for the build:**

- **One list of feeds in the code** holds each feed's publisher and source line, so every screen names its source the same way. It is not an access gate: who sees the platform is decided by the approved list (4.3).
- **Data stays out of Git,** logs, test fixtures and what CI keeps; tests use made-up records. The only data files shipped with the app are the open outlines (`public/`, which is served without sign-in).
- **Every other load starts from the wells.** The land, land sales, facilities and pipelines loads take their area from the wells' load (4.4).

### 3.2 Going back to the strict process as it was will stall again

The strict loop failed on F-247 part 2 because one large pull request reshaped shared code, and every round re-read all of it. F-251 recorded the fixes: small pull requests, focused re-reviews, five rounds run by themselves and more only with the owner's approval, with an earlier stop when a finding comes back or Claude and Codex disagree. The new repository starts with those rules, and with four tiers (Codex's finding 6 corrected my first three):

- **Governance** (workflows, the review scripts, `AGENTS.md`, the rules documents): a Codex review and the owner's approval of the exact commit, as today.
- **High risk** (design review before code, final review of the commit to be merged): the database, sign-in and permissions, **every Worker route, read-only ones too** (a route decides who sees data; this is today's policy, `scripts/review-register.js`), the loaders, every calculation, anything sent to another company's service.
- **Normal** (one final review): a screen that uses a data contract already reviewed.
- **Cosmetic** (CI and a look on staging, no Codex round): spacing and purely decorative styling. **Never cosmetic:** who may see something; what a page keeps or drops after sign-out; network or data loading; routes; source names and warnings; status colours and legend thresholds; units, rounding, money; export; keyboard access; a test that loosens a safeguard; deployment and policy.

**What the gate enforces and what stays a rule.** Setting `PROCESS = 'strict'` is not enough: by its path rules today a loader script or a calculation in the domain package counts as normal, and style sheets and tests as low (`scripts/review-register.js`). The first commit of the new repository changes those rules so that the gate itself treats as high risk: the database, the whole Worker, the loaders and their workflow, and the calculation modules of the domain package; and as at least normal: tests changed on their own, and the token files that carry status and legend colours. The "never cosmetic" list above is checked by Codex's final review, which names the tier it found.

Two more rules from the review. In a moving pull request the copied code is new to the new repository, so nothing in it can be set aside as "already there"; a security finding is never deferred. And loader workflows are governance: one reviewed, reusable loader workflow is built first, so that each data slice does not need the owner's approval of a new workflow file.

### 3.3 The oil and gas side has no specification

Grain has `MASTER_PROJECT_SPECIFICATION.md`. The oil and gas side grew request by request; `docs/FEATURES_OIL_GAS.md` is a history, not a description of the product. Before the first slice moves: a short specification (two or three pages): who uses it, what an analyst does with it in a session, **the smallest first release worth having**, which sources feed it under which terms, one company or several.

### 3.4 The free database plan is steering the engineering

Recent work went into fitting the data into shared room (F-310 and F-312: land "kept in less room"; loads limited to the box around the Duvernay). The product's stated goal is "all the data of an area in our own database, history included" (`docs/FEATURES_OIL_GAS.md`). That goal and a 500 MB limit shared with grain's real data do not fit together. Free projects also pause after a week idle and have no backups.

### 3.5 A code review does not check the data

Codex can tell whether a loader's code is sound, not whether a well's production for a month is the number Petrinex published. **Each data slice is released only when its reconciliation passes** (Codex's finding 7):

- **What is compared:** a fixed sample chosen to cover the awkward cases, plus totals and rules over the whole load. Wells: each status, wells with several legs, their paths. Production: several months, revised months, totals, missing told apart from zero, units. Land sales: sold, no offers, withdrawn, several tracts, exact money, rights. Pipelines: substance, status, lines crossing map squares. Everywhere: dates, duplicates, rows that matched nothing, rows refused, sudden changes in counts.
- **Against what:** the publisher's own file is the truth, followed from the file to the database to the API to the screen. Identifiers, dates and money must match exactly; a tolerance is allowed only for a stated conversion.
- **Written before the run:** the exact input files (with a digest where the terms allow keeping one), the publisher's edition or month, the day fetched, the area and filters, the loader's commit, the sample's identifiers, and the units, precision and any tolerance.
- **A load is shown only after it has passed** (revision 4). Today a loader commits its rows and the checks would come after; the wells and their field and pool names are even committed in two steps (`load-st37.yml`). In the new platform a load is written as a candidate that no screen shows, checked from the file through the API, then put in place in one step; a candidate that fails is dropped and the last good load stays. The same rule covers the Worker's own scheduled job and records copied from the old project. This is a change to how the loaders work, not a plain move: it is designed once, with the reusable loader workflow (3.2), and reviewed as high risk.
- **Recorded:** pass or fail, the version, and who approved; restricted files stay out of Git.
- **The analyst's comparison with another tool is a second opinion, not the truth:** other products define areas and corrections differently (the land-sale gap in `docs/DECISIONS.md`, 2026-11-21, is such a case). Known gaps go on the screen or in the release conditions.

Two loads, or a load and a deploy, must not overlap; today each workflow guards only itself. Keeping them apart is needed but does not replace the candidate rule above.

### 3.6 The documents have outgrown their purpose

`docs/HANDOFF.md` is described as short and is about 100 KB; single table cells in `docs/FEATURES_OIL_GAS.md` run to thousands of characters. Every session pays to read them. The new repository starts with short documents and a size check in CI, with history going to a changelog.

## 4. The proposed approach

### 4.1 The new repository

Private (recommended; to weigh against it: GitHub's included Actions minutes for private repositories, and whether its plan supports the branch protection, required checks and protected environment the Merge policy relies on, both read from GitHub's pages first).

| Taken as it is, then renamed | Taken in part, or rewritten | Left behind |
|---|---|---|
| The monorepo layout, `pnpm` workspace, strict TypeScript, ESLint and Prettier settings | `AGENTS.md` and `CLAUDE.md`: same structure and rules, grain's parts removed, the licence conditions and data rules added | `MASTER_PROJECT_SPECIFICATION.md`, `docs/TRADING_RULES.md`, `docs/ACCEPTANCE_TESTS.md`, `docs/BUILD_PLAN.md` |
| The review machinery, reviewed as one unit: `.claude/skills/codex-review/`, `scripts/review-gate.js` (with `PROCESS = 'strict'`), `review-register.js`, `review-approval.js`, `.claude/hooks/guard-merge.js`, `merge-policy.yml`, `policy-refresh.yml`, their tests, `docs/reviews/README.md`, `docs/AI_WORKFLOW.md` | **The Worker's base, in part:** the sign-in check, a narrow database connection and request context, error answers. `db.ts`, `respond.ts` and the Team page are not copied whole: they carry grain's queries, bindings, callbacks and email | Counterparties, quotes, freight, CRM, calls, email, summaries, grains: code, migrations and tests |
| Sign-in screens (`apps/web/src/auth/`), `components/ui/`, the token files, `lib/theme.ts` | A Team screen and a session of its own; the map renderer without grain's pins | `docs/HANDOFF_HISTORY.md`, `docs/CHANGELOG.md`, `docs/FEATURES_DONE.md` |
| CI, the deploy and Hyperdrive workflows, the browser-test setup, cut down | `docs/ARCHITECTURE.md`, `DATA_MODEL.md`, `API.md`, written from the code as each slice lands; a fresh, short `docs/FEATURES.md`; `docs/DECISIONS.md` (4.8); `docs/DESIGN_SYSTEM.md` (4.6) | The Demo data switch, unless the owner wants a demo mode |

Each copied file's origin (this repository and the commit) is recorded in the slice's pull request.

**Starting the gate** (revision 4). The first commit cannot be checked by a gate that does not exist yet, so it is handled by hand, once:

1. Claude prepares the seed on a branch: the skeleton, the review machinery with its tier rules changed as 3.2 says, `review-withdraw-auto.sh`, the hook and its wiring in `.claude/settings.json`, the two policy workflows, and their tests.
2. Codex reviews the seed against this repository's files at the tagged commit; the review is recorded in the seed's own register.
3. **The owner** approves that exact commit and puts it on the default branch himself. Nobody else can: the gate reads its rules from the default branch.
4. The owner turns on branch protection, both required checks, the approval labels and the protected `staging` environment.
5. A test pull request with its review evidence missing is shown to be blocked, and one with a changed migration. A gate that has not been seen to refuse is not relied on.

Only then does application code arrive. Also settled then: who provides each credential, who approves workflow changes, who runs each manual load, and that Claude and Codex can both read this repository at the tagged commit and the new one.

### 4.2 Infrastructure

| Thing | Today | New platform |
|---|---|---|
| Supabase | `petroleum-staging`, no users, same organization as grain, free plan | A new project in a **new Supabase organization**, holding sign-in and data; paid plan recommended, with backups (price read from Supabase's page first) |
| Worker | `grain-trading-api-staging` serves both | Its own Worker and Hyperdrive configuration. The same Cloudflare account shares the bill, limits and administrators; **its deploy token must not be able to change grain's Worker or connection**, settled before the first deploy |
| Address | `map.torvenco.com` is a custom domain of grain's Worker | Moved at cutover, or a new name (owner's choice) |
| Mapbox, Anthropic, Geocodio, Supabase keys | grain's | Its own, so cost, limits and access are separate |
| GitHub | repository and `staging` environment secrets here | Its own, in a `staging` environment limited to `main` from day one; no grain secret among them |
| Data that can be fetched again | in `petroleum-staging` | Loaded again by the reviewed loaders, each load's coverage and version recorded |
| Records that cannot be fetched again (section 2) | only in `petroleum-staging` | For each, the owner decides: carried over, kept in a closed archive, or let go. What is carried is copied by a reviewed script. Rows copied unchanged are compared one for one; rows whose organization or person IDs change are compared against the approved mapping of old IDs to new, since a plain checksum cannot match them. If months of production are carried or kept, the new production load replaces only the months it fetched |
| People | GSS's accounts in `gss-staging` | Approved people are invited again and set up their authenticator again; choices a browser remembered start over |

The old `petroleum-staging`, the `PETROLEUM` binding and the oil and gas code here stay as they are until the waiting period after cutover has passed (4.4). The old project is deleted only after a last export has been restored once, as a test.

### 4.3 The database and sign-in

- **One project for sign-in and data, and the database checks membership itself** (Codex's finding 3). The Worker verifies the session and the authenticator step and passes the person's ID for the transaction; **SQL then checks active membership and role in that same transaction.** This is grain's pattern, which already checks membership in SQL and trusts the Worker only for the ID (`app.is_active_member`). It replaces today's oil and gas arrangement, where the database trusts the Worker for the ID, the organization and the role (`apps/api/src/petroleum-db.ts`). Supabase's own Data API is kept away from the private schemas; the Worker, the loaders, migrations and account administration each get their own, narrower login.
- **Who gets in (the owner, 2026-11-26):** a new sign-in and an approved list, set up by the owner once the platform has moved. So the sign-in is built with the foundation, because the map must never be open to someone who has not signed in, and the owner is the only person on the list while the data moves. The owner then adds each approved person; nobody can sign themselves up.
- **Written down before sign-in is built:** invited, suspended and removed accounts; who may invite and administer; what happens when a check cannot be made (refused). The app today takes a person's first organization (`App.tsx`); if a person may belong to several, a chooser is designed now.
- **What belongs to whom:** reference data is the same for everyone where its terms allow, gated by active membership; settings, saved analyses and the audit record belong to an organization from the first migration.
- **Denial tests required:** signed out; a session from another project; no authenticator step; suspended; another company; a non-admin writing. Also after access is removed or the account changes: pooled connections, the Data API directly, map tiles, kept answers.
- **What the browser keeps.** Production, frac, well geology, prices and the 3D wells each keep answers by address or organization (`Production.tsx`, `WellFrac.tsx`, `WellGeology.tsx`, `WellRoyalty.tsx`, `Well3d.tsx`); only the general store is cleared at sign-out. In the new platform every kept answer is tied to the person and their access, dropped at sign-out, account change or refusal, and a late answer cannot put it back.
- **Ask the map** sends the typed words to Anthropic and place names to Geocodio. Before it ships: what is sent, how long each keeps it, and ceilings on rate and cost, reviewed on their own.
- **A new first migration, derived from the end state** (Codex's finding 5). All 26 old migrations are replayed in a throwaway database; each slice's schema is written from that result and compared with it: tables, roles, grants and default grants, policies, triggers, functions, indexes. The pgTAP and API database tests that apply are carried over; deliberate sign-in changes are listed. Kept from the end state: the compact land shapes (`path`, `rings`) and their checks, layer history and versions, the narrow grants. Left out: injection and Stettler data. **The new first migration is never run against the old database.** Each slice states what "ready" means for it, and the Worker and its loader check the same version; one green readiness light for everything is not enough for cutover.

### 4.4 Order of work

**Phase 0: before any code (owner and Claude).**

- Freeze new oil and gas features here at a tagged commit, with a date to look at the freeze again. Fixes to the old page continue, each recorded so it is carried across.
- What the owner's permission covers, written down (3.1); the specification with its smallest first release (3.3); the owner's decisions (section 6).
- Trials, with made-up records only: reading moved files' history at the tagged commit (4.8); the copy script for the records that cannot be fetched again (4.2); the replay of the 26 migrations (4.3). The copy of the real records is rehearsed later, against a separate instance of the new schema, after its design review and before anything is loaded into the real project.

**Phase 1: the foundation.** One reviewed pull request each: (a) the skeleton, CI, Merge policy and review machinery, then the gate shown to block (4.1); (b) the database baseline: organizations, members, roles, audit, their tests; (c) sign-in, the session, the Team screen (4.3); (d) the list of feeds with their source lines (3.1); (e) the reusable loader workflow (3.2); (f) deploy to the new Worker and project. End state: a person signs in and sees a plain page that says so; the map arrives in phase 2.

**Phase 2: the map base.** The page's frame, agreed with the owner (4.6); a renderer that works with any set of overlays missing; map styles; the township grid; the layer system with F-248's two open findings fixed and tested, and the admins' layers copied. Routes, queries and version checks exist only for what has landed. End state: an empty map with the grid and the layers.

**Phase 3: the data, in the order the code depends on it.** Each slice is its tables, loader, routes, panel, tests and reconciliation (3.5), moved as it is unless the review finds a fault, apart from the one change every loader gets (a load is shown only after it has passed, 3.5). A panel section or Ask action whose data has not landed stays switched off.

| # | Slice | Needs first | Publisher |
|---|---|---|---|
| 1 | Wells (ST37) **with** Petrinex's licence inputs and the AER's fields and pools; the well set and its bounds become stated, versioned inputs for later loads | Phases 1 and 2 | AER, Petrinex |
| 2 | Production by month | 1 | Petrinex |
| 3 | Land held and land sales: one slice, or storage in two and the shared screens held until both are in | **1**: both loads take their area from the wells' load and stop without it (`load-land.yml`, `load-land-sales.yml`) | Province |
| 4 | Facilities (ST102) | **1**, for the same reason (`load-facilities.yml`) | AER |
| 5 | Pipelines | **1**, for the same reason (`load-pipelines.yml`) | AER |
| 6 | Operators: search and colour across sources | 1, 3, 4, 5 | none of its own |
| 7 | The AER's daily lists and rigs, kept together where they share lookups; licence transfers and their history as a job of their own | Phase 2: they load from the AER's own lists without the wells | AER |
| 8 | Formation outlines and the Survey's grids as files (can go earlier, alone); then the grids loaded around the wells, geology in wells, the wells in 3D | the files: Phase 2; the rest: 1 | Geological Survey |
| 9 | Prices (can land alone) | Phase 2 | Province |
| 10 | Frac data: its load stands alone; its section of the well panel needs the wells | Phase 2 for the load, 1 for the panel | AER |
| 11 | The royalty estimate | 2, 9, 10 | none of its own |
| 12 | Ask the map | every panel | Anthropic, Geocodio (4.3) |

To move land, sales, facilities or pipelines before the wells, their area would have to be stated on its own instead of read from the wells' load, with the resulting coverage reconciled: a change, not a plain move.

**The first release** is the smallest set the specification names, proved from end to end with real sign-in, real loads and a passed reconciliation, before the remaining slices move. It tests the whole method while a change of course is still cheap. **With the owner's permission in hand it is wells, production and land** (slices 1 to 3), unless the specification names something else.

**Phase 4: the switch, with a way back.** In plain words: today `map.torvenco.com` opens the old map, served from this repository. On one chosen day that address is pointed at the new platform instead: **the switch.** If the new platform then turns out to have a fault, the address is pointed at the old map again: **going back.** That only works while the old map is still running, so the old one is kept alive, untouched, for a set time after the switch, and removed only when the owner says so. Until the switch, the new platform lives at an address of its own and nobody's daily work depends on it.

1. A restore from backup is tried on the new project; records, freshness and access are compared with the old page.
2. **The way back is tried before it is needed:** on a spare address, pointed at the new Worker, then back at the old one.
3. The final copy: builds pinned; the old side's loads and its twice-daily job paused **only while the copy runs**, so that it is consistent, then started again; the last good load of each feed recorded; sign-in, the certificate, Mapbox and the main paths checked on the new side.
4. `map.torvenco.com` moves. One named person decides; the conditions for going back and the date the old side is kept until are written down beforehand, with what happens to anything saved on the new side if we go back.
5. **A waiting period** (proposed: 14 days). **Who writes what** (revision 4): each side keeps capturing for itself and nothing is synchronized between them. The old side runs as before: its twice-daily AER job and its three scheduled loads (licences, frac, prices) keep the old database current, so going back loses no day. The new side runs its own jobs from the copied state. The old page is open only to today's GSS members. **If we go back:** the old side is already current; what exists only on the new side (layers admins changed, settings, anything saved) is listed during the period and entered again by hand on the old side, or let go, as the owner decided beforehand.
6. After it, on the owner's word: the old `/map`, the old `/petroleum` routes on grain's addresses and the old credentials are retired (4.7). Going back is then no longer possible without rebuilding.

**New features (waterflood, type curves, other formations) wait until phase 3 is done,** or are added as their own slices under the strict process, never in the old place.

How long this takes depends mostly on Codex's usage limit: about 25 reviewed pull requests, most of them high risk.

### 4.5 The review process in the new repository

As `docs/AI_WORKFLOW.md` §11.5 and §11.6 describe it, with the tiers and rules of 3.2, the reconciliation of 3.5, each moving pull request naming the commit it took its files from, and one stated rule per screen for what it keeps from the server, written before the first review.

### 4.6 Design, layout and tokens

- **Agree the frame early** (Codex's finding 8): navigation, where Team and Settings live, and how panels sit around the map, before the first panel moves. Panels then move into it unchanged. The full redesign comes after the first release has proved the move.
- **Keep for a faithful move:** the order of layers, which thing a click picks first, what each colour means, source lines.
- **Keep the three-layer token system** (`palette.css` → `themes.css` → `scales.css`), `components/ui/` and the contrast tests.
- **Map roles, as their own slice.** The overlays' colours are hex values in `st37Map.ts`, `landMap.ts`, `landSalesMap.ts`, `pipelinesMap.ts`, `operatorColours.ts` and `geologyMap.ts`; the base map already reads roles, the map page is forced light, and satellite already has darker variants. Paint, legend swatch and drawing get one named role each, tested on both base maps, across zooms, for contrast, and with each colour still tied to its status, scale or class.
- **Grain's roles** (`bid`, `offer`, `grain-*`) are removed only after the renderer no longer draws grain's pins, which use them.

### 4.7 Grain after the split

Two pull requests (Codex's finding 9), because grain's own maps run through the shared renderer:

1. **Before cutover: separate the renderer.** `FacilityMap.tsx` stops importing the oil and gas drawing code, with grain's Workspace, Counterparties, company, lanes and freight maps tested unchanged (pins, styles, layer files, ArcGIS imports, overviews). Small, reviewed, and safe to merge while the old map page still works through its own entry: the old page's tests stay and keep running until the retirement, and grain's layer access and its "still a member?" re-check are tested after the split (`apps/web/src/lib/layerApi.ts`).
2. **After the waiting period: the retirement.** Removed: the `/petroleum` routes, the oil and gas components, `lib` files, domain exports, generated files and build scripts, tests and fixtures; the eleven `load-*.yml` workflows; the `PETROLEUM` binding and the Hyperdrive setup's `petroleum` choice with its tests; CI's second database and its jobs; the deploy's migration step and readiness call; the routing tests that expect both sides; **only** the AER call from the shared schedule (the exchange rate, calls and email keep theirs); only the oil and gas secrets. Decided with the owner: where an old `/map` bookmark leads; `/map/coordinates` is kept. README and rules updated. Tested after: sign-in, the Workspace, every grain map, Team, the exchange rate, calls and email schedules.

**The oil and gas migrations are not deleted.** The Merge policy refuses any pull request that removes a migration under either database's folder (`scripts/review-gate.js`, `DATABASE_ROOTS` in `scripts/review-register.js`), under the light process too. `petroleum/supabase/` stays as a closed record with a note that nothing applies it. The alternative, an owner-approved rule that lets that one database be retired, is possible but not worth it for 26 files.

**How the retirement is held** (revision 4). It changes workflows, so it should have a Codex review and the owner's approval of the exact commit. Under grain's light process the gate does not hold a governance change for that approval (`mergeDecision` in `scripts/review-gate.js`). So one of two, the owner's choice: grain is back on the strict process before the retirement, and the gate holds it; or the pull request stays a draft, which GitHub will not merge, until Codex's approval is in its register, and the owner then marks it ready and merges it himself. Claude does not start an automatic merge for it either way.

Whether grain returns to the strict process is a separate decision; it holds the business's real data, calls and email, so I would use the same tiers there.

### 4.8 Keeping the history

- **The code's history.** The new main branch starts fresh. This repository's history holds why each thing was built and 40 review registers. **It is kept here:** this repository stays, with the freeze commit tagged, and every moving pull request names the files and the commit it took them from. That is enough for a reviewer to compare. A second copy inside the new repository is the owner's option, not part of the plan: it would put grain's code and history into the new repository, a tag can be moved or deleted unless it is protected, and the review guarantee would still cover only the branch that deploys.
- **The records:** section 4.2.
- **The decisions.** Every oil and gas entry of `docs/DECISIONS.md` is copied whole, with its date; the licence conditions are in those words.

## 5. Alternatives considered

- **Stay in one repository, with stricter rules for the oil and gas folders.** Rejected: different users, data rules and review standard; one Worker and one sign-in keep them tied; grain's real data stays exposed to faults in fast-moving code.
- **Copy everything across at once, then audit it in place.** Rejected, and no longer kept as a fallback for a live site: blocking new features does not stop an unreviewed route from serving people (Codex). If everything must be wired together to understand how it hangs together, that is done as a **closed reference build**: made-up data, no live credentials, no users; each capability is still reviewed before it enters the branch that deploys.
- **Rewrite the Git history to the oil and gas files only and build on it.** Rejected: it brings all the unreviewed code onto the main branch at once (4.8 keeps the history instead).
- **A shared package used by both repositories.** Rejected: versioning work with no benefit for one small team.

## 6. Decisions

**Answered by the owner (2026-11-26)**

- **Data permission:** held; not a gate and not a decision. It covers people outside GSS, downloads and exports (3.1).
- **No connection to GSS.** The new platform is its own thing: its own name, sign-in, database and keys, and nothing shared once the old version is disconnected. The rule "the platform only ever serves GSS staff" (`AGENTS.md`) is not carried over.
- **Who may use it:** people on an approved list, through a new sign-in the owner sets up once the platform has moved (4.3).
- **Organizations:** people will most likely have their own, "but this isn't a big priority for now". So the organization boundary is kept in the database from the first day, because the foundation already has it and adding it later is costly; everyone starts in one organization; choosing between organizations and companies managing their own people are designed when wanted.
- **The order:** "migrate all the code over, get it running, and then we will disconnect the old version which is in GSS."

**Still open.** Where Claude has a recommendation it is given; costs and business choices are the owner's alone.

*How the code moves: the one that shapes the rest*

0. Both ways end the same: the code in its own repository, reviewed by Codex, running, the old version disconnected. They differ in when it runs and when it is reviewed.
   - **A. Piece by piece** (section 4.4 as written): each part is reviewed before it enters the new repository. Nothing unreviewed is ever there. The map is complete only at the end, after about 25 pull requests, and the map page and the routes file have to be rebuilt as frames that each piece is added to.
   - **B. All at once, then reviewed in place** (the owner's order): the reviewed foundation first (sign-in, the approved list, the review gate), then all the oil and gas code copied across in one step and got running, **with the owner as the only person signed in.** Codex then reviews it module by module where it stands, and the faults are fixed. Two locks hold until every module is marked reviewed: nobody else is added to the approved list, and the old version is not disconnected.
   - **Claude's recommendation: B.** Section 5 rejected copying everything at once because unreviewed code could serve other people and "we will audit it later" is how the present state arose. The owner's answers change the first: he is the only user until he adds others. The two locks answer the second: the audit cannot be skipped without the platform staying a one-person tool. B reaches a running platform sooner, needs no rebuilding of the frames, and lets the old database be copied as it is. Its cost: until the audit is done, the new repository holds code no one has reviewed, as this one does today.
   - If B is chosen, sections 4.3 to 4.5 are rewritten for it and Codex reviews that rewrite.

*The switch (explained in 4.4, phase 4)*

1. Who says "switch now", and who says "go back"? (Proposed: the owner, both.)
2. How long is the old map kept running after the switch, so that going back stays possible? (Proposed: 14 days.) If we do go back, is what was saved only on the new side entered again by hand, or let go?
3. With no connection to GSS: what is the new platform called, and at which address? Does it get accounts of its own (GitHub, Cloudflare, Supabase, Mapbox), or stay under the ones that hold GSS today?

*People and use*

4. Who gave the permission and when, in a line per publisher, for the record (nothing of it is committed)?

*What is kept*

7. Which stored records matter (section 2: the AER's daily files as captured, the licence-transfer history, the layers admins added and their history)? For each: carry over, or let go.
8. Should production months be kept once loaded, beyond the years Petrinex gives free? (Recommended: yes.)

*Money and setup*

9. A paid Supabase plan in a new Supabase organization, with backups? (Recommended; the price is read from Supabase's page first.) A monthly budget for hosting, maps and Ask?
10. A private repository? (Recommended.)
11. You put the first commit of the new repository in place and switch on its protections yourself, with exact click paths from Claude (4.1)? (Needed: nobody else can.)

*Process and design*

12. Stop adding oil and gas features here until the slices have moved, with fixes still allowed? (Recommended.)
13. The four review tiers of 3.2, or a Codex review on every pull request as before? (Recommended: the tiers.)
14. Is the new layout settled enough to agree the page's frame now (4.6)?
15. The old oil and gas migrations stay here as a closed record (4.7)? (Recommended: yes.)
16. Grain's process after the split: light as now, or the same tiers? For the removal of the oil and gas side itself: strict again beforehand, or a draft the owner merges by hand (4.7)?

## 7. Codex's review

**Round 1 (2026-11-25, at `efc4bce`): sound with changes.** Nine findings, all accepted. Claude checked the cited code for each row marked "seen" and it was as Codex said.

| # | Codex's finding | Checked | Changed in |
|---|---|---|---|
| 1 (P1) | Rights cleared feed by feed; prices mixed; offset notices state no terms; a private repository does not control the data | seen: `docs/DECISIONS.md` | 3.1, section 6 |
| 2 (P1) | Irreplaceable records carried over; the way back rehearsed; old addresses still serve the map after the domain moves | seen: `load-petrinex.yml` (rolling window, rows deleted), `load-licences.yml`, `router.tsx` | 2, 4.2, 4.4 phase 4, section 6 |
| 3 (P1) | The trust boundary designed before sign-in; the database checks membership; kept answers scoped to the person; Ask's outside services | seen: `App.tsx` (first organization), `WellRoyalty.tsx` (answers kept by organization) | 4.3 |
| 4 (P2) | Shared map and API rebuilt for step-by-step delivery; base files not copied whole; order by dependency; a first release; the fallback unsafe | seen: `gridMap.ts`, `WellRoyalty.tsx` (needs frac), `FacilityMap.tsx` | 2, 4.1, 4.4, 5 |
| 5 (P2) | The new baseline compared with the result of all 26 migrations; never an upgrade of the old database; readiness per slice | accepted on Codex's evidence | 4.3 |
| 6 (P2) | Governance above the tiers; every Worker route high risk; what is never cosmetic; the gate proved before code; one reusable loader workflow | seen: `scripts/review-register.js` (the whole Worker is high risk) | 3.2, 4.1 |
| 7 (P2) | Reconciliation as a release check with pinned inputs; the publisher is the truth; loads must not overlap | accepted on Codex's evidence | 3.5 |
| 8 (P2) | Map behaviour kept, the frame settled early, redesign after proof; map roles | seen: hex values in the `lib` map files | 4.6 |
| 9 (P2) | Grain's cleanup is a compatibility change: the renderer separated first; migrations cannot be deleted | seen: `FacilityMap.tsx` imports, `scripts/review-gate.js` | 4.7 |

**Facts Codex corrected, now fixed in section 2:** the oil and gas database is not "public reference data only"; the township outlines ship with the app; the domain package's 31,000 lines include about 12,500 of tests; `/map` works on any address; the loaders sign in to grain's database; Geocodio, the Supabase keys and the sign-in admin secret are shared too; the royalty estimate needs frac data; the price data is only partly open.

**Round 2 (2026-11-26, on revision 3 at `dc0dce4`): sound with changes, approval pending.** Findings 3, 5 and 8 resolved; six partly. Each point was checked in the code and was as Codex said.

| # | What was still open | Checked | Changed in revision 4 |
|---|---|---|---|
| 1 | 3.1 let GSS load restricted feeds into the new project while 1.7 forbade it; three AER feeds not named | seen: `licenceHolders.ts` (three lists) | One rule in 3.1; the inventory;, section 6 |
| 2 | A plain checksum cannot match rows whose IDs change; no word on which side writes after the final copy; "paused" against "untouched" | seen: `cron` in three load workflows | 2, 4.2, 4.4 phase 4 |
| 3 | Resolved; grain's pattern described wrongly; 3D wells missing from the kept answers | seen: `app.is_active_member`, `Well3d.tsx` | 4.3 |
| 4 | Land, sales, facilities and pipelines need the wells' load; daily lists, rigs, transfers and frac do not; phase 1 promised a map it does not build | seen: `st37_loads` read in all four workflows, none in licences or frac | 4.4, 3.1 |
| 6 | Who starts the gate; strict mode alone leaves loaders and calculations "normal"; "five rounds at most" misread F-251 | seen: `fileTier` rules, `docs/AI_WORKFLOW.md` §11.5 | 3.2, 4.1 |
| 7 | Loads commit before they are checked; inputs and tolerances fixed beforehand | seen: `load-st37.yml` (two commits), `load-petrinex.js` | 3.5 |
| 9 | The old page tested until retirement; the retirement not held under the light process | seen: `mergeDecision` | 4.7, section 6 |
| — | A release without wells promised too much; the history copy an extra choice; trials with real records | seen: `load-prices.js` (needs the gas archive), `wrangler.jsonc` | 3.1, 4.8, 4.4 phase 0 |

**Superseded by the owner (2026-11-26):** finding 1 of both rounds, on permission. Codex asked that rights be cleared feed by feed before any restricted feed entered the new project, and revision 4 made that its rule. The owner states he holds permission, so the rule and the per-feed access check are withdrawn (3.1). What remains of the finding: the feed inventory, the source lines, and writing down what the permission covers. The parts of round 2's last row about a release without wells no longer apply.

**Next:** the owner's answers to what is still open in section 6; a third Codex round only on what those answers change. Codex's own file (`docs/reviews/F-313-plan-review.md`) is on the owner's computer and was pasted into the chat; it is not committed here.
