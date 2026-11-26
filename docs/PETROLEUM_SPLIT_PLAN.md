# Splitting the oil and gas side into its own platform: proposal (F-313)

**Status:** a proposal for the owner's decision. Nothing here is built or decided. Written by Claude on 2026-11-25 against `main` at `1e1d1bf` (ivanmueller/gss#380). Asked by the owner on 2026-11-25: separate the two sides completely; the oil and gas side becomes its own repository, built and reviewed under the strict Claude + Codex process again; grain stays here as its own thing.

**Revision 8 (2026-11-26): the method changed, on the owner's "go".** The repository is duplicated whole and grain is stripped out of the copy; the platform is got running with the owner as the only person signed in; Codex then reviews the data layer section by section where it stands; the screens are redesigned after that, not audited. Sections 1, 4, 5 and 6 are rewritten for this; sections 2 and 3 stand. This sets aside Codex's advice to keep the piece-by-piece move, for the reasons in 4.1, so a third Codex round on section 4 is asked for (section 7). Earlier: revision 7 (eight sections moved piece by piece) was merged as ivanmueller/gss#382; revisions 5 and 6 recorded the owner's answers; revisions 3 and 4 took in Codex's two reviews.

## 1. The recommendation in short

1. **Duplicate, then strip.** This repository is copied whole, with its history, into a new private repository, and grain is removed from the copy. The code stays wired as it works today, so little can break on the way.
2. **The working setup is in place from the first day:** the rules and commands, the way Claude and Codex work together, and the design files come with the copy; the first change rewrites the rules for the new platform and switches the strict review on.
3. **Its own home:** one new Supabase project for sign-in and data, one Worker, its own keys, under the owner's same accounts. No connection to GSS.
4. **Running first, with one person signed in:** the owner. Nobody else can be added until the review below is done.
5. **Codex's strict review goes on what lasts:** sign-in, the database, the loaders, the checks against the publishers' own files, the calculations. Seven sections, reviewed where they stand, faults fixed in small pull requests.
6. **The screens are not audited; they are redesigned,** after the transfer, and each rebuilt screen is reviewed as new code.
7. **The old version in GSS is disconnected last,** on the owner's word. Nothing switches over: the new platform has its own address from the start.

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
| CI, the Merge policy, deploys, data loads, the schedule | `.github/workflows/` (eleven `load-*.yml` workflows are oil and gas only); the Worker fetches the AER's lists on the schedule of grain's exchange rate (`apps/api/src/index.ts`, `scheduled`); three loads run by themselves: licence transfers daily, frac monthly, prices twice a month (`cron` in `load-licences.yml`, `load-frac.yml`, `load-prices.yml`) | Come with the copy and are cut down in the strip; the scheduled ones are switched off in the first push and back on one at a time (4.2) |
| Keys and accounts | `MAPBOX_PUBLIC_TOKEN`, `ANTHROPIC_API_KEY`, `GEOCODIO_API_KEY` (Ask's place names), the Supabase address, publishable key and admin secret, `CLOUDFLARE_API_TOKEN` | New ones for the new platform, the Cloudflare token limited to the new Worker |
| One routes file, one database opener, one map page | `apps/api/src/petroleum.ts` imports every module; `petroleum-db.ts` opens every module's queries; `FullPageMap.tsx` holds every panel; `lib/gridMap.ts` names the wells', sales', facilities' and pipelines' layers | Come across whole with the copy and keep working as they are; grain's parts are cut out of them in the strip (4.2) |

**Modules that read one another's tables or answers:** production reads the wells (`petro.st37_wells`), and its loader lists them; geology reads the wells and the formation grids, and its loader keeps only the wells near ours; operators reads the wells, facilities, pipelines and land agreements; land and land sales read each other's tables; the wells read the fields and pools, and their loader also reads Petrinex's Well Licence file; a well's royalty estimate needs its production, the prices **and its frac data** (`WellRoyalty.tsx`); Ask the map uses the settings of every panel. This sets the order of the review sections (4.2).

**Records that cannot be fetched again:**

- the AER's daily licence and rig files **as they were captured** since 2026-11-19: when each was seen, and each versioned reading (`petro.aer_list_files` and the tables read from them). Part of their contents can be read again from the AER's ST1 and ST49 archives; the record of what was seen when cannot;
- licence transfers, worked out by comparing each day's three licence lists (wells, facilities, pipelines) with the day before (`load-licences.yml`, `packages/domain/src/licenceHolders.ts`). Carrying the history on needs the last holdings and the chain of loads too, not only the transfers found;
- the layers admins added, their sources, terms and defaults, and every change and removal with who made it (`petro.map_layers`, `petro.map_layer_history`);
- production months that leave the window Petrinex gives free: each load deletes all rows and reads from January of the fourth year back (`load-petrinex.yml`, `scripts/load-petrinex.js`). Nothing older is stored today as far as the repository shows; from January 2027 the months of 2022 would be deleted at the next load. If the owner wants months kept once loaded, the new loader must replace only the months it fetched;
- the land held on a past day: each load replaces the copy;
- the record of every load (the `*_loads` tables).

**Shipped with the app, not fetched:** the township outlines (`apps/web/public/grid/alberta-townships.json`, built by `scripts/build-township-grid.js`); only sections and finer squares are fetched live.

**Removed in the strip, with grain:** `petro.wells` and its job (F-243 part 3), built and switched off; `petro.well_injection` and the Stettler wells, created and removed again.

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

- **One list of feeds in the code** holds each feed's publisher and source line, so every screen names its source the same way. It is not an access gate: who sees the platform is decided by the approved list (4.4).
- **Data stays out of Git,** logs, test fixtures and what CI keeps; tests use made-up records. The only data files shipped with the app are the open outlines (`public/`, which is served without sign-in).
- **Every other load starts from the wells.** The land, land sales, facilities and pipelines loads take their area from the wells' load, which is why the wells are reviewed before them (4.2).

### 3.2 Going back to the strict process as it was will stall again

The strict loop failed on F-247 part 2 because one large pull request reshaped shared code, and every round re-read all of it. F-251 recorded the fixes: small pull requests, focused re-reviews, five rounds run by themselves and more only with the owner's approval, with an earlier stop when a finding comes back or Claude and Codex disagree. The new repository starts with those rules, and with four tiers (Codex's finding 6 corrected my first three):

- **Governance** (workflows, the review scripts, `AGENTS.md`, the rules documents): a Codex review and the owner's approval of the exact commit, as today.
- **High risk** (design review before code, final review of the commit to be merged): the database, sign-in and permissions, **every Worker route, read-only ones too** (a route decides who sees data; this is today's policy, `scripts/review-register.js`), the loaders, every calculation, anything sent to another company's service.
- **Normal** (one final review): a screen that uses a data contract already reviewed.
- **Cosmetic** (CI and a look on staging, no Codex round): spacing and purely decorative styling. **Never cosmetic:** who may see something; what a page keeps or drops after sign-out; network or data loading; routes; source names and warnings; status colours and legend thresholds; units, rounding, money; export; keyboard access; a test that loosens a safeguard; deployment and policy.

**What the gate enforces and what stays a rule.** Setting `PROCESS = 'strict'` is not enough: by its path rules today a loader script or a calculation in the domain package counts as normal, and style sheets and tests as low (`scripts/review-register.js`). The first commit of the new repository changes those rules so that the gate itself treats as high risk: the database, the whole Worker, the loaders and their workflow, and the calculation modules of the domain package; and as at least normal: tests changed on their own, and the token files that carry status and legend colours. The "never cosmetic" list above is checked by Codex's final review, which names the tier it found.

Two more rules from the review. Everything in the copy counts as unreviewed until its section's review is done, so nothing in the data layer can be set aside as "already there"; a security finding is never deferred. And loader workflows are governance: one reviewed, reusable loader workflow is built first, so that each loader does not need the owner's approval of a new workflow file.

### 3.3 The oil and gas side has no specification

Grain has `MASTER_PROJECT_SPECIFICATION.md`. The oil and gas side grew request by request; `docs/FEATURES_OIL_GAS.md` is a history, not a description of the product. Before the redesign (the transfer itself needs none, since it changes nothing a person sees): a short specification (two or three pages): who uses it, what an analyst does with it in a session, **what approved people should find on their first day**, which sources feed it under which terms, one company or several.

### 3.4 The free database plan is steering the engineering

Recent work went into fitting the data into shared room (F-310 and F-312: land "kept in less room"; loads limited to the box around the Duvernay). The product's stated goal is "all the data of an area in our own database, history included" (`docs/FEATURES_OIL_GAS.md`). That goal and a 500 MB limit shared with grain's real data do not fit together. Free projects also pause after a week idle and have no backups.

### 3.5 A code review does not check the data

Codex can tell whether a loader's code is sound, not whether a well's production for a month is the number Petrinex published. **A section's review is finished only when its data has passed reconciliation** (Codex's finding 7):

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

### 4.1 The method: duplicate, strip, run, then review in place

**Chosen by the owner on 2026-11-26 ("go"), on Claude's recommendation.** Revision 7 moved the code piece by piece, each piece reviewed before it entered. That guarantees nothing unreviewed is ever in the new repository, at the price of about 17 careful reviews spent re-creating a prototype, its screens included, when the owner means to redesign those screens. For a platform meant to stand beside Enverus and AccuMap, the lasting value is the data: the loaders that read each government source correctly, the calculations, and the database behind them. So the code is copied as it works, and the strict review is spent on the data layer.

**What makes this safe.** Section 5 of the earlier revisions, and Codex, rejected copying everything at once for two reasons: unreviewed code could serve other people, and "we will audit it later" is how the present state arose. Two locks answer them:

1. **Nobody but the owner can be signed in** until every review section of 4.2 is marked reviewed. This is a setting in the code, not a promise: adding a person is refused while it is on, and switching it off is a governance change that needs the owner's approval of the exact commit.
2. **The old version in GSS is not disconnected** until then either.

The cost, stated plainly: until the review is done, the new repository holds code no one has reviewed, as this one does today.

### 4.2 The steps

**Step 0: before any code (the owner).** A working name. An empty private repository (click path in the chat). New oil and gas features stop here at a tagged commit; fixes continue and are carried across. The decisions of section 6.

**Step 1: the copy and the working setup.**

1. Claude pushes this repository at the tagged commit, with its history, into the new one, with one commit on top that switches off every workflow that deploys, loads data or sets up a database connection. So the first push runs nothing against anything; the new repository has no secrets yet in any case. CI stays on.
2. The first pull request, reviewed by Codex and merged by the owner himself: `AGENTS.md`, `CLAUDE.md` and `/start` rewritten for the new platform (no GSS, no grain, the data rules of 3.1); the process set to strict with the tier rules of 3.2; the review runner given an **audit** mode, which reads a section's files as they stand instead of a change; fresh, short `docs/FEATURES.md` and `docs/HANDOFF.md` with the review tracker; the oil and gas entries of `docs/DECISIONS.md` kept whole.
3. The owner turns on branch protection, both required checks and the approval labels. A test pull request with its review evidence missing is shown to be blocked.

*Done when:* a session opened with `/start` works under the new rules, a Codex review runs, and the gate has been seen to refuse. The design files (`apps/web/src/styles/`, `components/ui/`, `docs/DESIGN_SYSTEM.md`) are there unchanged, because they came with the copy.

**Step 2: strip grain.** Three pull requests, each reviewed by Codex. Removing code is easier to check than re-creating it: the compiler and the tests show what a deletion broke.

1. **The web app:** grain's pages, components and `lib` files go; the app becomes sign-in, the map page and Team; the shared map code (`FacilityMap.tsx`) loses grain's pins; the map page loses grain's follow-up count and call box.
2. **The Worker and the domain package:** grain's routes, calling, email, exchange rate and summaries go, with their scheduled jobs and bindings; `db.ts`, `respond.ts` and `index.ts` are narrowed to what the oil and gas side uses; the packages are renamed from `@grain/…`.
3. **The database folders:** `supabase/` is cut down to the few migrations that create accounts: the schema and its role, organizations and members, the audit record, member management (about five of the 74; the exact list in this step's plan). Removing the others is allowed this once, in an owner-approved pull request, because no database of the new platform has ever run them. `petroleum/supabase/` keeps its 26 migrations untouched. Tests are cut to match.

*Done when:* `pnpm check`, the database tests and the browser tests pass, and the map page works on a local database with made-up records.

**Step 3: its own home, and running.**

1. **One new Supabase project** holds sign-in and both schemas: `app` (accounts) and `petro` (the data). One new migration makes the oil and gas schema check membership itself, in SQL, against the accounts in the same database, instead of trusting what the Worker tells it (4.4).
2. **The data comes across whole:** the old `petroleum-staging` is copied into the new project (a dump and a restore, tried first on a local database). That brings the records no loader can fetch again (section 2) without any special handling. The few rows that name an organization or a person (the admins' layers and their history) are pointed at the new accounts by a stated mapping.
3. **One new Worker** with its own database connection and keys (4.3). The loaders stop reading grain's database for the size check. The workflows are switched back on one at a time.
4. **The lock on adding people** (4.1) is on from the first deploy.

*Done when:* the owner signs in at the new address and sees today's map with today's data. Nobody else can.

**Step 4: Codex reviews the data layer, in seven sections, where it stands.**

| # | Section | What Codex reads |
|---|---|---|
| A | Sign-in and access | The sign-in check, membership in SQL, the lock, what the browser keeps after sign-out (4.4) |
| B | Wells and production | The ST37, fields and pools, and Petrinex loaders; their tables and routes; the production charts' numbers |
| C | Land | Land held and land sales: loaders, tables, routes, the reading of rights |
| D | Facilities, pipelines, operators | Their loaders, tables and routes; the operator search across sources |
| E | The AER's daily lists | The twice-daily job, rigs, licence locations, licence transfers and their history |
| F | Geology, prices, frac, royalties | The loaders, and every formula: the royalty estimate, maturity, unit conversions |
| G | Layers and Ask the map | The layer system (F-248's two open findings fixed); what Ask sends to Anthropic and Geocodio, with ceilings on rate and cost |

For each section: Codex audits the files as they stand; every confirmed finding is fixed in a small pull request, itself reviewed as a change; the section's data passes reconciliation against the publisher's own files (3.5); the tracker then records "reviewed at commit …". The rule that a load is shown only after it has passed its checks (3.5) is built in section B and used by every later one. Section A goes first; B before C and D, which read the wells; the rest in the owner's order.

**The screens are not audited,** apart from what bears on safety: what a page keeps after sign-out, and each source line. They are replaced in step 6.

*Done when:* A to G are marked reviewed. The lock of 4.1 can then be lifted, by the owner.

**Step 5: the data made fit for a product** (the owner's decisions, section 6): all of Alberta instead of one formation's box; months of production kept once loaded; the limits that came from the free plan removed. Each is built on a loader that has already been reviewed, as its own reviewed change.

**Step 6: the redesign.** A short specification (3.3), then the new design agreed with the owner: the page's frame, the tokens' values, the components. The screens are then rebuilt in it one section at a time, each reviewed as new code; an old screen stays as the working reference until its replacement is in (4.6).

**Step 7: people.** The owner adds approved people, after step 4 at the earliest; whether before or after the redesign is his choice.

**Step 8: the old version is disconnected.** Nothing switches over: the new platform has had its own address since step 3, and the old map stays as it is until the owner says so. Then this repository is cleaned (4.7).

### 4.3 Infrastructure

| Thing | Today | New platform |
|---|---|---|
| Repository | this one, public | A new private one under the owner's same GitHub account, holding the copy with its history |
| Supabase | `gss-staging` for sign-in, `petroleum-staging` for data, one organization, free plan | One new project for both, under the owner's same Supabase login but in a **new organization** there (that is how Supabase separates plans and size limits); a paid plan with backups recommended (price read from Supabase's page first) |
| Hosting | `grain-trading-api-staging`, one Worker serving the app and the API | **One Worker of its own, in the same Cloudflare account.** The owner thought of Cloudflare Pages to start; Claude recommends the Worker, because the code is built for it (the API, the twice-daily job, the database connection) and Pages would mean rewiring those; what Pages can do is read from Cloudflare's own page before this is settled. Its deploy token must not be able to change grain's Worker |
| Address | `map.torvenco.com`, a custom domain of grain's Worker | No name yet. The Worker's free `workers.dev` address until there is one; a domain is added later with no code change |
| Keys | grain's Mapbox token, Anthropic key, Geocodio key, Supabase keys | Its own of each, so cost, limits and access are separate; no grain secret ever enters the new repository |
| Data | in `petroleum-staging` | Copied whole (4.2, step 3); loaded again from the sources only where the copy fails |

### 4.4 The database and sign-in

- **One database, two schemas, the migrations kept as they are.** Nothing is rewritten into a new first migration, so nothing the old migrations protect can be lost in a rewrite (Codex's finding 5 was about that risk; it no longer arises). The accounts' migrations and the 26 oil and gas ones are applied to the new project in their order.
- **The database checks membership itself.** Today the oil and gas database trusts the Worker for the person, the organization and the role. In the new project the accounts are in the same database, so one new migration makes SQL check active membership and role in the same transaction, the Worker supplying only the verified person's ID, as grain's own schema already does (`app.is_active_member`). High risk; reviewed before step 3 deploys, and again as section A.
- **Who gets in:** a new sign-in and an approved list. The owner is the only person while the lock is on; afterwards he adds each approved person; nobody can sign themselves up.
- **Organizations:** the boundary is already in the accounts' schema and is kept; everyone starts in one organization. Choosing between organizations, and companies managing their own people, are designed when wanted (the owner: "not a big priority for now").
- **What the browser keeps:** production, frac, well geology, prices and the 3D wells each keep answers by address or organization, and only the general store is cleared at sign-out (`Production.tsx`, `WellFrac.tsx`, `WellGeology.tsx`, `WellRoyalty.tsx`, `Well3d.tsx`). Fixed in section A: every kept answer is tied to the person, dropped at sign-out, and a late answer cannot put it back. With one person signed in until then, the fault cannot show itself before it is fixed.
- **Denial tests,** in section A: signed out; a session from another project; no authenticator step; suspended; another organization; a non-admin writing; and after access is removed: pooled connections, Supabase's own Data API, map tiles, kept answers.

### 4.5 The review process in the new repository

As `docs/AI_WORKFLOW.md` §11.5 and §11.6 describe it, with the four tiers and the gate's rules of 3.2, and:

- **An audit is a review of what stands, not of a change.** The runner's new mode reads a section's files at one commit; its findings go into that section's register (`docs/reviews/AUDIT-A.md` to `AUDIT-G.md`) and are triaged as any finding is. Each fix is an ordinary pull request under the usual rules.
- **The tracker** in `docs/FEATURES.md` lists the seven sections: not reviewed, in review, or reviewed at a named commit. The lock of 4.1 reads from it.
- **A section is not "reviewed" on Codex's word alone:** its reconciliation must have passed (3.5) and the owner must have seen it.
- **New work** (steps 5 and 6) goes through the strict process in full: a design review before code where the tier asks for one.

### 4.6 Design, layout and tokens

- **After the transfer** (the owner asked whether to redesign at the start or once the current version is across). Three reasons: moving and redesigning together means two unknowns at once, so a fault cannot be told from an intention; the design needs the platform running with real data in its panels; and it should follow what an analyst does in a session, which the specification (3.3) will say.
- **What comes over at the start** is the way the tokens are organized (`palette.css` → `themes.css` → `scales.css`), `components/ui/` and the contrast tests. Grain's colour roles (`bid`, `offer`, `grain-*`) go in the strip, once the map no longer draws grain's pins.
- **The redesign itself:** the frame first (navigation, where Team and Settings live, how panels sit around the map), then the tokens' values and the components, then the screens one section at a time. Kept through it: which thing a click picks first, what each colour means, each source line.
- **Map colours become roles** as each map section is rebuilt. Today they are hex values in `st37Map.ts`, `landMap.ts`, `landSalesMap.ts`, `pipelinesMap.ts`, `operatorColours.ts` and `geologyMap.ts`; the map page is forced light. Named roles are what make a night theme and a consistent legend possible.

### 4.7 Grain after the split

When the owner says the old version goes (step 8), two pull requests here, because grain's own maps run through the shared map code:

1. **Separate the map code.** `FacilityMap.tsx` stops importing the oil and gas drawing code; grain's Workspace, Counterparties, company, lanes and freight maps are tested unchanged, with grain's layer access and its "still a member?" re-check.
2. **The removal.** The `/petroleum` routes and the map page, the oil and gas components, `lib` files, domain exports, generated files and build scripts, tests and fixtures; the eleven `load-*.yml` workflows; the `PETROLEUM` binding and the Hyperdrive setup's `petroleum` choice; CI's second database; the deploy's migration step and readiness call; **only** the AER call from the shared schedule; only the oil and gas secrets. `map.torvenco.com` is retired or pointed elsewhere, as the owner decides; `/map/coordinates` is kept. Then the old `petroleum-staging` project is deleted.

**The oil and gas migrations stay here** as a closed record: the Merge policy refuses any pull request that removes a migration (`scripts/review-gate.js`), under the light process too.

**How the removal is held.** It changes workflows, so it should have a Codex review and the owner's approval; under grain's light process the gate does not hold it (`mergeDecision`). So either grain is back on the strict process by then, or the pull request stays a draft until Codex's approval is in its register and the owner merges it himself.

### 4.8 Keeping the history

The copy carries this repository's whole history into the new one, so the reasons each thing was built and the 40 review registers come along. This repository stays as it is as well. Every oil and gas entry of `docs/DECISIONS.md` is kept whole in the new one.

## 5. Alternatives considered

- **Piece by piece, each piece reviewed before it enters** (revisions 1 to 7; Codex's advice). Nothing unreviewed is ever in the new repository. Set aside by the owner on 2026-11-26: it spends the strict review on re-creating a prototype, screens included, and reaches a running platform only at the end; the map page, the routes file and the shared map code would have to be rebuilt as frames. Its guarantee matters most when other people use the platform before the review ends, which the lock of 4.1 prevents.
- **Stay in one repository, with stricter rules for the oil and gas folders.** Rejected: different users and data rules; one Worker and one sign-in keep the two tied; grain's real data stays exposed to faults in fast-moving code.
- **Redesign while moving.** Rejected (4.6).
- **A shared package used by both repositories.** Rejected: versioning work with no benefit for one small team.

## 6. Decisions

**Answered by the owner (2026-11-26)**

- **Data permission:** held; it covers people outside GSS, downloads and exports (3.1).
- **No connection to GSS:** its own name, sign-in, database and keys.
- **Who may use it:** people on an approved list, through a new sign-in.
- **Organizations:** most likely each person's own, later; not a priority now.
- **The method:** duplicate and strip, running first, Codex's review on the data layer, the redesign after the transfer (4.1; "go").
- **Accounts:** the same as today. No name and no address yet.

**Still open.** Where Claude has a recommendation it is given; costs and business choices are the owner's alone.

*Needed to start*

1. A working name for the repository, the Worker and the database project (proposed: `petroleum`; all three can be renamed later, the Worker's free address changing with its name).
2. The empty private repository, created by the owner.
3. Stop adding oil and gas features here from now, with fixes still allowed? (Recommended: the copy is taken at one commit, and anything added here afterwards must be carried across by hand.)

*Money and setup*

4. A paid Supabase plan in a new organization, with backups? (Recommended; the price is read first.) A monthly budget for hosting, maps and Ask?
5. Hosting: a Worker as today (recommended), or Cloudflare Pages?

*The data*

6. All of Alberta instead of one formation's area, once each loader is reviewed? (Recommended for a product; it is what the paid plan is for.)
7. Production months kept once loaded, beyond the years Petrinex gives free? (Recommended.)

*People and design*

8. Approved people added as soon as Codex's review is done, or only after the redesign?
9. The four review tiers of 3.2 for new work? (Recommended.)

*Grain, at the end*

10. `map.torvenco.com` once the old version is disconnected: retired, or pointed somewhere?
11. Grain's process afterwards: light as now, or the same tiers? For the removal itself: strict again beforehand, or a draft the owner merges by hand (4.7)?

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


**Revision 8 (2026-11-26) departs from Codex's advice on one point, by the owner's choice.** Finding 4 of the first round said to keep the reviewed, piece-by-piece move, and that copying everything at once was unsafe because an unreviewed route could still serve people. Revision 8 copies everything at once and answers that objection with the lock of 4.1: nobody but the owner is signed in until every section is reviewed. What still stands from the two rounds: the feed inventory and source lines (finding 1), the records that cannot be fetched again, now carried by copying the database whole (2), membership checked in SQL and the kept answers (3), the old migrations kept instead of rewritten (5), the tiers and what the gate enforces (6), reconciliation and loads shown only after they pass (7), the redesign after the move (8), grain's cleanup in two pull requests (9). The slice order, the first release, the hand-made first commit and the switch with its waiting period no longer apply.

**Next:** a third Codex round on section 4 of this revision: is the lock enough, is the first push safe, is keeping the migrations and copying the database sound, are the seven review sections cut well. Codex's own file (`docs/reviews/F-313-plan-review.md`) is on the owner's computer and was pasted into the chat; it is not committed here.
