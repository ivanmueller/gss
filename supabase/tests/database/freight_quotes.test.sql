-- Carrier freight rates: privileges, who may enter, revise and withdraw freight quotes, that
-- revisions are numbered by the database and never changed or deleted, the values refused
-- (a rate per load needs its payload), that a withdrawn freight quote stays withdrawn,
-- cross-organization denials and the audit trail. Runs in one transaction that is rolled
-- back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(67);

-- Fixtures ------------------------------------------------------------------
-- Org A: tom (trader), adam (org_admin), olivia (operations), victor (viewer),
-- sue (suspended operations), alan (analyst). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'sue@example.test'),
  ('00000000-0000-4000-8000-0000000066aa', 'alan@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'operations', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000066aa', 'analyst', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- A: k1a (carrier), k3a (archived carrier), c1a (buyer, location f1a), c2a (seller, location
-- f2a), c4a (archived seller, location f4a). B: k1b (carrier), c1b (locations f1b, f2b).
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Carrier', '{carrier}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000d3aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Old Carrier', '{carrier}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now()),
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c4aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now()),
  ('00000000-0000-4000-8000-00000000d1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Carrier', '{carrier}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

insert into app.facilities (id, organization_id, counterparty_id, city, region, country, created_by) values
  ('00000000-0000-4000-8000-000000000f1a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Synthetic Town', 'MN', 'US', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f2a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa',
   'Synthetic City', 'SK', 'CA', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f4a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c4aa',
   'Synthetic Hamlet', 'MB', 'CA', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f1b', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1bb',
   'Synthetic Village', 'ND', 'US', '00000000-0000-4000-8000-0000000011bb'),
  ('00000000-0000-4000-8000-000000000f2b', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1bb',
   'Synthetic Crossing', 'ND', 'US', '00000000-0000-4000-8000-0000000011bb');

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

-- A truck rate from k1a for f2a to f1a in org A, entered by the given user, with the given id.
create function pg_temp.new_freight(id text, uid text,
                                    carrier text default '00000000-0000-4000-8000-00000000d1aa',
                                    origin text default '00000000-0000-4000-8000-000000000f2a',
                                    destination text default '00000000-0000-4000-8000-000000000f1a',
                                    org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.freight_quotes
                    (id, organization_id, carrier_id, origin_facility_id, destination_facility_id, mode, created_by)
                  values (%L, %L, %L, %L, %L, 'truck', %L)$$, id, org, carrier, origin, destination, uid)
$fn$;

-- A revision of the freight quote, recorded by the given user, at the given rate per tonne.
create function pg_temp.new_revision(quote text, uid text, rate text,
                                     org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.freight_quote_revisions
                    (organization_id, freight_quote_id, revision_number, firmness, rate, currency, rate_unit,
                     payload, payload_unit, inclusions, quoted_at, valid_from, valid_until, source_type,
                     recorded_by, recorded_by_name)
                  values (%L, %L, 99, 'firm', %s, 'CAD', 'MT', null, null, 'Fuel surcharge included',
                          now(), now(), now() + interval '7 days', 'email', %L, 'Synthetic Person')$$,
                org, quote, rate, uid)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.freight_quotes', 'select, insert')
    and has_table_privilege('app_api', 'app.freight_quote_revisions', 'select, insert'),
  'app_api reads and enters freight quotes and revisions'
);
select ok(
  not has_table_privilege('app_api', 'app.freight_quotes', 'delete, truncate')
    and not has_table_privilege('app_api', 'app.freight_quote_revisions', 'update, delete, truncate'),
  'app_api cannot delete freight quotes or change or delete revisions'
);
select ok(
  has_column_privilege('app_api', 'app.freight_quotes', 'withdrawn_at', 'update')
    and has_column_privilege('app_api', 'app.freight_quotes', 'withdrawn_by', 'update')
    and has_column_privilege('app_api', 'app.freight_quotes', 'withdrawn_by_name', 'update'),
  'app_api can withdraw a freight quote'
);
select ok(
  not has_column_privilege('app_api', 'app.freight_quotes', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.freight_quotes', 'carrier_id', 'update')
    and not has_column_privilege('app_api', 'app.freight_quotes', 'origin_facility_id', 'update')
    and not has_column_privilege('app_api', 'app.freight_quotes', 'destination_facility_id', 'update')
    and not has_column_privilege('app_api', 'app.freight_quotes', 'mode', 'update')
    and not has_column_privilege('app_api', 'app.freight_quotes', 'created_by', 'update'),
  'app_api cannot move a freight quote to another carrier, route or mode'
);
select ok(
  not has_table_privilege('anon', 'app.freight_quotes', 'select')
    and not has_table_privilege('authenticated', 'app.freight_quote_revisions', 'select')
    and not has_table_privilege('service_role', 'app.freight_quotes', 'select'),
  'the Supabase API roles cannot read freight quotes or revisions'
);
select ok(
  has_function_privilege('app_api', 'app.can_enter_freight(uuid)', 'execute')
    and not has_function_privilege('app_api', 'app.number_freight_revision()', 'execute')
    and not has_function_privilege('app_api', 'app.keep_freight_revisions()', 'execute')
    and not has_function_privilege('app_api', 'app.keep_freight_identity()', 'execute')
    and not has_function_privilege('anon', 'app.can_enter_freight(uuid)', 'execute'),
  'app_api can ask who enters freight but cannot call the freight triggers directly'
);

-- Entering freight quotes: who may and what ------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'a viewer cannot enter a freight quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000066aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000066aa')),
  '42501', null, 'an analyst cannot enter a freight quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000055aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000055aa')),
  '42501', null, 'a suspended operations member cannot enter a freight quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'another organization''s admin cannot enter a freight quote in this organization'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-00000000d1bb', '00000000-0000-4000-8000-000000000f2a',
      '00000000-0000-4000-8000-000000000f1b', '00000000-0000-4000-8000-0000000000bb')),
  '23503', null, 'another organization''s admin cannot route their freight from this organization''s location'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-000000000f1b',
      '00000000-0000-4000-8000-000000000f2b', '00000000-0000-4000-8000-0000000000bb')),
  '42501', null, 'another organization''s admin cannot name this organization''s carrier'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-000000000f2a',
      '00000000-0000-4000-8000-000000000f1b')),
  '23503', null, 'a freight quote cannot end at another organization''s location'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000022aa')),
  '42501', null, 'a freight quote cannot be entered in someone else''s name'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000d3aa')),
  '42501', null, 'an archived carrier gets no new freight quotes'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000c2aa')),
  '42501', null, 'a counterparty that is not a carrier quotes no freight'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-000000000f4a')),
  '42501', null, 'no new freight from a location of an archived counterparty'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-000000000f1a',
      '00000000-0000-4000-8000-000000000f1a')),
  '23514', null, 'a route needs two different locations'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa'),
            '''truck''', '''barge''')),
  '22P02', null, 'an unknown mode is refused'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa')),
  1, 'a trader enters a carrier''s truck rate from the seller''s location to the buyer''s'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    replace(pg_temp.new_freight('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000011aa',
      '00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-000000000f1a',
      '00000000-0000-4000-8000-000000000f2a'), '''truck''', '''rail''')),
  1, 'an operations member enters a rail rate the other way'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-0000000022aa')),
  1, 'an admin enters a second rate on the same route'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_freight('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-00000000d1bb', '00000000-0000-4000-8000-000000000f1b',
      '00000000-0000-4000-8000-000000000f2b', '00000000-0000-4000-8000-0000000000bb')),
  1, 'the other organization''s admin enters freight in their own organization'
);

-- Revisions: numbered by the database, never changed ------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000033aa', '105.00')),
  '42501', null, 'a viewer cannot record a freight revision'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000022aa', '105.00')),
  '42501', null, 'a freight revision cannot be recorded in someone else''s name'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011bb', '105.00',
      '00000000-0000-4000-8000-0000000000bb')),
  '23503', null, 'another organization''s admin cannot revise this organization''s freight quote'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '105.00')),
  1, 'a trader records the first terms of the freight quote'
);
select is(
  (select revision_number from app.freight_quote_revisions where freight_quote_id = '00000000-0000-4000-8000-00000000e001'),
  1, 'the database numbers the first revision 1, whatever number was sent'
);
select is(
  (select rate::text from app.freight_quote_revisions where freight_quote_id = '00000000-0000-4000-8000-00000000e001'),
  '105.00', 'the rate keeps the decimal places it was entered with'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000011aa', '98.50')),
  1, 'an operations member records new terms'
);
select is(
  (select array_agg(revision_number::text || ':' || rate::text order by revision_number)::text
     from app.freight_quote_revisions where freight_quote_id = '00000000-0000-4000-8000-00000000e001'),
  '{1:105.00,2:98.50}', 'the new terms are revision 2 and the first terms are kept'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    replace(replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-0000000044aa', '4200.00'),
            '''MT'', null, null', '''LOAD'', 90.500, ''MT'''), '''CAD''', '''USD''')),
  1, 'a rate per railcar load is recorded with its payload'
);
select is(
  (select rate_unit || ' ' || payload::text || ' ' || payload_unit from app.freight_quote_revisions
    where freight_quote_id = '00000000-0000-4000-8000-00000000e002'),
  'LOAD 90.500 MT', 'the load''s payload is kept as quoted'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-0000000022aa', '0.85'),
            '''MT'', null, null', '''BU'', null, null')),
  1, 'a rate per bushel is recorded as quoted'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.freight_quote_revisions set rate = 1 where freight_quote_id = '00000000-0000-4000-8000-00000000e001'$$),
  '42501', null, 'app_api cannot change a freight revision'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$delete from app.freight_quote_revisions where freight_quote_id = '00000000-0000-4000-8000-00000000e001'$$),
  '42501', null, 'app_api cannot delete a freight revision'
);
select throws_ok(
  $$update app.freight_quote_revisions set rate = 1 where freight_quote_id = '00000000-0000-4000-8000-00000000e001'$$,
  '42501', null, 'not even the table owner can change a freight revision'
);
select throws_ok(
  $$delete from app.freight_quote_revisions where freight_quote_id = '00000000-0000-4000-8000-00000000e001'$$,
  '42501', null, 'not even the table owner can delete a freight revision'
);
select throws_ok(
  $$truncate app.freight_quote_revisions cascade$$,
  '42501', null, 'not even the table owner can empty the freight revisions'
);

-- Revisions: the values the database refuses ---------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '0')),
  '23514', null, 'a rate of zero is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '-5.00')),
  '23514', null, 'a negative rate is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''CAD''', '''EUR''')),
  '23514', null, 'a currency other than CAD or USD is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''MT'', null, null', '''KM'', null, null')),
  '23514', null, 'an unknown rate unit is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''MT'', null, null', '''LOAD'', null, null')),
  '23514', null, 'a rate per load without its payload is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''MT'', null, null', '''MT'', 40.000, ''MT''')),
  '23514', null, 'a payload is recorded only for a rate per load'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''MT'', null, null', '''LOAD'', 40.000, null')),
  '23514', null, 'a payload without its unit is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''MT'', null, null', '''LOAD'', 0, ''MT''')),
  '23514', null, 'a payload of zero is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''MT'', null, null', '''LOAD'', 40.000, ''KG''')),
  '23514', null, 'an unknown payload unit is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            'now() + interval ''7 days''', 'now()')),
  '23514', null, 'a rate valid until the moment it starts is refused'
);

-- Withdrawing -----------------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.freight_quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000033aa', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000e001'$$),
  0, 'a viewer cannot withdraw a freight quote'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$update app.freight_quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000011bb', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000e001'$$),
  0, 'another organization''s admin cannot withdraw this organization''s freight quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.freight_quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000022aa', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000e001'$$),
  '42501', null, 'a freight quote cannot be withdrawn in someone else''s name'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.freight_quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000011aa', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000e001'$$),
  1, 'an operations member withdraws a freight quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$update app.freight_quotes set withdrawn_at = null, withdrawn_by = null, withdrawn_by_name = null
      where id = '00000000-0000-4000-8000-00000000e001'$$),
  '23514', null, 'a withdrawn freight quote cannot be brought back'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-0000000044aa', '99.00')),
  'GS003', null, 'a withdrawn freight quote cannot be revised'
);
select throws_ok(
  $$update app.freight_quotes set mode = 'truck' where id = '00000000-0000-4000-8000-00000000e002'$$,
  '23514', null, 'not even the table owner can change a freight quote''s mode'
);
select throws_ok(
  $$update app.freight_quotes set destination_facility_id = '00000000-0000-4000-8000-000000000f4a'
     where id = '00000000-0000-4000-8000-00000000e003'$$,
  '23514', null, 'not even the table owner can change a freight quote''s route'
);

-- Reading ---------------------------------------------------------------------------
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa', 'select id from app.freight_quotes'),
  3, 'a viewer reads the organization''s freight quotes, withdrawn included'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000066aa', 'select id from app.freight_quote_revisions'),
  4, 'an analyst reads the organization''s freight revisions, and only those'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    $$select id from app.freight_quotes where organization_id = '00000000-0000-4000-8000-0000000000aa'
      union all select id from app.freight_quote_revisions where organization_id = '00000000-0000-4000-8000-0000000000aa'$$),
  0, 'another organization''s admin reads none of this organization''s freight'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb', 'select id from app.freight_quotes'),
  1, 'the other organization''s admin reads their own freight quote'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000055aa',
    'select id from app.freight_quotes union all select id from app.freight_quote_revisions'),
  0, 'a suspended member reads no freight'
);
select is(
  pg_temp.api_count(null, 'select id from app.freight_quotes union all select id from app.freight_quote_revisions'),
  0, 'nothing is read without a user'
);

-- Locations with freight, and the audit trail ---------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$delete from app.facilities where id = '00000000-0000-4000-8000-000000000f2a'$$),
  '23503', null, 'a location freight starts from cannot be removed'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$delete from app.facilities where id = '00000000-0000-4000-8000-000000000f1a'$$),
  '23503', null, 'a location freight goes to cannot be removed'
);
select is(
  (select array_agg(entity || ':' || action order by id)::text from app.audit_events
    where entity in ('freight_quotes', 'freight_quote_revisions')
      and organization_id = '00000000-0000-4000-8000-0000000000aa'),
  '{freight_quotes:insert,freight_quotes:insert,freight_quotes:insert,freight_quote_revisions:insert,freight_quote_revisions:insert,freight_quote_revisions:insert,freight_quote_revisions:insert,freight_quotes:update}',
  'entering, revising and withdrawing freight are audited'
);
select is(
  (select count(*)::int from app.audit_events
    where entity = 'freight_quote_revisions' and actor_id is not null
      and organization_id = '00000000-0000-4000-8000-0000000000aa'
      and request_id = '00000000-0000-4000-8000-0000000e0e0e'),
  4, 'each freight revision''s audit event names who recorded it and the request'
);

select * from finish();
rollback;
