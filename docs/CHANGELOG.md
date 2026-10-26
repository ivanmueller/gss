# Documentation pack changelog

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
