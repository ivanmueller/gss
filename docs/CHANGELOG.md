# Documentation pack changelog

## 2026-11-04 — Handoff record of #133, and the status brought up to date

- `docs/HANDOFF.md`: Undo an import (ivanmueller/gss#133) with its CI and Deploy staging runs and Codex's four reviews; the status (sellers' details, coordinates page by page, Back keeping the list, Undo an import); the checks on staging for #125 to #133.

## 2026-11-04 — Codex's re-review of Undo an import

- `docs/DECISIONS.md`: additions taken off only while the company is unchanged, its version read under its lock; older imports always flagged.
- `docs/DATA_MODEL.md`: `import_additions.row_version`.

## 2026-11-04 — Codex's review of Undo an import

- `docs/DECISIONS.md`: what an import adds recorded with it; retypes found without times; older imports left to check by hand.
- `docs/DATA_MODEL.md`, `docs/API.md`: the migration and the plan as now.

## 2026-11-04 — Handoff record of #132

- `docs/HANDOFF.md`: Select all among the coordinates results and Back keeping the list as it was (ivanmueller/gss#132) with its CI and Deploy staging runs.

## 2026-11-04 — Undo an import

- `docs/DECISIONS.md`: the owner's request and answers; what is removed, kept and listed to check.
- `docs/DATA_MODEL.md`: migration `20261104010000_undo_import.sql`.
- `docs/API.md`: `GET /counterparties/imports` and `POST /counterparties/imports/{id}/undo`.
- `docs/PRODUCT.md`: Undo an import in the + window.

## 2026-11-04 — Back returns to the list as it was

- `docs/DECISIONS.md`: the search and Show archived in the address; the back arrow as the browser's Back; the scroll position kept.

## 2026-11-04 — Select all among the results to check

- `docs/DECISIONS.md`: Select all and Select none when finding coordinates.

## 2026-11-04 — Handoff record of #131

- `docs/HANDOFF.md`: every location without coordinates looked up after an import (ivanmueller/gss#131) with its CI and Deploy staging runs.

## 2026-11-04 — Every location without coordinates looked up after an import

- `docs/DECISIONS.md`: the owner's report; the lookup after an import and Find missing coordinates when nothing is new.

## 2026-11-04 — Handoff record of #130

- `docs/HANDOFF.md`: coordinates page by page and the import's seller kind and websites (ivanmueller/gss#130) with their CI and Deploy staging runs; the owner's report on uploading the file again.

## 2026-11-04 — Handoff record of #129

- `docs/HANDOFF.md`: the highest tier kept without a warning (ivanmueller/gss#129) with its CI and Deploy staging runs; the sellers' import on staging.

## 2026-11-04 — Coordinates page by page; a company's locations keep their seller kind and website

- `docs/DECISIONS.md`: Geocodio failing on a 1,024-location import; pages of 100, Try again, Find missing coordinates; seller kind as each location's type, extra websites in the notes, warnings counted by kind.
- `docs/API.md`: `after` and `next` on `POST /facilities/geocode`.
- `docs/PRODUCT.md`: the import and the map view.

## 2026-11-04 — No tier warnings when a company's rows differ

- `docs/DECISIONS.md`: the highest tier kept without a warning (owner's request).

## 2026-11-04 — Handoff record of #128

- `docs/HANDOFF.md`: one company's rows combined and Company name (ivanmueller/gss#128) with its CI and Deploy staging runs.

## 2026-11-03 — Company name, not Legal name

- `docs/DECISIONS.md`: the field called Company name on screen, the public (DBA) name; nothing stored changed.

## 2026-11-03 — Handoff record of #127

- `docs/HANDOFF.md`: no Market for sellers in spreadsheets (ivanmueller/gss#127) with its CI and Deploy staging runs.

## 2026-11-03 — One company's rows combined

- `docs/DECISIONS.md`: the owner's answers: notes, phones, grain types and markets combined across a company's rows, the highest tier, the first seller kind given.

## 2026-11-03 — No Market for sellers in spreadsheets

- `docs/DECISIONS.md`, `docs/API.md`, `docs/PRODUCT.md`: a sellers' file offered no Market; a seller-only row's Market left out with a warning.

## 2026-11-03 — Handoff record of #125 and #126

- `docs/HANDOFF.md`: a seller's own details (ivanmueller/gss#125) and contacts added on the counterparty's page only (ivanmueller/gss#126), with their CI and Deploy staging runs; the checks on staging.

## 2026-11-03 — Contacts added on the counterparty's page only

- `docs/DECISIONS.md`: the owner's request: no contact in spreadsheets or the add form; the sellers' header row without Contact, Phone and Email.
- `docs/API.md`: contact fields refused when adding by hand and importing.
- `docs/PRODUCT.md`: the add form and the import without contacts.

## 2026-11-03 — Codex's review of the seller's details, and CI run #273

- `docs/DECISIONS.md`: a sellers' Market column kept as Market; tons never taken for tonnes, whatever the header's spelling (Codex's re-review of `eb99697`); a file starting as carriers or sellers from its columns.
- `docs/PRODUCT.md`: the import's starting choice and tons.

## 2026-11-03 — A seller's own details

- `docs/DECISIONS.md`: the owner's request and answers: a seller's grain types instead of a buyer's market, its kind, tonnes a year and organic certificate; Served by from a spreadsheet; the Grain type filter; each file offered its own columns; the header row for a sellers' sheet.
- `docs/DATA_MODEL.md`: migration `20261103040000_seller_details.sql` and the new `counterparties` columns.
- `docs/API.md`: the seller's fields when adding by hand and importing; the Served by column.
- `docs/PRODUCT.md`: the seller's form, page, filter and import.

## 2026-11-03 — Handoff record of #124

- `docs/HANDOFF.md`: the documents pull request (ivanmueller/gss#124: the handoff record of #123, `AGENTS.md` and README status) with its CI and Deploy staging runs; Dependabot ivanmueller/gss#114 listed with the other open updates.

## 2026-11-03 — Handoff record of #123, and the status brought up to date

- `docs/HANDOFF.md`: the live call box (ivanmueller/gss#123) with its CI and Deploy staging runs; the status (transcripts by side, the less cluttered page, the call box); the next checks on staging and the next choices (texting and callbacks, notes drafted from transcripts, a Hang up button, the open Dependabot updates).
- `AGENTS.md`: the status line with calling, transcripts and the contact history's pins and removals; Telnyx under the architecture.
- `README.md`: calling by clicking a phone number, the live call box.

## 2026-11-03 — A live call box

- `docs/DECISIONS.md`: the call's progress in a box in the bottom right corner, with its steps and a running clock.
- `docs/PRODUCT.md`: the live call box on the counterparty page.
- `docs/DESIGN_SYSTEM.md`: the `--z-floating` layer.

## 2026-11-03 — Handoff record of #122

- `docs/HANDOFF.md`: Codex's review of the contact history rows fixed (ivanmueller/gss#122) with its CI and Deploy staging runs.

## 2026-11-03 — Codex's review of the less cluttered page

- `docs/DECISIONS.md`: every entry with notes opens; a removal and a correction serialized.
- `docs/DATA_MODEL.md`: migration `20261103030000_contact_log_removal_lock.sql`.

## 2026-11-03 — Handoff record of #121

- `docs/HANDOFF.md`: a less cluttered counterparty page (ivanmueller/gss#121) with its CI and Deploy staging runs and Codex's review after the merge.

## 2026-11-03 — A less cluttered counterparty page

- `docs/DECISIONS.md`: the owner's answers: contact history in short rows with Pin, Edit and Remove (kept), only Log contact at the top, click-to-call numbers with Call and Copy number.
- `docs/DATA_MODEL.md`: migration `20261103020000_contact_log_pins_removals.sql`.
- `docs/API.md`: `pinned` on entries; `PUT`/`DELETE /contact-log/{id}/pin` and `POST /contact-log/{id}/removal`.
- `docs/PRODUCT.md`: the counterparty page's top, contact history and phone numbers.

## 2026-11-03 — Handoff record of #120

- `docs/HANDOFF.md`: transcripts uploaded instead of linked (ivanmueller/gss#120) with its CI and Deploy staging runs; transcripts by side checked on staging by the owner.

## 2026-11-03 — Transcripts: the audio uploaded, refusals explained

- `docs/DECISIONS.md`: Telnyx's 400 on staging, the audio streamed into the upload instead of linked, what a refusal was about logged as a fixed word, failed recordings tried again; Codex's review of `5c72810`.
- `docs/DATA_MODEL.md`: migration `20261103010000_retry_transcripts.sql`.

## 2026-11-03 — Handoff record of #119

- `docs/HANDOFF.md`: the recordings job logging a part that stopped (ivanmueller/gss#119) with its CI and Deploy staging runs; the transcript not coming on staging, open.

## 2026-11-02 — Handoff record of #118

- `docs/HANDOFF.md`: Codex's review of the transcript by side (ivanmueller/gss#118) with its CI and Deploy staging runs and Codex's re-review.

## 2026-11-02 — The recordings job logs a part that stopped

- `docs/DECISIONS.md`: Codex's re-review of `14e54fd` and the P3 fixed (a stopped part of the job logged, secret-free).

## 2026-11-02 — Codex's review of the transcript by side

- `docs/DECISIONS.md`: the four findings on `3571e62` and their fixes (transcription and deletion side by side within a time budget, one claim at a time, transcripts cut to fit, text kept without segments).
- `README.md`: the job's two parts side by side.

## 2026-11-02 — Handoff record of #117

- `docs/HANDOFF.md`: the transcript split by side (ivanmueller/gss#117) with its CI and Deploy staging runs and Codex's review after the merge.

## 2026-11-02 — The transcript split by side

- `docs/DECISIONS.md`: the owner's choice of speech-to-text after the call, by side, with its cost; the channel mapping to check on the first real call.
- `docs/DATA_MODEL.md`: migration `20261102080000_transcript_lines.sql`.
- `docs/API.md`: the recordings' `lines`, `callerName`, `contactName` and `transcriptFailed`.
- `README.md`: transcription by side every 2 minutes, with the audio deletion.

## 2026-11-02 — Handoff record of #116

- `docs/HANDOFF.md`: the transcript's reloads (ivanmueller/gss#116) with its CI and Deploy staging runs; the owner's next request.

## 2026-11-02 — Handoff record of #115

- `docs/HANDOFF.md`: transcripts with 24-hour audio and the call's status line (ivanmueller/gss#115) with its CI and Deploy staging runs and Codex's reviews; the staging checklist.

## 2026-11-02 — The transcript's reloads outlive the call's line

- `docs/DECISIONS.md`: Codex's re-review of `319f801`; one P3 fixed, one accepted.

## 2026-11-02 — Transcripts of calls, audio kept 24 hours (and Codex's review of them)

- `docs/DECISIONS.md`: recording and transcription of every call that connects; audio at Telnyx for 24 hours, playable by everyone on the team, then deleted; transcripts kept.
- `docs/DATA_MODEL.md`: migration `20261102070000_call_recordings.sql`.
- `docs/API.md`: `/api/v1/calls/recordings` and its audio; the recording events.
- `README.md`: transcripts and the hourly deletion.
- `docs/DECISIONS.md`: Codex's review of `9de3e78` and CI run #251 (the entry module's exports).

## 2026-11-02 — The call's status line goes after the call

- `docs/DECISIONS.md`: the line goes 5 seconds after the call ends.

## 2026-11-02 — Handoff record of #111

- `docs/HANDOFF.md`: Codex's fifth to eighth reviews of the Telnyx calls fixed (ivanmueller/gss#111) with its CI and Deploy staging runs; the accepted P3; the owner's first real call; the staging checklist.

## 2026-11-02 — Codex's seventh and eighth reviews of the Telnyx calls

- `docs/DECISIONS.md`: the leg of a dial that came back after its caller was suspended, kept and hung up; the P3 of both reviews.
- `docs/DATA_MODEL.md`: migration `20261102060000_keep_stray_leg.sql`.

## 2026-11-02 — Codex's sixth review of the Telnyx calls

- `docs/DECISIONS.md`: a 10-second limit on every Telnyx request; calls of a suspended caller ended at Telnyx.
- `docs/DATA_MODEL.md`: migration `20261102050000_call_legs.sql`.
- `docs/API.md`: the same for `POST /api/v1/telnyx/voice`.

## 2026-11-02 — Handoff record of #110

- `docs/HANDOFF.md`: Codex's third and fourth reviews of the Telnyx calls fixed (ivanmueller/gss#110) with its CI and Deploy staging runs; Codex's fifth review; the staging checklist.

## 2026-11-02 — Codex's fifth review of the Telnyx calls

- `docs/DECISIONS.md`: acknowledged only when every command of the call is settled; commands on their way never cancelled; temporary refusals retried.
- `docs/API.md`: the same for `POST /api/v1/telnyx/voice`.

## 2026-11-02 — Handoff record of #109

- `docs/HANDOFF.md`: Codex's re-review of the Telnyx calls fixed (ivanmueller/gss#109) with its CI and Deploy staging runs; Codex's three findings on `d64168a`; the staging checklist.

## 2026-11-02 — Codex's third and fourth reviews of the Telnyx calls

- `docs/DECISIONS.md`: the three findings on `d64168a`, the one on `98c4e1a`, and their fixes.
- `docs/DATA_MODEL.md`: migration `20261102040000_call_event_legs.sql`.

## 2026-11-02 — Codex's re-review of the Telnyx calls

- `docs/DECISIONS.md`: the six findings on `faa7813` and their fixes.
- `docs/DATA_MODEL.md`: migration `20261102030000_call_command_fences.sql`.
- `docs/API.md`: 503 `COMMAND_IN_FLIGHT`, fenced completions, kept hang-ups, the narrower late answer.

## 2026-11-02 — Handoff record of #108

- `docs/HANDOFF.md`: Codex's review of the Telnyx calls fixed (ivanmueller/gss#108) with its CI and Deploy staging runs; Codex's six findings on `faa7813`; the trial account's one verified number; the staging checklist.

## 2026-11-02 — Codex's review of the Telnyx calls

- `docs/DECISIONS.md`: the four findings on `a7dbf99` and their fixes.
- `docs/DATA_MODEL.md`: migration `20261102020000_call_commands.sql` (`call_commands`; the late-answer correction in `check_call`).
- `docs/API.md`: commands kept until sent, late events, the 4-hour limit.

## 2026-11-02 — Handoff record of #106 and #107

- `docs/HANDOFF.md`: calling counterparties through Telnyx (ivanmueller/gss#107) and the handoff record of #105 (#106), with their CI and Deploy staging runs; Codex's four findings on `a7dbf99`; the Telnyx Worker secrets and setup; the status summary, tests and the staging checklist.

## 2026-11-02 — Calling counterparties through Telnyx

- `docs/DECISIONS.md`: the owner's answers on Telnyx (calling, logging, texting, transcripts, drafted notes, who uses it, callbacks) and the choices for calling: the caller's cell first with press 1, the automatic contact log entry, signed events applied as the caller, and the later slices.
- `docs/API.md`: `/api/v1/me/phone`, `/api/v1/calls` and `/api/v1/telnyx/voice`.
- `docs/DATA_MODEL.md`: migration `20261102010000_telnyx_calls.sql` (`member_phones`, `calls`, `call_events`).
- `README.md`: calling through Telnyx and its four Worker secrets.

## 2026-11-02 — Handoff record of #105

- `docs/HANDOFF.md`: the documents brought up to #104 (ivanmueller/gss#105) with its CI and Deploy staging runs.

## 2026-11-02 — Documents brought up to #104

- `AGENTS.md`: the status line with carriers added by hand or from a spreadsheet and lanes to verify.
- `README.md`: the import's green columns, the Carriers choice and the carrier columns; the lanes map without lines.
- `docs/PRODUCT.md`, `docs/BUILD_PLAN.md`: carrier imports and unverified lanes.
- `docs/DESIGN_SYSTEM.md`: the lanes map, unverified lanes and the import's found columns.
- `docs/DATA_MODEL.md`: `carrier_lanes` among the tables.

## 2026-11-02 — Handoff record of #100 to #104

- `docs/HANDOFF.md`: the carrier import and lanes to verify (ivanmueller/gss#102, #103), the green found columns (#101), the lanes map without lines (#104) and the record of #99 (#100), with their CI and Deploy staging runs and Codex's review; the status summary, GT-020, GT-050, tests and the staging checklist.

## 2026-11-02 — No lines on the lanes map

- `docs/DECISIONS.md`, `docs/PRODUCT.md`: the lanes map shades places only.

## 2026-11-02 — Codex's review of the carrier import

- `docs/DECISIONS.md`: the four findings on `08a3957` and their fixes.

## 2026-11-01 — Carrier spreadsheets; lanes to verify

- `docs/DECISIONS.md`: the Equipment, Loads in, Delivers to and Mode columns; lanes from a file unverified until verified by a rep.
- `docs/DATA_MODEL.md`: migration `20261101030000_lane_verification.sql`.
- `docs/API.md`: the import's carrier columns and lane counts; `verify` and `verifiedAt` on lanes.
- `docs/PRODUCT.md`, `README.md`: carrier imports and verifying lanes.

## 2026-11-01 — Columns found shown in green

- `docs/DECISIONS.md`: the import's found columns in green; carrier sheets without contact columns.

## 2026-11-01 — Handoff record of #99

- `docs/HANDOFF.md`: carriers added by hand and lanes not stated as truck or rail (ivanmueller/gss#99) with their CI and Deploy staging runs and Codex's review; the staging checklist and the carrier import next.

## 2026-11-01 — Adding a carrier by hand; truck or rail only when stated

- `docs/DECISIONS.md`: the add form for carriers (equipment, lanes, home yard, no market or tier); lanes not stated as truck or rail.
- `docs/DATA_MODEL.md`: migration `20261101020000_lane_transport_optional.sql`.
- `docs/API.md`: `equipment` and `lanes` on `POST /api/v1/counterparties`; a lane's transport may be null.
- `docs/PRODUCT.md`: the add form for carriers.

## 2026-11-01 — Handoff record of #98

- `docs/HANDOFF.md`: the carrier page, lanes and equipment (ivanmueller/gss#98) with its CI and Deploy staging runs and Codex's review; GT-050; the staging checklist.
- `AGENTS.md`: the status line with carrier lanes.

## 2026-11-01 — Codex's review of the carrier lanes

- `docs/DECISIONS.md`, `docs/DATA_MODEL.md`: `app.begin_lane_change` locks the person's membership and the carrier for each change of lanes.

## 2026-11-01 — A carrier's page, lanes and equipment

- `docs/DECISIONS.md`: the carrier page like a buyer's; lanes from a province or state to others by truck, rail or both, on a map from Natural Earth's public-domain outlines; lanes from freight rates; equipment; Cross-border from lanes; the Loads in and Delivers to filter.
- `docs/DATA_MODEL.md`: migration `20261101010000_carrier_lanes.sql`.
- `docs/API.md`: `PATCH /api/v1/counterparties/{id}/lanes`; `equipment`, `lanes` and `quotedLanes` on counterparties; `equipment` on `PATCH /api/v1/counterparties/{id}`.
- `docs/PRODUCT.md`, `docs/BUILD_PLAN.md`: the carrier page and lanes.

## 2026-11-01 — Handoff record of #97

- `docs/HANDOFF.md`: the documents update (ivanmueller/gss#97) with its CI and Deploy staging runs; its pull-request run #210 failed at Start local Supabase (the runner's port 54322 in use; unit tests passed, database and browser tests did not run), run #211 on `main` green.

## 2026-10-31 — Handoff record of #96; documents brought up to date

- `docs/HANDOFF.md`: Codex's reviews of #95 fixed (ivanmueller/gss#96) with its CI and Deploy staging runs; the status summary, GT-020 and the next steps brought up to #96.
- `docs/API.md`, `docs/PRODUCT.md`, `docs/BUILD_PLAN.md`, `docs/DATA_MODEL.md`, `docs/DESIGN_SYSTEM.md`: listed companies updated by later files, deletion of archived counterparties, Paste logo and the phone format described as they now are.

## 2026-10-31 — Codex's second review of #95

- `docs/DECISIONS.md`, `docs/API.md`: the fingerprint holds the values replaced and is checked when nothing is left to write.

## 2026-10-31 — Handoff record of #95

- `docs/HANDOFF.md`: imports updating listed companies, pasted logos and the phone format (ivanmueller/gss#95) with their CI and Deploy staging runs, and Codex's review.

## 2026-10-31 — Codex's review of #95

- `docs/DECISIONS.md`: one listed record per row, the reviewed plan's fingerprint, long phones kept, the importer's membership held.
- `docs/DATA_MODEL.md`: migrations `20261031030000_import_holds_membership.sql` and `20261031040000_phone_format_length.sql`.
- `docs/API.md`: `fingerprint`, `reviewed`, `NOT_CHECKED` and `PLAN_CHANGED`.

## 2026-10-31 — Imports update listed companies; pasted logos; phone format

- `docs/DECISIONS.md`: filled cells win on a later import (verified grains and a verified company's status kept); logos pasted, not fetched by link; phones as (403) 555-0100.
- `docs/DATA_MODEL.md`: migration `20261031020000_phone_format.sql`.
- `docs/API.md`: the import's `changes` and `existingUpdated`.
- `README.md`: the import's updates, Paste logo, the phone format.

## 2026-10-31 — Handoff record of #94

- `docs/HANDOFF.md`: Codex's findings on #93 fixed (ivanmueller/gss#94) with its CI and Deploy staging runs.

## 2026-10-31 — Codex's review of #93

- `docs/DECISIONS.md`: the deleting admin's membership held until the delete is done; nothing kept unless the company itself is deleted; late answers not kept after a delete.

## 2026-10-31 — Handoff record of #93

- `docs/HANDOFF.md`: admins delete archived counterparties (ivanmueller/gss#93) with its CI and Deploy staging runs, and Codex's review of it.

## 2026-10-31 — Admins delete archived counterparties

- `docs/DECISIONS.md`: who may delete, what goes with a counterparty, and why one with history stays archived.
- `docs/DATA_MODEL.md`: migration `20261031010000_counterparty_deletion.sql`.
- `docs/API.md`: `DELETE /api/v1/counterparties/{id}`.
- `docs/PRODUCT.md`, `README.md`, `AGENTS.md`: Delete beside Restore for admins.

## 2026-10-31 — Handoff record of #89 to #92

- `docs/HANDOFF.md`: Codex's reviews of #88 fixed (ivanmueller/gss#89 to #92) with their CI and Deploy staging runs.

## 2026-10-30 — Codex's fourth review of #88

- `docs/DECISIONS.md`: the plan kept only once made with its companies locked; the same file may be imported again.
- `docs/DATA_MODEL.md`: migration `20261030090000_import_content_repeatable.sql`.
- `docs/API.md`: no `ALREADY_IMPORTED`; a repeated file adds only what the list lacks.

## 2026-10-30 — Codex's third review of #88

- `docs/DECISIONS.md`: a company archived during an import makes it plan again; no empty import recorded.

## 2026-10-30 — Codex's second review of #88

- `docs/DECISIONS.md`: one import at a time per organization, matched under the lock; a slash splits only two whole numbers; the race test on two connections.
- `docs/DATA_MODEL.md`: migration `20261030080000_counterparty_import_lock.sql`.
- `docs/API.md`: the import matched again under the lock.

## 2026-10-30 — Handoff record of #88

- `docs/HANDOFF.md`: companies with several locations in an import (ivanmueller/gss#88) with their CI and Deploy staging runs, and Codex's review of it.

## 2026-10-30 — Codex's review of #88

- `docs/DECISIONS.md`: names in other scripts kept apart; locations without a name or address matched by coordinates; additions matched again under the import's lock; notes too long refused on the Check step; two numbers with a slash split.
- `README.md`: a slash between two company phone numbers.

## 2026-10-30 — Companies with several locations in an import

- `docs/DECISIONS.md`: names matched loosely; a later file's new locations, contacts and grains added to companies already listed; Canada and the US left as they are; City or Town and two-phone cells.
- `docs/DATA_MODEL.md`: migration `20261030070000_facility_import_batch.sql`.
- `docs/API.md`, `docs/PRODUCT.md`, `README.md`: the import's matching and additions.

## 2026-10-30 — Handoff record of #87

- `docs/HANDOFF.md`: Codex's findings on #85 fixed (ivanmueller/gss#87) with their CI and Deploy staging runs.

## 2026-10-30 — Codex's review of #85

- `docs/DECISIONS.md`: kept answers per person and forgotten on any sign-out; logos kept per sign-in.
- `docs/API.md`: the logo's `Vary: Authorization`.

## 2026-10-30 — Handoff record of #86

- `docs/HANDOFF.md`: the documents update (ivanmueller/gss#86) with its CI and Deploy staging runs, and Codex's review of #85.

## 2026-10-30 — Handoff record of #85; documents brought up to date

- `docs/HANDOFF.md`: the Counterparties changes (ivanmueller/gss#85) with their CI and Deploy staging runs; #84's `main` run settled by #186; the status summary, GT-020 and GT-021 and the owner's staging check brought up to #85.
- `AGENTS.md`: the status line with the company phone, rail or truck access, verified commodities, markets and tiers, and follow-up removal.
- `README.md`: the Commodities picker and verified commodities; Add by hand.
- `docs/DESIGN_SYSTEM.md`: dropdowns: `MultiPicker`.

## 2026-10-30 — Counterparties: pickers, markets and tiers, the map, the + window, kept answers

- `docs/DECISIONS.md`: the owner's eight changes and answers (markets and tiers; several commodities; the map without a list; the + window in two steps; no trading name; kept answers; grains from a spreadsheet).
- `docs/DATA_MODEL.md`: migration `20261030060000_counterparty_market_tier.sql`; `counterparties.markets`, `tier`.
- `docs/API.md`: `markets` and `tier`; the logo kept by checksum.
- `docs/PRODUCT.md`, `docs/DESIGN_SYSTEM.md`, `README.md`: the pickers, the map view, the + window, `MultiPicker` and `animate-dialog-in`.

## 2026-10-30 — Handoff record of #84

- `docs/HANDOFF.md`: Codex's P3 on #83 fixed (ivanmueller/gss#84); CI run #184 on `main` red in the freight browser test, not this change, to be re-run.

## 2026-10-30 — Handoff record of #83

- `docs/HANDOFF.md`: removing follow-ups, the simpler locations map, shorter coordinates and Added (ivanmueller/gss#83) with their CI and Deploy staging runs and Codex's review; the owner's check on staging extended to #83.

## 2026-10-30 — Removing follow-ups, a simpler locations map, shorter coordinates and Added

- `docs/DECISIONS.md`: the owner's request: admins remove follow-ups (kept, never deleted); the small locations map without road names and highway numbers, closer; coordinates without their source; Added without the weekday.
- `docs/DATA_MODEL.md`: migration `20261030050000_follow_up_removal.sql`; `follow_ups.removed_*`.
- `docs/API.md`: `POST /api/v1/follow-ups/{id}/remove`.
- `docs/PRODUCT.md`, `README.md`: Remove on a follow-up; the counterparty page's map, coordinates and Added.

## 2026-10-30 — Handoff record of #82

- `docs/HANDOFF.md`: the company phone, rail and truck, coordinates when adding, the + window and verified commodities (ivanmueller/gss#82) with their CI and Deploy staging runs; the owner's check on staging and next request in the next task.

## 2026-10-30 — Company phone, rail and truck, coordinates when adding, the + window, verified commodities

- `docs/DECISIONS.md`: the owner's request and answers: a company phone; rail or truck access by location, never from a spreadsheet; coordinates found when counterparties and locations are added, sure results saved, doubtful ones asked; adding and importing in the + window; commodities from a spreadsheet unverified until anyone on the team verifies them.
- `docs/DATA_MODEL.md`: migration `20261030040000_phone_access_verified_commodities.sql`; `counterparties.phone`, `facilities.transport_access`, `counterparty_commodities.verified_by`/`verified_at`.
- `docs/API.md`: `companyPhone`, `transportAccess`, `verify` and `verifiedAt`; `counterpartyId` and `importBatchId` on the geocoding lookup.
- `docs/PRODUCT.md`, `README.md`: the + window's two tabs, the company page's phone, badges and Find coordinates; the coordinates page gone.
- `AGENTS.md`: the geocoding line.

## 2026-10-30 — Handoff record of #81

- `docs/HANDOFF.md`: the handoff record of #80 (ivanmueller/gss#81) with its CI and Deploy staging runs; the owner's next request (company phone, coordinates at add and import, rail and truck access, adding in the + window, verified commodities) in the next task.

## 2026-10-30 — Handoff record of #80

- `docs/HANDOFF.md`: the Counterparties toolbar (ivanmueller/gss#80) with its CI and Deploy staging runs; the owner's check on staging extended to #79 and #80.
- `AGENTS.md`: the status line with the main contact, the next follow-up and last contact, and what each counterparty buys or sells.

## 2026-10-30 — Counterparties toolbar: commodity first, views as icons

- `docs/DECISIONS.md` and `docs/PRODUCT.md`: the commodity dropdown before All / Buyers / Sellers / Carriers; Logos, Table and Map as icons; `README.md` likewise.

## 2026-10-30 — Handoff record of #79

- `docs/HANDOFF.md`: the + button for adding counterparties (ivanmueller/gss#79) with its CI and Deploy staging runs.

## 2026-10-30 — One + button for adding counterparties

- `docs/DECISIONS.md`: the owner's request, a + button that opens a window with Add by hand and Import spreadsheet.
- `docs/PRODUCT.md`: the Counterparties toolbar; `docs/DESIGN_SYSTEM.md`: the `Dialog` component.
- `README.md`: the + button, the Commodities column and box, the main contact and the commodity dropdown.

## 2026-10-30 — Handoff record of #78

- `docs/HANDOFF.md`: what counterparties buy and sell, the commodity filter and the lighter header (ivanmueller/gss#78), its CI and Deploy staging runs and Codex's review; the next task, the owner's check on staging.

## 2026-10-30 — What counterparties buy and sell

- `docs/DECISIONS.md`: the owner's answers (a list kept by hand, anyone can change it, the 20 commodities, a filter, an import column), the next follow-up and last contact in the header instead of four boxes, freight's Show and Hide in one place.
- `docs/API.md`: `PATCH /api/v1/counterparties/{id}/commodities`; `buys`, `sells` and `commodities` in the responses.
- `docs/DATA_MODEL.md`: `app.counterparty_commodities` and migration `20261030020000_counterparty_commodities.sql`.
- `docs/PRODUCT.md`: the commodity filter and the counterparty page's top and Commodities box.
- `docs/DATA_MODEL.md`: after Codex's review of ivanmueller/gss#78, the commodity list's key and the one-main-contact index keyed by organization (migration `20261030030000_main_contact_index_by_organization.sql`), and the archived check reading only the caller's organization; `docs/DECISIONS.md`: Feed wheat not read as a commodity.

## 2026-10-30 — Handoff record of #77

- `docs/HANDOFF.md`: ivanmueller/gss#77 (the race tests for the main contact) with its CI and Deploy staging runs.

## 2026-10-30 — Handoff record of #76

- `docs/HANDOFF.md`: the redesigned page for buyers and sellers with a main contact (ivanmueller/gss#76), its CI and Deploy staging runs and Codex's review; the next task, the owner's check on staging.

## 2026-10-30 — A redesigned page for buyers and sellers

- `docs/DECISIONS.md`: the owner's approved layout and answers (two columns, Log contact first, a main contact, a small satellite map, freight folded).
- `docs/API.md`: `PUT /api/v1/counterparties/{id}/main-contact` and contacts' `isMain`.
- `docs/DATA_MODEL.md`: `counterparty_contacts.is_main` and migration `20261030010000_counterparty_main_contact.sql`.
- `docs/PRODUCT.md`: the counterparty page for buyers, sellers and brokers.

## 2026-10-29 — Handoff record of #75

- `docs/HANDOFF.md`: ivanmueller/gss#75 with its CI and Deploy staging runs; the next task, the owner's choice of a redesigned counterparty page for buyers and sellers.

## 2026-10-29 — Handoff record of #74

- `docs/HANDOFF.md`: ivanmueller/gss#74 with its CI and Deploy staging runs; #73's runs on `main` green; the owner's check of times in MT on staging.

## 2026-10-29 — Handoff record of #72 and #73

- `docs/HANDOFF.md`: Alberta time on every screen (ivanmueller/gss#73) and the handoff record of #71 (#72), with their CI and Deploy staging runs; the next task, the owner's check on staging of times in MT and of the CRM.

## 2026-10-29 — Alberta time on every screen

- `docs/DECISIONS.md`: the owner's decision: every time typed and shown in Alberta time (MT), UTC−6 all year from 8 March 2026, stored in UTC; saved follow-ups keep their moment; the exchange rate's age still counted in Ottawa days.
- `AGENTS.md`, `README.md`, `docs/API.md`, `docs/PRODUCT.md`, `docs/BUILD_PLAN.md`, `docs/DESIGN_SYSTEM.md`: Alberta time in place of Central time and UTC.

## 2026-10-29 — Handoff record of #70

- `docs/HANDOFF.md`: Codex's fix of the CRM's insert grants (ivanmueller/gss#70), CI runs #154 and #155 and Deploy staging run #67; the owner's decisions on sign-in (keep the authenticator; no texted codes; no iPhone experiment); the next task (the owner's answer on Central time after Manitoba's change, the owner's check on staging).
- `AGENTS.md`: the status line with the CRM.

## 2026-10-29 — Codex's review of the CRM

- `docs/DATA_MODEL.md`: migration `20261029080000_crm_insert_column_grants.sql` (insert grants by column on the CRM tables; the database's own times).

## 2026-10-29 — A CRM for counterparties (GT-027)

- `docs/DECISIONS.md`: the owner's request and answers, and the choices made (who may do what, corrections as versions, follow-ups changed while open and final once done, Central time, anyone on the team responsible, archived counterparties, the menu's count, what is left out).
- `docs/DATA_MODEL.md`: `contact_log_entries`, `contact_log_revisions` and `follow_ups`; migration `20261029070000_counterparty_crm.sql`.
- `docs/API.md`: `/api/v1/contact-log` and `/api/v1/follow-ups` (with `/count` and `/team`).
- `docs/PRODUCT.md`: the counterparty page's follow-ups and contact history, the `/follow-ups` page and the menu's count.
- `docs/BUILD_PLAN.md`: GT-027 in Phase 2, built.
- `docs/DESIGN_SYSTEM.md`: `CounterpartyCrm`, `CrmForms`, `FollowUpItem`, `DueBadge`; a count beside a menu item.
- `README.md`: "Contact log and follow-ups".

## 2026-10-29 — Handoff record of #64 to #66

- `docs/HANDOFF.md`: the website field (ivanmueller/gss#65, #66) with Codex's two reviews and the preview's removal, the handoff record of #63 (#64); CI runs #138 to #145 and Deploy staging runs #61 to #63; the owner's checks on staging (Logos and searchable pickers, the Freight page, a stored Bank of Canada rate); the next task.
- `AGENTS.md`: the status line with carriers, websites and Freight.
- `docs/BUILD_PLAN.md`: websites in GT-020; the Bank of Canada FX connector done.

## 2026-10-29 — No website preview (owner's decision)

- `docs/DECISIONS.md`: the website entry rewritten as built, with the preview removed and why; the review's address rules kept.
- `docs/API.md`: `GET /api/v1/counterparties/{id}/website-preview` removed.
- `docs/ARCHITECTURE.md`: counterparty websites no longer among the Worker's outbound adapters.
- `docs/DESIGN_SYSTEM.md`: `Dialog` removed.
- `docs/PRODUCT.md`, `README.md` ("Counterparties"): the website link only.

## 2026-10-29 — Codex's review of the website field

- `docs/DATA_MODEL.md`: migration `20261029060000_counterparty_website_rules.sql` (printable ASCII after the site name; no international labels).
- `docs/DECISIONS.md`: ports and user names refused as written, also with a tab or line break inside; the database holding site names to the same rules; site names in plain letters only; the preview without `allow-same-origin`.
- `README.md` ("Counterparties"): plain-letter site names.
- `docs/API.md`: the preview check refuses the app's own address and redirects written with a port or user name.

## 2026-10-29 — A website on each counterparty

- `docs/DECISIONS.md`: the owner's request and the choices made (public web addresses only, the Worker's check of whether a site may be previewed, the sandboxed preview).
- `docs/DATA_MODEL.md`: `website` on counterparties; migration `20261029050000_counterparty_website.sql`.
- `docs/API.md`: `website` on a counterparty; `GET /api/v1/counterparties/{id}/website-preview`.
- `docs/DESIGN_SYSTEM.md`: `Dialog`.
- `docs/ARCHITECTURE.md`: the website check among the Worker's outbound adapters.
- `docs/PRODUCT.md`, `README.md` ("Counterparties"): the website link and Preview.

## 2026-10-29 — Counterparties open on Logos; searchable counterparty pickers

- `docs/DECISIONS.md`: the owner's request and the choices made (Logos first, the map kept as a view, `SearchSelect`).
- `docs/DESIGN_SYSTEM.md`: `SearchSelect`.
- `docs/PRODUCT.md`, `README.md` ("Counterparties"): the Logos default.

## 2026-10-29 — A bid's or offer's quantities are never NaN

- `docs/DATA_MODEL.md`: migration `20261029040000_quote_quantities_not_nan.sql`.

## 2026-10-29 — A freight payload is never NaN

- `docs/DATA_MODEL.md`: migration `20261029030000_freight_payload_not_nan.sql` (Codex's review of ivanmueller/gss#58).

## 2026-10-29 — Carrier freight rates by route (part of GT-050)

- `docs/DECISIONS.md`: the owner's answers (units vary by carrier; routes are from one location to another), and the choices made: carriers in Counterparties, who enters freight, a rate per load needs its payload, revisions.
- `docs/DATA_MODEL.md`: `freight_quotes` and `freight_quote_revisions` as built.
- `docs/API.md`: `/api/v1/freight-quotes`; `LOCATION_HAS_FREIGHT`.
- `docs/PRODUCT.md`, `docs/BUILD_PLAN.md`, `README.md` ("Counterparties", "Freight"): the Freight pages and the Carriers filter.

## 2026-10-29 — Handoff record of #55; ArcGIS map layers on the list

- `docs/HANDOFF.md`: ivanmueller/gss#55 (Codex's finding on #54 fixed), CI runs #119 and #120, Deploy staging run #52; GT-026; the next task and the owner's backlog.
- `docs/BUILD_PLAN.md`, `docs/DECISIONS.md`, `docs/ARCHITECTURE.md`: map overlay layers from ArcGIS (GT-026), requested and not started, with the proposed approach.
- `AGENTS.md`, `README.md`: the Bank of Canada FX connector built; ArcGIS layers requested.

## 2026-10-29 — Handoff record of #54

- `docs/HANDOFF.md`: ivanmueller/gss#54 (the Bank of Canada FX connector), CI run #118 and Deploy staging run #51, the scheduled job in "How staging is wired", GT-052, the next task.

## 2026-10-29 — Bank of Canada FX connector (GT-052)

- `docs/DECISIONS.md`: when the rate is fetched and stored, why the table has no organization, the out-of-date rule, what the screen shows.
- `docs/API.md`: `GET /api/v1/fx-quotes`.
- `docs/DATA_MODEL.md`: `fx_quotes` as built.
- `docs/ARCHITECTURE.md`, `docs/BUILD_PLAN.md`, `docs/PRODUCT.md`, `docs/REFERENCES.md`, `README.md` ("Exchange rate", "Workspace"): the connector built.

## 2026-10-29 — Handoff record of #53

- `docs/HANDOFF.md`: ivanmueller/gss#53, CI runs #116 and #117 and Deploy staging run #50.

## 2026-10-29 — Status checked after the dropdown change

- `AGENTS.md`: Phase 2 and most of Phase 3 on staging.
- `docs/HANDOFF.md`: ivanmueller/gss#52 and Deploy staging run #49, the status line, the tests of #50–#52, the next task (the Bank of Canada FX connector).

## 2026-10-29 — One dropdown style

- `docs/DESIGN_SYSTEM.md`: `Select`, the one dropdown for a single choice, and the rule that every dropdown shares the commodity picker's look.
- `docs/DECISIONS.md`: why the browser's own dropdown was replaced.

## 2026-10-29 — Authenticator setup by device

- `docs/DECISIONS.md`: the setup screen by device (computer, iPhone, Android), and why the iPhone button now says Apple Passwords.
- `README.md` and `docs/PRODUCT.md`: the new buttons at first sign-in.

## 2026-10-28 — Documents brought up to date after bids and offers

The owner asked for every document to be current. Updated:

- `README.md`: what staging has (Bids & offers, the workspace on live quotes), a "Bids and offers" section, the workspace's pins and what is left out of the order book, the layout list.
- `docs/BUILD_PLAN.md`: Phase 3 mostly done, the Bank of Canada FX connector next.
- `docs/DESIGN_SYSTEM.md`: only Scenarios is still planned in the menu; the Demo data switch against live data; the quote components.
- `docs/DECISIONS.md`: notes on three entries overtaken the same day (provisional view types, the synthetic-only workspace, the slice that left the workspace on made-up data).
- `docs/HANDOFF.md`: ivanmueller/gss#49 and Deploy staging run #46, the status line, GT-024, the FX note and the next task.
- `AGENTS.md`: the FX connector is next.

## 2026-10-28 — Live bids and offers in the workspace

- `docs/DECISIONS.md`: the workspace on GSS's live bids and offers (kept in step, where each sits, CAD per tonne only in the book).
- `docs/PRODUCT.md`: the workspace paragraph.
- `docs/API.md`: a quote's location carries its coordinates.

## 2026-10-28 — Bids and offers

- `docs/DECISIONS.md`: bids and offers with a full revision history, linked to a counterparty (who enters them, revisions never changed, withdrawn is final, the terms recorded, commodities, what is not in this slice).
- `docs/DATA_MODEL.md`: migration `20261028040000_quotes.sql`.
- `docs/API.md`: `/api/v1/commodities` and `/api/v1/quotes`, and `LOCATION_HAS_QUOTES`.
- `docs/PRODUCT.md`: the `/quotes` pages and the counterparty page's bids and offers.
- `README.md`: reset the local database before running the browser tests again.

## 2026-10-28 — Documents brought up to date again

The owner asked for every document to be current. Updated:

- `docs/BUILD_PLAN.md`: a "Where the build stands" table by phase; the Phase 1 gate notes one organization only.
- `docs/DECISIONS.md`: the day's smaller choices (PNG, JPG or WebP logos; Open in authenticator app; leaf and coral order book; Figtree for prices; the counterparties toolbar), and notes on the earlier entries they replace.
- `docs/PRODUCT.md`: sign-in, the Team page's add form, logo formats, the counterparties toolbar and the order book's colours and font.
- `docs/DESIGN_SYSTEM.md`: the leaf and coral ramps and the `-accent` tokens.
- `docs/HANDOFF.md`: ivanmueller/gss#43 and #44, the status line, logins made from the app, the tests of #41–#44.

## 2026-10-28 — Order book colours and price font

- `docs/DESIGN_SYSTEM.md`: bids and asks in the owner's reference leaf green and coral, with their own ramps; Figtree for prices.
- `docs/DESIGN_SYSTEM.md`: the order book's prices and spreads in Figtree semibold (owner's request, after seeing medium).

## 2026-10-28 — Authenticator link and WebP logos

- `README.md`: **Open in authenticator app** when setting up sign-in on a phone; logos may also be WebP (saved as a PNG, like a JPG).

## 2026-10-28 — Documents brought in line with what is built

The owner asked whether every document was up to date. Updated:

- `README.md` and `AGENTS.md`: the status lines (the Team page, counterparty editing, the map view); `AGENTS.md` also records that the platform only ever serves GSS staff.
- `MASTER_PROJECT_SPECIFICATION.md` and `docs/PRODUCT.md`: "multi-tenant onboarding (data model should accommodate future tenancy)" replaced by the owner's decision that only GSS ever uses the platform.
- `docs/DATA_MODEL.md` and the specification: one organization row, GSS.
- `docs/API.md`: 404s described without other organizations.
- `docs/ARCHITECTURE.md`: the staging Worker's secrets and what each may do.
- `docs/HANDOFF.md`: ivanmueller/gss#39, the people and secrets on staging, the map and geocoding checks the owner confirmed.

Engineering rules that speak of "tenant isolation" (`AGENTS.md` rule 4, `docs/ACCEPTANCE_TESTS.md`, `docs/ARCHITECTURE.md`) are unchanged: they describe how the database keeps out anyone who is not active GSS staff, and their tests stay (decision of 2026-10-27).

## 2026-10-28 — Logins from the Team page

- `README.md`: adding a person from the app, and the Supabase secret key on the Worker.
- `docs/API.md`: `POST /api/v1/members` making logins, `POST /api/v1/me/password`.
- `docs/DECISIONS.md`: the owner's choices (admin as the top role, temporary passwords, names at first sign-in).

## 2026-10-28 — Member management

- `README.md`: adding a person (login in Supabase, then **Team → Add a person**).
- `docs/API.md`, `docs/DATA_MODEL.md`, `docs/PRODUCT.md`, `docs/DESIGN_SYSTEM.md`: the members endpoints, migration `20261028020000_member_management.sql`, the `/team` route, the menu.
- `docs/DECISIONS.md`: the owner's choices.

## 2026-10-28 — Counterparty editing, buyers and sellers, the map in Counterparties

Documents updated for counterparty editing (owner's request; see `docs/DECISIONS.md`, 2026-10-28):

- `README.md`: the Counterparties section (add by hand, edit, archive, the import's column choice and buyers/sellers choice) and the map as a view of Counterparties.
- `docs/API.md`: the new endpoints, the `type` filter on `GET /facilities`, `defaultTypes` on the import, and the error codes of edits.
- `docs/DATA_MODEL.md`: migration `20261028010000_counterparty_editing.sql`.
- `docs/PRODUCT.md`: the counterparty routes; `/map` and `/map/coordinates` now forward to Counterparties.
- `docs/DESIGN_SYSTEM.md`: pin colours for buyers, sellers and both; the new components.
- `docs/DECISIONS.md`: the owner's choices of 2026-10-28.
- `AGENTS.md`: the status line.

## 2026-10-27 — Documents brought up to date with the owner's decisions

The owner asked for every project file to match the decisions and changes merged on 27 October (ivanmueller/gss#23 to ivanmueller/gss#29). Updated:

- `README.md`:
  - a current status line (it still said there was no database or sign-in);
  - a "Workspace" section: the order book, the Demo data switch, the FX rate;
  - the database connection through Hyperdrive, with `DATABASE_URL` as a local fallback only;
  - the shared money code in `packages/domain`.
- `AGENTS.md`:
  - status;
  - the FX decision under the intended architecture;
  - how synthetic data is labelled in the web app (the Demo tag).
- FX source, the Bank of Canada daily rate (owner's decision), recorded in:
  - `docs/ARCHITECTURE.md`, `docs/API.md` and `docs/DATA_MODEL.md`;
  - `docs/TRADING_RULES.md` and its copy in the specification, which also gain the stale-rate rule and display rounding;
  - `docs/BUILD_PLAN.md` (GT-052 pulled forward);
  - `docs/REFERENCES.md`.
- `MASTER_PROJECT_SPECIFICATION.md`:
  - version line;
  - FX as a permitted data source;
  - the order book as the right-hand panel, with a pointer to its owner-approved exceptions to three interface conventions;
  - references.
- Other docs:
  - `docs/PRODUCT.md` and `docs/AI_CODING_SYSTEM.md`: the quote inspector is now the order book;
  - `docs/DECISIONS.md`: pointers on entries that later decisions changed.

Product rules, formulas and schemas are unchanged apart from recording these decisions.

## 2026-10-26 — AI coding workflow pack integrated into the repository

The pack update below arrived after the Phase 0 bootstrap (ivanmueller/gss#1) had merged, so three of its files were merged by hand rather than copied:

- `README.md` and `AGENTS.md`: the pack text is adopted; the repository's Phase 0 status line, quick start, layout and Commands section are kept.
- `docs/HANDOFF.md`: the pack's "documentation pack only" status is not adopted because it no longer matches `main`. The file records the merged bootstrap, the revised Phase 0 gate and the pack's new next step (choose the implementer and reviewer, optionally after the tool comparison).

Every other pack file is copied unchanged. The note below that no application tests were executed describes the pack itself; the repository's test and CI results are in `docs/HANDOFF.md`.

## 2026-10-26 — AI coding workflow refinement

**Scope:** Documentation-only update to the initial repository starter. No application, credentials, CI system, migrations or live data were added, and **no application tests have been executed**.

### Added

- `docs/AI_CODING_SYSTEM.md`: concrete multi-model coding setup (Cursor 3/Claude/Codex/Gemini), Claude Code and Antigravity alternatives, tool evaluation rubric, worktree routing, independent PR review, prompt templates, frontend verification, security gates, budget control and early end-to-end vertical-slice path.
- This changelog to make the ZIP revision auditable.

### Updated

- `README.md`: new developer onboarding route and tool-choice link.
- `AGENTS.md`: agreed contracts before parallel edits; single integration owner updates handoff after merge.
- `docs/AI_WORKFLOW.md`: role-agnostic governance and explicit handoff ownership.
- `docs/BUILD_PLAN.md`: early thin-slice milestone across minimal Phase 2–4 scope **after** mandatory Phase 0 and secure Phase 1 prerequisites; all full phase gates retained.
- `MASTER_PROJECT_SPECIFICATION.md`: aligned AI collaboration roles, handoff ownership, repo tree, reference links and thin-slice approach. Core trading/business rules, technology stack and schemas preserved.
- `docs/HANDOFF.md`: consistent documentation-only status and next step.
- `docs/REFERENCES.md`: current official agent-platform reference links.
- GitHub issue and pull-request templates: owned-file scope, shared contracts, reviewer and evidence fields; integration owner handles merged-state handoff.

### Deliberately not changed

- Product scope, trading formulas, commodity conversion policies, quote schemas, cross-tenant isolation rules or deployment choices.
- No `.cursor` or Antigravity-specific configuration added: the existing `AGENTS.md` provides portable instructions; add vendor-specific config **only when a proven recurring need appears**.
- No custom orchestration framework, automatic execution agent, billing configuration or cloud permissions.
