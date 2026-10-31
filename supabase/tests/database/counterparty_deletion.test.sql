-- Admins delete archived counterparties: only an org_admin of the counterparty's organization,
-- only once it is archived, and never one with history. Runs in one transaction that is
-- rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(18);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), adam (org_admin), victor (viewer). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- c1: archived, with a contact, a location, a commodity and a logo. c2: not archived.
-- c3: archived, with a contact log entry.
insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Archived Co', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now()),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Active Co', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c3aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Storied Co', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now());
insert into app.counterparty_contacts (organization_id, counterparty_id, name, created_by) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'Synthetic Contact',
   '00000000-0000-4000-8000-0000000011aa');
insert into app.facilities (organization_id, counterparty_id, country, region, created_by) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'CA', 'SK',
   '00000000-0000-4000-8000-0000000011aa');
insert into app.counterparty_commodities (organization_id, counterparty_id, commodity_code, direction, created_by) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'canola', 'buys',
   '00000000-0000-4000-8000-0000000011aa');
insert into app.counterparty_logos (organization_id, counterparty_id, data, updated_by)
  select '00000000-0000-4000-8000-0000000000aa', id,
    '\x89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082',
    '00000000-0000-4000-8000-0000000011aa'
  from app.counterparties
  where id in ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-00000000c2aa');
insert into app.contact_log_entries (organization_id, counterparty_id, created_by) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c3aa',
   '00000000-0000-4000-8000-0000000011aa');

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

create function pg_temp.delete_counterparty(id text) returns text
language sql as $fn$
  select format('delete from app.counterparties where id = %L', id)
$fn$;
create function pg_temp.delete_logo(id text) returns text
language sql as $fn$
  select format('delete from app.counterparty_logos where counterparty_id = %L', id)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.counterparties', 'delete')
    and has_table_privilege('app_api', 'app.counterparty_logos', 'delete'),
  'app_api may delete counterparties and logos, as its policies allow');
select ok(
  not has_table_privilege('anon', 'app.counterparties', 'delete')
    and not has_table_privilege('authenticated', 'app.counterparties', 'delete')
    and not has_table_privilege('service_role', 'app.counterparties', 'delete')
    and not has_table_privilege('authenticated', 'app.counterparty_logos', 'delete'),
  'the Supabase API roles may not');

-- Who may delete -----------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.delete_counterparty('00000000-0000-4000-8000-00000000c1aa')), 0,
  'operations cannot delete an archived counterparty');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  pg_temp.delete_counterparty('00000000-0000-4000-8000-00000000c1aa')), 0,
  'nor a viewer');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.delete_counterparty('00000000-0000-4000-8000-00000000c1aa')), 0,
  'nor another organization''s admin');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.delete_counterparty('00000000-0000-4000-8000-00000000c2aa')), 0,
  'an admin cannot delete one that is not archived');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.delete_logo('00000000-0000-4000-8000-00000000c2aa')), 0,
  'nor its logo');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.delete_logo('00000000-0000-4000-8000-00000000c1aa')), 0,
  'operations cannot delete an archived counterparty''s logo');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.delete_logo('00000000-0000-4000-8000-00000000c1aa')), 0,
  'nor another organization''s admin');

-- An admin deletes an archived counterparty, after what it has --------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    pg_temp.delete_counterparty('00000000-0000-4000-8000-00000000c1aa')),
  '23503', null, 'not while it still has contacts, locations, commodities or a logo');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$delete from app.counterparty_commodities where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'$$),
  'GS005', null, 'operations still cannot remove an archived counterparty''s commodities');
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$insert into app.counterparty_commodities (organization_id, counterparty_id, commodity_code, direction, created_by)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'oats', 'buys',
              '00000000-0000-4000-8000-0000000022aa')$$),
  'GS005', null, 'nor an admin add one');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', $$
  delete from app.counterparty_commodities where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'$$), 1,
  'an admin deletes them, as deleting it does');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', $$
  delete from app.counterparty_contacts where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'$$)
  + pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', $$
  delete from app.facilities where counterparty_id = '00000000-0000-4000-8000-00000000c1aa'$$), 2,
  'its contact and its location');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.delete_logo('00000000-0000-4000-8000-00000000c1aa')), 1,
  'its logo');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.delete_counterparty('00000000-0000-4000-8000-00000000c1aa')), 1,
  'and then the counterparty');
select is(
  (select count(*)::int from app.audit_events
   where entity = 'counterparties' and entity_id = '00000000-0000-4000-8000-00000000c1aa'
     and action = 'delete' and actor_id = '00000000-0000-4000-8000-0000000022aa'),
  1, 'the audit trail keeps who deleted it and when');

-- History is kept ------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    pg_temp.delete_counterparty('00000000-0000-4000-8000-00000000c3aa')),
  '23503', null, 'one with a contact history cannot be deleted');

select * from finish();
rollback;
