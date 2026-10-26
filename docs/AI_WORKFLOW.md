# AI-assisted development standards

Controlled model collaboration and source-control protocol. For the **current practical development setup, role rotation, tool comparison, and ready-to-use prompts**, see `docs/AI_CODING_SYSTEM.md`. This document governs Git/PR process independent of the chosen vendor.

# 11. Multi-model development governance

## 11.1 How AI models share knowledge

Git is the source of code truth; specifications and decision records are the source of design intent. A chat transcript is not the source of truth. Use short `AGENTS.md` as central instructions and store the detailed documents in `docs/`. Keep `CLAUDE.md` importing `AGENTS.md`, and configure Gemini CLI's context filename to `AGENTS.md` or use `GEMINI.md` to import it. Confirm agent instructions are actually loaded in each environment before work starts.

## 11.2 Suggested human/agent roles

- **Owner/product lead:** Accepts economic assumptions, prioritizes backlog, owns commercial correctness and merges approved changes.
- **Primary implementer (often Claude via Cursor or native Claude Code):** Delivers scoped UI, API, migrations or bug fixes in an isolated worktree/branch.
- **Independent reviewer (often Codex):** Tests financial math, authorization, migrations, hidden coupling and regression risk; should not be the sole approver of its own changes.
- **Alternate implementer / second opinion (often Gemini):** Can implement discrete tasks, assess data integrations and challenge UX alternatives.
- **Integration owner:** Human/coordinator approves shared contracts, serializes dependent merges and updates the canonical handoff after merge.

These are process assignments, not claims about permanent model superiority. Rotate roles when useful; the model implementing a high-risk change should not be its sole approver.

## 11.3 Task handoff protocol

1. GitHub Issue documents intent, affected module, prerequisites, acceptance criteria and synthetic examples.
2. Implementer reads `AGENTS.md` and only needed docs; states files being changed, edge cases, and intended test plan.
3. Work occurs on a separate branch/worktree. No concurrent agents write to the same worktree.
4. Implementer supplies PR with change summary, migration notes, screenshots for UI work, test output, business-rule impacts and risk.
5. Independent reviewer actively looks for errors and adds tests for disputed assumptions.
6. CI passes; human owner approves; merge updates architectural decisions/docs. **After** merge, the integration owner updates `docs/HANDOFF.md`; agents do not edit it concurrently on independent feature branches.
7. Deploy staging; run the relevant acceptance flow; promote production only after the release gate is met.

**AI must never:** invent quotes or market data, treat hypotheticals as live, auto-execute trades, skip tenant isolation, edit production records ad hoc, bypass CI, commit secrets, or conceal unverified assumptions.

## 11.4 Documentation ownership

- `docs/PRODUCT.md`: user-facing product scope and user journeys.
- `docs/ARCHITECTURE.md`: components, diagram, technical decisions.
- `docs/DATA_MODEL.md`: entities and schema rules.
- `docs/TRADING_RULES.md`: formulas, assumptions and invariants.
- `docs/API.md`: endpoint contracts and error behavior.
- `docs/BUILD_PLAN.md`: ordered stages and issues.
- `docs/ACCEPTANCE_TESTS.md`: cross-model golden fixtures, security gates.
- `docs/DECISIONS.md`: unresolved decisions + dated architecture decisions.
- `docs/HANDOFF.md`: current merged implementation state, last verified commit, open blockers, next exact task; maintained by integration owner after merge.
- `docs/AI_CODING_SYSTEM.md`: recommended tools and operational multi-model coding process; no competing domain rules.

# 12. Repository structure and engineering standards

```
grain-trading-platform/
  AGENTS.md
  CLAUDE.md
  .gemini/settings.json
  README.md
  docs/
    PRODUCT.md
    AI_CODING_SYSTEM.md
    AI_WORKFLOW.md
    ARCHITECTURE.md
    DATA_MODEL.md
    TRADING_RULES.md
    API.md
    BUILD_PLAN.md
    ACCEPTANCE_TESTS.md
    DECISIONS.md
    HANDOFF.md
  apps/
    web/                    # React + Vite SPA, map, table, dialogs
    api/                    # Cloudflare Worker + Hono; same deploy or separate Worker
  packages/
    domain/                 # types, schemas and enums
    trading-engine/         # pure decimal math and validation
    database/               # typed queries/repositories
  supabase/
    migrations/             # all DB changes versioned
    tests/                  # RLS and data invariant tests
  tests/
    e2e/
    fixtures/
  .github/
    workflows/
    ISSUE_TEMPLATE/
    pull_request_template.md
  .env.example              # key names only, no values
```

Keep one `pnpm` workspace, lockfiles in Git, strict TS config, lint/format hooks, named import conventions and consistent error structures. Centralize schemas with Zod or another well-supported validation library. Pin engine calculation version and use decimal strings over JSON rather than JSON numbers when precision matters. Any package addition must be justified in the PR.

### Branch and merge policy

`main` always releasable; branch naming `feat/GT-###-short-name`, `fix/GT-###-short-name`, `docs/GT-###`. Required checks: formatting/lint, typecheck, unit tests, DB schema/RLS tests where relevant, API integration tests, e2e smoke if UI touched, dependency/secrets checks. Financial math, auth, migration, data import and compliance changes need independent human review.

