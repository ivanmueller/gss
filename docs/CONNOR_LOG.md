# Connor's work log

What Connor (GitHub `connorrodewald`) has done on GSS, newest first, so Ivan can see it. Feature IDs (`F-###`) refer to `docs/FEATURES.md`.

This file is only a log. Statuses in `docs/FEATURES.md` and `docs/HANDOFF.md` are still updated by the integration owner after a merge (`AGENTS.md` rule 10). The repository is public, so this log holds no real business data: no names, contacts, phone numbers or prices.

## How entries are written

- **Date** (Alberta time), then what was done.
- **Staging checks:** the `F-2##` ID, **Pass** or **Fail**, and for a failure what was wrong (the click path and what was seen). The tick list is `docs/CONNOR_STAGING_CHECKS.md`.
- **Answers to owner questions:** the `F-###` ID, the question's number and the answer.
- **Code or document changes:** the branch and the pull request.

## 2026-11-09

- Read `docs/FEATURES.md` with Claude Code to see what is waiting on us. Open items:
  - **Questions to answer:** F-114 email (7 questions, the top priority), F-101, F-103, F-104, F-105, F-108, F-110, F-113 and F-120. Quick yes or no on F-109, F-111, F-121 and F-124.
  - **Staging checks not yet done:** F-201 to F-222.
- Started this log, and a tick list for the staging checks (`docs/CONNOR_STAGING_CHECKS.md`).
- **F-114 email: proposed answers for Ivan to approve.** Ivan decides; nothing here is final until he says so. Where these answers come from: Claude Code's suggestions, based on how the platform already handles calls (`docs/DECISIONS.md`) and the roles in `packages/domain/src/members.ts`. Cloudflare's own pages were not read. Ivan: reply on the PR with **OK** or your change for each one.

  | # | Question | Proposed answer | Why |
  |---|---|---|---|
  | 1 | Sending address: each person's own, or one shared? | **Each person's own** (name@ the domain). | Counterparties deal with a person, as on calls, where the caller's own cell is used. A reply then reaches the person who wrote. A shared address (trading@) can be added later for general enquiries. |
  | 2 | Is the domain's DNS on Cloudflare? Which subdomain for replies? | **Ivan to check:** Cloudflare → Websites, is the domain listed? Subdomain: **`reply.`** + the domain, as the plan suggests. | Only Ivan can see the Cloudflare account. A dedicated subdomain keeps the main domain's mail free to move to Microsoft 365 later. |
  | 3 | Who may send? | **Traders, operations and admins.** Viewers and analysts may not send. | Traders deal with buyers and sellers. Operations deals with carriers and counterparty details. Viewers and analysts only look. |
  | 4 | Attachments, or text only at first? | **Text only at first**, attachments in a later step. | A smaller first build, and fewer files to store and check. Most first contacts are short messages. |
  | 5 | A standard signature? Saved templates? | **Yes to a standard signature** (the person's name, role, GSS and phone, set once). **Templates later.** | Every email looks professional from day one. Templates are easier to design once we see what people actually write. |
  | 6 | How long are emails kept? | **Forever, as call transcripts are.** | One consistent rule, and the contact history stays complete. Ivan may want to check Canadian privacy rules before production. |
  | 7 | Should Claude draft from received replies automatically? | **Yes, as with calls.** Drafts still need a person to click **Verify**, and Claude never sends. | It works the same way people already use for calls, and it saves typing bids, offers and follow-ups. It adds one Anthropic request per reply; Ivan should confirm the cost is acceptable. |
