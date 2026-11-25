# Splitting the oil and gas side into its own platform: proposal (F-313)

**Status:** a proposal for the owner's decision and for Codex's review. Nothing here is built or decided. Written by Claude on 2026-11-25 against `main` at `1e1d1bf` (ivanmueller/gss#380). Asked by the owner on 2026-11-25: separate the two sides completely; the oil and gas side becomes its own repository, built and reviewed under the strict Claude + Codex process again; grain stays here as its own thing.

**Revision 2 (2026-11-25), after Codex's review: "sound with changes".** Changed for the four points of its verdict, each checked by Claude in the repository: permission asked and enforced feed by feed (3.1); history kept and a rollback that is tried before it is needed (4.2, 4.4, 4.8); the slices moved in the order the code depends on them (4.4); grain's cleanup no longer deletes migrations, which the Merge policy refuses (4.7). **Still to fold in:** the corrected facts and owner questions of Codex's full review (`docs/reviews/F-313-plan-review.md`), which was left uncommitted on the owner's computer and has not reached Claude.

## 1. The recommendation in short

1. **Split, and do it now.** The longer it waits, the more unreviewed code and shared wiring there is to untangle.
2. **A new private repository, started from a clean copy of the foundation.** Its main branch starts fresh; this repository's whole history is kept beside it as a read-only archive (4.8).
3. **The oil and gas code moves over in slices, each slice one pull request that Codex reviews.** The move is the audit: nothing enters the new repository unreviewed.
4. **Its own sign-in and database in one new Supabase project, in its own Supabase organization, on a paid plan;** its own Cloudflare Worker, its own secrets and keys.
5. **No shared code between the two repositories.** What both need is copied once; after that each goes its own way.
6. **Look and layout: keep the way the design tokens are organized, move the screens as they are, redesign afterwards** as separate reviewed work.
7. **Two things are settled before any code moves:** a short product specification, and a list of every data feed with what its publisher allows. Permission is asked feed by feed, and the platform shows a feed to people outside GSS only once that feed's permission is recorded.
8. **Grain:** the oil and gas code is removed from this repository in one pull request, after the new platform has taken over `map.torvenco.com` and a stated waiting period has passed. Until then the old page stays whole, so the move can be undone.

## 2. Where things stand (checked in the repository)

**Already separate**

- The oil and gas database: Supabase project `petroleum-staging`, schema `petro`, role `petro_api`, 26 migrations and 23 pgTAP test files in `petroleum/supabase/`. It holds public reference data only and no users.
- The Worker's connection to it: the Hyperdrive binding `PETROLEUM` (`apps/api/wrangler.jsonc`).
- The tracker: `docs/FEATURES_OIL_GAS.md`.
- Its map layers (`petro.map_layers`), since F-247.

**Still shared**

| Shared thing | Where | What it means for a split |
|---|---|---|
| Sign-in and membership | `gss-staging`'s Supabase Auth and `app.organization_members`; the Worker checks them, then sets the organization and role for the oil and gas database by `set_config` (F-247, `docs/DECISIONS.md`) | The new platform needs its own users. Today the oil and gas database trusts the Worker for who is asking |
| One Worker and one web app | `grain-trading-api-staging`; `apps/api/src/index.ts` mounts `/petroleum` beside grain's routes; `apps/web/src/lib/router.tsx` shows the map at a host starting with `map.` | A second Worker and a second web app |
| One domain package | `packages/domain/src/` (about 31,000 lines, both sides mixed in one `@grain/domain`) | Sorted file by file |
| The map-layer machinery | `apps/api/src/map-layers.ts`, `packages/domain/src/mapLayers.ts`, `apps/web/src/lib/mapLayers.ts`, used by both sides (F-247 part 2; F-248 item 3) | Copied; the two copies then differ |
| The database size limit | Both Supabase projects are in one organization on the free plan; loaders stop at 450 MB combined (`scripts/load-*.js`) | Grain's real data and the oil and gas data compete for the same room |
| CI, the Merge policy, deploys, data loads | `.github/workflows/` (eleven `load-*.yml` workflows are oil and gas only) | Copied and cut down on each side |
| Keys | `MAPBOX_PUBLIC_TOKEN`, `ANTHROPIC_API_KEY`, `CLOUDFLARE_API_TOKEN` | New ones for the new platform |
| One routes file and one map page | `apps/api/src/petroleum.ts` imports every oil and gas module; `apps/web/src/components/FullPageMap.tsx` holds every panel | Neither can move whole in the first slice: each is rebuilt as a small frame that every slice adds its part to |

**Modules that read one another's tables (checked in `apps/api/src/*-db.ts` and `scripts/load-*.js`):** production reads the wells (`petro.st37_wells`); geology reads the wells and the formation grids, and its loader keeps only the wells near ours; operators reads the wells, facilities, pipelines and land agreements; land and land sales read each other's tables; the wells read the fields and pools, and their loader also reads Petrinex's Well Licence file; a well's royalty estimate needs its production and the prices; Ask the map uses the settings of every panel. This sets the order of section 4.4.

**Stored history that cannot be fetched again:** the AER's daily licence and rig files, kept as published since 2026-11-19 by the Worker's twice-daily job (`petro.aer_list_files` and the tables read from them); the layers admins added and their change history (`petro.map_layers`, `petro.map_layer_history`); the record of every load (the `*_loads` tables). Everything else is a copy of a published file that a loader can fetch again.

**Not to move:** `petro.wells` and its job (F-243 part 3, the province's well service), built and switched off; `petro.well_injection`, created and dropped again.

**Size of the oil and gas side (approximate):** 7,700 lines of API code with 7,900 lines of tests; 2,550 lines of SQL; 6,200 lines of loader scripts and their tests; the map page (`apps/web/src/components/FullPageMap.tsx`), about 30 components and about 15 `lib` files on the web side; a share of the domain package.

**How it was built:** the light process started on 2026-11-19 with ivanmueller/gss#271. Pull requests #271 to #380, about 110 in six days, were merged without a Codex review, and most of them are oil and gas. The last strictly reviewed oil and gas work was F-247 part 2 (ivanmueller/gss#268): 23 review rounds without an approval, merged by the owner, with two findings still open (F-248).

## 3. What worries me

### 3.1 The data licences were granted for a different purpose

This is the largest risk, and it is not a code problem. The decisions in `docs/DECISIONS.md` rest on the oil and gas side being a personal side project shown to GSS staff:

- **AER lists (ST1, ST49, ST37 and the rest), 2026-11-19:** the AER's page allows "personal and public non-commercial (educational) use" and prohibits reproduction "for the purposes of commercial redistribution … except with prior written permission". The owner proceeded on his own reading: shown only to GSS staff, nothing redistributed.
- **Petrinex, 2026-11-20:** "may be used, reproduced, stored or transmitted for non-commercial purposes"; for commercial purposes consent is arranged first. The owner: "This isn't for commercial use at all." The decision itself says: "If the tool is ever sold or used in a company's business, consent is asked of Petrinex first."

A platform built as an alternative to Enverus, AccuMap or geoSCOUT, at an industry analyst's request, with people outside GSS signing in, is a different purpose. Their answers can change the design (what may be stored, shown, exported, to whom), so asking starts first, in parallel with everything else.

**Permission is asked and recorded feed by feed, not publisher by publisher** (revision 2). A publisher may allow one file and not another, and the first draft of this plan was wrong about one feed: only part of the price data is under the open licence. The feeds, with the terms `docs/DECISIONS.md` and `docs/FEATURES_OIL_GAS.md` record for each:

| Feed | Publisher | Terms recorded | For the new purpose |
|---|---|---|---|
| Township grid (live, not stored) | Government of Alberta | Open Government Licence – Alberta | Allowed, with its attribution line |
| Crown agreements, offset notices, non-Crown minerals | Government of Alberta | Open Government Licence – Alberta (2026-11-19) | Allowed, with attribution |
| Crown land sales: notices and results | Alberta Energy and Minerals | Recorded with the province's open data (2026-11-19, 2026-11-21) | The page's own terms to be read again and recorded for this feed alone |
| Monthly reference price calculations | `open.alberta.ca` | Open Government Licence – Alberta (2026-11-23) | Allowed, with attribution |
| Gas reference price archive, oil par prices, information letters | `alberta.ca`, `inform.energy.gov.ab.ca` | alberta.ca's terms: "non-commercial use", unmodified; commercial reproduction needs written permission (2026-11-23) | **Permission needed** |
| Geological Framework of Alberta (depths), Table of Formations, shale outlines, formation tops, Rock-Eval samples | Alberta Geological Survey | Open Government Licence – Alberta, the Survey acknowledged (2026-11-22, 2026-11-24) | Allowed, with acknowledgement |
| ST37 wells; ST103 fields and pools; ST1 daily licences; ST49 rig activity and the monthly rig archives; ST102 facilities; pipelines; frac summary data; licence transfers | Alberta Energy Regulator | The AER's terms: "personal and public non-commercial (educational) use"; no commercial redistribution without written permission (2026-11-19, 2026-11-23) | **Permission needed, named file by file** |
| Well Licence file; Conventional Volumetric Data (monthly production) | Petrinex | Non-commercial; consent arranged first for commercial use (2026-11-20) | **Permission needed, named file by file** |

Each row's terms are re-read from the publisher's page when the request is written (the pages may have changed), and each answer is recorded in the new repository's `docs/DECISIONS.md` against the feed.

**What this means for the build:**

- Moving the code and loading the data for GSS's own staff is the use the owner already decided on. It does not wait for the answers.
- **The platform enforces the audience per feed.** One list in the code names every feed, its publisher, its attribution line and who may see it: "GSS staff only" until its permission is recorded, then whoever the permission allows. The Worker checks it on every route that returns that feed's data, and tests prove that a member outside the permitted audience is refused. This is a high-risk piece and is built with the foundation, before the first data slice.
- **The wells gate most of the product.** Production, geology, operators, frac and the royalty estimate all hang on the AER's wells (section 2). If the AER says no, people outside GSS see land, land sales, the grid, geology grids and the open prices, and little else. That is worth knowing before the product is designed around outside users.

This is the owner's decision and, I think, a question for a lawyer or for the publishers themselves, not for an AI model.

### 3.2 Going back to the strict process as it was will stall again

The strict loop did not fail because reviews are a bad idea. It failed on F-247 part 2 because one large pull request reshaped shared code, and every round re-read all of it and found something new. F-251 already recorded the fixes: small pull requests, a final review blocks only on the lines a pull request changes, five rounds at most. The new repository should start with those rules in force from its first commit, plus the risk tiers of `docs/AI_WORKFLOW.md` §11.6 used honestly:

- **High risk (design review before code, final review after):** the database, sign-in and permissions, the loaders (they decide whether the data is right), every calculation an analyst will rely on (royalties, prices, volumes, later type curves and decline curves), and anything sent to Claude.
- **Normal (one final review):** new screens and API routes that only read.
- **Cosmetic (CI and a look on staging, no Codex round):** sizes, colours, wording, positions. Several recent pull requests were of this kind (F-305 to F-308: the Ask the map button). Five Codex rounds on a button's outline is the cost that made the strict process unbearable.

### 3.3 The oil and gas side has no specification

Grain has `MASTER_PROJECT_SPECIFICATION.md`. The oil and gas side grew request by request; `docs/FEATURES_OIL_GAS.md` is a history, not a description of the product. A design review needs something to measure against. Before the first slice moves: a short specification (two or three pages): who uses it, what an analyst does with it in a session, what the first version contains and leaves out, which sources feed it under which terms, one company or several.

### 3.4 The free database plan is steering the engineering

Recent work went into fitting the data into shared room (F-310 and F-312: land "kept in less room"; loads limited to the box around the Duvernay). The product's stated goal is "all the data of an area in our own database, history included" (`docs/FEATURES_OIL_GAS.md`). That goal and a 500 MB limit shared with grain's real data do not fit together. Free projects also pause after a week idle and have no backups. A product meant to be scrutinized should not sit on that.

### 3.5 A code review does not check the data

Codex can tell whether a loader's code is sound. It cannot tell whether a well's production for a given month is the number Petrinex published. For an analyst's tool, a wrong number is the worst defect. Each data slice needs a **reconciliation test**: a fixed sample (for example 20 wells, 3 land sales, 5 pipelines) whose loaded values are compared with the source's own figures, recorded with the date. The analyst who asked for the tool is the right person to compare a handful of wells against the tool they use today.

### 3.6 The documents have outgrown their purpose

`docs/HANDOFF.md` is described as short and is about 100 KB; single table cells in `docs/FEATURES_OIL_GAS.md` run to thousands of characters. Every session pays to read them. The new repository should start with short documents and a size check in CI, with history going to a changelog.

## 4. The proposed approach

### 4.1 The new repository

Private (recommended: the licence conditions already require that the data never be public, and the code is now a product; to weigh against it: GitHub's included Actions minutes for private repositories, to be read from GitHub's pricing page, since CI and the data loads run there).

| Taken as it is, then renamed | Rewritten for oil and gas | Left behind |
|---|---|---|
| The monorepo layout, `pnpm` workspace, strict TypeScript, ESLint and Prettier settings | `AGENTS.md` and `CLAUDE.md` (same structure and rules; grain's mission, quotes, FX, Telnyx and email removed; the licence conditions and data rules added) | `MASTER_PROJECT_SPECIFICATION.md`, `docs/TRADING_RULES.md`, `docs/ACCEPTANCE_TESTS.md`, `docs/BUILD_PLAN.md` |
| The review machinery: `.claude/skills/codex-review/`, `scripts/review-gate.js` (with `PROCESS = 'strict'`), `review-register.js`, `review-approval.js`, `.claude/hooks/guard-merge.js`, `merge-policy.yml`, `docs/reviews/README.md`, `docs/AI_WORKFLOW.md` | `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md`: written from the code as each slice lands | Counterparties, quotes, freight, CRM, calls, email, summaries, grains: code, migrations and tests |
| The Worker's base: `auth.ts`, `db.ts`, `respond.ts`, the readiness and schema-version checks, `logins.ts` and `members.ts` (Team) | `docs/FEATURES.md`: a fresh, short tracker; `docs/FEATURES_OIL_GAS.md` copied once as `docs/HISTORY_FROM_GSS.md` for reference | `docs/HANDOFF_HISTORY.md`, `docs/CHANGELOG.md`, `docs/FEATURES_DONE.md` |
| Sign-in screens (`apps/web/src/auth/`), `components/ui/`, the token files, `lib/theme.ts`, `lib/api.ts`, `useApiResource` | `docs/DECISIONS.md`: only the decisions that still apply (Hyperdrive and TLS, Mapbox, Claude's limits, every oil and gas source and its terms), each marked as carried over | The Demo data switch and `data/synthetic.ts`, unless the owner wants a demo mode |
| CI (`ci.yml`), the deploy and Hyperdrive workflows, the browser-test setup | `docs/DESIGN_SYSTEM.md`: see 4.6 | |

Each copied file's origin (this repository, commit `1e1d1bf` or the later commit it was taken from) is recorded in the slice's pull request, so a reviewer can compare.

### 4.2 Infrastructure

| Thing | Today | New platform |
|---|---|---|
| Supabase | `petroleum-staging`, no users, same organization as grain, free plan | A new project in a **new Supabase organization**, holding both sign-in and data; paid plan recommended (price read from Supabase's page before deciding) |
| Worker | `grain-trading-api-staging` serves both | Its own Worker in the same Cloudflare account (the Workers paid plan is per account), its own Hyperdrive configuration |
| Address | `map.torvenco.com` is a custom domain of grain's Worker | Moved to the new Worker at cutover, or a new name (owner's choice) |
| Mapbox | grain's public token | A new token restricted to the new address |
| Anthropic | grain's `ANTHROPIC_API_KEY` | Its own key, so cost and limits are separate |
| GitHub | repository and `staging` environment secrets here | Its own repository secrets, in a `staging` environment limited to `main` from day one |
| Data that can be fetched again | loaded into `petroleum-staging` | Loaded again by the reviewed loaders |
| Stored history (section 2: the AER's daily files, admins' layers and their history, load records) | only in `petroleum-staging` | Copied across by a reviewed script, tried first on a local database: the row counts and a checksum of each table must match before the real copy is trusted |

The old `petroleum-staging`, the `PETROLEUM` binding and the oil and gas code in this repository stay exactly as they are until the waiting period after cutover has passed (4.4, phase 4). The old project is deleted only after a last export of its stored history has been restored once, as a test.

### 4.3 The database

- **One project for sign-in and data.** The Worker verifies the person's session against the same project it queries, and row level security is keyed on the signed-in person and their membership (the `app.current_user_id()` pattern of grain's foundation). The "database trusts the Worker for who is asking" arrangement of F-247 goes away.
- **A new, clean first migration** instead of the 26 that carry their history (tables created, reshaped, dropped: `petro_land_shape_dropped`, `petro_waterflood_removed`). The "migrations are only added, never edited" rule starts from that baseline. Each table arrives with its slice, not all at once, in the order of section 4.4, so no migration names a table that does not exist yet. What the 26 old migrations protect and a rewrite could lose (each grant and revoke, each policy, the checks on values, the schema version a route waits for) is listed table by table in the slice's plan and compared by Codex against the old files, which stay readable in the archive (4.8).
- **To settle in the first design review:** reference data (wells, production, land) is the same for everyone and has no organization column today; what belongs to an organization is small (map layers, later saved views and analyses). If more than one company will ever sign in, the organization boundary and its cross-organization denial tests are built in from the first migration, as on grain. If it stays one company, they are still kept (cheap, already written) but the product is not designed around tenants.

### 4.4 Order of work

**Phase 0: before any code (owner and Claude).** Stop adding oil and gas features here (a freeze at a named, tagged commit). Write the feed list and the requests to the publishers (3.1). Write the specification. The owner answers the decisions in section 6. Codex reviews the specification. Two trials on throwaway copies, so that nothing later depends on an untried step: the archive of this repository's history (4.8), and the copy of the stored history into a local database (4.2).

**Phase 1: the foundation, in the new repository.** One reviewed pull request each: (a) the skeleton, CI, Merge policy and review machinery, with the documents; (b) the database baseline: organizations, members, roles, audit events, their pgTAP tests; (c) sign-in, the Worker's base and the Team page; (d) the feed list and its audience check (3.1); (e) deploy to the new Worker and project, with the readiness check. End state: a person signs in and sees an empty map.

**Phase 2: the map base.** The full-page map as a frame that panels are added to, map styles, the township grid (fetched live, nothing stored), the layer system (with F-248's two open findings fixed on the way in) and the copy of the admins' layers.

**Phase 3: the data, in the order the code depends on it** (revision 2; the dependencies are listed in section 2). Each slice is the tables, the loader and its workflow, the API routes, the panel on the map, the tests and the reconciliation sample. A slice is moved as it is unless the review finds a fault: no redesign and no new feature inside a move.

| # | Slice | Needs first | Publisher |
|---|---|---|---|
| 1 | What every loader shares: load records, the size check, the routes frame | Phases 1 and 2 | none |
| 2 | Wells (ST37) with fields and pools (ST103) and the planned wells from Petrinex's Well Licence file | 1 | AER, Petrinex |
| 3 | Formations: outlines, and the zones worked out from the wells | 2 | Geological Survey |
| 4 | Production by month | 2 | Petrinex |
| 5 | Formation grids, geology in wells, the wells in 3D | 2, 3 | Geological Survey |
| 6 | Land held and land sales, as one slice or back to back with the cross-reading added in the second | 1 | Province |
| 7 | Facilities (ST102) | 1 | AER |
| 8 | Pipelines | 1 | AER |
| 9 | Operators: the one Operator box and colour by operator | 2, 6, 7, 8 | none of its own |
| 10 | The AER's daily lists, rigs, licence locations and targets, licence transfers, with their stored history copied | 2 | AER |
| 11 | Prices, then the royalty estimate | 4 | Province |
| 12 | Frac data | 2 | AER |
| 13 | Ask the map | every panel | none (Claude is sent no data) |

Slices 6, 7 and 8 depend only on slice 1 and can go in any order, or earlier if the specification wants land first. Where the order above and the analyst's priorities disagree, the dependency wins: a slice is never moved before what it reads.

**Phase 4: cutover, with a way back.**

1. The owner and the analyst check the new platform against the old page side by side.
2. The stored history is copied a last time and checked (4.2).
3. **The way back is tried before it is needed:** on a spare address (not `map.torvenco.com`), the address is pointed at the new Worker, then back at the old one, and both are seen to work.
4. `map.torvenco.com` moves to the new Worker.
5. **A waiting period** (proposed: 14 days) during which nothing on the old side is touched: the old Worker's oil and gas routes, the `PETROLEUM` binding, `petroleum-staging` and its twice-daily AER job all keep running, so that going back is one change of address and loses no daily file. Both sides fetch the AER's lists during that time.
6. Going back after the waiting period is no longer possible without rebuilding; the owner says "go" before phase 5.

**Phase 5: grain's cleanup,** one pull request here (section 4.7), after the waiting period and the owner's word.

**New features (waterflood, type curves, other formations) wait until phase 3 is done,** or are added as their own slices under the strict process. They are not built in the old place meanwhile: every such line would have to be moved and reviewed a second time.

How long this takes depends mostly on Codex's usage limit: about 20 reviewed pull requests, several of them high risk with a design review.

### 4.5 The review process in the new repository

As `docs/AI_WORKFLOW.md` §11.5 and §11.6 describe it, with F-251's rules, the tiers of section 3.2 above, and three additions: a reconciliation sample for every data slice (3.5); "moved from GSS at commit …" stated in each moving pull request so the review compares with the origin; and one stated rule per screen for what it keeps from the server, written in the plan before the first review (the lesson of F-247 part 2).

### 4.6 Design, layout and tokens

- **Keep the three-layer token system** (`palette.css` → `themes.css` → `scales.css` and the Tailwind bridge), the `components/ui/` set and the contrast tests (`styles/tokens.test.ts`). The value of the system is that components use roles, never raw colours, so a later change of look is mostly a change of values in two files.
- **Remove at the copy:** grain's roles (`bid`, `offer`, the five `grain-*` families) and whatever nothing on the map page uses.
- **Add, as its own slice:** roles for the map's data. Today the colours of wells, land, sales, pipelines, operators and geology are written as hex values in about eight files under `apps/web/src/lib/` (`st37Map.ts`, `landMap.ts`, `landSalesMap.ts`, `pipelinesMap.ts`, `operatorColours.ts`, `geologyMap.ts` and others). They become named roles in the token files, which is what makes a redesign and a night theme possible later (the map is light only today).
- **Move first, redesign after.** If a pull request both moves a screen and changes how it looks, a reviewer cannot tell a mistake from an intention. The new layout (the owner says much will change) is designed once, after phase 3 or at the latest after phase 2, from the owner's references, as its own feature: the page shell first, then panel by panel. The grain app's shell (`AppShell.tsx`, left menu) is not copied; the oil and gas side is a map with panels, plus Team and Settings.
- If the owner already knows the new layout before phase 2, the shell is built to the new layout from the start and the panels move into it unchanged. That is the one sensible exception.

### 4.7 Grain after the split

One pull request, after the waiting period, removes: the `/petroleum` routes and their files, the oil and gas components, `lib` files and domain modules, the eleven `load-*.yml` workflows and their scripts, the `PETROLEUM` binding, the size guard's second database, the `map.` host rule; `docs/FEATURES_OIL_GAS.md` becomes a one-line pointer. The shared layer code stays (grain uses it). `AGENTS.md` returns to grain only.

**The oil and gas migrations are not deleted** (revision 2; Codex's finding, confirmed). The Merge policy refuses any pull request that removes or changes a migration under either database's folder, `petroleum/supabase/migrations/` included (`scripts/review-gate.js`: "migrations are only ever added"), under the light process too. So `petroleum/supabase/` stays in this repository as a closed record, with a short README saying that nothing applies it any more. The alternative, a governance change that teaches the gate to let a whole database be retired, weakens a rule that protects grain's real data and is not worth it for 26 files.

**Three things must change in the same pull request, or the deploy fails:** the step of `deploy-staging.yml` that applies the oil and gas migrations, the smoke test's call to `/api/v1/petroleum/ready` (which fails on "not set up" once the Worker has had its binding), and the binding itself. CI's second local database and its `petro_api` tests go with them. This pull request changes workflows, so it is a governance change with a Codex review, whatever process grain is on.

Whether grain also returns to the strict process is a separate decision; it holds the business's real data, calls and email, so I would use the same three tiers there.

### 4.8 Keeping the history

- **The code's history.** The new repository's main branch starts fresh, because the slices must arrive one reviewed pull request at a time. This repository's history is still worth keeping: it holds why each thing was built, and 40 review registers in `docs/reviews/`. It is kept twice: this repository stays as it is, with the freeze commit tagged; and the same history is pushed into the new repository as a read-only tag that no branch builds on, so it survives whatever later happens to this repository. **Tried in phase 0:** on a throwaway copy, push the tag and read the history of two moved files through it (`git log <tag> -- apps/api/src/st37.ts`). If that works, every moving pull request names the files and the commit it took them from, and a reviewer can read their past.
- **The data's history:** section 4.2.
- **The decisions' history:** every oil and gas entry of `docs/DECISIONS.md` is copied whole, with its date, not summarized; the licence conditions are in those words.

## 5. Alternatives considered

- **Stay in one repository, with stricter rules for the oil and gas folders.** Cheapest today. Rejected: the two sides have different users, different data rules and a different review standard; one Worker and one sign-in keep them tied; grain's real data stays exposed to faults in fast-moving code.
- **Copy everything across at once, then audit it in place.** Fastest to a working copy. Rejected: a first commit of tens of thousands of lines cannot be reviewed, and "we will audit it later" is how the present situation arose. Kept as the fallback if slices prove too slow: copy at once, but mark every module "unreviewed" in the tracker and block new features on a module until its audit is done.
- **Rewrite the Git history to the oil and gas files only (`git filter-repo`) and build on it.** Rejected: it brings all the unreviewed code onto the main branch at once. The history is kept whole as an archive instead (4.8).
- **A shared package used by both repositories.** Rejected: versioning and publishing work with no benefit for one small team; the shared part (layers, sign-in) is stable enough to copy.

## 6. Decisions for the owner

1. **Permission, feed by feed (3.1):** ask the AER, Petrinex and the province (for the prices under alberta.ca's terms) in writing now, naming each file, and for what use exactly (internal at one company; several companies; paid)? Until each answers, that feed is shown to GSS staff only: agreed? And if the AER refuses the wells, is the product still worth building for outside users?
2. **One company or several** on the new platform, now and in a year?
3. **Private repository?** (Recommended.)
4. **A paid Supabase plan and a new Supabase organization?** (Recommended; price to be read first.)
5. **Name and address** of the new platform: keep `map.torvenco.com` or a name of its own?
6. **Freeze oil and gas features here** from the day this plan is accepted until the slices have moved?
7. **The three review tiers** of section 3.2, or a Codex review on every pull request as before?
8. **Is the new layout known already,** or does it come after the move (section 4.6)?
9. **The analyst:** will they check sample wells against the tool they use today, slice by slice?
10. **Grain's process** after the split: light as now, or the same tiers?
11. **The waiting period after cutover** before the old side is removed: 14 days, or longer?
12. **The old oil and gas migrations stay in this repository as a closed record** (4.7), rather than changing the Merge policy to allow deleting them: agreed?

## 7. Codex's review

**Round 1 (2026-11-25, at `efc4bce`): sound with changes.** Its verdict named four changes; all four are confirmed in the repository and made in revision 2:

| Codex's point | Confirmed by | Changed in |
|---|---|---|
| Permission feed by feed | `docs/DECISIONS.md`, 2026-11-23: two of the three price sources are under alberta.ca's non-commercial terms, which the first draft called open; the AER's terms cover eight separate files | 3.1, 4.4 phase 1 (d), decision 1 |
| A tested way to keep history and to go back | `petro.aer_list_files` and `petro.map_layer_history` hold what no loader can fetch again; the first draft deleted the old project at cutover | 2, 4.2, 4.4 phases 0 and 4, 4.8, decision 11 |
| A moving order that follows the code's dependencies | the tables each `*-db.ts` file and loader reads (section 2) | 2, 4.3, 4.4 phase 3 |
| Grain's cleanup would fail the check on deleted migrations | `scripts/review-gate.js`, the loop over `DATABASE_ROOTS` | 4.7, decision 12 |

**Open:** Codex's full review (97 lines: its evidence, the facts it corrected, its questions for the owner) is in `docs/reviews/F-313-plan-review.md` on the owner's computer, uncommitted. Claude revised from the verdict and has not read the file; its corrected facts are folded in when it is committed to this branch or pasted into the chat. A second Codex round then checks revision 2.
