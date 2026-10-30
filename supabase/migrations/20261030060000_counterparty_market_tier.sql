-- A counterparty's markets and tier (the owner's request and answers of 2026-10-30,
-- docs/DECISIONS.md), to filter Counterparties by.
--
-- markets: the markets it serves, any of pet, bird, equine, specialty,
-- small_animal, exotic, wildlife and aqua (several allowed; none by default). The API saves
-- each once, in this order (packages/domain/src/directory.ts).
-- tier: A, B or C, or null when not given.
--
-- Operations and org_admin members set both with the company's other details, by hand, from
-- a spreadsheet's Market and Tier columns, or under Edit details: inserts were already
-- granted on the whole table, and updates go through counterparties_update_for_editors. The
-- audit trigger records them like every other column.

alter table app.counterparties
  add column markets text[] not null default '{}'
    constraint counterparties_markets_check check (
      markets <@ array['pet', 'bird', 'equine', 'specialty', 'small_animal', 'exotic',
                       'wildlife', 'aqua']::text[]
      and array_position(markets, null) is null
    ),
  add column tier text
    constraint counterparties_tier_check check (tier in ('A', 'B', 'C'));

grant update (markets, tier) on app.counterparties to app_api;
