# Staging checks: Connor's tick list

The features built and deployed to staging that nobody has checked yet (`docs/FEATURES.md`, section 2). The exact click paths are in `docs/HANDOFF.md`, "Next exact task".

How to use it: try each one on staging, tick the box, and write **Pass** or **Fail** in `docs/CONNOR_LOG.md` under that day. For a fail, write what you clicked and what you saw. Use made-up test companies wherever you can; write no real names, numbers or prices here (the repository is public).

**Ask Ivan first** before the two items that change real data: undoing the sellers' import (F-209), and permanently deleting a company (F-205).

## Company pages and contacts

- [ ] **F-203: a buyer's page.** Make main on a contact. The main contact, next follow-up and last contact at the top. Log contact. Edit under What they buy. The small map in satellite view. ⋯ → Edit details. The page on a phone. Follow-ups: a follow-up due in the past, the count beside Follow-ups, Correct, Mark done (the count goes away).
- [ ] **F-204: adding companies.** The + window: Add by hand (Type, Market, Tier, an address whose coordinates are found). The company phone link. Served by on a location. Find coordinates. Verifying an unverified commodity. Remove on a follow-up (admins). The Commodities, Market and Tier pickers.
- [ ] **F-208: page top and calls.** Only Log contact and ⋯ at the top. Clicking the logo square. Clicking a phone number offers Call and Copy number. The live call box during a call. The contact history shows two lines per entry; a click opens notes, transcript and recording. Pin, Edit, Remove (admin). **On a transcript, are the caller's and the contact's names the right way round?**

## Imports

- [ ] **F-205: buyer imports.** One company with several rows, then a second file adding a location. The same file again says nothing is new. The Check step shows changes. A change made by someone else before Import: the Check step comes back. Paste logo. A phone typed as 4035550100 becomes (403) 555-0100. *(Delete permanently on an archived test company only, after asking Ivan.)*
- [ ] **F-209: sellers.** *(Ask Ivan first.)* Undo the old sellers' import, fix the 2 buyers it changed, import the corrected sellers' sheet. Add a seller by hand. Back from a company keeps the list's filters and scroll position.

## Carriers

- [ ] **F-206: a carrier's page.** New freight rate. Add lanes (From, To, Truck/Rail/Both, Save lanes) and the map shading. Edit details → Equipment badges. Counterparties → Carriers → Delivers to, a state. Add a carrier by hand.
- [ ] **F-207: the carrier spreadsheet.** Found columns in green. Carriers chosen for rows without a type. The Lanes column on the Check step. Unverified places grey and dashed, then Verify.

## Claude's features

- [ ] **F-201: company summaries.** The titles ("Latest contact", "Live bids and offers"…) followed by the records' own text.
- [ ] **F-202: Claude's notes under a call.** The Voicemail badge, Claude's notes, Use as notes.
- [ ] **F-211: Claude's drafts in their sections.** On a company with a recent call: drafts in Bids and offers, Follow-ups and Contacts. Verify on a complete one. Finish in the form on one marked "Not heard". Dismiss. The same drafts on the main Bids & offers and Follow-ups pages.
- [ ] **F-213: Claude's colours.** Drafts folded, terracotta on cream with Claude's logo. Check this is still visible while folded. The arrow opens the transcript lines. Buttons under the text on a phone.

## Calls to GSS's number

- [ ] **F-212: callbacks.** Team → Callbacks to GSS's number → choose a person → Turn on callbacks. From a second phone that a test company's page called, call GSS's number: your cell rings, press 1, connected, logged in your name. Call again without answering: the callbacks person rings, then voicemail, and a follow-up appears. From a number never called: Follow-ups → Calls to GSS's number → Link to a company. **Is the caller cut off before the voicemail message?**

## Grains

- [ ] **F-210: Grains page.** The tiles (two per row on a phone). Search Camden. Wheat opens with CWRS chosen. CWAD. Close goes back as it was. A verified grain's badge on a buyer's page opens its grain.

## Map layers

- [ ] **F-214: adding a layer.** Team → Map layers → Add map layer (a web address with Check, and a small KML or GeoJSON file). Colour by a field. Two layers on at once on both maps. Clicking a line shows its details. Remove.
- [ ] **F-215: Layers panel.** Edit on the rail layer. A layer's values: Hide all, then CN alone, search. Zoomed out, the whole network; zoomed in, the detail.
- [ ] **F-216: one railroad.** CPKC alone: around Houston the lines to Beaumont and Dallas show, as on ArcGIS.
- [ ] **F-217: layers from an ArcGIS map.** Prepare zoomed-out view on Amtrak Routes. Each railroad in ArcGIS's colour and width.
- [ ] **F-218: map tidy-up.** The Layers box under the zoom buttons. No "Source:" under the map. No Find missing coordinates on Counterparties → map.
- [ ] **F-219: steady while zooming.** Zoom in and out over Chicago or Houston: the lines stay.
- [ ] **F-220: heat maps.** The crop density map: All Annual Crops with its colour scale, another crop, zoomed in past level 10.
- [ ] **F-221: a map's layers together.** On Team, each map is one folded entry; Remove selected, then Keep. In Layers, each map is one row with an arrow.
- [ ] **F-222: map import form.** Read map shows only Source under the layers. After adding, the terms show on Team.

## Bills

- [ ] **Telnyx invoice.** Recording and speech-to-text were expected to add about USD 18–28 a month; callbacks cost about USD 0.02 a minute (estimates from `docs/HANDOFF.md`).
