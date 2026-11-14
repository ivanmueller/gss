-- Freight rates between areas, quoted by any company, with an optional end date (F-235,
-- 20261119010000_freight_areas.sql): each end a saved location or an area, never both or
-- neither; an area's province or state from the list; a point whole or absent; one town name
-- in two provinces allowed, the same area twice refused; any company not archived may quote;
-- the area columns never change; viewers and analysts enter nothing; another organization's
-- rates stay invisible. Runs in one transaction that is rolled back. All fixtures synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Org A: tom (trader), victor (viewer), alan (analyst). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000066aa', 'alan@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000066aa', 'analyst', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- A: c1a (buyer, location f1a), c2a (archived buyer). B: c1b (buyer, location f1b).
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000044aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Old Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000044aa', now()),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

insert into app.facilities (id, organization_id, counterparty_id, city, region, country, created_by) values
  ('00000000-0000-4000-8000-000000000f1a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Synthetic Town', 'MN', 'US', '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-000000000f1b', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1bb',
   'Synthetic Village', 'ND', 'US', '00000000-0000-4000-8000-0000000011bb');

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

create function pg_temp.api_changed(uid text, statement text) returns int
language plpgsql as $fn$
declare
  changed int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);
  set local role app_api;
  execute statement;
  get diagnostics changed = row_count;
  reset role;
  perform set_config('app.user_id', '', true);
  return changed;
end
$fn$;

create function pg_temp.api_count(uid text, query text) returns int
language plpgsql as $fn$
declare
  result int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute format('select count(*)::int from (%s) q', query) into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

-- A truck rate quoted by c1a in org A: the origin columns and destination columns given as
-- SQL fragments "(facility, text, region, latitude, longitude, precision)".
create function pg_temp.new_rate(id text, uid text, origin text, destination text,
                                 company text default '00000000-0000-4000-8000-00000000c1aa',
                                 org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.freight_quotes
                    (id, organization_id, carrier_id, mode, created_by,
                     origin_facility_id, origin_area_text, origin_area_region, origin_area_latitude,
                     origin_area_longitude, origin_area_precision,
                     destination_facility_id, destination_area_text, destination_area_region,
                     destination_area_latitude, destination_area_longitude, destination_area_precision)
                  select %L, %L, %L, 'truck', %L, o.*, d.*
                  from (values %s) o, (values %s) d$$,
                id, org, company, uid, origin, destination)
$fn$;

-- Ends, as SQL fragments.
create function pg_temp.area(text_ text, region text, point boolean default false) returns text
language sql as $fn$
  select format('(null::uuid, %L, %L::app.lane_region, %s, %s, %s)', text_, region,
                case when point then '49.354000::numeric' else 'null::numeric' end,
                case when point then '-97.365000::numeric' else 'null::numeric' end,
                case when point then '''approximate''::app.location_precision' else 'null::app.location_precision' end)
$fn$;
create function pg_temp.facility(id text) returns text
language sql as $fn$
  select format('(%L::uuid, null::text, null::app.lane_region, null::numeric, null::numeric, null::app.location_precision)', id)
$fn$;

-- What is accepted -------------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e101', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area('Synthetic Town A, MB', 'CA-MB', true), pg_temp.area('Synthetic Town B', 'US-IN'))),
  1, 'a buyer quotes a rate between two areas, one with a point'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e102', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area('Synthetic Town A', 'CA-MB'), pg_temp.facility('00000000-0000-4000-8000-000000000f1a'))),
  1, 'an area to a saved location'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e103', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area('Synthetic Springfield', 'US-IL'), pg_temp.area('Synthetic Springfield', 'US-MO'))),
  1, 'one town name in two states is two places'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$insert into app.freight_quote_revisions
        (organization_id, freight_quote_id, revision_number, firmness, rate, currency, rate_unit,
         quoted_at, valid_from, valid_until, source_type, recorded_by, recorded_by_name)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e101', 1,
              'indicative', 335, 'CAD', 'MT', now(), now(), null, 'email',
              '00000000-0000-4000-8000-0000000044aa', 'Synthetic Person')$$),
  1, 'a revision without an end date'
);

-- What is refused ---------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area('Synthetic Springfield', 'US-IL'), pg_temp.area('synthetic springfield', 'US-IL'))),
  '23514', null, 'the same area at both ends is refused, whatever its case'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      $$('00000000-0000-4000-8000-000000000f1a'::uuid, 'Synthetic Town', 'CA-MB'::app.lane_region, null::numeric, null::numeric, null::app.location_precision)$$,
      pg_temp.area('Synthetic Town B', 'US-IN'))),
  '23514', null, 'an end is a saved location or an area, not both'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      $$(null::uuid, null::text, null::app.lane_region, null::numeric, null::numeric, null::app.location_precision)$$,
      pg_temp.area('Synthetic Town B', 'US-IN'))),
  '23514', null, 'an end is never neither'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      $$(null::uuid, 'Synthetic Town', null::app.lane_region, null::numeric, null::numeric, null::app.location_precision)$$,
      pg_temp.area('Synthetic Town B', 'US-IN'))),
  '23514', null, 'an area needs its province or state'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area('Synthetic Town', 'CA-ZZ'), pg_temp.area('Synthetic Town B', 'US-IN'))),
  '23514', null, 'a province or state off the list is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      $$(null::uuid, 'Synthetic Town', 'CA-MB'::app.lane_region, 49.1::numeric, null::numeric, null::app.location_precision)$$,
      pg_temp.area('Synthetic Town B', 'US-IN'))),
  '23514', null, 'half a point is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      $$(null::uuid, 'Synthetic Town', 'CA-MB'::app.lane_region, 91::numeric, 10::numeric, 'exact'::app.location_precision)$$,
      pg_temp.area('Synthetic Town B', 'US-IN'))),
  '23514', null, 'a latitude beyond the poles is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area(E'Synthetic\tTown', 'CA-MB'), pg_temp.area('Synthetic Town B', 'US-IN'))),
  '23514', null, 'an area''s text with a control character is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area('Synthetic Town A', 'CA-MB'), pg_temp.area('Synthetic Town B', 'US-IN'),
      '00000000-0000-4000-8000-00000000c2aa')),
  '42501', null, 'an archived company quotes no freight'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000044aa',
      pg_temp.area('Synthetic Town A', 'CA-MB'), pg_temp.facility('00000000-0000-4000-8000-000000000f1b'))),
  '23503', null, 'another organization''s location is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000033aa',
      pg_temp.area('Synthetic Town A', 'CA-MB'), pg_temp.area('Synthetic Town B', 'US-IN'))),
  '42501', null, 'a viewer enters no freight'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000066aa',
    pg_temp.new_rate('00000000-0000-4000-8000-00000000e110', '00000000-0000-4000-8000-0000000066aa',
      pg_temp.area('Synthetic Town A', 'CA-MB'), pg_temp.area('Synthetic Town B', 'US-IN'))),
  '42501', null, 'an analyst enters no freight'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$insert into app.freight_quote_revisions
        (organization_id, freight_quote_id, revision_number, firmness, rate, currency, rate_unit,
         quoted_at, valid_from, valid_until, source_type, recorded_by, recorded_by_name)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000e102', 1,
              'firm', 335, 'CAD', 'MT', now(), now(), now() - interval '1 day', 'email',
              '00000000-0000-4000-8000-0000000044aa', 'Synthetic Person')$$),
  '23514', null, 'an end date before the start is refused'
);

-- The route never changes ---------------------------------------------------------------
select throws_ok(
  $$update app.freight_quotes set origin_area_text = 'Synthetic Elsewhere'
    where id = '00000000-0000-4000-8000-00000000e101'$$,
  '23514', null, 'an area''s text never changes'
);
select throws_ok(
  $$update app.freight_quotes set origin_area_latitude = 50, origin_area_longitude = -97
    where id = '00000000-0000-4000-8000-00000000e101'$$,
  '23514', null, 'an area''s point never changes'
);
select throws_ok(
  $$update app.freight_quotes set destination_area_region = 'US-OH'
    where id = '00000000-0000-4000-8000-00000000e101'$$,
  '23514', null, 'an area''s province or state never changes'
);

-- Other organizations ------------------------------------------------------------------
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    'select 1 from app.freight_quotes where organization_id = ''00000000-0000-4000-8000-0000000000aa'''),
  0, 'another organization sees none of these rates'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa',
    'select 1 from app.freight_quotes where origin_area_text is not null'),
  3, 'a viewer of the organization reads its area rates'
);

select * from finish();
rollback;
