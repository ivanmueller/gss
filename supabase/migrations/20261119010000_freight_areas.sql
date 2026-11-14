-- F-235 part 1 (the owner's answers of 2026-11-13, docs/FEATURES.md): freight rates between
-- areas, quoted by any company, with an optional end date.
--
-- 1. A route's end is a saved location (a facility, as before) or an area typed as the
--    company wrote it ("Morris, MB"), with its province or state (app.lane_region, the list
--    the carriers' lanes use) and, when Geocodio found the town and the person accepted it,
--    a point with its precision. Exactly one of the two per end.
-- 2. Any company that is not archived may quote a freight rate, not only carriers. The
--    column keeps its name, carrier_id: it is the company quoting the rate.
-- 3. valid_until is optional. A rate without one holds until withdrawn; the screens tag it
--    outdated 30 days after it was quoted, and it is never usable for a calculation then
--    (docs/TRADING_RULES.md).
--
-- Existing rows are unchanged: each has two facilities and a valid_until, so every new check
-- holds for them. The old Worker keeps working during the deploy window: it writes only
-- facility ends and a valid_until.

alter table app.freight_quotes
  alter column origin_facility_id drop not null,
  alter column destination_facility_id drop not null,
  add column origin_area_text app.label,
  add column origin_area_region app.lane_region,
  add column origin_area_latitude numeric(8, 6) check (origin_area_latitude between -90 and 90),
  add column origin_area_longitude numeric(9, 6)
    check (origin_area_longitude between -180 and 180),
  add column origin_area_precision app.location_precision,
  add column destination_area_text app.label,
  add column destination_area_region app.lane_region,
  add column destination_area_latitude numeric(8, 6)
    check (destination_area_latitude between -90 and 90),
  add column destination_area_longitude numeric(9, 6)
    check (destination_area_longitude between -180 and 180),
  add column destination_area_precision app.location_precision,
  -- Each end is a saved location or an area, never both and never neither.
  add constraint freight_quotes_origin_one_kind
    check ((origin_facility_id is null) = (origin_area_text is not null)),
  add constraint freight_quotes_destination_one_kind
    check ((destination_facility_id is null) = (destination_area_text is not null)),
  -- An area has its province or state; a saved location has no area columns.
  add constraint freight_quotes_origin_area_region
    check ((origin_area_text is null) = (origin_area_region is null)),
  add constraint freight_quotes_destination_area_region
    check ((destination_area_text is null) = (destination_area_region is null)),
  -- A point is whole (latitude, longitude and precision) or absent, and only on an area.
  add constraint freight_quotes_origin_area_point check (
    (origin_area_latitude is null) = (origin_area_longitude is null)
    and (origin_area_latitude is null) = (origin_area_precision is null)
    and (origin_area_latitude is null or origin_area_text is not null)
  ),
  add constraint freight_quotes_destination_area_point check (
    (destination_area_latitude is null) = (destination_area_longitude is null)
    and (destination_area_latitude is null) = (destination_area_precision is null)
    and (destination_area_latitude is null or destination_area_text is not null)
  ),
  -- The same area at both ends is refused; one name in two provinces or states is two
  -- places (Springfield, IL and Springfield, MO).
  add constraint freight_quotes_not_same_area check (
    origin_area_text is null or destination_area_text is null
    or (lower(origin_area_text::text), origin_area_region::text)
       is distinct from (lower(destination_area_text::text), destination_area_region::text)
  );

comment on column app.freight_quotes.carrier_id is
  'The company quoting the rate: any counterparty that was not archived when it was entered.';

-- Rates quoted by a company, whatever its locations (a company's page lists them).
create index freight_quotes_quoting_idx on app.freight_quotes (organization_id, carrier_id);

alter table app.freight_quote_revisions
  alter column valid_until drop not null,
  drop constraint freight_quote_revisions_check2,
  add constraint freight_quote_revisions_valid_window
    check (valid_until is null or valid_from < valid_until);

-- Nothing about a freight quote changes but its withdrawal, once: the area columns too.
create or replace function app.keep_freight_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.withdrawn_at is not null
     or (new.organization_id, new.carrier_id, new.origin_facility_id,
         new.destination_facility_id, new.mode, new.created_at, new.created_by,
         new.origin_area_text, new.origin_area_region, new.origin_area_latitude,
         new.origin_area_longitude, new.origin_area_precision,
         new.destination_area_text, new.destination_area_region,
         new.destination_area_latitude, new.destination_area_longitude,
         new.destination_area_precision)
        is distinct from
        (old.organization_id, old.carrier_id, old.origin_facility_id,
         old.destination_facility_id, old.mode, old.created_at, old.created_by,
         old.origin_area_text, old.origin_area_region, old.origin_area_latitude,
         old.origin_area_longitude, old.origin_area_precision,
         old.destination_area_text, old.destination_area_region,
         old.destination_area_latitude, old.destination_area_longitude,
         old.destination_area_precision) then
    raise exception 'only withdrawing changes a freight quote, and only once'
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

-- New freight quotes from any company that is not archived; a saved location's company not
-- archived either.
drop policy freight_quotes_insert_for_entrants on app.freight_quotes;
create policy freight_quotes_insert_for_entrants on app.freight_quotes
  for insert to app_api
  with check (
    app.can_enter_freight(organization_id)
    and created_by = app.current_user_id()
    and withdrawn_at is null
    and exists (
      select 1 from app.counterparties c
       where c.id = carrier_id and c.organization_id = freight_quotes.organization_id
         and c.archived_at is null
    )
    and not exists (
      select 1 from app.facilities f
        join app.counterparties c on c.id = f.counterparty_id
       where f.id in (origin_facility_id, destination_facility_id)
         and c.archived_at is not null
    )
  );
