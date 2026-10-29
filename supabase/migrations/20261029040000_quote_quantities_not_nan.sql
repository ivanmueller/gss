-- A bid's or offer's quantities are never NaN (the same gap as freight payloads, found in
-- Codex's review of ivanmueller/gss#58).
--
-- Postgres ranks numeric NaN above every number, so in 20261028040000_quotes.sql the checks
-- `quantity_max_mt > 0` and `quantity_min_mt <= quantity_max_mt` let a revision be stored
-- with NaN as its available quantity (with any minimum, or NaN as both). The API never sends
-- one; the database now refuses it too. The price's upper bound already refuses NaN, and the
-- columns' size refuses infinity. Adding the checks verifies the stored revisions, which
-- were all entered through the API's checks.
alter table app.quote_revisions
  add constraint quote_revisions_quantity_max_not_nan check (quantity_max_mt <> 'NaN'),
  add constraint quote_revisions_quantity_min_not_nan check (quantity_min_mt <> 'NaN');
