# Accepted limits and known deferred items

Project-wide limits that a review accepted, and known items deferred to the tracker, so Codex does not report them again as new (the review runner passes every `A-` row to Codex). Changed only in the records commit after a verified merge, like `docs/HANDOFF.md`. A finding that is real and accepted for one pull request only stays in that pull request's register.

Codex may still raise one of these with **new evidence** that the reason no longer holds; Claude then records a new finding that names the `A-` row.

| ID | Area | Limit | Why it is accepted | Source |
|---|---|---|---|---|
| A-01 | Map layer pictures (`apps/api/src/map-layers.ts`) | The Worker checks every PNG and JPEG passed on as a whole (structure, chunks, checksums, size) but does not decode compressed pixel data. | Codex's review of `4026e22` to `dbbcceb`: no P1 or P2 remaining; not decoding coded pixels accepted. | `docs/HANDOFF.md`, ivanmueller/gss#183 |
| A-02 | Bid, offer and freight revision tables | Insert grants are not limited by column. | Hardening only; no check depends on `created_at` there today. Tracked as F-126 (Offered). | `docs/FEATURES.md` F-126 |
| A-03 | "What they buy / sell" during archiving | Not locked while a company is being archived. | Not reported or tested; tracked as F-127 (Offered). | `docs/FEATURES.md` F-127 |
