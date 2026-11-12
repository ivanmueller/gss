# Connor's work log

What Connor (GitHub `connorrodewald`) has done on GSS, newest first, so Ivan can see it. Feature IDs (`F-###`) refer to `docs/FEATURES.md`.

This file is only a log. Statuses in `docs/FEATURES.md` and `docs/HANDOFF.md` are still updated by the integration owner after a merge (`AGENTS.md` rule 10). The repository is public, so this log holds no real business data: no names, contacts, phone numbers or prices.

## How entries are written

- **Date** (Alberta time), then what was done.
- **Staging checks:** the `F-2##` ID, **Pass** or **Fail**, and for a failure what was wrong (the click path and what was seen). The tick list is `docs/CONNOR_STAGING_CHECKS.md`.
- **Answers to owner questions:** the `F-###` ID, the question's number and the answer.
- **Code or document changes:** the branch and the pull request.

## 2026-11-09 (staging checks, second pass: with test data)

Run by Claude Code in Connor's Chrome, signed in as Connor (admin), at Connor's request ("test whatever you can that doesn't involve anything manual"). Only made-up test data was added, every record named **"ZZ Test … (Claude staging test)"** with a note saying so; addresses are public buildings, phones are 555 numbers, emails are example.com.

### Problems found (Ivan, please look)

1. **Import: a location created by an import loses its Served By (F-205).** Test file 1 had one company on two rows (Edmonton "Truck", Calgary "Rail"). After importing, the Check step of the next import showed both as "served by: none". File 2 added a third row (Regina, "Truck"); the page showed Regina with no Served By, and importing file 2 again wanted to set it. Result: **importing the same file again never says "nothing is new"**; each import fixes the locations the previous one added.
2. **Import: re-importing duplicates the notes (F-205).** After the second import the company's Notes held the Edmonton and Calgary row notes twice.
3. **Carrier sheet: "Rows with an empty type are" stays on Buyers (F-207).** A file with Equipment, Loads In, Delivers To and Mode columns and an empty Type kept Buyers; the checklist expects Carriers chosen. Chosen by hand, the rest worked.
4. **Import step 1's text is out of date.** It says "companies already in the list are skipped, not changed", but they are updated (filled cells replace their details).
5. **After any import, the Coordinates step retries every location without coordinates (37 real ones today)**, not only the imported ones, and lists them all. If not intended, it uses Geocodio lookups each time.
6. **Workspace map (F-214, F-218):** the layers' colour key is above the map (under it on Counterparties → map); with the rail map on it pushes the map about 180 px down, and the box that opens when a line is clicked lands **below the screen**. Layers imported from an ArcGIS map show "No details for this shape"; a layer from a file shows its fields correctly, so this is only ArcGIS-map layers.
7. **Small things:** on a carrier's lanes map, "Loads in" and "Delivers to" shades are hard to tell apart; Claude's summary ended a note with `."` then a period; after adding a location, "Locations (0)" stays until the Find coordinates window is closed; the same contact (same name, email, phone) can be added twice without a warning.

### Passed

| ID | What was done |
|---|---|
| F-204 | + → Add by hand (Buyer, Pet, Tier C, Canada, a phone, an address with Served by Rail and truck): added, coordinates found, Served by badges, coordinates line and Added date shown. Verifying an unverified commodity (Oats) turned it green. |
| F-203 | Add contact, **Make main** (shown at the top), **Log contact** at the top opens the form in Contact history, Edit under What they buy (saved Feed barley, Oats), satellite map, ⋯ → Edit details opens filled in. CRM flow: a follow-up due yesterday showed Overdue and "1" beside Follow-ups; **Correct** kept the earlier version; **Pin** worked; **Mark done** removed the count. |
| F-205 (part) | Phone typed 4035550100 shown as (403) 555-0100. One company on two rows imported as one company with 2 locations; a second file added the third location with its coordinates. Archive, then **Delete → Delete permanently** removed a test company; a company with a freight rate is **refused** ("it stays archived"). |
| F-206 | A carrier added by hand: Equipment and lanes (Alberta → Montana, Saskatchewan, Truck), no Market or Tier; Equipment badges and Cross-border shown; **the lanes map shading works** (first time seen). Carriers → Delivers to → Montana lists the test carrier (33 carriers). New freight rate: saved with its history, then withdrawn; the form refuses the same location as From and To. |
| F-207 | Carrier sheet: columns recognised (Equipment, Loads In, Delivers To, Mode); lanes counted "2 lanes (unverified)"; on the page the places dashed; clicking Montana → **Verify** made it solid. |
| F-208 | The top shows only Log contact and ⋯ (New bid, Plan follow-up, Edit details, Add logo, Archive); a phone number offers **Call … / Copy number** (Call not clicked). |
| F-201 | **Write one now** on the test buyer: within about 2 minutes a summary with fixed titles (Latest contact, Follow-ups done, Buys and sells, Contacts) and the records' own text. |
| F-211 | On the "Test" company: **Verify** on a complete draft made a follow-up (then marked done); **Dismiss** removed another. |
| F-214 | Team → Map layers → Add map layer → File (a one-line GeoJSON): added with its source and terms, drawn on the Workspace map, clicking it shows its fields, **Remove** (with Keep) removed it. |

### Left on staging

- **ZZ Test Buyer** and **ZZ Test Carrier** are **archived** (they have history or a freight rate, so they cannot be deleted by design). The test freight rate is withdrawn. The two imported test companies were deleted.
- On the "Test" company: one of Claude's drafts verified (its follow-up marked done) and one dismissed. The draft for a real company was left alone.

### Correction to the first pass

The duplicate contact made during the first contact test was Claude's own double submit (a screenshot lagged behind the page), not the app's fault and not Connor's. The pop-ups Connor saw were Chrome's own "save address" prompts, not GSS.

### Needs a person (for Ivan)

- **Phones:** F-212 callbacks (a second phone), F-208 the live call box during a real call and which name is which on a transcript, F-202 a call's Voicemail badge and Claude's notes, and the Telnyx invoice.
- **Real data:** F-209 undoing the sellers' import, fixing the 2 buyers, and importing the corrected sellers' sheet; F-205 re-importing the real buyer sheet.
- **Changes to the shared rail and crop layers:** F-215 to F-217 (Edit, Use ArcGIS's railroad settings, Prepare zoomed-out view, Remove selected). Not done, to avoid changing the real layers.
- **Not possible from the browser tool:** **Paste logo** (needs the clipboard); "a change made meanwhile" on the Check step (needs two people at once); the phone-width layouts; the light theme's cream colours for Claude's drafts.

## 2026-11-09 (staging checks, first pass)

Run by Claude Code in Connor's Chrome, signed in as Connor (admin), at desktop width (about 1500 px), dark theme. **Look-only:** nothing was added, changed, verified, dismissed or removed, and no calls were placed. Turning layers on and off in the Layers panel was the only thing clicked that is saved (per person, in the browser); they were switched back off at the end.

| ID | Result | What was seen |
|---|---|---|
| F-218 Map tidy-up | **Pass, one note** | Workspace: the Layers box opens under the zoom buttons, top left. Counterparties → map: under the zoom buttons, top right; no Find missing coordinates. Note: on the Workspace the layers' colour key is shown **above** the map, not under it (on Counterparties → map it is under). With the rail map on (9 lines) it pushes the map about 180 px down the page. |
| F-219 Steady while zooming | **Pass** | Rail map on; zoomed in step by step from the whole continent to the Duluth area (Minnesota). Lines stayed at every step, and the whole network showed zoomed out. Not tried over Chicago or Houston. |
| F-220 Heat maps | **Pass** | The crop map's switch turns on All Annual Crops alone (1 of 22) with its "Most Dense – Least Dense" scale. Barley added (2 of 22) gets its own scale line. Not tried: zoomed past level 10. |
| F-221 A map's layers together | **Pass (looked only)** | Layers panel: each map is one row with its count and arrow; the arrow lists each layer with its own switch. Team → Map layers: each map is one entry with its layer count, Remove map, source and terms. Not tried: the tick boxes, Remove selected, Keep. |
| F-222 Terms on Team | **Pass (part)** | Both maps show their source and terms on Team. The Add map layer form was not opened. |
| F-214 Clicking a line | **Note** | Clicking a rail line shows a box naming the railroad (e.g. BNSF Railway), but it says "No details for this shape". On the Workspace the box was **below the visible screen** (the colour key above the map pushes it down) until scrolling. Is "No details" expected for layers imported from an ArcGIS map? |
| F-210 Grains | **Pass** | Search "Camden" picks out Oats. Wheat opens with CWRS chosen: grades with minimum test weight and protein, moisture, most grown varieties, source. CWAD switches the table. Close returns to the tiles. Not tried: phone width, a buyer's grain badge. |
| F-211 / F-213 Claude's drafts | **Pass (looked only)** | Follow-ups → Everyone: "Claude's drafts to verify (3)", on test companies, marked "Drafted by Claude" with the logo, folded. A complete one offers Verify, Edit, Dismiss; ones "Not heard on the call" offer Finish in the form and Dismiss. Unfolding shows the call and the transcript line. Not checked: the light theme's cream colour, the company page's sections, the main Bids & offers page. Note: the complete draft also has an **Edit** button, not in the checklist. |

**Not done yet:** anything that adds or changes data or places calls: F-203 to F-209, F-212, F-201, F-202, the rest of F-211, and F-214 to F-217 (adding and editing layers). Also not done: the phone layout.

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
  | 4 | Attachments, or text only at first? | **Attachments from the start** (Connor's preference). | Connor would rather build them in now than wait. Cloudflare's limit noted in `docs/FEATURES.md` is 25 MiB per email, attachments included. Ivan to say which file types (e.g. photos and PDFs) and whether attachments are kept with the email. |
  | 5 | A standard signature? Saved templates? | **Both from the start** (Connor's preference): a standard signature (the person's name, role, GSS and phone, set once) and saved templates. | Connor would rather build templates in now than wait. Ivan to say who may create and edit templates (admins only, or anyone who sends) and the first few to set up. |
  | 6 | How long are emails kept? | **Forever, as call transcripts are.** | One consistent rule, and the contact history stays complete. Ivan may want to check Canadian privacy rules before production. |
  | 7 | Should Claude draft from received replies automatically? | **Yes, as with calls.** Drafts still need a person to click **Verify**, and Claude never sends. | It works the same way people already use for calls, and it saves typing bids, offers and follow-ups. It adds one Anthropic request per reply; Ivan should confirm the cost is acceptable. |
