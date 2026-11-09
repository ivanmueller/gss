---
name: codex-review
description: GSS's Claude-to-Codex review loop. Use for every GSS pull request that changes code - a Codex design review of the plan before high-risk work (database, auth, money, Telnyx, Anthropic), background Codex reviews of committed checkpoints while you keep working, triage of each finding into docs/reviews/<ID>.md, fixes with regression tests, targeted re-reviews, at most 3 rounds, then the evidence check before the pull request.
---

# Codex review loop (GSS)

The process and its reasons are in `docs/AI_WORKFLOW.md` §11.5 and §11.6; the register format is in `docs/reviews/README.md`. This file is the exact procedure. The owner has authorized Claude to fix confirmed findings without asking (this replaces the Codex plugin's own "ask before fixing" guidance for this repository), but never to merge, approve pull requests, deploy, or change GitHub settings.

The runner is `node .claude/skills/codex-review/run-review.js`. It reviews a **committed** snapshot in its own worktree with Codex's read-only sandbox, so commit before reviewing and never point it at uncommitted work. Run it with `run_in_background: true` and keep working; you are notified when it exits. Its output (findings with probable duplicates) is what you triage; Codex's raw output stays in `~/.gss-reviews/<ID>/` outside the repository.

## 0. Start

- The item ID is the `F-###` or `T-##` from `docs/FEATURES.md` (add a suffix for a second pull request of the same item: `F-114-2`).
- Create `docs/reviews/<ID>.md` from the format in `docs/reviews/README.md` (Status: open).
- Risk tier: `node scripts/review-gate.js --base origin/main --head HEAD` once there is a commit; high risk also includes anything that changes how money, permissions, phone numbers or real business data are handled, whatever the paths say.

## 1. Design review (high risk only, before coding)

1. Write the plan to `~/.gss-reviews/<ID>/plan.md`: goal, files, schema and API changes, permissions, tests, risks. No real business data.
2. `node .claude/skills/codex-review/run-review.js --id <ID> --mode design --plan <plan file>` (background).
3. Triage as in step 3. Findings get IDs `<ID>-D<n>-<nn>`; they are fixed by the implementation and verified by the first code review.
4. If a finding needs the owner's decision, stop and ask before building that part.

## 2. Checkpoint reviews (background)

At each stable point (a coherent piece built, `pnpm check` or the relevant tests passing locally), commit and push, then start
`node .claude/skills/codex-review/run-review.js --id <ID> --mode checkpoint` (background; the first one starts at the branch's merge base with `origin/main`). Continue with work in other files while it runs. Do not start a second code review of the same pull request while one is running: rounds form a chain.

Prefer one checkpoint review when the feature is complete over many small ones: the limit is 3 code rounds per pull request, and a large feature should be split into several pull requests (as the build plans already do).

## 3. Triage every finding (never accept one unchecked)

For each finding, read the code it names and decide:

- **confirmed**: it is real. For P1 and P2, reproduce it with a test that fails before the fix wherever technically possible (unit, API, database or browser test); say so in Evidence. If no test is possible, say why.
- **rejected**: not a real problem. Evidence: the concrete reason (the caller checks it, the database constraint refuses it, the line does not do what Codex says).
- **duplicate**: the same as a known finding or an `A-` row in `docs/reviews/ACCEPTED.md`; Evidence names it. The runner flags probable duplicates; you still decide.
- **accepted-limitation**: real but accepted for this pull request; Evidence says why and who accepted it. Anything touching money, permissions, privacy, costs or retention is the owner's to accept: use requires-decision instead.
- **requires-decision**: the right answer is a business choice. Write it under "Escalated to the owner" in plain language.

Record each in the register's Findings table with ID `<ID>-R<round>-<nn>`. If Codex marked it `security_sensitive` and it is not fixed yet, write the summary in general terms only ("Security finding in <area>; details withheld until fixed") and keep the detail in `~/.gss-reviews/<ID>/notes.md`. Add the review's row to the Reviews table (round, mode, base, reviewed commit, verdict, number of findings).

## 4. Fix confirmed findings

For each confirmed finding: write or keep the failing test, fix the code, run the test and the affected suites, commit. Fill in Fix (the commit) and Test (file and test name), set Status to **fixed**, leave Verified empty: only Codex's re-review fills it.

## 5. Targeted re-review

`node .claude/skills/codex-review/run-review.js --id <ID> --mode rereview` (background). It reviews only what changed since the last code review and asks Codex to verify every fixed-but-unverified and confirmed finding. For each `verified_fixes` entry: `fixed` → set Verified to `R<this round>`; `not-fixed` → set Status back to **confirmed** with Codex's note in Evidence; `cannot-tell` → explain in Evidence and decide (a test proving it may be enough to ask again next round). New findings are triaged as in step 3.

## 6. The limit

The runner allows 3 code rounds (exit code 3 after that). When it refuses, or when you and Codex still disagree after two exchanges on one finding, stop the loop: set the register's Status to **escalated**, write under "Escalated to the owner" what is unresolved, your position, Codex's position and the decision needed, in plain language, and put the same in the pull request. Only the owner may allow one more round (`--extra-round`, with the label `owner-approved-extra-review-round` on the pull request, which only the owner adds).

## 7. Finish

1. The last code review must have reviewed the final code: after its commit only `docs/reviews/` may change. If code changed since, run a re-review.
2. Set Status to **complete** (or **escalated**), commit the register.
3. Run `node scripts/review-gate.js --base origin/main --head HEAD` and fix whatever it lists.
4. Push and open the pull request (template sections filled, the register linked, rounds and any escalation stated). Report the link. Do not merge.
