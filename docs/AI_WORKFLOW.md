# AI-assisted development standards

Controlled model collaboration and source-control protocol. For the **current practical development setup, role rotation, tool comparison, and ready-to-use prompts**, see `docs/AI_CODING_SYSTEM.md`. This document governs Git/PR process independent of the chosen vendor.

# 11. Multi-model development governance

## 11.1 How AI models share knowledge

Git is the source of code truth; specifications and decision records are the source of design intent. A chat transcript is not the source of truth. Use short `AGENTS.md` as central instructions and store the detailed documents in `docs/`. Keep `CLAUDE.md` importing `AGENTS.md`, and configure Gemini CLI's context filename to `AGENTS.md` or use `GEMINI.md` to import it. Confirm agent instructions are actually loaded in each environment before work starts.

## 11.2 Suggested human/agent roles

- **Owner/product lead:** Accepts economic assumptions, prioritizes backlog, owns commercial correctness and merges approved changes.
- **Primary implementer (Claude Code, in VS Code, on the owner's Claude Max plan):** Plans, implements, tests and debugs scoped UI, API, migrations or bug fixes on its own branch, and runs the review loop (§11.5).
- **Independent reviewer (OpenAI Codex, on the owner's ChatGPT plan, through the official Codex plugin's CLI):** Reviews designs before high-risk work and committed checkpoints, read-only, looking for errors in financial math, authorization, migrations, hidden coupling, security and regression risk; secondary debugging agent when Claude is stuck (`codex:codex-rescue`). Called by Claude, not by the owner pasting prompts. Never the sole approver of its own changes, and never writes to the branch under review.
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
- `docs/reviews/`: one Codex review findings register per pull request, and `ACCEPTED.md` for project-wide accepted limits (§11.5).

## 11.5 Claude + Codex review loop (F-149)

Claude runs this loop itself with the `codex-review` skill (`.claude/skills/codex-review/SKILL.md`, the exact procedure); the owner does not copy prompts between tools. The register format is in `docs/reviews/README.md`.

1. **Design review before high-risk work.** For database, auth and permissions, money, FX and units, Telnyx, Anthropic, or real business data: Claude writes the plan; Codex reviews it before code is written. Findings that need a business decision go to the owner before that part is built.
2. **Checkpoint reviews in the background.** Claude commits a stable checkpoint and starts a Codex review of that commit while it keeps working. Codex works in its own detached worktree of the commit (tracked files only, never the working tree Claude is editing), in Codex's read-only sandbox, with connectors off, so it reviews exactly that commit. Codex's raw output stays in Claude's private folder outside the repository.
3. **Validation, never automatic acceptance.** Claude checks every finding against the code and records it in `docs/reviews/<ID>.md` as confirmed, rejected, duplicate, accepted-limitation or requires-decision, with evidence. A confirmed P1 or P2 is reproduced by a failing test wherever technically possible.
4. **Fixes.** Claude fixes confirmed findings without asking (the owner's authorization of 2026-11-09), each with its regression test, and records the fix commit and test.
5. **Targeted re-reviews.** Codex reviews only what changed since its last review and verifies each fix; a fix counts only once Codex has verified it.
6. **Deduplication.** Each review receives the register's known findings and `docs/reviews/ACCEPTED.md`; Codex marks repeats, and the runner flags probable duplicates (same file, nearby lines). Claude decides.
7. **Round limits (the owner's rule, 2026-11-09).** Up to **5** code review rounds run automatically. Rounds **6 to 8** run only while there is measurable progress: the last round's issue count (Codex's new findings plus fixes it found not fixed, each problem counted once; the register's Findings column) is lower than the round's before it. **Beyond 8**, more rounds need the owner's approval (label `owner-approved-extra-review-round`, which only the owner adds). The loop **stops early** when Codex approves: then the evidence check and CI decide. It **stops and escalates** to the owner, whatever the round, when the same fix is found not fixed two rounds running without the issue count falling, or when Claude and Codex disagree on a significant (P1 or P2) issue: Codex raising again what Claude rejected or accepted, or Claude rejecting a P1 or P2 in the last round. Escalation goes in the pull request in plain language (what, both positions, the decision needed); the register's Status becomes **escalated**. The runner (`roundAllowed` and `roundOutcome` in `scripts/review-register.js`) and the GitHub check apply the same rules. **Reaching a limit is never approval:** unresolved P1 and P2 findings always block merging, and so does an escalated register or a last review that did not approve (unless it raised only P3 findings).
8. **Public repository.** Open security-sensitive findings are written in general terms in the register until fixed; their details stay outside the repository.
9. **Evidence for the exact head.** The code reviews must chain from the base branch to the last code commit, and the last one must approve; after it, only `docs/reviews/` may change. `scripts/review-gate.js` checks this locally and in GitHub (§11.6).

Pull requests that change documents only (Markdown other than the governance files) need no Codex review. GitHub CI (`check`) stays the authoritative automated validation; Codex's review is in addition to it, never instead.

## 11.6 Merge policy and safeguards

**Today: only the owner merges.** Automatic merging is designed below but **not switched on**; switching it on needs the owner's explicit authorization and the GitHub settings in step 4.

| Tier (set by `scripts/review-gate.js` from the changed files) | Examples | Merge |
|---|---|---|
| **Low** | Documents, tests, style sheets | Eligible for automatic merge once CI and the review evidence check pass (documents only need no Codex review). |
| **Normal** | Features, API and web changes outside the high-risk areas | Eligible for automatic merge after a complete Codex review (no blocking finding, every fix verified), regression tests and CI. |
| **High** | `supabase/` (migrations, RLS), auth, members and logins, money, FX, quotes, freight, trading engine, Telnyx, calls and callbacks, Anthropic, readings and summaries, the database layer, Worker config, dependencies, `.github/`, `.claude/`, the review scripts and governance documents | Never automatic. Held for qualified independent approval (today: the owner's merge after Codex's review and CI). |

**Merging, deploying and migrating are different steps**, and today one leads to the other: every merge to `main` runs `Deploy staging`, which applies migrations to the staging database (real business data) and deploys the staging Worker. That is why migrations and everything touching real data are high risk. Production deployment does not exist yet (F-130) and needs the owner's go-ahead.

**Never done by an agent:** merging a pull request (until automatic merging is switched on, and then only by GitHub's own auto-merge), approving a pull request, pushing to `main`, force-pushing, deploying (`wrangler deploy`), pushing migrations to a database (`supabase db push`), running workflows by hand, changing secrets, variables, labels, rulesets, branch protection or environments; and the restricted actions of `AGENTS.md` rule 8 (trades, binding offers, payments, hedges). `.claude/settings.json` blocks these commands for Claude Code. That is a guardrail, not a security boundary: GitHub's settings are the boundary, because Claude's `gh` acts with the owner's account.

**Review evidence in GitHub.** The workflow `Review evidence` runs `scripts/review-gate.js` on every pull request: its risk tier, whether the register covers the exact head commit, and whether the pull request would be eligible for automatic merge. It reads git data only. Its `pull_request_target` run uses the copy on `main`, which a pull request cannot change. Known limit: GitHub can check that the evidence matches the commits, not that Codex really produced it, since the register is written by Claude. Codex's own GitHub code review (from ChatGPT's Codex settings, posting reviews as its own app) would add independent proof; it is not set up.

**To switch on automatic merging (owner steps, later, only after the test pull requests have shown the system works):**
1. GitHub → the repository → Settings → General → Pull Requests → tick **Allow auto-merge**.
2. Settings → Rules → Rulesets → New branch ruleset for `main`: require the status checks `check` and `Review evidence (pull_request_target)`, require a pull request, block force pushes; keep yourself as the only bypass.
3. Settings → Environments → `staging` → Required reviewers: yourself, if migrations should wait for you after a merge.
4. Tell Claude it may run `gh pr merge --auto` for low and normal tier pull requests; the settings file then allows that one command.

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

`main` always releasable; branch naming `claude/<short-name>` (Claude Code's branches, e.g. `claude/F-149-codex-review-loop`), the pull request naming its `F-###` or `T-##` (earlier plan: `feat/GT-###-short-name`). Required check: `check` in `.github/workflows/ci.yml` (formatting, lint, typecheck, unit tests, database and RLS tests, API database tests, browser tests). Financial math, auth, migration, data import and compliance changes need Codex's independent review and the owner's merge (§11.5, §11.6).

