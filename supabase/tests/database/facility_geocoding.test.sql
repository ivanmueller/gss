-- Saving geocoded coordinates: column privileges, who may fill in a missing location,
-- that existing coordinates are never overwritten, the new constraints and the audit trail.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(17);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), victor (viewer), sam (suspended operations).
-- Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'sam@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'operations', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c0aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c0bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

-- f1a and f1b have no coordinates; f2a already has some.
insert into app.facilities (id, organization_id, counterparty_id, city, region, country, latitude, longitude, location_precision, created_by) values
  ('00000000-0000-4000-8000-000000000f1a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0aa',
   'Synthetic Town', 'SK', 'CA', null, null, null, '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f2a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0aa',
   'Synthetic City', 'MB', 'CA', 49.895136, -97.138374, 'approximate', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f1b', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb',
   'Synthetic Village', 'MB', 'CA', null, null, null, '00000000-0000-4000-8000-0000000011bb');

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

-- Runs a statement as app_api for the given user and returns how many rows it changed.
create function pg_temp.api_changed(uid text, statement text) returns int
language plpgsql as $fn$
declare
  changed int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e9e9e', true);
  set local role app_api;
  execute statement;
  get diagnostics changed = row_count;
  reset role;
  perform set_config('app.user_id', '', true);
  return changed;
end
$fn$;

-- Saving a geocoded point for one facility, as the API does.
create function pg_temp.save_location(facility text) returns text
language sql as $fn$
  select format(
    $$update app.facilities
      set latitude = 52.133214, longitude = -106.670046, location_precision = 'exact',
          geocoding_source = 'geocodio', geocoding_accuracy = 'rooftop', geocoding_confidence = 0.97
      where id = %L$$,
    facility)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_column_privilege('app_api', 'app.facilities', 'latitude', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'longitude', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'location_precision', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'geocoding_source', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'geocoding_accuracy', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'geocoding_confidence', 'update'),
  'app_api can update the location columns of a facility'
);
select ok(
  not has_column_privilege('app_api', 'app.facilities', 'name', 'update')
    and not has_column_privilege('app_api', 'app.facilities', 'address_line', 'update')
    and not has_column_privilege('app_api', 'app.facilities', 'city', 'update')
    and not has_column_privilege('app_api', 'app.facilities', 'region', 'update')
    and not has_column_privilege('app_api', 'app.facilities', 'country', 'update')
    and not has_column_privilege('app_api', 'app.facilities', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.facilities', 'counterparty_id', 'update')
    and not has_column_privilege('app_api', 'app.facilities', 'created_by', 'update'),
  'app_api cannot change a facility''s address, organization or counterparty'
);
select ok(
  not has_table_privilege('app_api', 'app.facilities', 'delete, truncate'),
  'app_api still cannot delete facilities'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.facilities set city = 'Elsewhere' where id = '00000000-0000-4000-8000-000000000f1a'$$),
  '42501', null, 'an editor cannot change a facility''s address through app_api'
);

-- Who may fill in a missing location ------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa', pg_temp.save_location('00000000-0000-4000-8000-000000000f1a')),
  0, 'a viewer cannot save coordinates'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000055aa', pg_temp.save_location('00000000-0000-4000-8000-000000000f1a')),
  0, 'a suspended member cannot save coordinates'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb', pg_temp.save_location('00000000-0000-4000-8000-000000000f1a')),
  0, 'another organization''s admin cannot save coordinates for this organization'
);
select is(
  pg_temp.api_changed(null, pg_temp.save_location('00000000-0000-4000-8000-000000000f1a')),
  0, 'nothing is saved without a user'
);
select is(
  (select latitude from app.facilities where id = '00000000-0000-4000-8000-000000000f1a'),
  null, 'the facility still has no coordinates after the refused attempts'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.save_location('00000000-0000-4000-8000-000000000f1a')),
  1, 'an operations member saves coordinates for a facility that has none'
);
select is(
  (select row(latitude, longitude, location_precision, geocoding_source, geocoding_accuracy, geocoding_confidence)::text
     from app.facilities where id = '00000000-0000-4000-8000-000000000f1a'),
  '(52.133214,-106.670046,exact,geocodio,rooftop,0.97)',
  'the saved location keeps its source, accuracy type and confidence'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.save_location('00000000-0000-4000-8000-000000000f2a')),
  0, 'existing coordinates are never overwritten'
);
select is(
  (select row(latitude, longitude, location_precision)::text from app.facilities where id = '00000000-0000-4000-8000-000000000f2a'),
  '(49.895136,-97.138374,approximate)',
  'the existing coordinates are unchanged'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.save_location('00000000-0000-4000-8000-000000000f1b')),
  0, 'an editor cannot save coordinates for another organization''s facility'
);
select is(
  (select row(actor_id, action, request_id)::text || ' ' || array_to_string(changed_fields, ',')
     from app.audit_events
    where entity = 'facilities' and entity_id = '00000000-0000-4000-8000-000000000f1a' and action = 'update'),
  '(00000000-0000-4000-8000-0000000011aa,update,00000000-0000-4000-8000-0000000e9e9e) geocoding_accuracy,geocoding_confidence,geocoding_source,latitude,location,location_precision,longitude',
  'saving coordinates is audited with the user, the request and the changed columns'
);

-- Constraints (as the test owner) -----------------------------------------------
select throws_ok(
  $$update app.facilities set geocoding_accuracy = 'place' where id = '00000000-0000-4000-8000-000000000f1b'$$,
  '23514', null, 'a geocoding accuracy needs coordinates'
);
select throws_ok(
  $$update app.facilities set geocoding_confidence = 1.5 where id = '00000000-0000-4000-8000-000000000f2a'$$,
  '23514', null, 'a geocoding confidence lies between 0 and 1'
);

select * from finish();
rollback;
