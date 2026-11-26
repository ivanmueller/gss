# Agent instructions — Canadian–U.S. Physical Grain Trading Platform

This project has its **Phase 1 foundation, Phase 2, most of Phase 3, the Bank of Canada FX connector, calling through Telnyx and Claude's readings of call transcripts** on staging, with the owner's real data. The current status is in `docs/HANDOFF.md`, what is built and to build in `docs/FEATURES.md`; the full description that stood here until 2026-11-10 is in `docs/HANDOFF_HISTORY.md`. Standing facts every task respects: the platform only ever serves GSS staff, and screens and owner-facing documents never speak of other organizations; made-up data appears only behind the profile menu's **Demo data** switch; every time on screen is typed and shown in Alberta time (MT, UTC−6 all year) and stored in UTC; nothing Claude drafts is saved until a person clicks **Verify** or finishes it in the usual form; revisions, contact history and follow-ups are kept, never edited or deleted (corrections are new versions, removals are marked); texting, the trading engine and saved scenarios do not exist yet. **Process (the owner, 2026-11-19): light and fast.** A short plan in chat, build, a quick check on staging, merge. No Codex reviews, no owner approval of each commit, no separate documents-only pull requests; see "Working with the owner". The oil and gas side is the owner's own side project, an MVP to show friends in the industry, not oil or gas trading. **It is frozen here since 2026-11-26 (the owner): no new oil and gas features in this repository, fixes only,** while it moves to a private repository of its own (`docs/PETROLEUM_SPLIT_PLAN.md`, F-313); a fix made here is listed in `docs/HANDOFF.md` so that it is carried across. Before coding, read the *relevant sections* of `MASTER_PROJECT_SPECIFICATION.md`, current status in `docs/HANDOFF.md`, and the features and tests tracker `docs/FEATURES.md` (what is built, what is to build, what the owner still has to check).

## Mission
Build a secure, auditable Canadian-to-U.S. physical grain trading operations platform. The map is for discovery; executable economics comes from validated bid/offer records, quote delivery terms, source FX and freight inputs, and a deterministic saved scenario snapshot.

## Intended architecture
- One GitHub monorepo, public by the owner's choice (`docs/DECISIONS.md`): never commit real business data or secrets. React/Vite/strict TypeScript frontend; Hono API on Cloudflare Workers.
- Supabase Postgres/PostGIS, Supabase Auth, private Storage, organization-aware access.
- Shared domain/validation packages and a pure TypeScript trading-engine package using **decimal**, never JS float, for monetary arithmetic.
- Mapbox GL JS with Mapbox map tiles (owner's decision, `docs/DECISIONS.md`); keep Mapbox calls in one map component so the provider can be changed later. Map layers from ArcGIS and WMS services and from files (F-107, GT-026): admins add them on Team with their source and terms of use recorded, one at a time or a whole ArcGIS map from its link, drawn as ArcGIS draws them (F-138, F-141: colours, widths, zoom ranges, filters, pre-drawn picture layers such as heat maps, legends); live ones are fetched by the Worker by map square, never by the browser; a secured one would need a Worker secret, never a key in the browser.
- Geocoding with Geocodio's free plan, from the Worker only, when counterparties and locations are added (owner's decisions, `docs/DECISIONS.md`): sure results are saved, doubtful ones are reviewed before saving.
- FX: the Bank of Canada's daily USD/CAD rate, fetched once a day by the Worker and stored per day with its source, stale after four days (owner's decision, `docs/DECISIONS.md`). Built (GT-052): the Worker's scheduled job stores it at 14:15 and 22:15 UTC; without a current rate, USD bids and offers stay out of the workspace's order book with a note.
- Calling and texting through Telnyx (owner's decisions, `docs/DECISIONS.md`): Telnyx is called from the Worker only, with its API key a Worker secret; its webhooks are accepted only with a valid Ed25519 signature. Recordings are transcribed by Telnyx's speech-to-text after the call; the audio stays at Telnyx and is deleted 24 hours after the call; transcripts are kept.
- Claude through Anthropic's API (owner's decisions, `docs/DECISIONS.md`, 2026-11-05): called from the Worker only, with `ANTHROPIC_API_KEY` a Worker secret, one request per call transcript with no tools; it drafts notes, voicemail, bids and offers, follow-ups and contact details that a person confirms before anything is saved, and the Worker checks every price, quantity and phone number against the transcript; one request per company summary, in which Claude writes no words: it chooses topics from a fixed list and the records under each, and the Worker writes each topic's title and each record's own text; one request per request typed in the oil and gas map's Ask bar (F-254, Claude Haiku 5.5), in which Claude chooses settings from the map's fixed list and reason codes only, is sent no data, and the Worker checks the answer and drops any name not in the typed words.
- Python is out of scope until analytics or optimization justifies it.

## Always follow
1. Source of design intent: `MASTER_PROJECT_SPECIFICATION.md`. Per-module details: `docs/`. **Do not invent market prices, routing fees, FX quotes or regulatory outcomes.** Label all synthetic data (in the web app, made-up data appears only while the Demo data switch is on, with the "Demo" tag beside GSS).
2. A quote must carry side, commodity/grade, numeric units, currency, delivery basis, valid time, available quantity and provenance. Treat indicative/stale as non-executable.
3. Normalize quantity/FX explicitly. Missing FX, freight or unit conversion must **block** margin calculations; do not treat missing as zero. Preserve quote revision IDs and calculation engine version in every saved scenario.
4. Enforce organization isolation server-side; no browser service-role secrets; limit grants/RLS, secure private files; test cross-tenant denials.
5. Do not alter an executed/saved historical calculation in place. Version changes and audit them.
6. Use schema migrations for changes; add tests for every financial calculation, permission change and bug fix.
7. Use a Git branch per change; no direct commits to protected main; open a short PR describing what changed, tests, migrations and risks. Agree on shared schemas/API contracts before parallel implementation.
8. No AI model can autonomously commit a real grain trade, approve a payment, execute a hedge, or send contract offers to third parties.
9. Do not add microservices, runtime LLM agent frameworks, vector DBs or predicted pricing to v1 without an approved architecture decision.
10. `docs/HANDOFF.md` is a short running list: each pull request adds its own line there (and the record of any earlier merge not yet listed), no separate documents-only pull request. Never claim an unbuilt feature works.

## Working with the owner
- The owner runs a grain trading shop and is not a developer. Explain in plain language, give exact click paths (e.g. "Cloudflare → Workers & Pages → grain-trading-api-staging → Logs"), and keep owner steps few and numbered.
- **Light process (the owner, 2026-11-19; replaces the strict Codex review process for now):** a short plan in chat, build, run `pnpm check` (and the database tests when the database changes), open the pull request, merge, then a quick check on staging. No Codex reviews (the `codex-review` skill stays available if the owner asks for one), no owner approval of each exact commit, no risk tiers holding a merge, no separate documents-only pull requests. Kept, because they are cheap and protect what matters: the AER/ST37 licence conditions (members only, no export, the data never committed to this public repository); the Supabase free-plan size guard (450 MB with grain's database, raised from 400 MB by the owner on 2026-11-24); a quick staging check before anything reaches production; migrations only added, with pgTAP tests (the Merge policy still checks both); the security rules below. The strict process (`docs/AI_WORKFLOW.md` §11.5, §11.6) returns when the owner says so, for example once friends in the industry want the platform in their companies. Gemini stays optional, with a **Gemini:** prefix and a paste-ready prompt.
- Never ask for secrets in chat (passwords, connection strings, `sb_secret_` keys, API tokens). Ask for the non-secret part instead, such as the host after `@`. Real business data (buyer rows, contacts, prices) never goes into Git or prompts; ask for column headers only.
- The platform serves one organization, the owner's shop (`docs/DECISIONS.md`).
- Claude opens pull requests (`gh pr create`) and merges with `gh pr merge <n> --auto --squash` once CI and the Merge policy pass (under the light process the Merge policy checks only that migrations are added, never edited, with pgTAP tests). Never `--admin`, never labels or approval comments. After each merge, Claude watches `Deploy staging`, checks the change there briefly and tells the owner; it interrupts the owner only for failed deploys or checks and business decisions. Keep CI green; record merges in `docs/HANDOFF.md` and `docs/FEATURES.md` (or `docs/FEATURES_OIL_GAS.md`) in the next pull request.
- Staging failures: read the Worker's log line (`Database unavailable … code=… kind=…`) before guessing; see `docs/HANDOFF.md`, "How staging is wired".

## Sessions, models and tokens
- Read only what the task needs. `docs/HANDOFF.md` and `docs/FEATURES.md` are kept short; `docs/HANDOFF_HISTORY.md`, `docs/FEATURES_DONE.md` and `MASTER_PROJECT_SPECIFICATION.md` are searched for the part needed, never read whole at the start of a session.
- One feature per session; the owner starts the next with `/clear` or `/start`.
- `/start` ends by recommending a model for the next task: **Sonnet** (`/model sonnet`) for documents, tests, styles and ordinary features with a clear plan; **Opus** for database, sign-in, money and planning a new feature. Only the owner switches the model.
- Hand routine work to a helper agent on a cheaper model: searches across many files (the Explore agent), watching checks and deploys (an agent with `model: sonnet` or `haiku`). Keep design and database code in the main session.

## Read by task
- What is built, what is to build, owner checks on staging, open test issues and dependency updates: `docs/FEATURES.md`. Read it at the start of every session. Add every new request from the owner there (with its open questions) before writing code; name its `F-###` ID in the pull request; update its status in the same commit that records the merge in `docs/HANDOFF.md`.
- UX: `docs/PRODUCT.md`; look and feel, tokens and components: `docs/DESIGN_SYSTEM.md`.
- Schema: `docs/DATA_MODEL.md` and `docs/ARCHITECTURE.md`.
- API: `docs/API.md`.
- Financial logic: `docs/TRADING_RULES.md` + `docs/ACCEPTANCE_TESTS.md`.
- Tickets: `docs/BUILD_PLAN.md`.
- Agent collaboration and governance: `docs/AI_WORKFLOW.md`.
- October 2026 development environment, model assignments, worktree orchestration, sample prompts and early vertical slice: `docs/AI_CODING_SYSTEM.md`.
- Open decisions: `docs/DECISIONS.md`.

## Commands
- `pnpm install`
- `pnpm check`: format check, lint, typecheck and tests, the same steps CI runs.
- `pnpm format`: apply Prettier (Markdown is excluded).
- `pnpm build`: build the web app (CI runs it after `pnpm check`).
- `pnpm --filter @grain/api dev`: local API Worker at `http://localhost:8787/api/v1/health`.
- `pnpm --filter @grain/web dev`: web app with hot reload at `http://localhost:5173`; `/api` is proxied to port 8787.
- `pnpm preview:staging`: build, then serve web and API together as on staging.
- `pnpm e2e`: build, then run the Playwright browser tests (CI runs them in the required `check` job). Needs a local Supabase with sign-in (`supabase start`); see README "Quick start".
- `supabase db start` then `supabase test db`: apply migrations to a local Supabase and run the pgTAP tests (needs Docker; CI runs them in `check`).
- `pnpm --filter @grain/api test:db`: the API's database code as `app_api` against a migrated database (see README "Database").

## Database rules
- Every schema change is a new file in `supabase/migrations/`; never edit a migration that has reached `main`.
- Application tables go in the private `app` schema. Each new table enables row level security, gets policies for `app_api` keyed on `app.current_user_id()` and organization membership, and is revoked from `public`, `anon`, `authenticated` and `service_role` before granting `app_api` only what it needs. New functions are revoked the same way.
- Every new table or policy ships with pgTAP tests in `supabase/tests/database/`, including cross-organization denials.

## Completion definition
Run and report lint, TypeScript typecheck, relevant unit/integration tests, security/RLS tests where needed and a staged end-to-end smoke test for user-visible changes. If test infrastructure does not exist yet, explicitly state that and create it in the current approved phase.
