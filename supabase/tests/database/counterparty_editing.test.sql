-- Counterparty editing: column privileges, who may correct, archive and remove directory
-- records, that nothing moves between organizations or counterparties, cross-organization
-- denials and the audit trail. Runs in one transaction that is rolled back. All fixtures
-- are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(45);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), adam (org_admin), victor (viewer), tom (trader),
-- sam (suspended operations). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'sam@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'operations', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- c1a and c2a in A, c1b in B; each with a contact and a located facility.
insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, created_by) values
  ('00000000-0000-4000-8000-0000000c01aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Synthetic Contact A', 'a@example.test', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-0000000c02aa', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Synthetic Contact A2', null, '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-0000000c01bb', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1bb',
   'Synthetic Contact B', 'b@example.test', '00000000-0000-4000-8000-0000000011bb');

insert into app.facilities (id, organization_id, counterparty_id, city, region, country, latitude, longitude,
                            location_precision, geocoding_source, geocoding_accuracy, geocoding_confidence, created_by) values
  ('00000000-0000-4000-8000-000000000f1a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Synthetic Town', 'SK', 'CA', 52.133214, -106.670046, 'exact', 'geocodio', 'rooftop', 0.97,
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f2a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Synthetic City', 'MB', 'CA', null, null, null, null, null, null,
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f1b', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1bb',
   'Synthetic Village', 'ND', 'US', 46.877186, -96.789803, 'approximate', 'manual', null, null,
   '00000000-0000-4000-8000-0000000011bb');

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

-- Runs a statement as app_api for the given user and returns how many rows it changed.
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

create function pg_temp.rename_a() returns text
language sql as $fn$
  select $$update app.counterparties set legal_name = 'Synthetic A Buyer Renamed', types = '{buyer,seller}'
            where id = '00000000-0000-4000-8000-00000000c1aa'$$
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_column_privilege('app_api', 'app.counterparties', 'legal_name', 'update')
    and has_column_privilege('app_api', 'app.counterparties', 'trading_name', 'update')
    and has_column_privilege('app_api', 'app.counterparties', 'types', 'update')
    and has_column_privilege('app_api', 'app.counterparties', 'primary_country', 'update')
    and has_column_privilege('app_api', 'app.counterparties', 'verification_status', 'update')
    and has_column_privilege('app_api', 'app.counterparties', 'notes', 'update')
    and has_column_privilege('app_api', 'app.counterparties', 'archived_at', 'update'),
  'app_api can update the details of a counterparty and archive it'
);
select ok(
  not has_column_privilege('app_api', 'app.counterparties', 'id', 'update')
    and not has_column_privilege('app_api', 'app.counterparties', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.counterparties', 'source', 'update')
    and not has_column_privilege('app_api', 'app.counterparties', 'import_batch_id', 'update')
    and not has_column_privilege('app_api', 'app.counterparties', 'created_by', 'update')
    and not has_column_privilege('app_api', 'app.counterparties', 'created_at', 'update'),
  'app_api cannot change a counterparty''s organization, source or creation record'
);
select ok(
  not has_table_privilege('app_api', 'app.counterparties', 'truncate'),
  'app_api cannot empty counterparties; it deletes only archived ones, as an admin (counterparty_deletion.test.sql)'
);
select ok(
  has_column_privilege('app_api', 'app.counterparty_contacts', 'name', 'update')
    and has_column_privilege('app_api', 'app.counterparty_contacts', 'role', 'update')
    and has_column_privilege('app_api', 'app.counterparty_contacts', 'email', 'update')
    and has_column_privilege('app_api', 'app.counterparty_contacts', 'phone', 'update')
    and has_table_privilege('app_api', 'app.counterparty_contacts', 'delete'),
  'app_api can correct and remove contacts'
);
select ok(
  not has_column_privilege('app_api', 'app.counterparty_contacts', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.counterparty_contacts', 'counterparty_id', 'update')
    and not has_column_privilege('app_api', 'app.counterparty_contacts', 'created_by', 'update'),
  'app_api cannot move a contact to another organization or counterparty'
);
select ok(
  has_column_privilege('app_api', 'app.facilities', 'name', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'facility_type', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'address_line', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'city', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'region', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'postal_code', 'update')
    and has_column_privilege('app_api', 'app.facilities', 'country', 'update')
    and has_table_privilege('app_api', 'app.facilities', 'delete'),
  'app_api can correct and remove locations'
);
select ok(
  not has_function_privilege('app_api', 'app.keep_existing_coordinates()', 'execute'),
  'app_api cannot call the coordinates guard directly'
);

-- Counterparties: who may edit and archive ------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa', pg_temp.rename_a()), 0,
  'a viewer cannot edit a counterparty');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', pg_temp.rename_a()), 0,
  'a trader cannot edit a counterparty');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000055aa', pg_temp.rename_a()), 0,
  'a suspended operations member cannot edit a counterparty');
select is(pg_temp.api_changed(null, pg_temp.rename_a()), 0,
  'nothing is edited without a user');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb', pg_temp.rename_a()), 0,
  'another organization''s admin cannot edit this organization''s counterparty');
select is(
  (select legal_name::text from app.counterparties where id = '00000000-0000-4000-8000-00000000c1aa'),
  'Synthetic A Buyer', 'the counterparty is unchanged after the refused attempts'
);
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.rename_a()), 1,
  'an operations member edits a counterparty');
select is(
  (select legal_name::text || ' ' || types::text from app.counterparties where id = '00000000-0000-4000-8000-00000000c1aa'),
  'Synthetic A Buyer Renamed {buyer,seller}', 'the new name and types are saved'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$update app.counterparties set verification_status = 'verified' where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  1, 'an org_admin edits a counterparty'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set legal_name = 'synthetic a seller' where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  '23505', null, 'a counterparty cannot be renamed to another counterparty''s name, ignoring case'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set source = 'file_import' where id = '00000000-0000-4000-8000-00000000c1aa'$$),
  '42501', null, 'an editor cannot change where a counterparty came from'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c2aa'$$),
  0, 'a viewer cannot archive a counterparty'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparties set archived_at = now() where id = '00000000-0000-4000-8000-00000000c2aa'$$),
  1, 'an operations member archives a counterparty'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa',
    $$select 1 from app.counterparties where id = '00000000-0000-4000-8000-00000000c2aa' and archived_at is not null$$),
  1, 'members still see an archived counterparty, marked as archived'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$update app.counterparties set archived_at = null where id = '00000000-0000-4000-8000-00000000c2aa'$$),
  1, 'an org_admin restores an archived counterparty'
);

-- Contacts ----------------------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.counterparty_contacts set email = 'x@example.test' where id = '00000000-0000-4000-8000-0000000c01aa'$$),
  0, 'a viewer cannot correct a contact'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$update app.counterparty_contacts set email = 'x@example.test' where id = '00000000-0000-4000-8000-0000000c01aa'$$),
  0, 'another organization''s admin cannot correct this organization''s contact'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparty_contacts set email = 'new@example.test', phone = '+1 306 555 0101'
       where id = '00000000-0000-4000-8000-0000000c01aa'$$),
  1, 'an operations member corrects a contact'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.counterparty_contacts set counterparty_id = '00000000-0000-4000-8000-00000000c2aa'
       where id = '00000000-0000-4000-8000-0000000c01aa'$$),
  '42501', null, 'a contact cannot be moved to another counterparty'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$delete from app.counterparty_contacts where id = '00000000-0000-4000-8000-0000000c02aa'$$),
  0, 'a viewer cannot remove a contact'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$delete from app.counterparty_contacts where id = '00000000-0000-4000-8000-0000000c02aa'$$),
  0, 'another organization''s admin cannot remove this organization''s contact'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$delete from app.counterparty_contacts where id = '00000000-0000-4000-8000-0000000c02aa'$$),
  1, 'an operations member removes a contact'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$delete from app.counterparty_contacts where id = '00000000-0000-4000-8000-0000000c01bb'$$),
  0, 'an editor cannot remove another organization''s contact'
);

-- Locations ---------------------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.facilities set city = 'Elsewhere' where id = '00000000-0000-4000-8000-000000000f1a'$$),
  0, 'a viewer cannot correct a location'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$update app.facilities set city = 'Elsewhere' where id = '00000000-0000-4000-8000-000000000f1a'$$),
  0, 'another organization''s admin cannot correct this organization''s location'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.facilities set latitude = 50.445211, longitude = -104.618894
       where id = '00000000-0000-4000-8000-000000000f1a'$$),
  '23514', null, 'coordinates corrected by hand cannot keep the geocoder as their source'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.facilities
         set city = 'Synthetic Capital', latitude = 50.445211, longitude = -104.618894,
             location_precision = 'exact', geocoding_source = 'manual',
             geocoding_accuracy = null, geocoding_confidence = null
       where id = '00000000-0000-4000-8000-000000000f1a'$$),
  1, 'an operations member corrects a location''s address and coordinates by hand'
);
select is(
  (select row(city, latitude, longitude, geocoding_source)::text from app.facilities
    where id = '00000000-0000-4000-8000-000000000f1a'),
  '("Synthetic Capital",50.445211,-104.618894,manual)',
  'the corrected location is saved with the source manual'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.facilities
         set latitude = 49.895136, longitude = -97.138374, location_precision = 'approximate',
             geocoding_source = 'geocodio', geocoding_accuracy = 'place', geocoding_confidence = 0.9
       where id = '00000000-0000-4000-8000-000000000f2a' and latitude is null$$),
  1, 'a geocoding result still fills in a location that has no coordinates'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.facilities set organization_id = '00000000-0000-4000-8000-0000000000bb'
       where id = '00000000-0000-4000-8000-000000000f1a'$$),
  '42501', null, 'a location cannot be moved to another organization'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$delete from app.facilities where id = '00000000-0000-4000-8000-000000000f2a'$$),
  0, 'a viewer cannot remove a location'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$delete from app.facilities where id = '00000000-0000-4000-8000-000000000f2a'$$),
  0, 'another organization''s admin cannot remove this organization''s location'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$delete from app.facilities where id = '00000000-0000-4000-8000-000000000f2a'$$),
  1, 'an org_admin removes a location'
);
select is(
  (select row(c.legal_name, k.email, f.city)::text
     from app.counterparties c
     join app.counterparty_contacts k on k.counterparty_id = c.id
     join app.facilities f on f.counterparty_id = c.id
    where c.id = '00000000-0000-4000-8000-00000000c1bb'),
  '("Synthetic B Buyer",b@example.test,"Synthetic Village")',
  'organization B''s counterparty, contact and location are untouched'
);

-- Audit trail ----------------------------------------------------------------------------
select is(
  (select row(actor_id, request_id)::text || ' ' || array_to_string(changed_fields, ',')
     from app.audit_events
    where entity = 'counterparties' and entity_id = '00000000-0000-4000-8000-00000000c1aa'
      and action = 'update' and 'legal_name' = any (changed_fields)),
  '(00000000-0000-4000-8000-0000000011aa,00000000-0000-4000-8000-0000000e0e0e) legal_name,types',
  'editing a counterparty is audited with the user, the request and the changed columns'
);
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparties' and entity_id = '00000000-0000-4000-8000-00000000c2aa'
      and action = 'update' and changed_fields = array['archived_at']),
  2, 'archiving and restoring are each audited'
);
select is(
  (select string_agg(entity || ':' || actor_id, ',' order by entity) from app.audit_events
    where action = 'delete'),
  'counterparty_contacts:00000000-0000-4000-8000-0000000011aa,facilities:00000000-0000-4000-8000-0000000022aa',
  'removing a contact or a location is audited with who did it'
);
select is(
  (select count(*)::int from app.audit_events
    where actor_id in ('00000000-0000-4000-8000-0000000033aa', '00000000-0000-4000-8000-0000000044aa',
                       '00000000-0000-4000-8000-0000000055aa', '00000000-0000-4000-8000-0000000011bb')),
  0, 'refused edits leave no audit events'
);

select * from finish();
rollback;
