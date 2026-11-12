# Features and tests tracker

One list of what GSS has, what is still to build, what the owner still has to check on staging, and what the tests cover. Read it at the start of every session, together with `docs/HANDOFF.md` (the current status and latest merges). Finished items move word for word to `docs/FEATURES_DONE.md`, and older merge records are in `docs/HANDOFF_HISTORY.md`: search those for an ID when a task needs it, without reading them whole. The design intent stays in `MASTER_PROJECT_SPECIFICATION.md` and the tickets in `docs/BUILD_PLAN.md`; this file only tracks them.

## How to use this file

**Statuses**

| Status | Meaning |
|---|---|
| **Needs owner input** | Cannot start until the owner answers the questions listed with it. |
| **Planned** | Agreed and defined; not started. |
| **In progress** | A branch or pull request exists (named with it). |
| **Live, check pending** | Merged and deployed to staging; the owner has not checked it yet. |
| **Checked** | The owner checked it on staging (date given). |
| **Offered** | Suggested by an agent, not asked for; built only if the owner says so. |

**Rules**

1. Each item has a stable ID (`F-###`), never reused or renumbered. A ticket from `docs/BUILD_PLAN.md` (`GT-###`) is named beside it when there is one.
2. A new request from the owner is added here before any code is written, under "To build", with its open questions. Never fill in an answer that is the owner's to give (costs, privacy, retention, prices, tables).
3. A pull request names the IDs it works on. After each verified merge, the same commit that records the merge in `docs/HANDOFF.md` updates the statuses here (to **Live, check pending**) and adds the owner's checks to "Owner checks on staging". The records of all the merges of one session go in one documents-only pull request (at the end of the session, or at the next `/start`).
4. When the owner reports a check done, mark it **Checked** with the date. When a check fails, the item goes back to **In progress** with what was wrong. In the records commit, a "To build" row that is **Checked**, **Not needed**, or **Live** with nothing for the owner to check moves word for word to `docs/FEATURES_DONE.md`, under the same heading; **Live, check pending** rows stay here until checked.
5. Never mark something built or checked that is not; never move an item to **Checked** on an agent's own test.
6. No real business data in this file (names, contacts, phone numbers, prices): the repository is public.

## 1. To build

### Next up (the owner's order, 2026-11-09)

The owner moved Cloudflare to the Workers paid plan on 2026-11-09. In this order:

#### 1. F-114 — Email through the platform, written by hand and drafted by Claude

**Status:** Live, checked by the owner 2026-11-12 (steps 1 to 5; the reminder of step 5c part 2 waits for its first one, from 2026-11-18, F-231); sending attachments (answer 4) to come. Step 5c part 2 (reminders after 3 business days, answer 33; earlier emails as context for the readings, answer 26) merged as ivanmueller/gss#236 on 2026-11-12, live, thread context checked 2026-11-12, reminder check pending (F-231); steps 1 to 5 all merged and checked, sending attachments (answer 4) remains. Earlier: step 5c part 1 (email drafts Claude makes by itself after calls and received email, answers 25 to 34 but 33) merged as ivanmueller/gss#234 on 2026-11-12, live, checked 2026-11-12 (F-230). Earlier: step 5b (Reply on a received email and Draft with Claude on the email form) merged as ivanmueller/gss#232 on 2026-11-11 (2026-11-12 UTC), live, checked 2026-11-12 (F-229). Earlier: step 5a (Claude reads each received email on a company and drafts bids, offers, follow-ups and contact details) merged as ivanmueller/gss#229 on 2026-11-11 (2026-11-12 UTC), live and checked by the owner on 2026-11-11 (F-228). Earlier: step 4b (received mail on no company: the list, Link to a company, Delete, attachment downloads) merged as ivanmueller/gss#226 on 2026-11-11, live and checked by the owner on 2026-11-11 (F-227); step 4a (replies received, ivanmueller/gss#222) live and checked the same day after the owner added the catch-all routing rule (F-226); step 5 (Claude) next. Earlier: steps 1 to 3 merged (ivanmueller/gss#216 and #218 on 2026-11-10, #219 on 2026-11-11); step 3, send by hand, live, checked 2026-11-12 (F-225), sending on once the owner adds two Worker secrets; the owner's Cloudflare setup done on 2026-11-10 (unused IONOS mail records removed, sending and receiving onboarded, no routing rules yet; Email preview kept on, the owner's choice). Step 4, replies received, next. **Asked:** 2026-11-06 (as an idea), direction given 2026-11-09: email sent by hand and drafted by Claude (as Claude drafts from call transcripts today); no Microsoft 365 for the business yet; the business has its own domain; Cloudflare on the Workers paid plan.

**Approach (proposed by an agent 2026-11-09, to be recorded in `docs/DECISIONS.md` once the owner answers):**
- **Sending:** Cloudflare Email Service from the existing API Worker (its `send_email` binding), from a GSS address on the owner's domain. Not Cloudflare's Agents SDK or "email agents": no runtime agent framework (`AGENTS.md` rule 9), and nothing answers an email by itself.
- **Receiving (the owner's choice, 2026-11-10: option A, the platform is the mailbox):** Email Routing on the domain itself, all its mail (info@, each person's address, replies) passed to the same Worker: each message kept and shown on its company's page, or in a short list to link to a company when it matches none; nothing forwarded, as the business has no mailboxes yet. Option B later (real mailboxes, such as Microsoft 365): the domain's mail records move to that provider and the platform sends and reads through each person's mailbox; emails already kept stay.
- **Claude:** **Draft with Claude** on the email form (from the company's records, or a call), and Claude reading each received reply for drafts of bids, offers, follow-ups and contact details, shown and verified as the transcript drafts are (F-115, F-116), every price, quantity and phone number checked by the Worker against the source text. One request per draft or reply, no tools. A person always reviews and clicks **Send**; Claude never sends (`AGENTS.md` rule 8).
- **Later, Microsoft 365:** the sending code kept in one module, so sending through each person's Outlook (Microsoft Graph, the email then in their Sent folder) can replace it. When the domain moves to Microsoft 365: its MX records to Microsoft, and its one SPF record naming both Cloudflare and Microsoft.

**Found on 2026-11-09 from search results quoting Cloudflare's pages** (the pages themselves could not be opened from the build session; to be read and recorded before building): sending in public beta since 2026-04-16 (HTML, plain text, attachments, custom headers); to any address only from a verified domain and on Workers Paid, 3,000 emails a month included, then USD 0.35 per 1,000; at most 50 recipients and 25 MiB (attachments included) per email; Email Routing (receiving) unlimited. Not confirmed: whether a Reply-To can be set when sending (if not, emails are sent from the platform's subdomain address).

**Build plan** (each step a pull request; Codex review before merge for steps 2 to 5):
1. **Decisions and setup** (documents and owner steps): the owner's answers and Cloudflare's published terms, limits and price recorded in `docs/DECISIONS.md`; the owner removes IONOS's unused mail records, onboards the domain for sending and turns on Email Routing for the domain (exact click paths given then); a Worker secret only if the design needs one (signing reply addresses).
2. **Emails stored** (migration): an emails table in `app` (direction, company, contact, sender, recipients, subject, text, the provider's message id, status, times in UTC), linked to the contact history entry; row level security, `app_api` grants, pgTAP tests with cross-organization denials; retention as the owner decides.
3. **Send by hand:** **Email** beside a contact's address on a company's page, and **New email** in its ⋯ menu; a form (To from the company's contacts, Subject, message), **Send**; the Worker sends it, keeps it and logs it in the contact history; roles as the owner decides; refusals (no verified domain, over the limit, a bounce) shown plainly. Unit, API, database and browser tests.
4. **Replies received:** the Worker's email handler takes the domain's mail, matches it to the email it answers or else to a contact by address, logs it on the company's page, refuses auto-replies and loops; mail matching nothing goes to a short list (like **Calls to GSS's number**) to link to a company.
5. **Claude:** **Draft with Claude** on the form (a draft in Claude's colours, edited, then sent by the person), and drafts from each received reply, as from transcripts.
6. **Owner checks on staging**, then the handoff record.

**Owner's answers (2026-11-10):**
1. **Sending address:** both. A person sends from their own address (name@ the domain) or picks the shared address, **info@** the domain. No mailboxes exist yet (the owner, 2026-11-10: nothing is set up for email at IONOS or elsewhere).
2. **Replies:** first answered as a subdomain kept for the platform (`reply.` + the domain), provided Outlook or another provider stays easy to link later. With no mailboxes, the owner chose on 2026-11-10 **option A: the platform is the mailbox** (all the domain's mail received by the platform; read in the platform only, also on a phone's browser), and **option B later**, once mailboxes are set up (each person's inbox; the platform then sends and reads through it). Sending stays in one module so B replaces it.
3. **Who may send:** everyone on the team.
4. **Attachments:** text only at first; PDFs and photos once sending and replies are checked on staging.
5. **Signature:** one standard GSS signature for the whole team, edited by **admins only**, with each person's **name, title, phone and email**. Saved templates: not asked for.
6. **How long emails are kept:** forever, as call transcripts.
7. **Claude on replies:** yes, Claude reads every received reply and drafts bids, offers, follow-ups and contact details, verified by a person as from calls.

**Owner's answers for step 2 (2026-11-10):**
8. **Who reads whose email:** everyone on the team reads every email, including mail sent to another person's address.
9. **Mail that matches no company:** kept forever, with a way to delete it by hand (an agent's reading, to be confirmed: deleting hides it from every list and keeps the row, as the contact history's removals).
10. **Who links unmatched mail to a company (and deletes it):** anyone on the team.

**Owner's answers for step 3 (2026-11-10):**
11. **Phone in the signature:** a number admins type on Team for each person (beside their address); a person's private cell stays private.
12. **Title in the signature:** set by admins on Team for each person, with their address.
The owner also confirmed answer 9's reading (deleting hides the email and keeps the row) the same day.

**Owner's answers for step 4 (2026-11-11):**
13. **Attachments on received mail:** kept (the files themselves, to show later), not only their names.
14. **Mail that fails the sender checks:** kept, marked suspicious (Cloudflare itself refuses mail that fails its sender domain's own DMARC policy before the platform sees it).
15. **Mail to an address that belongs to nobody** (a typo, an old address): kept, in the list of mail on no company.

**Owner's answers for step 5, Claude (2026-11-11):**
16. **What Draft with Claude writes from:** everything on the company, chosen by context: when a call said an email would follow about something specific (for example "I'll send you an email about the barley"), the draft is about that.
17. **Claude reading received replies:** automatically, each reply as it arrives (one Anthropic request per reply).
18. **Where drafts from replies show:** in the same places as drafts from calls (Bids and offers, Follow-ups and Contacts on the company's page, and the main Bids & offers and Follow-ups pages).
19. **Tone of Claude's emails:** warm, short, plain business wording.

**Step 5 plan (proposed by an agent 2026-11-11, before the Codex design review):** two pull requests, both high risk (Claude, database).
- **5a, Claude reads each received email.** The 2-minute job reads received mail on a company as it reads call transcripts (claims, at most 5 tries, a few per run, one request per email, no tools, the same model and checks). Drafts go in the existing drafts table (`app.call_drafts`, a new migration: `call_id` and `recording_id` may be empty when a new `email_id` is set, exactly one source), so they show and are verified where call drafts are, marked "From an email of …" with the email's lines cited, and quotes saved from them have source `email`. Read: received mail on a company, not automatic, not unreadable, not removed; mail on no company is read once it is linked. Not read: emails sent by GSS, auto-replies, mail that failed the sender checks (question 20), attachments (text only), mail received before 5a goes live. The text Claude sees: the email's own new text, the quoted earlier messages left out (lines starting `>`, and from "On … wrote:" or "From: … Sent:" on), so GSS's own prices quoted back are never taken for the other side's; at most about 20,000 characters, longer mail cut with a note. Every price, quantity and phone number kept only when copied whole from a cited line (`checkReading`'s rules); a contact draft can come from the sender's signature. A follow-up drafted from an email is assigned to the GSS person whose email it answers, else the person whose address it was sent to, else left for the person who verifies it to choose. A removed email's open drafts stop showing. The email text is a record, never instructions to Claude.
- **5b, Draft with Claude on the email form**, and a **Reply** on a received email (opens the form to the sender, "Re: …", linked so their answer matches). **Draft with Claude** sends Claude one request with: the company's records (as for the company summary: details, contacts, contact history with Claude's call notes, live bids and offers, open follow-ups), the transcript of the latest call with the company in the last 7 days (so "I'll email you about the barley" leads the draft), the email being answered and the last few emails with the company, who it is to and from, and an optional line the person types ("What's it about?"). Claude writes a subject and a message, warm, short and plain, without a signature (the platform adds it). The draft fills Subject and Message, marked as drafted by Claude; nothing is saved or sent until the person edits it and clicks **Send** (`AGENTS.md` rule 8). The Worker checks every price, quantity, phone number and date in the draft against the records sent: any not found is listed above the message as **Check this** before Send. A sent email records that Claude drafted it. A limit per person per hour guards the cost.

**Owner's answers for step 5, continued (2026-11-11):**
20. **Mail that failed the sender checks:** skipped; Claude does not read it.
21. **Model for Draft with Claude:** Opus 5.5, the model that reads calls.
22. **Reply on a received email:** built now, with 5b.

**Owner's answers for step 5b (2026-11-11):**
23. **Limit on Draft with Claude:** none per person (the owner's choice).
24. **"What's it about?" line:** optional.

**Owner's direction, 2026-11-11 (after step 5a):** Claude's email work should not act only from email threads.
25. **Email drafts from calls:** when a call says an email should follow (for example a buyer asks for an email with what GSS has), Claude drafts that email after the call is read, ready for a person to check and send.
26. **Thread context:** Claude reads the whole thread (earlier messages both ways) for context, but drafts the best answer to the most recent email.
27. **"What we have" in an email to a buyer:** grain, grade, quantity, delivery period and area only; no prices (Claude leaves a marked blank the person must fill before **Send**) and never a seller's name.
28. **Automatic reply drafts:** only when a received email needs an answer (a question, a request), none for thanks, out-of-office or FYI mail; and a follow-up (reminder) drafted too when the thread calls for one.
29. **Where ready email drafts wait:** on the company's Emails card and on the Follow-ups page, assigned to the person who made the call or whose email it answers; opened, edited and sent, or dismissed.
30. **Unhandled email drafts:** stay until sent or dismissed, showing their age.

**Owner's answers for step 5c (2026-11-12):**
31. **From address of an automatic draft:** the assigned person's own address (from their Team profile); the person can switch it to the shared address before sending. With no one assigned, or no address of their own, the shared address.
32. **A reply draft no one is assigned to** (for example a contact writing to the shared address out of the blue): anyone on the team may open, send or dismiss it.
33. **Reminder after no answer:** left to the agent's judgment of business habit. Chosen (an agent, 2026-11-12): one reminder draft, 3 business days (Monday to Friday, Alberta time; holidays not counted) after a GSS email that asked for something got no answer, no other email to the company and no logged contact with it since. Never a reminder of a reminder.
34. **How people learn a draft is waiting:** left to the agents (Claude and Codex). Chosen: drafts for the signed-in person (and drafts for anyone) counted in the number beside **Follow-ups** in the menu, listed on the Follow-ups page and on the company's Emails card. No push notification or email.

**Step 5 plan, revised (an agent, 2026-11-11, before the 5b design review):**
- **5b, Draft with Claude and Reply** (as planned above), with the whole thread given to Claude as context and the newest email the one answered; no per-person limit (answer 23).
- **5c, email drafts made by themselves:** after a call is read, one email draft when the call asked for an email (answer 25); after a received email is read, one reply draft when it needs an answer, and a follow-up draft when the thread calls for one (answer 28). Shown as answer 29 says, kept as answer 30 says; nothing is sent until a person clicks **Send** (`AGENTS.md` rule 8). Automatic drafts stay under the organization's daily ceiling of Claude requests (200 a day, a guard against a mail loop or flood); the button is not counted against it.
- **Thread context for step 5a's readings:** earlier messages of the thread given to Claude as context only; prices, quantities and phone numbers in a bid, offer or contact draft still taken only from the newest email's own lines, so GSS's own prices quoted back are never drafted as the other side's.
- Every price, quantity, phone number and date in an email draft is checked by the Worker against the records sent; any not found is listed as **Check this** before Send; the "what we have" blank for a price blocks Send until filled.

Step 2 merged (ivanmueller/gss#218, 2026-11-10). Step 3 merged (ivanmueller/gss#219, 2026-11-11; register `docs/reviews/F-114-3.md`): send by hand. A sent email is logged in the contact history only when the sender's role logs contacts (viewers and analysts send, and their emails are kept with the company's emails). Found while planning: Cloudflare sets each email's Message-ID itself (custom Message-ID headers are refused) and returns its id from `send()`; the platform keeps that id, and step 4 matches replies against it once a real reply is seen on staging.

**Read from Cloudflare's documentation on 2026-11-10** (developers.cloudflare.com, Email Service pages; to be recorded in `docs/DECISIONS.md` in step 1): sending to any address needs a sending domain onboarded on Cloudflare DNS and Workers Paid; From any address on that domain, with a display name; a **Reply-To can be set** (`replyTo`); text and HTML; at most 50 recipients and 25 MiB per email, 32 attachments; 3,000 emails a month included on Workers Paid, then USD 0.35 per 1,000, new accounts on a daily quota that grows (no number published); still called a beta; sending's own DNS records go on a separate `cf-bounce` name, leaving the domain's SPF and IONOS mail untouched. Receiving (Email Routing) forwards only to verified addresses (each person's inbox verified once) and takes messages up to 25 MiB. Email Routing puts its records on the main domain and refuses to start while other mail records exist there. **The domain's DNS on Cloudflare (seen by the owner, 2026-11-10):** IONOS's default mail records, with no mailboxes behind them (two MX, an SPF TXT, two DKIM and a DMARC CNAME, and autodiscover); for option A they are removed in step 1, then Cloudflare adds its own; a DMARC record is also recommended by Cloudflare. Nothing is to be changed before step 1's exact steps.

#### 2. Paid-plan follow-ups (the Workers paid plan, 2026-11-09)

Work shaped by the free plan's limit of about 10 ms of computing per request, to loosen or simplify now that the plan is paid. Cloudflare's paid limits were read from its published page and recorded in `docs/DECISIONS.md` on 2026-11-10: 30 seconds of computing per request by default (the Worker sets no lower limit), 30 seconds per run of the 2-minute job, waiting on Anthropic, Telnyx or the database not counted, memory still 128 MB. Each change keeps its tests; the size checks stay (they guard against abuse, not only the plan).

All of this is done: see `docs/FEATURES_DONE.md`.

### Owner's list (2026-11-06)

| ID | Feature | Status | What it needs before work starts |
|---|---|---|---|
| F-101 | **Change map markers** | Needs owner input | Today every place is a round dot: buyers in the bid colour, sellers in the ask colour, filled for an exact location and hollow for an approximate one. Which maps (Workspace, Counterparties map view, a company's small map, lanes), and what should change: shape, colour, logo in the marker, size, grouping of close places, labels? |
| F-102 | **CSV template for importing buyers and sellers** | Planned | A **Download template** link in the + window's Import spreadsheet step: a CSV with the column headers the import recognizes, the required ones marked (today **Company name** and **Country**), and one made-up example row. One template for buyers and sellers, or one each (sellers have Grain type, Seller kind, Tonnes a year, Organic certificate; buyers have Market)? The carrier sheet could get its own. |
| F-103 | **Buying frequency and contracts** | Needs owner input | What to record: how often each buyer buys (e.g. monthly, by season), its usual tonnes, standing contracts (start, end, tonnes, commodity)? Entered by hand, or counted from bids, offers and the contact log? Shown where (buyer's page, a filter on Counterparties)? Contract documents themselves are Phase 6 (GT-061). |
| F-104 | **Backload strategy** | Needs owner input | Our reading: when a carrier delivers to a buyer, find a load for the trip back (or the reverse), from carriers' lanes and freight rates and sellers near the drop-off. To confirm: which direction, how near is "near", and whether it should suggest loads or only show them on the map. Relates to candidate matching (GT-053). |
| F-105 | **Buyer verification checklist, split view** | Needs owner input | A list of what to confirm before a buyer counts as verified: its facility on the map, the grains it takes (from the 20 commodities, with the verified grains already built), the type of buyer (its markets: Pet, Bird, Equine…), and more. Shown as a split view: the checklist on one side, the map and details on the other. To decide: the full checklist, who may verify (today anyone on the team verifies grains), whether a buyer is "verified" only when every item is ticked, and whether the split view replaces the buyer's page or is a separate review screen. |
| F-106 | **Trading engine and saved trade scenarios** | Planned | GT-040 to GT-046 (Phase 4). Decimal arithmetic only; missing FX, freight or unit conversion blocks the margin; saved scenarios never recalculated in place. Gate: the synthetic 42 MT example returns exactly CAD 46.00/MT and CAD 1,932.00 (`docs/ACCEPTANCE_TESTS.md`). Codex review (money). |
| F-108 | **Bushel price conversion** | Needs owner input | The owner's approved pounds-per-bushel table (`docs/TRADING_RULES.md` §5.3). Until then bushel prices stay out of the order book. Codex review (money). |
| F-109 | **Audit history page** | Planned | GT-016. Who changed what and when, from the audit trail the database already keeps; admins only? (owner to confirm). |
| F-110 | **Backups and a restore drill** | Needs owner input | GT-017. Needs a paid Supabase plan (a cost: the owner's decision). Until then the source spreadsheets are the backup. |
| F-111 | **Stop other sites showing the app inside their pages** | Offered | Small and optional: headers that refuse framing. No owner input needed beyond yes or no. |
| F-112 | **Verify USD rate tracking** | Planned | A check of the Bank of Canada connector (GT-052, built): a rate stored for each business day (the Worker fetches at 14:15 and 22:15 UTC), the workspace labelling the rate's day, USD bids and offers converted at it, and left out with a note when the rate is more than four days old. If gaps are found, fix them; a page listing the stored rates is possible if wanted. |
| F-113 | **Daily market report and news** | Needs owner input | One page (and possibly a morning email) gathering what matters to the desk each day: grain futures, weather in growing and delivery areas, world news affecting grain, and crop statistics. Sources named by the owner: Reuters, Barchart, DTN and Bloomberg (commercial, licensed feeds), and USDA, Statistics Canada, Agriculture and Agri-Food Canada and Environment Canada's weather (public agencies). Before any work: each source's data access, terms of use and price checked from its own published pages (never assumed) and recorded in `docs/DECISIONS.md`; the owner chooses which paid feeds to buy (a cost). To decide: which commodities, futures contracts and regions; whether prices are only shown or also used in calculations (shown only until GT-064, licensed price-feed adapters, is approved; never used as a GSS bid or offer); one daily report or live through the day; and whether Claude may write a short summary of the news (a new use of Anthropic's API, needing the owner's decision and the same rules as the company summaries: no number or price in Claude's own words). Every item shows its source and time; nothing predicted. Keys for paid feeds are Worker secrets the owner adds; every feed is fetched by the Worker, never the browser. |
| F-114 | **Email through the platform** | Live, checked 2026-11-12 (steps 1 to 5; the reminder of step 5c part 2 waits for its first one, from 2026-11-18, F-231); sending attachments to come | The owner's first priority since 2026-11-09: see "Next up" above, with its build plan and answers. |

### Earlier requests and offers still open

| ID | Feature | Status | Notes |
|---|---|---|---|
| F-120 | **Texting through the platform** (Telnyx) | Needs owner input | Approved 2026-11-02 (`docs/DECISIONS.md`) and asked for again 2026-11-06. A person texts a counterparty's contact from its page (beside Call on a phone number), and replies come back to the same conversation; every text sent or received logged in the contact history. Callbacks moved to F-132. Telnyx called from the Worker only; its webhooks accepted only with a valid signature. Owner decisions first: the sending number (GSS's Telnyx number or another), who on the team may text, whether texts are kept and for how long, attachments (photos) or not, the cost. The sending rules (business registration for texting, opt-outs such as STOP) checked from Telnyx's and the regulators' published pages, not recalled. Claude never sends a text; at most it drafts one a person sends, if the owner approves that use. Codex review (phone). |
| F-144 | **Commodity hot zones: where it is grown, where it is used, and the routes between** | Needs owner input (future idea: not to start until the owner asks) | Asked 2026-11-09 as an idea for the future, recorded only; nothing is to be built now. A map view that pulls in where each commodity is produced (in Canada, the U.S. and the world) and where demand for it is concentrated, and highlights the "hot zones": for example, the places in the U.S. needing barley, wheat and other grains, judged by how many end users are there (pet food makers, bakeries and flour mills, maltsters, feed mills…). It could also draw trade routes from the best producing areas to those hot zones. The owner's example also names steel (hot zones from where its end users are): other commodities than grain would widen the platform beyond grain trading. Builds on the map layers (F-107, F-141: the crop density heat maps already show where crops are grown); relates to the daily market report (F-113), backloads (F-104) and candidate matching (F-129). Questions for when it is taken up (none needed now): (1) which commodities, and whether non-grain ones such as steel are in scope; (2) the sources for production (e.g. USDA, Statistics Canada, Agriculture and Agri-Food Canada, FAO) and for end users (e.g. a business register such as the U.S. Census Bureau's County Business Patterns, a paid company database, or GSS's own buyers), each with its terms of use and any cost, named by the owner, never invented; (3) how a hot zone is measured (number of plants, their size, tonnes used if published) and shown (shaded areas, heat map, dots); (4) whether trade routes are drawn as straight lines from producing areas to hot zones or along rail and road (licensed routing is F-128); (5) whether it is reference only, like Grains, or tied to GSS's counterparties (e.g. hot zones with no buyer of ours yet). No predicted prices (AGENTS.md rule 9). |
| F-121 | **Hang up** button in the live call box | Offered | For calls placed from the platform and callbacks to GSS's number alike (both show in the call box since #164). A change to the calling commands; Codex review. |
| F-122 | **Quote import from files** | Planned | GT-035. |
| F-123 | **Grades as a list** | Planned | GT-015. |
| F-124 | **Typical use of each grain class** (feed, milling, malting, pet and bird) | Offered | From a published source or the owner's list, never from memory. |
| F-125 | **Ontario's Eastern wheat classes** on Grains | Offered | Left out by the owner's choice (2026-11-05); add if a buyer asks for Ontario winter wheat. |
| F-126 | Column-limited insert grants on the bid, offer and freight revision tables | Offered | Hardening; no check depends on `created_at` there today. |
| F-127 | Lock "What they buy / sell" while a company is being archived | Offered | The pattern of Codex's first finding on the lanes; not reported or tested. |
| F-128 | Licensed road routing | Planned | GT-051 (Phase 5). |
| F-129 | Candidate matching and comparison | Planned | GT-053, GT-054, GT-055 (Phase 5). |
| F-130 | Production deployment | Planned | After the owner's go-ahead; backups (F-110) first. |
| F-131 | Farm-location visibility | Planned | Specification §6; deferred by the owner until farms are added. |

Phase 6 (trade lifecycle, contracts, shipments, invoices; GT-060 to GT-067) waits for a separate release decision.

## 2. Owner checks on staging

Built and deployed, not yet checked by the owner. Details and click paths are in `docs/HANDOFF.md`, "Next exact task".

| ID | What to check | Pull requests |
|---|---|---|
| F-231 | **Reminder after an unanswered email** (F-114 step 5c part 2; its thread context was checked 2026-11-12): from a made-up test company's page, email your personal address a question and do not answer; from 2026-11-18 at the earliest (three business days later; reminders only for mail sent from 2026-11-13), "Reminder: no answer to …" on its **Emails** card and **Follow-ups → Emails to send**, for you; **Open** (To your address, "Re: …"), **Send**: the same thread in your mail program; a thanks-only email, or one answered in time, gets no reminder. | #236 |

### Company summaries: how many are done, waiting or stopped (F-201)

Read only; it changes nothing. `still_waiting` should fall toward 0 (a company waits up to an hour after new activity); `stopped_after_5_tries` counts the failed ones.

```sql
select
  count(*) as companies_with_history,
  count(*) filter (where s.written_at >= timestamptz '2026-11-06 04:53:08+00') as written_under_final_rules,
  count(*) filter (where (s.source_at is null or s.source_at < a.activity_at) and coalesce(s.attempts, 0) < 5) as still_waiting,
  count(*) filter (where (s.source_at is null or s.source_at < a.activity_at) and s.attempts >= 5) as stopped_after_5_tries
from app.counterparties c
left join app.counterparty_summaries s on s.counterparty_id = c.id
cross join lateral (select app.counterparty_activity_at(c.organization_id, c.id) as activity_at) a
where c.archived_at is null and a.activity_at is not null;
```

## 3. Built and live

| ID | Feature | Status | Main tests |
|---|---|---|---|
| F-001 | Sign-in with email, password and an authenticator app; Team page | Live | `auth.spec.ts`, `team.spec.ts`; `member_management`, `tenancy` (pgTAP); `members`, `logins` (API) |
| F-002 | Counterparty directory (buyers, sellers, brokers, carriers), editing, archiving, deleting | Live | `counterparties.spec.ts`; `counterparties`, `counterparty_editing`, `counterparty_deletion` (pgTAP); `directory`, `editing` (API) |
| F-003 | Spreadsheet import, updates from a later file, Undo an import | Live | `counterparties.spec.ts`; `facility_import_batch`, `counterparty_import_lock`, `undo_import` (pgTAP); `undo-import` (API); `ImportSpreadsheet.test.tsx` |
| F-004 | Map view (Mapbox) and coordinates with Geocodio | Live | `facility_map`, `facility_geocoding` (pgTAP); `coordinates`, `geocoding`, `facilities` (API) |
| F-005 | Website, logos, company phone, phone format, rail or truck per location | Checked 2026-10-29 (website) | `counterparty_website`, `phone_format`, `counterparty_phone_access_verified` (pgTAP); `website`, `phone` (API) |
| F-006 | What each company buys or sells, markets, tier, seller details | Live | `counterparty_commodities`, `counterparty_market_tier`, `seller_details` (pgTAP) |
| F-007 | Bids and offers with revision history | Live | `counterparties.spec.ts`; `quotes` (pgTAP); `quotes` (API) |
| F-008 | Workspace map and order book in CAD per tonne; Demo data switch | Live | `desktop.spec.ts`, `phone.spec.ts`; `orderBook`, `workspaceQuotes` (web) |
| F-009 | Bank of Canada USD/CAD rate (GT-052) | Checked 2026-10-29 (a stored rate) — see F-112 | `fx_quotes` (pgTAP); `fx` (API, domain, web) |
| F-010 | Freight rates, carriers, lanes and equipment | Checked 2026-10-29 (Freight page) | `counterparties.spec.ts`; `freight_quotes`, `carrier_lanes`, `lane_verification` (pgTAP); `freight`, `lanes` (API) |
| F-011 | CRM: contact history, follow-ups, Follow-ups page, main contact, pins and removals | Live | `counterparties.spec.ts`; `counterparty_crm`, `follow_up_removal`, `contact_log_pins_removals`, `counterparty_main_contact` (pgTAP); `crm` (API) |
| F-012 | Alberta time on every screen | Checked 2026-10-29 | `alberta` (domain), `time` (web) |
| F-013 | Calling through Telnyx, recordings and transcripts by side | Checked 2026-11-03 (transcripts) | `telnyx_calls`, `call_commands`, `call_recordings` (pgTAP); `calls`, `call-steps` (API) |
| F-014 | Claude's reading of call transcripts (drafts) | Checked 2026-11-12 (the owner; F-202) | `call_readings` (pgTAP); `readings` (API, domain) |
| F-015 | Company summaries | Checked 2026-11-12 (the owner; F-201) | `counterparty_summaries`, `counterparty_summary_retries` (pgTAP); `summaries` (API, domain) |
| F-016 | Grains reference (19 grains, classes, grades, varieties) | Checked 2026-11-12 (the owner; F-210) | `grains`, `grainClasses`, `grainWindow`, `grainLinks` (web); `scripts/check-grains.js` |
| F-017 | Callbacks to GSS's number (F-132) | Checked 2026-11-12 (the owner; F-212) | `callbacks` (pgTAP); `callbacks` (API, API database); `Callbacks.test.tsx` (web) |

Test file names are short: `*.spec.ts` are browser tests in `tests/e2e/specs/`; "pgTAP" files are `supabase/tests/database/<name>.test.sql`; "API" files are `apps/api/src/<name>.test.ts` and `<name>.db.test.ts`; "domain" files are in `packages/domain/src/`; "web" files are in `apps/web/src/lib/` and `apps/web/src/components/`.

## 4. Tests and maintenance

### What CI runs

`pnpm check` (format, lint, typecheck, unit tests of domain, API and web), the API's database tests, the pgTAP database tests and the Playwright browser tests, on every pull request and on `main`. Test counts for each merge are in `docs/HANDOFF.md`, "Tests run on the merged state".

### Open test and CI issues

| ID | Issue | Status |
|---|---|---|
| T-01 | Browser test "enters an offer, records new terms, and withdraws it" failed once (CI run #331, `counterparties.spec.ts:562`): after the withdrawal, "No live bids or offers here." not seen within 5 seconds. The test's fault, not the app's; likely cause: the Bids & offers list showing its kept answer, with the offer still live, before it refreshes. | Fixed in ivanmueller/gss#194 (2026-11-10 UTC): the quote page forgets kept quote lists after a withdrawal or new terms, two regression tests; the first real use of the Claude + Codex review loop (F-149). Watch a few CI runs before closing it. |
| T-02 | CI's local database refused its port (runs #342, #357, #367), with nothing listening on it: the port lies in Linux's range for outgoing connections. | Retries added in #159 did not help on #367; #162 reserves ports 54320 to 54329 as the job's first step. Its first run on `main` (#371) started the database at the first try and passed. Watch a few more runs before calling it fixed. |
| T-03 | Browser tests missing for: Grains, calling, callbacks and transcripts (needs a fake Telnyx), Claude's drafts and summaries (needs a fake Anthropic), lanes map and map layers (no Mapbox token in CI). | Planned, one area at a time. |
| T-04 | **Noisy GitHub Actions** (local tests possible since 2026-11-11: Docker, pnpm and the Supabase CLI on the build computer) (the owner, 2026-11-11, from the Actions page during F-114 step 3, ivanmueller/gss#219: CI runs #516 to #524 and Merge policy runs #58 to #67, red and grey one after another). Causes: (1) pushes minutes apart (a fix, then its review record) each restart the full CI, and `cancel-in-progress` cancels the run before (grey); (2) Merge policy runs on every push, also on drafts, and fails (red) until the review is complete, by design, but it reads as an error; (3) real failures that CI found because the database tests could not run on the build computer (no Docker), and a formatting slip. | Working habits, from 2026-11-12: run the database and browser tests locally before pushing (once Docker Desktop is installed); push the code and its review record together; keep a pull request a draft until its review is complete; format every changed file before each commit. To decide with the owner (governance: changes to `.github/workflows/` need a reviewed pull request and the owner's approval of the exact commit): Merge policy skipped on draft pull requests and on edits of the description; CI's long jobs skipped when only `docs/reviews/` changed (the required `check` still reporting, or merging would wait forever); Prettier run on staged files before each commit. |

### Dependency updates

| ID | Pull request | Status |
|---|---|---|
| D-01 | Dependabot #191 (was #112): 15 minor and patch updates | Reopened 2026-11-09. Still fails lint (one `no-unnecessary-condition` error at line 400 of a changed file, as before at `FacilityMap.tsx`); redo on our own branch with the lint fixed and a review register. |
| D-02 | Dependabot #192 (was #113): postgres (the Worker's database library) 3 → 4.1.0, a major version | Its CI failed one browser test ("adds a carrier, enters its rate per load…", `counterparties.spec.ts:635`; unit and database tests passed). To test on its own branch with all database tests, finding whether postgres 4 or a flaky test is the cause; Codex review. |
| D-03 | Dependabot #114: `@types/node` 22 → 26 | Not wanted: CI and deploys run Node 22. Close, and tell Dependabot to skip major `@types/node` updates. |
| D-04 | Dependabot #190: `supabase/setup-cli` action 1 → 3 | Changes `ci.yml` and `deploy-staging.yml`: governance, so it needs a review register and the owner's approval of the exact commit. Merge policy held it (2026-11-10), as designed. |
| D-05 | Dependabot #193: jsdom 30 → 31 (web tests only) | A major version of a test library; CI green; needs a review register. |
