---
name: codex-review
description: GSS's Claude-to-Codex review loop. Use for every GSS pull request that changes code - a Codex design review of the plan before high-risk work (database, auth, money, Telnyx, Anthropic), background Codex reviews of committed checkpoints while you keep working, triage of each finding into docs/reviews/<ID>.md, fixes with regression tests, targeted re-reviews (up to 5 rounds, 6 to 8 only with progress, escalation on recurrence or disagreement), then the evidence check before the pull request.
---

# Codex review loop (GSS)

The process and its reasons are in `docs/AI_WORKFLOW.md` §11.5 and §11.6; the register format is in `docs/reviews/README.md`. This file is the exact procedure. The owner has authorized Claude to fix confirmed findings without asking (this replaces the Codex plugin's own "ask before fixing" guidance for this repository), but never to merge, approve pull requests, deploy, or change GitHub settings.

The runner is `node .claude/skills/codex-review/run-review.js`. It reviews a **committed** snapshot in its own worktree with Codex's read-only sandbox, so commit before reviewing and never point it at uncommitted work. Run it with `run_in_background: true` and keep working; you are notified when it exits. Its output (findings with probable duplicates) is what you triage; Codex's raw output stays in `~/.gss-reviews/<ID>/` outside the repository.

The runner loads `scripts/review-register.js` from the working tree: do not start a review while that file (or the runner) is half-edited, or it fails before reaching Codex.

## 0. Start

- The item ID is the `F-###` or `T-##` from `docs/FEATURES.md` (add a suffix for a second pull request of the same item: `F-114-2`).
- Create `docs/reviews/<ID>.md` from the format in `docs/reviews/README.md` (Status: open).
- Risk tier: `node scripts/review-gate.js --base origin/main --head HEAD` once there is a commit; high risk also includes anything that changes how money, permissions, phone numbers or real business data are handled, whatever the paths say.

## Keep Codex usage low (the owner's decision, 2026-11-11)

Codex's usage is limited, and every round is a fresh review that reads the code again. The runner sets the reasoning effort by mode (medium for design and final, low for checkpoint and re-review) and a reading budget in the prompt, and prints each round's token count. Most rounds so far were spent on Claude's own slips, so **before every review, Claude checks its own work**:

1. **Plan (design reviews):** every edge case written down before Codex sees it: each role (viewer and analyst included), retries and lost answers, two people at once, paging ties and moved cursors, archived or removed records, missing configuration, limits and hostile input (linear time, bounded memory, Unicode cut on character boundaries for any parser). Follow the repository's existing patterns for the same thing (for example lists passed to Postgres as JSON, since the Worker's connection does not fetch types).
2. **Code (checkpoint, re-review, final):** `pnpm check`, the database tests (`supabase test db`, `pnpm --filter @grain/api test:db`) and, for screens, `pnpm e2e` pass locally; Prettier run on every changed file; Claude has read its own whole diff against the plan's edge cases and the open findings.
3. **One review per feature where possible:** the checkpoint review once the feature is complete, not after each piece; fixes for all of a round's findings together before the re-review.
4. After each round, compare its token count with the earlier ones; an unusually large one is a sign the prompt or the change is too broad.

## 1. Design review (required for high risk and governance, before coding)

The evidence check refuses a high-risk or governance pull request without one, and the design review must have reviewed a commit before the reviewed code. Know the tier before you start: anything touching the paths of the high-risk and governance rows in `docs/AI_WORKFLOW.md` §11.6.

1. Write the plan to `~/.gss-reviews/<ID>/plan.md`: goal, files, schema and API changes, permissions, tests, risks. No real business data.
2. `node .claude/skills/codex-review/run-review.js --id <ID> --mode design --plan <plan file>` (background).
3. Triage as in step 3. Findings get IDs `<ID>-D<n>-<nn>`; they are fixed by the implementation and verified by the first code review.
4. If a finding needs the owner's decision, stop and ask before building that part.

## 2. Checkpoint reviews (background)

At each stable point (a coherent piece built, `pnpm check` or the relevant tests passing locally), commit and push, then start
`node .claude/skills/codex-review/run-review.js --id <ID> --mode checkpoint` (background; the first one starts at the branch's merge base with `origin/main`). Continue with work in other files while it runs. Do not start a second code review of the same pull request while one is running: rounds form a chain.

Prefer one checkpoint review when the feature is complete over many small ones: every code review is a round (5 automatic per pull request), and a large feature should be split into several pull requests (as the build plans already do).

## 3. Triage every finding (never accept one unchecked)

For each finding, read the code it names and decide:

- **confirmed**: it is real. For P1 and P2, reproduce it with a test that fails before the fix wherever technically possible (unit, API, database or browser test); say so in Evidence. If no test is possible, say why.
- **rejected**: not a real problem. Evidence: the concrete reason (the caller checks it, the database constraint refuses it, the line does not do what Codex says).
- **duplicate**: the same as a known finding or an `A-` row in `docs/reviews/ACCEPTED.md`; Evidence names it. The runner flags probable duplicates; you still decide.
- **accepted-limitation**: real but accepted for this pull request; Evidence says why and who accepted it. Anything touching money, permissions, privacy, costs or retention is the owner's to accept: use requires-decision instead.
- **requires-decision**: the right answer is a business choice. Write it under "Escalated to the owner" in plain language.

Record each in the register's Findings table with ID `<ID>-R<round>-<nn>`. If Codex marked it `security_sensitive` and it is not fixed yet, write the summary in general terms only ("Security finding in <area>; details withheld until fixed") and keep the detail in `~/.gss-reviews/<ID>/notes.md`. Add the review's row to the Reviews table (round, mode, base, reviewed commit, verdict, and the runner's "Issues this round" as Findings).

## 4. Fix confirmed findings

For each confirmed finding: write or keep the failing test, fix the code, run the test and the affected suites, commit. Fill in Fix (the commit) and Test (file and test name), set Status to **fixed**, leave Verified empty: only Codex's re-review fills it.

## 5. Targeted re-review

`node .claude/skills/codex-review/run-review.js --id <ID> --mode rereview` (background). It reviews only what changed since the last code review and asks Codex to verify every fixed-but-unverified and confirmed finding. For each `verified_fixes` entry: `fixed` → set Verified to `R<this round>`; `not-fixed` → set Status back to **confirmed** with Codex's note in Evidence; `cannot-tell` → explain in Evidence and decide (a test proving it may be enough to ask again next round). New findings are triaged as in step 3.

## 6. When to stop

- **Codex approves** (the runner says "Codex approved: stop the loop"): stop. Record the round and go to step 7.
- **Limits** (the runner enforces them, exit code 3): rounds 1 to 5 run; 6 to 8 only when the last round's issue count ("Issues this round", which goes in the Reviews table's Findings column) fell from the round before; beyond 8 only with the owner's approval.
- **Escalation** (exit code 6, "ESCALATE: …"): the same fix was found not fixed two rounds running without the issue count falling, or Codex raised again a P1 or P2 you rejected or accepted. Also escalate yourself when you would reject a P1 or P2 in what should be the last round: that is a significant disagreement, never a pass.

To stop for the owner: record the round's findings, set the register's Status to **escalated**, write under "Escalated to the owner" what is unresolved, your position, Codex's position and the decision needed, in plain language, and put the same in the pull request. **Reaching a limit is never approval**: unresolved P1 and P2 findings keep blocking, and an escalated register blocks merging. Only the owner may allow more rounds (`--owner-approved`, with the label `owner-approved-extra-review-round` on the pull request, which only the owner adds).

## 7. Finish

1. The last code review must have reviewed the final code and approved (or raised only P3 findings): after its commit only `docs/reviews/` may change. If code changed since, run a re-review. **High risk and governance:** the last code review must be a final review of the whole pull request, `run-review.js --id <ID> --mode final` (background), after the loop has settled; it counts as a round. Triage its findings like any other; if it raises a P1 or P2, fix, re-review, and run the final review again (within the round limits).
2. Set Status to **complete** (or **escalated**), commit the register.
3. Run `node scripts/review-gate.js --base origin/main --head HEAD` and fix whatever it lists.
4. Push and open the pull request, ready for review (template sections filled, the register linked, rounds and any escalation stated).

## 8. Merge and staging (docs/AI_WORKFLOW.md §11.6)

1. **Low or normal risk:** `gh pr merge <n> --auto --squash`. GitHub merges once `check` and `Merge policy` pass. The hook refuses it while GitHub does not require the Merge policy (automatic merging not switched on): then say the pull request is ready and leave the merge to the owner.
2. **High risk:** the same `--auto --squash`, once the evidence check passes locally with its stronger requirements; GitHub merges after `check` and `Merge policy`.
3. **Governance:** enable `--auto --squash` too, then tell the owner briefly what it changes; the workflow comments the exact `approve-merge <commit>` line, which the owner posts with the terminal command the message gives (a review does not count) as a comment and then adds the label `owner-approved-merge`. Never write that line or add the label yourself; do not push to the pull request while it waits (a push needs a new approval).
4. Watch until it merges (`gh pr checks <n> --watch`, then `gh pr view <n> --json mergedAt,mergeCommit`), then the `Deploy staging` run for the merge commit (`gh run list --workflow "Deploy staging" --commit <sha>`, `gh run watch <id>`).
5. On success: send the owner a short notification (PushNotification) and message: what changed, in plain words, the pull request and that staging is updated. Then the records (`docs/HANDOFF.md`, `docs/FEATURES.md`): one documents-only pull request per session covering all its merges, at the end of the session or at the next `/start`.
6. On failure (a check, the deploy, the smoke test): read the log, notify the owner of the blocker, and fix it on a new branch; never re-run a deploy or migration by hand.
7. **After the merge rules change on `main`** (a governance merge touching `scripts/review-*` or the merge workflows), `Merge policy refresh` turns automatic merging off on open pull requests. For each: confirm the evidence check still passes locally, push an empty commit (`git commit --allow-empty`, no files changed, so its Codex review still covers it) so the Merge policy runs under the new rules, then `gh pr merge <n> --auto --squash` again.
