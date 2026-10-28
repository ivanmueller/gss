# Documentation pack changelog

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
