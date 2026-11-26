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

**Status:** Live, checked by the owner 2026-11-12 (steps 1 to 5; the reminder of step 5c part 2 checked 2026-11-18, F-231); sending attachments (step 7) merged as ivanmueller/gss#239 on 2026-11-13, live, checked 2026-11-14 (F-232). Step 5c part 2 (reminders after 3 business days, answer 33; earlier emails as context for the readings, answer 26) merged as ivanmueller/gss#236 on 2026-11-12, live, thread context checked 2026-11-12, reminder checked 2026-11-18 (F-231); steps 1 to 5 all merged and checked. Earlier: step 5c part 1 (email drafts Claude makes by itself after calls and received email, answers 25 to 34 but 33) merged as ivanmueller/gss#234 on 2026-11-12, live, checked 2026-11-12 (F-230). Earlier: step 5b (Reply on a received email and Draft with Claude on the email form) merged as ivanmueller/gss#232 on 2026-11-11 (2026-11-12 UTC), live, checked 2026-11-12 (F-229). Earlier: step 5a (Claude reads each received email on a company and drafts bids, offers, follow-ups and contact details) merged as ivanmueller/gss#229 on 2026-11-11 (2026-11-12 UTC), live and checked by the owner on 2026-11-11 (F-228). Earlier: step 4b (received mail on no company: the list, Link to a company, Delete, attachment downloads) merged as ivanmueller/gss#226 on 2026-11-11, live and checked by the owner on 2026-11-11 (F-227); step 4a (replies received, ivanmueller/gss#222) live and checked the same day after the owner added the catch-all routing rule (F-226); step 5 (Claude) next. Earlier: steps 1 to 3 merged (ivanmueller/gss#216 and #218 on 2026-11-10, #219 on 2026-11-11); step 3, send by hand, live, checked 2026-11-12 (F-225), sending on once the owner adds two Worker secrets; the owner's Cloudflare setup done on 2026-11-10 (unused IONOS mail records removed, sending and receiving onboarded, no routing rules yet; Email preview kept on, the owner's choice). Step 4, replies received, next. **Asked:** 2026-11-06 (as an idea), direction given 2026-11-09: email sent by hand and drafted by Claude (as Claude drafts from call transcripts today); no Microsoft 365 for the business yet; the business has its own domain; Cloudflare on the Workers paid plan.

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
7. **Sending attachments** (merged in ivanmueller/gss#239 on 2026-11-13, checked by the owner 2026-11-14, F-232; planned 2026-11-12; register `docs/reviews/F-114-7.md`): files from the computer on the email form (new email, Reply, Claude's drafts once opened), at most 10 files and 10 MB in all, PDFs and JPEG or PNG photos (decided by the file's first bytes); kept in the private bucket with the email, shown with download buttons on sent email as on received; never given to Claude. Codex design review first (high risk).

**Owner's answers (2026-11-10):**
1. **Sending address:** both. A person sends from their own address (name@ the domain) or picks the shared address, **info@** the domain. No mailboxes exist yet (the owner, 2026-11-10: nothing is set up for email at IONOS or elsewhere).
2. **Replies:** first answered as a subdomain kept for the platform (`reply.` + the domain), provided Outlook or another provider stays easy to link later. With no mailboxes, the owner chose on 2026-11-10 **option A: the platform is the mailbox** (all the domain's mail received by the platform; read in the platform only, also on a phone's browser), and **option B later**, once mailboxes are set up (each person's inbox; the platform then sends and reads through it). Sending stays in one module so B replaces it.
3. **Who may send:** everyone on the team.
4. **Attachments:** text only at first; PDFs and photos once sending and replies are checked on staging. The owner, 2026-11-12: files **from the computer only** (not from files kept on a company's page); the size left to the agents: **10 MB in total per email** (Cloudflare allows 25 MiB and 32 files; attachments grow by about a third when sent, and large emails bounce more often).
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

#### 1a. F-233 — Forwarded email: mail a person received in their own mailbox, brought into the platform

**Status:** Checked by the owner 2026-11-13 (merged as ivanmueller/gss#241 on 2026-11-13; register `docs/reviews/F-233.md`). Asked 2026-11-13. **Asked:** the owner received a logistics company's answer in their personal mailbox and wants to forward it into the platform.

**Today (found 2026-11-13):** forwarding such an email to an address on the business's domain keeps it, but the platform sees it as mail from the person's own address: it lands on **Follow-ups → Email on no company** (it can be linked by hand); Claude reads only the person's note above the forwarded part, because the forwarded block (`From: … Date:` or `From: … Sent:`) is cut as quoted mail (`packages/domain/src/emailReading.ts`); **Reply** would answer the person, not the original sender.

**Owner's answers (2026-11-13):**
1. **Who may forward mail in:** anyone on the team.
2. **Which personal addresses:** each person adds their own.
3. **Claude reads forwarded email** and drafts bids, offers, follow-ups, contact details and replies from it, as from mail received directly.

**Plan (an agent, 2026-11-13, before the Codex design review):**
- **Forwarding addresses (Team):** each person adds their own personal addresses under their name; each is confirmed by a code the platform emails to it, typed back by the person, before it counts (so nobody can name a company's or another person's address as theirs). Removed by the person; a removal is marked, not deleted. Addresses on the business's own domain refused.
- **Recognizing a forward:** received mail to a GSS address (the shared address or a person's own) from a confirmed forwarding address whose sender checks passed (DMARC). The forwarded message is read from the body (the usual "Forwarded message" block of Gmail, Outlook and Apple Mail: its From, date, subject and text) or from an attached original message (forward as attachment). The email keeps who forwarded it and the original sender's address and name, date and subject; the forwarding person stays its sender of record.
- **Matching:** on the original sender's address, a contact of exactly one company (as for direct mail); otherwise **Email on no company**, shown as "Forwarded by …, from …", linked by hand as now.
- **Claude:** reads the forwarded message's own text (its earlier quoted mail still left out, so GSS's quoted prices are never taken for the other side's); the person's note above it given as context only. Prices, quantities and phone numbers kept only when copied from the forwarded message's lines, as now.
- **Reply** (and Claude's reply drafts) go to the original sender, "Re: " + the original subject, not threaded (the original's Message-ID is not known for an inline forward).
- Not done: a forward from an address not confirmed stays ordinary mail from that person (as today); nothing is sent or answered by itself (`AGENTS.md` rule 8).

#### 1b. F-235 — Claude drafts freight rates from email and calls, on routes between areas

**Status:** Checked by the owner 2026-11-14 (both parts). Part 1 (rates between towns or areas, from any company, end date optional, entered by hand) merged as ivanmueller/gss#245 on 2026-11-14, live, checked 2026-11-14. Part 2 (Claude drafts freight rates from calls and email, verified by a person; drafts on the company's Freight rates card and the Freight page) merged as ivanmueller/gss#247 on 2026-11-14, live, checked 2026-11-14 (emails read before the deploy are not read again; a one-time re-reading of older emails for freight rates was offered, not asked for). Asked 2026-11-13. **Asked:** the owner forwarded a logistics company's email quoting a rate; Claude drafted nothing from it. Found 2026-11-13: Claude's readings of calls and email draft only bids and offers on grain, follow-ups and contact details (`packages/domain/src/readings.ts`); a freight rate is not among them. A freight rate today must come from a company marked as a carrier and run between two saved locations (`20261029020000_freight_quotes.sql`).

**Owner's answers (2026-11-13):**
1. **Route places:** not bound to saved locations; a broad address or just an area ("Morris, MB" to "Muncie, IN") must work.
2. **What Claude drafts:** rates only (not lanes or equipment).
3. **From calls too:** yes, as from email.
4. **Which companies:** any company that quotes a freight rate, not only carriers.
5. **Examples of the wording (made up):** "Morris MB to Muncie IN 335/CMT", "Morris MB to Lacrosse WI 182/CMT", "Morris, Mb to Cochrane, Wi: $2500 usd per load-25st loads". **CMT** means Canadian dollars per metric tonne.
6. **How long a rate holds:** a valid-until date is optional, on the form too; without one the rate holds indefinitely and is tagged **outdated** 30 days after it was quoted.
7. **On the map:** yes, area routes drawn at the towns found by Geocodio, doubtful matches checked by the person before saving (as for counterparties).

As everywhere: nothing Claude drafts is saved until a person clicks **Verify**, and every rate and quantity is kept only when copied whole from a cited line of the email or transcript. High risk (database, Claude, money): Codex design review first.

#### 1c. F-101 — Map markers: company types told apart, grouping, names, details on the map

**Status:** Checked by the owner 2026-11-18, with F-237 (merged as ivanmueller/gss#253 on 2026-11-16; register `docs/reviews/F-101.md`; the main type order buyer, seller, broker, carrier is an agent's reading, confirmed by the owner 2026-11-18). Normal risk (screens only: no database, money or sign-in change). **Asked:** 2026-11-06; answered 2026-11-16.

**Today:** every place on every map is a small round dot drawn by one component (`FacilityMap.tsx`): buyers in the bid colour, sellers in the offer colour, both or neither in the mixed colour; filled for an exact location, hollow for an approximate one. A click shows the place's details in a panel below the map. The pins carry only an id, a colour and the fill (no names).

**Owner's answers (2026-11-16):**
1. **What to change:** tell company types apart; and a click shows the company's details on the map, not below it.
2. **Shapes:** a teardrop pin with a small symbol inside: buyer (a building or elevator), seller (a wheat ear), carrier (a truck), broker (a handshake or two arrows). Colours stay as today; filled or hollow stays for exact or approximate.
3. **A company of several types:** the symbol of its main type, in the mixed colour when it both buys and sells.
4. **Close places:** grouped into a bubble with their count when zoomed out; a click or zooming in splits them.
5. **Names:** shown beside the markers only when zoomed in close enough not to pile up.
6. **The details box:** the company's name (a link to its page), its type and the location (place, how exact it is).
7. **On a phone:** the details slide up from the bottom of the map; on a computer, a box opens beside the marker.
8. **Which maps:** all alike (Workspace, Counterparties map view, a company's small map, carrier lanes, freight routes).

**Plan (an agent, 2026-11-16; readings to confirm marked "reading"):**
- One change in `FacilityMap.tsx` and `apps/web/src/lib/mapbox.ts`, so every map gets it (the Mapbox calls stay in that one component). Symbols drawn as small images added to the map (no new icon service, no data leaving the app); colours from the design tokens, light and dark.
- **Main type (reading):** buyer, then seller, then broker, then carrier: a buyer and seller shows the buyer symbol in the mixed colour; a seller and carrier the seller symbol. Workspace pins follow each place's live bids and offers as today.
- **Grouping:** Mapbox's own clustering of the pins; a bubble shows the count; a click zooms in on it. The selected place is never hidden inside a bubble.
- **Names:** the company name added to each pin's data and drawn from a set zoom level, Mapbox hiding labels that would overlap.
- **Details box:** name (link), type and location in a box beside the marker on a computer, a panel sliding up on a phone; closed with ✕, Escape or a click on the map. **Workspace (reading):** its list of the place's live bids and offers stays below the map, as today; only the name, type and location move into the box.
- A legend (the four symbols, filled and hollow) on the two large maps.
- Tests: unit tests of the main type and the pin data (`mapbox.ts`), component tests of the box and the phone panel, the browser tests kept green (no Mapbox token in CI, T-03, so the drawing itself is checked on staging).

**Owner check on staging (once merged):** the four symbols on the Workspace and Counterparties maps; bubbles with counts when zoomed out; names when zoomed in; a click opens the box beside the marker (on a phone, the panel from the bottom); a company's own map, lanes and freight routes look alike.

#### 1d. F-237 — Map pins as Google Maps draws saved places

**Status:** Checked by the owner 2026-11-18 (merged as ivanmueller/gss#255 on 2026-11-16 and #256 on 2026-11-17; registers `docs/reviews/F-237.md` and `F-237-2.md`; the badge colours are an agent's choice, confirmed by the owner 2026-11-18). Normal risk (screens only). **Asked:** 2026-11-16, after seeing F-101 on staging: the owner does not like the black count bubbles or the teardrop icons, and wants the pins to look like the saved places on Google Maps (three screenshots shown: Calgary close up, southern Alberta, and British Columbia to Montana zoomed out).

**Owner's answers (2026-11-16):**
1. **Zoomed out:** no bubbles or numbers: "when they zoom out it's still the same dots". Every place keeps its own pin at every zoom, overlapping where crowded, as on Google Maps.
2. **Symbols:** the same symbols (building, wheat ear, truck, arrows), white inside a round badge in the type's colour with a white edge, Google style.

**Built (an agent, 2026-11-16):** the teardrop replaced by a round badge with a white edge, a soft shadow and a short point at the bottom (`apps/web/src/lib/mapPinImages.ts`); an approximate location keeps a white centre with a ring and symbol in the colour. Grouping removed from `FacilityMap.tsx` (no bubbles, no count, no click-to-zoom on a bubble). Unchanged: colours, names from zoom 9, the details box, the larger chosen pin, the legend (drawn with the same pictures). Tests: `mapPinImages.test.ts` (white edge first, then the badge; picture size).

**Second pull request (`feat/f-237-2-bolder-pins`, asked 2026-11-16 after seeing the first on staging):** the owner: "It still looks nothing like the google maps ones. The icons should look bolder and more put together and the colours should match maps or be more similar to that style" (a screenshot of Google Maps' teal saved places in Calgary). Built: the symbols redrawn as bold filled white shapes (elevator, wheat ear, truck, two arrows) filling more of a slightly larger badge; the badges in colours close to Google Maps' own, the same in light and dark (buyers green `#1e8e3e`, sellers Google's pink-red `#e8436b`, carriers, brokers and companies that buy and sell Google's blue `#1a73e8`), chosen by an agent for the owner to confirm; lane areas and the order book keep the app's colours.

**Owner check on staging (once merged):** on the Workspace and Counterparties maps, zoomed all the way out and in: round badges with white edges and symbols, never black bubbles or numbers; crowded places overlap as on Google Maps; a click on any pin still opens its box.

#### 1e. F-238 — The map on its own page, at map.torvenco.com

**Status:** Live (merged as ivanmueller/gss#259 on 2026-11-18; register `docs/reviews/F-238.md`); the owner's Cloudflare and Mapbox steps done 2026-11-18. Emptied for the oil and gas side by F-239 (`docs/FEATURES_OIL_GAS.md`). Normal risk (screens only: no database, money or sign-in change). **Asked:** 2026-11-18: "build a mapping tool or part of the platform on its own page … map.torvenco.com"; the owner will describe what the page should hold later; to start, a full-page map shown at that address.

**Plan (an agent, 2026-11-18):**
- The same app and Worker, no new service (as `app.torvenco.com`, F-153): opened at an address starting with `map.`, the app shows only the full-page map, without the menu; the same page at `/map` on any address (which until now led to Counterparties → map view), so it can be tried on the workers.dev address.
- Signed in as for the rest of the app (the map shows GSS's companies). A new address is a new site for the browser: the first visit asks for the email, password and authenticator code once.
- To start: every located place of a company that is not archived, with the pins, legend, details box, map styles and map layers of the Counterparties map, filling the window.

**Owner steps once merged:** (1) Cloudflare → Workers & Pages → `grain-trading-api-staging` → Settings → Domains & Routes → Add → Custom domain → `map.torvenco.com`; (2) Mapbox → Tokens → the app's public token → URL restrictions: add `https://map.torvenco.com`.

**Open (for the owner's detailed description):** what the page adds beyond the map (tools, filters, lists, drawing), who may open it, and whether `/map` should keep leading to Counterparties instead.

#### 1f. F-239 to F-250 — The oil and gas side

The oil and gas features (the map page emptied of companies, live as ivanmueller/gss#260; its own database, `petroleum-staging`, connected as ivanmueller/gss#263 and #264; its own layer system with a Settings button, live as ivanmueller/gss#268, merged by the owner without Codex's approval on 2026-11-19, what was left open being F-248 in `docs/FEATURES_OIL_GAS.md`; then Alberta's public land, agreement and well data) have their own list: `docs/FEATURES_OIL_GAS.md`, with the owner's answers. Asked 2026-11-18.

#### 1g. F-313 — The oil and gas side as its own platform, in its own repository

**Status:** Proposal, revision 5 (two Codex reviews taken in, 2026-11-25 and 2026-11-26; revision 2 merged as ivanmueller/gss#381); the owner's answers recorded 2026-11-26 (he holds permission for the data, covering people outside GSS and exports; the new platform has no connection to GSS; a new sign-in with an approved list); **open: how the code moves**, piece by piece or all at once and then reviewed in place (the plan's section 6, item 0); nothing built. **Asked:** 2026-11-25: separate the two sides completely; the oil and gas side becomes its own repository, built and reviewed under the strict Claude + Codex process again, taking this repository's foundation, rules and documents; grain stays here. **The plan, its risks and what is still open (its section 6):** `docs/PETROLEUM_SPLIT_PLAN.md`.

#### 2. Paid-plan follow-ups (the Workers paid plan, 2026-11-09)

Work shaped by the free plan's limit of about 10 ms of computing per request, to loosen or simplify now that the plan is paid. Cloudflare's paid limits were read from its published page and recorded in `docs/DECISIONS.md` on 2026-11-10: 30 seconds of computing per request by default (the Worker sets no lower limit), 30 seconds per run of the 2-minute job, waiting on Anthropic, Telnyx or the database not counted, memory still 128 MB. Each change keeps its tests; the size checks stay (they guard against abuse, not only the plan).

All of this is done: see `docs/FEATURES_DONE.md`.

### Experiments in how the platform is built

#### F-236 — More agents in the Claude + Codex pipeline (an experiment)

**Status:** Needs owner input. **Asked:** 2026-11-14, after a discussion of AI agents (what they do, their gains and risks); recorded as an experiment, not a standing change. Changes to how agents work are governance (`AGENTS.md`, `docs/AI_WORKFLOW.md` §11.5 and §11.6): a reviewed pull request and the owner's approval of the exact commit before anything here is used.

**Why:** today one Claude builds one feature at a time and Codex reviews it. Most waiting is on Codex rounds and on the owner's answers and checks, which more agents do not shorten. Two additions may still help: one for speed, one for catching mistakes.

**Part A, a parallel builder for low-risk work (speed; to try first):**
- While the main session works on one feature, a second Claude on a cheaper model (Sonnet or Haiku) does one low-risk task on its own branch and worktree: dependency updates (D-01 to D-05), documents, styles, flaky tests, small screens.
- Never two high-risk tasks at once (database, sign-in, money, FX, Telnyx, Claude), and never two tasks touching the same tables, API routes or screens.
- Its pull request follows the usual low-risk path (CI, Merge policy); a governance change (such as D-04, `supabase/setup-cli`) still waits for the owner's approval.

**Part B, an independent test writer for high-risk work (robustness; to try with the trading engine, F-106):**
- Before Claude builds a high-risk feature, a separate agent writes its tests from the rules alone (`docs/TRADING_RULES.md`, `docs/ACCEPTANCE_TESTS.md`, the database rules, the owner's answers), without seeing the code. Claude then makes them pass; a test is changed only when it misreads a rule, and the change is recorded.
- Aim: a rule misunderstood by Claude no longer slips into both the code and its tests. Most useful for money (the 42 MT example: exactly CAD 46.00/MT and CAD 1,932.00), organization isolation and Claude's checks against transcripts.

**Not part of the experiment:** a third reviewer of the same kind as Codex (expected to add overlapping findings, false alarms and tokens more than catches); agents inside the platform acting by themselves (`AGENTS.md` rules 8 and 9 stand).

**How it would be judged (to agree with the owner):** for Part A, merges per week, review rounds per pull request, conflicts or redone work, and whether the owner feels overloaded; for Part B, mistakes the independent tests caught that Codex or CI did not, and review rounds saved. Both against the token cost, with Codex's usage limit (reached twice on 2026-11-11) watched.

**Questions for the owner:**
1. **When to start Part A:** during the next feature (for example texting, F-120), with the dependency updates as the first side task?
2. **How long the trial runs:** for example two weeks or three side tasks, then a short report and a decision to keep, change or stop.
3. **Budget:** a ceiling on extra usage (Claude and Codex), and whether the side builder stops when Codex nears its limit.
4. **Notices:** one message per side merge, or one summary at the end of the session?
5. **Part B:** try it with the trading engine (F-106) when that starts, or earlier on another high-risk feature?

| ID | Feature | Status | What it needs before work starts |
|---|---|---|---|
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

- **F-312, land for All rights as dots** (oil and gas map, live since #377): `map.torvenco.com` → Ctrl+F5 → **Land sales** on, Rights include **All rights**: dots over the whole area loaded, coloured by price, coming in as the land does far out; zoom in past about 270 km across and they turn into outlines. The same for **Land today** (dots in holders' colours, outlines from about 135 km across). Duvernay chosen: as before.
- Earlier: the owner checked F-310 on 2026-11-25 (both loads green, 279 MB in all, "Everything was good"); F-309 on 2026-11-25 ("Staging is good"); F-301 to F-308, F-302 parts 1 to 3 and F-254 parts 3a and 3b on 2026-11-25 ("Staging is good"); F-254 parts 1 and 2 and the bar at the top on 2026-11-24 ("Staging is good"), and F-287 (geology, all four parts) on 2026-11-24 ("Geology staging is good"), F-239, F-247, F-284, F-285 and F-288 on 2026-11-23 ("All checks are good") and F-287 part 2 on 2026-11-24 ("Staging is good").

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
| T-05 | **Flaky browser test:** `counterparties.spec.ts:643` (carrier rate withdrawn, then 'No live freight rates here.') failed once on main's CI #569 for #239 and passed on its re-run. | Fixed in ivanmueller/gss#245 (2026-11-14): the test now waits for the withdrawn notice, with a unit regression test of the list reloading; watch a few runs before closing. |

### Dependency updates

| ID | Pull request | Status |
|---|---|---|
| D-01 | Dependabot #224 (was #191, before it #112): 16 minor and patch updates | Merged 2026-11-15 in ivanmueller/gss#251 (our own branch, the `FacilityMap.tsx` lint error fixed; register `docs/reviews/D-01.md`); #224 closed. |
| D-02 | Dependabot #192 (was #113): postgres (the Worker's database library) 3 → 4.1.0, a major version | Its CI failed one browser test ("adds a carrier, enters its rate per load…", `counterparties.spec.ts:635`; unit and database tests passed). To test on its own branch with all database tests, finding whether postgres 4 or a flaky test is the cause; Codex review. |
| D-03 | Dependabot #114: `@types/node` 22 → 26 | Closed 2026-11-15 (CI and deploys run Node 22), with Dependabot told to ignore that major version. Offered: a lasting rule in `.github/dependabot.yml` (governance). |
| D-04 | Dependabot #190: `supabase/setup-cli` action 1 → 3 | Changes `ci.yml` and `deploy-staging.yml`: governance, so it needs a review register and the owner's approval of the exact commit. Merge policy held it (2026-11-10), as designed. |
| D-05 | Dependabot #193: jsdom 30 → 31 (web tests only) | Merged 2026-11-15 in ivanmueller/gss#251, with D-01; #193 closed. |
