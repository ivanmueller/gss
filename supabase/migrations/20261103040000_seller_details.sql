-- A seller's own details (the owner's request and answers of 2026-11-03, docs/DECISIONS.md):
-- a buyer's Market (pet, bird, …) describes who it feeds, which a seller does not, so a
-- seller has grain types instead, and a few facts that a buyer has no use for.
--
-- grain_types: any of feed, human_consumption, organic and non_gmo_ip (several allowed; none
--   by default), for the whole company. The API saves each once, in this order
--   (packages/domain/src/directory.ts).
-- seller_kind: farm, elevator, processor or other; null when not given.
-- annual_tonnes: about how many tonnes it sells a year, a whole number; null when not given.
--   Not money and never used in a calculation; an estimate to help choose whom to call.
-- organic_certifier, organic_certified_until: who certified it organic and until when (a
--   calendar date, no time of day); asked only with the organic grain type, kept if that is
--   later removed, like markets on a counterparty that is only a carrier.
--
-- Operations and org_admin members set them with the company's other details, by hand, from
-- a spreadsheet's columns, or under Edit details: inserts were already granted on the whole
-- table, and updates go through counterparties_update_for_editors. The audit trigger records
-- them like every other column. Rail or truck access stays on each location
-- (facilities.transport_access).

alter table app.counterparties
  add column grain_types text[] not null default '{}'
    constraint counterparties_grain_types_check check (
      grain_types <@ array['feed', 'human_consumption', 'organic', 'non_gmo_ip']::text[]
      and array_position(grain_types, null) is null
    ),
  add column seller_kind text
    constraint counterparties_seller_kind_check
      check (seller_kind in ('farm', 'elevator', 'processor', 'other')),
  add column annual_tonnes integer
    constraint counterparties_annual_tonnes_check
      check (annual_tonnes between 1 and 10000000),
  add column organic_certifier text
    constraint counterparties_organic_certifier_check check (
      char_length(organic_certifier) between 1 and 200
      and organic_certifier = btrim(organic_certifier)
      and organic_certifier !~ '[[:cntrl:]]'
    ),
  add column organic_certified_until date
    constraint counterparties_organic_certified_until_check
      check (organic_certified_until between date '2000-01-01' and date '2100-12-31');

grant update (grain_types, seller_kind, annual_tonnes, organic_certifier, organic_certified_until)
  on app.counterparties to app_api;
