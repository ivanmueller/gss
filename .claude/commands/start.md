---
description: Start a GSS work session — read the handoff, record merges, say where we are and what's next
---

Continue work on GSS.

1. `AGENTS.md` is already loaded; do not read it again. Read `docs/HANDOFF.md` (current status, latest merges, next exact task) and `docs/FEATURES.md` (what is built, what is to build, the owner's pending checks). Do not read `docs/HANDOFF_HISTORY.md` or `docs/FEATURES_DONE.md` whole; search them only when a task needs a past detail.
2. If pull requests were merged since the last merge recorded in `docs/HANDOFF.md`, record them all first, in one documents-only commit, with their CI and Deploy staging run numbers: the newest in "Latest merges", the record it replaces moved to the top of "Merge records" in `docs/HANDOFF_HISTORY.md`; update their statuses in `docs/FEATURES.md` and move finished rows to `docs/FEATURES_DONE.md` (its rule 4). Hand this to a helper agent on a cheaper model when there are several.
3. Tell me in plain language where we are: what is live, what I still have to check on staging, and what is next.
4. Then do what I ask below, or, if nothing is asked, suggest the next feature from "Next up" or "To build" with the questions only I can answer. Don't code anything marked "Needs owner input" until I answer.
5. End with one line recommending the model for that next task, by its risk tier (`docs/AI_WORKFLOW.md` §11.6): "Type `/model sonnet`" for documents, tests, styles and ordinary features with a clear plan; "Stay on Opus" for high risk (database, sign-in, money, FX, Telnyx, Claude), governance, or planning a new feature.

$ARGUMENTS
