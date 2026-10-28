-- Counterparty directory: privileges, constraints, tenant isolation, role-based writes
-- and the audit trail. Runs in one transaction that is rolled back. All fixtures are
-- synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(63);

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

-- B's directory, created outside the API.
insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c0bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer LLC', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb');
insert into app.counterparty_contacts (organization_id, counterparty_id, name, email, created_by) values
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb', 'Synthetic Contact', 'contact@example.test',
   '00000000-0000-4000-8000-0000000011bb');
insert into app.facilities (organization_id, counterparty_id, country, region, created_by) values
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb', 'US', 'ND',
   '00000000-0000-4000-8000-0000000011bb');
insert into app.counterparty_logos (organization_id, counterparty_id, data, updated_by) values
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb',
   '\x89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082',
   '00000000-0000-4000-8000-0000000011bb');
insert into app.import_batches (organization_id, kind, file_name, content_sha256, row_count, created_count, skipped_count, created_by) values
  ('00000000-0000-4000-8000-0000000000bb', 'counterparties', 'synthetic.csv', repeat('b', 64), 0, 0, 0,
   '00000000-0000-4000-8000-0000000011bb');

grant app_api to current_user;

create function pg_temp.api_rows(uid text, query text) returns jsonb
language plpgsql as $fn$
declare
  result jsonb;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute format('select coalesce(jsonb_agg(q), ''[]''::jsonb) from (%s) q', query) into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

create function pg_temp.api_count(uid text, query text) returns int
language sql as $fn$
  select jsonb_array_length(pg_temp.api_rows(uid, query))
$fn$;

create function pg_temp.api_exec(uid text, statement text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute statement;
  reset role;
  perform set_config('app.user_id', '', true);
end
$fn$;

-- A counterparty insert in org A by the given user.
create function pg_temp.new_counterparty(org text, legal_name text, created_by text) returns text
language sql as $fn$
  select format(
    $$insert into app.counterparties (organization_id, legal_name, primary_country, source, created_by)
      values (%L, %L, 'CA', 'manual', %L)$$,
    org, legal_name, created_by)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  not has_table_privilege('app_api', 'app.audit_events', 'select, insert, update, delete, truncate'),
  'app_api has no privileges on the audit trail'
);
select ok(
  not has_function_privilege('app_api', 'app.record_audit_event()', 'execute'),
  'app_api cannot call the audit trigger function directly'
);
select ok(
  not has_table_privilege('app_api', 'app.counterparties', 'delete, truncate')
    and not has_table_privilege('app_api', 'app.counterparty_contacts', 'truncate')
    and not has_table_privilege('app_api', 'app.facilities', 'truncate')
    and not has_table_privilege('app_api', 'app.import_batches', 'update, delete, truncate'),
  'app_api cannot delete counterparties, empty directory tables or change import records'
);
select ok(
  not has_table_privilege('app_api', 'app.counterparty_logos', 'delete, truncate'),
  'app_api cannot delete logos'
);
select ok(
  has_column_privilege('app_api', 'app.counterparty_logos', 'data', 'update')
    and has_column_privilege('app_api', 'app.counterparty_logos', 'updated_by', 'update')
    and not has_column_privilege('app_api', 'app.counterparty_logos', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.counterparty_logos', 'counterparty_id', 'update'),
  'app_api can replace a logo image but not move it to another counterparty or organization'
);
select ok(
  has_table_privilege('app_api', 'app.counterparties', 'select, insert')
    and has_table_privilege('app_api', 'app.counterparty_contacts', 'select, insert')
    and has_table_privilege('app_api', 'app.facilities', 'select, insert')
    and has_table_privilege('app_api', 'app.counterparty_logos', 'select, insert')
    and has_table_privilege('app_api', 'app.import_batches', 'select, insert'),
  'app_api can read and create directory records'
);
select is(
  (select extnamespace::regnamespace::text from pg_extension where extname = 'postgis'),
  'extensions',
  'PostGIS is installed in the extensions schema, not public'
);
select ok(
  exists (
    select 1 from pg_indexes
     where schemaname = 'app' and tablename = 'facilities' and indexdef ilike '%using gist (location)%'
  ),
  'facility locations have a spatial index'
);

-- Constraints (as the test owner) -----------------------------------------------
select throws_ok(
  $$insert into app.counterparty_logos (organization_id, counterparty_id, data, updated_by) values
    ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb',
     convert_to('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'UTF8'),
     '00000000-0000-4000-8000-0000000011bb')
    on conflict (counterparty_id) do update set data = excluded.data$$,
  '23514', null, 'a logo that is not a PNG is rejected'
);
select throws_ok(
  $$update app.counterparty_logos
       set data = '\x89504e470d0a1a0a'::bytea || decode(repeat('00', 524281), 'hex')
     where counterparty_id = '00000000-0000-4000-8000-00000000c0bb'$$,
  '23514', null, 'a logo over 512 KB is rejected'
);
select throws_ok(
  $$insert into app.counterparties (organization_id, legal_name, primary_country, source, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', 'SYNTHETIC B BUYER llc', 'US', 'manual', '00000000-0000-4000-8000-0000000011bb')$$,
  '23505', null, 'a legal name is unique per organization and country, ignoring case'
);
select lives_ok(
  $$insert into app.counterparties (organization_id, legal_name, primary_country, source, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer LLC', 'CA', 'manual', '00000000-0000-4000-8000-0000000011bb')$$,
  'the same legal name may exist in another country'
);
select throws_ok(
  $$insert into app.counterparties (organization_id, legal_name, primary_country, source, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', '   ', 'US', 'manual', '00000000-0000-4000-8000-0000000011bb')$$,
  '23514', null, 'a blank legal name is rejected'
);
select throws_ok(
  $$insert into app.counterparties (organization_id, legal_name, primary_country, source, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', 'Lowercase Country Co', 'us', 'manual', '00000000-0000-4000-8000-0000000011bb')$$,
  '23514', null, 'a country must be an ISO code in capitals'
);
select throws_ok(
  $$insert into app.counterparties (organization_id, legal_name, primary_country, source, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', 'Unbatched Import Co', 'US', 'file_import', '00000000-0000-4000-8000-0000000011bb')$$,
  '23514', null, 'an imported counterparty must name its import batch'
);
select throws_ok(
  $$insert into app.facilities (organization_id, counterparty_id, country, latitude, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb', 'US', 47.9, '00000000-0000-4000-8000-0000000011bb')$$,
  '23514', null, 'a latitude needs a longitude'
);
select throws_ok(
  $$insert into app.facilities (organization_id, counterparty_id, country, latitude, longitude, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb', 'US', 47.9, -97.0, '00000000-0000-4000-8000-0000000011bb')$$,
  '23514', null, 'a location must say whether it is exact or approximate'
);
select throws_ok(
  $$insert into app.counterparty_contacts (organization_id, counterparty_id, name, email, created_by) values
    ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb', 'Bad Email', 'not an email', '00000000-0000-4000-8000-0000000011bb')$$,
  '23514', null, 'a contact email must look like an email address'
);
select throws_ok(
  $$insert into app.facilities (organization_id, counterparty_id, country, created_by) values
    ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0bb', 'US', '00000000-0000-4000-8000-0000000011aa')$$,
  '23503', null, 'a facility cannot belong to another organization''s counterparty'
);
select is(
  (select extensions.st_astext(location) from app.facilities
    where organization_id = '00000000-0000-4000-8000-0000000000bb' and region = 'ND'),
  null,
  'a facility without coordinates has no location'
);

-- Writes through the API role ---------------------------------------------------------
-- olivia 11aa (operations A), adam 22aa (org_admin A), victor 33aa (viewer A),
-- tom 44aa (trader A), sam 55aa (suspended A), bob 11bb (org_admin B).
select lives_ok(
  format('select pg_temp.api_exec(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000aa', 'Synthetic Prairie Mills', '00000000-0000-4000-8000-0000000011aa')),
  'an operations member creates a counterparty in their organization'
);
select lives_ok(
  format('select pg_temp.api_exec(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000aa', 'Synthetic Admin Grain', '00000000-0000-4000-8000-0000000022aa')),
  'an org_admin creates a counterparty in their organization'
);
select throws_ok(
  format('select pg_temp.api_exec(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000aa', 'Viewer Attempt', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'a viewer cannot create counterparties'
);
select throws_ok(
  format('select pg_temp.api_exec(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000aa', 'Trader Attempt', '00000000-0000-4000-8000-0000000044aa')),
  '42501', null, 'a trader cannot create counterparties'
);
select throws_ok(
  format('select pg_temp.api_exec(%L, %L)', '00000000-0000-4000-8000-0000000055aa',
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000aa', 'Suspended Attempt', '00000000-0000-4000-8000-0000000055aa')),
  '42501', null, 'a suspended operations member cannot create counterparties'
);
select throws_ok(
  format('select pg_temp.api_exec(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000bb', 'Cross Org Attempt', '00000000-0000-4000-8000-0000000011aa')),
  '42501', null, 'an operations member cannot create counterparties in another organization'
);
select throws_ok(
  format('select pg_temp.api_exec(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000aa', 'Impersonation Attempt', '00000000-0000-4000-8000-0000000022aa')),
  '42501', null, 'a record cannot claim to be created by another user'
);
select throws_ok(
  format('select pg_temp.api_exec(%L, %L)', null,
    pg_temp.new_counterparty('00000000-0000-4000-8000-0000000000aa', 'Anonymous Attempt', '00000000-0000-4000-8000-0000000011aa')),
  '42501', null, 'without a user context nothing can be created'
);

-- A contact and a facility for olivia's counterparty.
select lives_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000011aa', $$
    insert into app.counterparty_contacts (organization_id, counterparty_id, name, email, phone, created_by)
    select organization_id, id, 'Synthetic Merchandiser', 'merch@example.test', '+1 306 555 0100', app.current_user_id()
      from app.counterparties where legal_name = 'Synthetic Prairie Mills'$$)$q$,
  'an operations member adds a contact to their counterparty'
);
select lives_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000011aa', $$
    insert into app.facilities (organization_id, counterparty_id, name, facility_type, city, region, country,
                                latitude, longitude, location_precision, geocoding_source, created_by)
    select organization_id, id, 'Synthetic Elevator', 'elevator', 'Synthetic Town', 'SK', 'CA',
           52.13, -106.67, 'approximate', 'file_import', app.current_user_id()
      from app.counterparties where legal_name = 'Synthetic Prairie Mills'$$)$q$,
  'an operations member adds a facility to their counterparty'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000011aa', $$
    insert into app.facilities (organization_id, counterparty_id, country, created_by)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c0bb', 'US', app.current_user_id())$$)$q$,
  '23503', null, 'an operations member cannot attach a facility to another organization''s counterparty'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000011aa', $$
    insert into app.counterparty_contacts (organization_id, counterparty_id, name, created_by)
    values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c0bb', 'Cross Org Contact', app.current_user_id())$$)$q$,
  '42501', null, 'an operations member cannot add a contact to another organization'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000033aa', $$
    insert into app.counterparty_contacts (organization_id, counterparty_id, name, created_by)
    select organization_id, id, 'Viewer Contact', app.current_user_id()
      from app.counterparties where legal_name = 'Synthetic Prairie Mills'$$)$q$,
  '42501', null, 'a viewer cannot add contacts'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000033aa', $$
    insert into app.facilities (organization_id, counterparty_id, country, created_by)
    select organization_id, id, 'CA', app.current_user_id()
      from app.counterparties where legal_name = 'Synthetic Prairie Mills'$$)$q$,
  '42501', null, 'a viewer cannot add facilities'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000033aa', $$
    insert into app.import_batches (organization_id, kind, file_name, content_sha256, row_count, created_count, skipped_count, created_by)
    values ('00000000-0000-4000-8000-0000000000aa', 'counterparties', 'x.csv', repeat('a', 64), 0, 0, 0, app.current_user_id())$$)$q$,
  '42501', null, 'a viewer cannot record an import'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000011aa', $$
    update app.counterparties set organization_id = '00000000-0000-4000-8000-0000000000bb'
     where legal_name = 'Synthetic Prairie Mills'$$)$q$,
  '42501', null, 'a counterparty cannot be moved to another organization through the API role'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000022aa', 'delete from app.counterparties')$q$,
  '42501', null, 'counterparties cannot be deleted through the API role'
);

-- Logos.
select lives_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000011aa', $$
    insert into app.counterparty_logos (organization_id, counterparty_id, data, updated_by)
    select organization_id, id,
      '\x89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082',
      app.current_user_id()
      from app.counterparties where legal_name = 'Synthetic Prairie Mills'$$)$q$,
  'an operations member adds a PNG logo'
);
select lives_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000022aa', $$
    insert into app.counterparty_logos (organization_id, counterparty_id, data, updated_by)
    select organization_id, id,
      '\x89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082'::bytea || '\x00'::bytea,
      app.current_user_id()
      from app.counterparties where legal_name = 'Synthetic Prairie Mills'
    on conflict (counterparty_id) do update set data = excluded.data, updated_by = excluded.updated_by$$)$q$,
  'an org_admin replaces the logo'
);
select is(
  (select octet_length(data) from app.counterparty_logos l join app.counterparties c on c.id = l.counterparty_id
    where c.legal_name = 'Synthetic Prairie Mills'),
  71,
  'the replacement logo is stored'
);
select is(
  (select sha256 from app.counterparty_logos l join app.counterparties c on c.id = l.counterparty_id
    where c.legal_name = 'Synthetic Prairie Mills'),
  (select encode(sha256(data), 'hex') from app.counterparty_logos l join app.counterparties c on c.id = l.counterparty_id
    where c.legal_name = 'Synthetic Prairie Mills'),
  'the logo checksum is derived from the stored image'
);
select lives_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000033aa', $$
    update app.counterparty_logos set data = data || '\x00'::bytea, updated_by = app.current_user_id()$$)$q$,
  'a viewer''s logo update runs'
);
select is(
  (select octet_length(data) from app.counterparty_logos l join app.counterparties c on c.id = l.counterparty_id
    where c.legal_name = 'Synthetic Prairie Mills'),
  71,
  'but changes no logo'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000033aa', $$
    insert into app.counterparty_logos (organization_id, counterparty_id, data, updated_by)
    select organization_id, counterparty_id, data, app.current_user_id() from app.counterparty_logos
    on conflict (counterparty_id) do update set data = excluded.data, updated_by = excluded.updated_by$$)$q$,
  '42501', null, 'a viewer cannot upload a logo'
);
select lives_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000011aa', $$
    update app.counterparty_logos set data = data || '\x00'::bytea, updated_by = app.current_user_id()
     where organization_id = '00000000-0000-4000-8000-0000000000bb'$$)$q$,
  'an update aimed at another organization''s logo runs'
);
select is(
  (select octet_length(data) from app.counterparty_logos where counterparty_id = '00000000-0000-4000-8000-00000000c0bb'),
  70,
  'but changes nothing in that organization'
);

-- Reads through the API role -----------------------------------------------------------
select is(
  pg_temp.api_rows('00000000-0000-4000-8000-0000000033aa',
    'select legal_name from app.counterparties order by legal_name'),
  '[{"legal_name": "Synthetic Admin Grain"}, {"legal_name": "Synthetic Prairie Mills"}]'::jsonb,
  'a viewer reads their organization''s counterparties and no others'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa', 'select 1 from app.counterparty_contacts'),
  1, 'a viewer reads their organization''s contacts only'
);
select is(
  pg_temp.api_rows('00000000-0000-4000-8000-0000000033aa',
    'select region, latitude::text, longitude::text, location_precision from app.facilities'),
  '[{"region": "SK", "latitude": "52.130000", "longitude": "-106.670000", "location_precision": "approximate"}]'::jsonb,
  'a viewer reads their organization''s facilities only, with coordinates as entered'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa', 'select 1 from app.counterparty_logos'),
  1, 'a viewer reads their organization''s logos only'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa', 'select 1 from app.import_batches'),
  0, 'a viewer sees no import batches from another organization'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    $$select 1 from app.counterparties where organization_id = '00000000-0000-4000-8000-0000000000aa'$$),
  0, 'organization B cannot read organization A''s counterparties'
);
select is(
  pg_temp.api_rows('00000000-0000-4000-8000-0000000011bb',
    $$select (select count(*) from app.counterparty_contacts) as contacts,
             (select count(*) from app.facilities) as facilities,
             (select count(*) from app.counterparty_logos) as logos,
             (select count(*) from app.import_batches) as batches$$),
  '[{"contacts": 1, "facilities": 1, "logos": 1, "batches": 1}]'::jsonb,
  'organization B sees only its own contacts, facilities, logos and imports'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000055aa', 'select 1 from app.counterparties'),
  0, 'a suspended member reads no counterparties'
);
select is(
  pg_temp.api_count(null, 'select 1 from app.counterparties'),
  0, 'no user context: no counterparties'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011aa', 'select 1 from app.counterparties where id = ''00000000-0000-4000-8000-00000000c0bb'''),
  0, 'organization A cannot read organization B''s counterparty by guessing its id'
);

-- Audit trail ----------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events e join app.counterparties c on c.id = e.entity_id
    where e.entity = 'counterparties' and e.action = 'insert' and c.legal_name = 'Synthetic Prairie Mills'
      and e.actor_id = '00000000-0000-4000-8000-0000000011aa'
      and e.organization_id = '00000000-0000-4000-8000-0000000000aa'),
  1,
  'creating a counterparty records who did it, in which organization'
);
select is(
  (select count(*)::int from app.audit_events
    where organization_id = '00000000-0000-4000-8000-0000000000aa' and entity in ('counterparty_contacts', 'facilities')
      and action = 'insert' and actor_id = '00000000-0000-4000-8000-0000000011aa'),
  2,
  'adding a contact and a facility is audited'
);
select is(
  (select changed_fields from app.audit_events
    where entity = 'counterparty_logos' and action = 'update' and actor_id = '00000000-0000-4000-8000-0000000022aa'),
  array['data', 'sha256', 'updated_by'],
  'replacing a logo records which fields changed'
);
select is(
  (select count(*)::int from app.audit_events where actor_id = '00000000-0000-4000-8000-0000000033aa'),
  0,
  'the viewer''s refused and no-op changes leave no audit events'
);
select is(
  (select count(*)::int from app.audit_events
    where organization_id = '00000000-0000-4000-8000-0000000000bb' and actor_id is null),
  -- B's directory records and, since member management (audited), its membership.
  7,
  'changes made outside the API are audited without an actor'
);
select throws_ok(
  $q$select pg_temp.api_count('00000000-0000-4000-8000-0000000022aa', 'select 1 from app.audit_events')$q$,
  '42501', null, 'even an org_admin cannot read the audit trail through the API role yet'
);
select throws_ok(
  $q$select pg_temp.api_exec('00000000-0000-4000-8000-0000000022aa', 'delete from app.audit_events')$q$,
  '42501', null, 'the audit trail cannot be erased through the API role'
);

select * from finish();
rollback;
