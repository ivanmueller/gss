# Review findings registers

Every pull request that changes code has one register here, `docs/reviews/<ID>.md`, named after the item it works on (`F-149`, `T-01`; `F-114-2` for the second pull request of F-114). It records each Codex review of the pull request and every finding, with what became of it. The process is in `docs/AI_WORKFLOW.md` §11.5; the GitHub check that reads these files is `scripts/review-gate.js` (§11.6).

Pull requests that change documents only (Markdown outside the governance files) need no register.

## Rules

1. **One register per pull request**, written on its own branch. Parallel branches never edit the same register, so they never conflict. `docs/reviews/ACCEPTED.md` (limits accepted for the whole project) changes only in the records commit after a merge, like `docs/HANDOFF.md`.
2. **Public repository.** No real business data (names, contacts, prices, phone numbers). An open finding marked security-sensitive is written in general terms only ("Security finding in the callbacks API; details withheld until fixed"); its details stay in Claude's private review folder outside the repository (`~/.gss-reviews/<ID>/`) until the fix is merged, then the row is completed.
3. **Codex's raw output stays private** in that folder; the register holds the curated record.
4. **Nothing Codex says is accepted unchecked.** Claude validates each finding against the code (for P1 and P2, by reproducing it with a failing test wherever that is technically possible) before marking it confirmed or rejected.
5. A finding marked **fixed** needs its fix commit, a regression test (P1 and P2; or `n/a: <reason>`), and the round in which a Codex re-review verified it (the Verified column). Until then it stays blocking.
6. **Round limits** (`docs/AI_WORKFLOW.md` §11.5, step 7): up to 5 code review rounds; 6 to 8 only while each round's issue count falls; beyond 8, or after an escalation, only with the owner's approval (pull request label `owner-approved-extra-review-round`, added by the owner only). The loop stops when Codex approves, and stops for the owner on recurring findings or a disagreement on a P1 or P2 (Status: **escalated**, which blocks merging). Reaching a limit is never approval.

## Format

```markdown
# Review register: F-149 — Claude + Codex review loop

- Risk tier: high (from the changed files; scripts/review-gate.js says which)
- Status: open | complete | escalated

## Reviews

| Round | Mode | Base | Reviewed commit | Result | Findings |
|---|---|---|---|---|---|
| D1 | design | — | 5956e33 | needs-attention | 4 |
| 1 | checkpoint | 5956e33 | 1a2b3c4 | needs-attention | 2 |
| 2 | rereview | 1a2b3c4 | 5d6e7f8 | approve | 0 |

## Findings

| ID | Sev | Status | Round | Commit | Where | Summary | Evidence | Fix | Test | Verified |
|---|---|---|---|---|---|---|---|---|---|---|
| F-149-R1-01 | P2 | fixed | 1 | 1a2b3c4 | scripts/x.js:40 | … | failing test before the fix | 5d6e7f8 | x.test.js "…" | R2 |

## Escalated to the owner

(Plain language: what is unresolved, Claude's view, Codex's view, what the owner needs to decide.)
```

- **Round**: `D1`, `D2`… for design reviews of a plan (they do not count toward the limit); `1`, `2`, `3` for code reviews.
- **Mode**: `design` (a plan), `checkpoint` (every change from a base commit; the first code review starts on the base branch), `rereview` (only what changed since the previous code review, plus the fixes to verify), `final` (high risk and governance: the whole pull request again from the base branch, the last review before merging, which must approve). Coverage starts at the latest review that starts on the base branch; each review after it starts where the previous one stopped; after the last one, only `docs/reviews/` may change.
- **Result**: Codex's verdict, `approve` or `needs-attention`; `failed` when Codex did not finish (does not count). The last code review must approve, unless it raised only P3 findings.
- **Findings**: the round's issue count as the runner prints it ("Issues this round"): Codex's new findings plus fixes it found not fixed, each problem counted once. Rounds 6 to 8 are allowed only while it falls.
- **Finding ID**: `<ID>-R<round>-<n>`, or `<ID>-D<n>-<n>` from a design review. Never reused.
- **Sev**: P1 must fix before merge; P2 should fix; P3 minor.
- **Status**: `confirmed` (real, not yet fixed; blocks), `fixed`, `duplicate` (of the ID given in Evidence), `rejected` (not a real problem; the evidence says why), `accepted-limitation` (real, accepted; the evidence says who accepted it and why; project-wide ones go to `ACCEPTED.md` after the merge), `requires-decision` (the owner's to decide; blocks).
- **Commit**: the commit reviewed when it was found. **Fix**: the commit that fixed it. **Test**: the regression test's file and name.
