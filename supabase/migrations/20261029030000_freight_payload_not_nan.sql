-- A freight revision's payload is never NaN (Codex's review of ivanmueller/gss#58).
--
-- Postgres ranks numeric NaN above every number, so the check `payload > 0` in
-- 20261029020000_freight_quotes.sql let a rate per load be stored with NaN as its payload,
-- which is no actual contract payload (docs/TRADING_RULES.md section 5.3). The API never
-- sends one; the database now refuses it too. The column's size already refuses infinity,
-- and the rate's upper bound already refuses NaN. Adding the check verifies the stored rows.
alter table app.freight_quote_revisions
  add constraint freight_quote_revisions_payload_not_nan check (payload <> 'NaN');
