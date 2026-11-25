# Splitting the oil and gas side into its own platform: proposal (F-313)

**Status:** a proposal for the owner's decision and for Codex's review. Nothing here is built or decided. Written by Claude on 2026-11-25 against `main` at `1e1d1bf` (ivanmueller/gss#380). Asked by the owner on 2026-11-25: separate the two sides completely; the oil and gas side becomes its own repository, built and reviewed under the strict Claude + Codex process again; grain stays here as its own thing.

## 1. The recommendation in short

1. **Split, and do it now.** The longer it waits, the more unreviewed code and shared wiring there is to untangle.
2. **A new private repository, started from a clean copy of the foundation, with no history carried over.** This repository stays as the record of how the code got here.
3. **The oil and gas code moves over in slices, each slice one pull request that Codex reviews.** The move is the audit: nothing enters the new repository unreviewed.
4. **Its own sign-in and database in one new Supabase project, in its own Supabase organization, on a paid plan;** its own Cloudflare Worker, its own secrets and keys.
5. **No shared code between the two repositories.** What both need is copied once; after that each goes its own way.
6. **Look and layout: keep the way the design tokens are organized, move the screens as they are, redesign afterwards** as separate reviewed work.
7. **Two things are settled before any code moves:** permission to use the AER's and Petrinex's data for the new purpose, and a short product specification.
8. **Grain:** the oil and gas code is removed from this repository in one pull request, after the new platform has taken over `map.torvenco.com`.

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

**Size of the oil and gas side (approximate):** 7,700 lines of API code with 7,900 lines of tests; 2,550 lines of SQL; 6,200 lines of loader scripts and their tests; the map page (`apps/web/src/components/FullPageMap.tsx`), about 30 components and about 15 `lib` files on the web side; a share of the domain package.

**How it was built:** the light process started on 2026-11-19 with ivanmueller/gss#271. Pull requests #271 to #380, about 110 in six days, were merged without a Codex review, and most of them are oil and gas. The last strictly reviewed oil and gas work was F-247 part 2 (ivanmueller/gss#268): 23 review rounds without an approval, merged by the owner, with two findings still open (F-248).

## 3. What worries me

### 3.1 The data licences were granted for a different purpose

This is the largest risk, and it is not a code problem. The decisions in `docs/DECISIONS.md` rest on the oil and gas side being a personal side project shown to GSS staff:

- **AER lists (ST1, ST49, ST37 and the rest), 2026-11-19:** the AER's page allows "personal and public non-commercial (educational) use" and prohibits reproduction "for the purposes of commercial redistribution … except with prior written permission". The owner proceeded on his own reading: shown only to GSS staff, nothing redistributed.
- **Petrinex, 2026-11-20:** "may be used, reproduced, stored or transmitted for non-commercial purposes"; for commercial purposes consent is arranged first. The owner: "This isn't for commercial use at all." The decision itself says: "If the tool is ever sold or used in a company's business, consent is asked of Petrinex first."

A platform built as an alternative to Enverus, AccuMap or geoSCOUT, at an industry analyst's request, with people outside GSS signing in, is a different purpose. Wells and monthly production, the core of the product, come from exactly these two sources. **Written permission from the AER and from Petrinex should be asked for before anyone outside GSS signs in, and before the new platform is designed around that data.** Their answers can change the design (what may be stored, shown, exported, to whom), so this starts first, in parallel with everything else. The province's own data (land, sales, the township grid, royalty prices) is under the Open Government Licence – Alberta, which allows commercial use with attribution.

This is the owner's decision and, I think, a question for a lawyer or for the two publishers themselves, not for an AI model.

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
| Data | loaded into `petroleum-staging` | Loaded again by the reviewed loaders; all of it is public data that can be fetched again, nothing is migrated by hand |

The old `petroleum-staging` keeps serving `map.torvenco.com` until cutover, then is deleted.

### 4.3 The database

- **One project for sign-in and data.** The Worker verifies the person's session against the same project it queries, and row level security is keyed on the signed-in person and their membership (the `app.current_user_id()` pattern of grain's foundation). The "database trusts the Worker for who is asking" arrangement of F-247 goes away.
- **A new, clean first migration** instead of the 26 that carry their history (tables created, reshaped, dropped: `petro_land_shape_dropped`, `petro_waterflood_removed`). The "migrations are only added, never edited" rule starts from that baseline. Each table arrives with its slice, not all at once.
- **To settle in the first design review:** reference data (wells, production, land) is the same for everyone and has no organization column today; what belongs to an organization is small (map layers, later saved views and analyses). If more than one company will ever sign in, the organization boundary and its cross-organization denial tests are built in from the first migration, as on grain. If it stays one company, they are still kept (cheap, already written) but the product is not designed around tenants.

### 4.4 Order of work

**Phase 0: before any code (owner and Claude).** Stop adding oil and gas features here (a freeze at a named commit). Ask the AER and Petrinex. Write the specification. The owner answers the decisions in section 6. Codex reviews this plan and the specification.

**Phase 1: the foundation, in the new repository.** One reviewed pull request each: (a) the skeleton, CI, Merge policy and review machinery, with the documents; (b) the database baseline: organizations, members, roles, audit events, their pgTAP tests; (c) sign-in, the Worker's base and the Team page; (d) deploy to the new Worker and project, with the readiness check. End state: a person signs in and sees an empty map.

**Phase 2: the map base.** The full-page map, map styles, the township grid (fetched live, nothing stored), the layer system (with F-248's two open findings fixed on the way in).

**Phase 3: the data, one source per slice.** Each slice is the table, its loader and workflow, its API routes, its panel on the map, its tests and its reconciliation sample: wells (ST37) and formations; production (Petrinex); land held; land sales; facilities; pipelines; rigs and the AER daily lists; prices and royalties; frac data; geology and the 3D wells; operators; Ask the map. Order by what the specification says an analyst needs first. A slice is moved as it is unless the review finds a fault: no redesign and no new feature inside a move.

**Phase 4: cutover.** The owner checks the new platform against the old page side by side; `map.torvenco.com` moves; the old project is deleted.

**Phase 5: grain's cleanup,** one pull request here (section 4.7).

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

One pull request removes: the `/petroleum` routes and their files, the oil and gas components, `lib` files and domain modules, the eleven `load-*.yml` workflows and their scripts, the `PETROLEUM` binding, `petroleum/`, the size guard's second database, the `map.` host rule; `docs/FEATURES_OIL_GAS.md` becomes a one-line pointer. The shared layer code stays (grain uses it). `AGENTS.md` returns to grain only. Whether grain also returns to the strict process is a separate decision; it holds the business's real data, calls and email, so I would use the same three tiers there.

## 5. Alternatives considered

- **Stay in one repository, with stricter rules for the oil and gas folders.** Cheapest today. Rejected: the two sides have different users, different data rules and a different review standard; one Worker and one sign-in keep them tied; grain's real data stays exposed to faults in fast-moving code.
- **Copy everything across at once, then audit it in place.** Fastest to a working copy. Rejected: a first commit of tens of thousands of lines cannot be reviewed, and "we will audit it later" is how the present situation arose. Kept as the fallback if slices prove too slow: copy at once, but mark every module "unreviewed" in the tracker and block new features on a module until its audit is done.
- **Carry the Git history over (`git filter-repo`).** Rejected: the history is interleaved with grain's, and the old repository remains available to read.
- **A shared package used by both repositories.** Rejected: versioning and publishing work with no benefit for one small team; the shared part (layers, sign-in) is stable enough to copy.

## 6. Decisions for the owner

1. **The AER and Petrinex:** ask for written permission now, and for what use exactly (internal at one company; several companies; paid)? Who may sign in until they answer?
2. **One company or several** on the new platform, now and in a year?
3. **Private repository?** (Recommended.)
4. **A paid Supabase plan and a new Supabase organization?** (Recommended; price to be read first.)
5. **Name and address** of the new platform: keep `map.torvenco.com` or a name of its own?
6. **Freeze oil and gas features here** from the day this plan is accepted until the slices have moved?
7. **The three review tiers** of section 3.2, or a Codex review on every pull request as before?
8. **Is the new layout known already,** or does it come after the move (section 4.6)?
9. **The analyst:** will they check sample wells against the tool they use today, slice by slice?
10. **Grain's process** after the split: light as now, or the same tiers?

## 7. What Codex is asked to check

The prompt is in the owner's chat with Claude. In short: are the facts in section 2 right; is anything shared that this plan missed; is slice-by-slice the right way to move the code, and are the slices cut well; is a clean first migration sound, or does it lose something the 26 migrations protect; is the sign-in change of section 4.3 safe; are the review tiers too loose or too tight; what would Codex do differently.
