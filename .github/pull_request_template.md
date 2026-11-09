## Summary / linked issue

## Business intent and acceptance criteria

## Implementing agent / branch / independent reviewer

## Files changed / architecture decisions

## Quote, trade math, FX, freight or security implications

## Migrations / rollback notes

## Evidence of tests (include exact commands and results)
- [ ] Lint / formatting
- [ ] TypeScript typecheck
- [ ] Domain/financial unit tests
- [ ] Database and RLS tests if schema/auth touched
- [ ] UI smoke or screenshot if front-end touched

## Codex review (docs/AI_WORKFLOW.md §11.5)
- Register: `docs/reviews/<ID>.md` (none for documents only)
- Risk tier (from `node scripts/review-gate.js --base origin/main --head HEAD`):
- Rounds used (design / code, limit 3 code rounds):
- Findings: confirmed and fixed (verified by Codex) / rejected / duplicate / accepted / open:
- Last reviewed commit, and what changed after it (only `docs/reviews/`):
- **Needs owner decision** (plain language), if anything was escalated:

## Data provenance, permissions and user-impact warnings

## Handoff for integration owner (after merge only)
- Merged commit (integration owner records after merge):
- Verified commands/results:
- Remaining blockers / next exact issue:

## Reviewer checklist
- [ ] No synthetic data represented as live
- [ ] No cross-tenant data exposure
- [ ] No quote history overwritten
- [ ] Assumptions and calculation engine version documented
- [ ] Handoff summary provided here for integration owner; `docs/HANDOFF.md` is updated **after merge**
