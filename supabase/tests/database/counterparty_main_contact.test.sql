-- A counterparty's main contact: the column and its privilege, at most one per counterparty,
-- who may choose it, cross-organization denials and the audit trail. Runs in one transaction
-- that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(24);

-- Fixtures ------------------------------------------------------------------
-- Org A: olivia (operations), adam (org_admin), victor (viewer), tom (trader).
-- Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- Two counterparties in org A (c1aa, c2aa) and one in org B (c1bb).
insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

-- Contacts: k1aa and k2aa of c1aa, k3aa of c2aa, k1bb of c1bb.
insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, created_by) values
  ('00000000-0000-4000-8000-00000000a1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Synthetic Ana', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000a2aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Synthetic Ben', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000a3aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c2aa', 'Synthetic Cy', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000a1bb', '00000000-0000-4000-8000-0000000000bb',
   '00000000-0000-4000-8000-00000000c1bb', 'Synthetic Bo', '00000000-0000-4000-8000-0000000011bb');

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

-- Marks one contact as main (or not), by id.
create function pg_temp.mark(contact text, main boolean) returns text
language sql as $fn$
  select format('update app.counterparty_contacts set is_main = %L where id = %L', main, contact)
$fn$;

create function pg_temp.mains(counterparty text) returns text[]
language sql as $fn$
  select coalesce(array_agg(name::text order by name), '{}')
  from app.counterparty_contacts where counterparty_id = counterparty::uuid and is_main
$fn$;

-- The column and its privilege ---------------------------------------------
select col_not_null('app', 'counterparty_contacts', 'is_main', 'is_main is never null');
select col_default_is('app', 'counterparty_contacts', 'is_main', 'false',
  'a contact is not the main contact unless chosen');
select is(pg_temp.mains('00000000-0000-4000-8000-00000000c1aa'), '{}'::text[],
  'existing contacts start as not main');
select ok(has_column_privilege('app_api', 'app.counterparty_contacts', 'is_main', 'UPDATE'),
  'app_api may update is_main');
select ok(not has_column_privilege('authenticated', 'app.counterparty_contacts', 'is_main', 'UPDATE')
  and not has_column_privilege('anon', 'app.counterparty_contacts', 'is_main', 'UPDATE')
  and not has_column_privilege('service_role', 'app.counterparty_contacts', 'is_main', 'UPDATE'),
  'the Supabase API roles may not update is_main');
select ok(not has_column_privilege('authenticated', 'app.counterparty_contacts', 'is_main', 'SELECT')
  and not has_column_privilege('anon', 'app.counterparty_contacts', 'is_main', 'SELECT'),
  'the Supabase API roles may not read is_main');

-- Who may choose it ----------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
  pg_temp.mark('00000000-0000-4000-8000-00000000a1aa', true)), 0,
  'a viewer cannot choose the main contact');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
  pg_temp.mark('00000000-0000-4000-8000-00000000a1aa', true)), 0,
  'a trader cannot choose the main contact');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.mark('00000000-0000-4000-8000-00000000a1aa', true)), 0,
  'another organization''s admin cannot choose it');
select is(pg_temp.api_changed(null,
  pg_temp.mark('00000000-0000-4000-8000-00000000a1aa', true)), 0,
  'no one signed in cannot choose it');
select is(pg_temp.mains('00000000-0000-4000-8000-00000000c1aa'), '{}'::text[],
  'refused choices changed nothing');

select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  pg_temp.mark('00000000-0000-4000-8000-00000000a1aa', true)), 1,
  'operations chooses the main contact');
select is(pg_temp.mains('00000000-0000-4000-8000-00000000c1aa'), array['Synthetic Ana'],
  'the chosen contact is the main contact');

-- At most one per counterparty ----------------------------------------------
select throws_ok(
  format($$select pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', %L)$$,
    pg_temp.mark('00000000-0000-4000-8000-00000000a2aa', true)),
  '23505', null, 'a second main contact for the same counterparty is refused');
select throws_ok(
  $$insert into app.counterparty_contacts (organization_id, counterparty_id, name, is_main, created_by)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
            'Synthetic Second Main', true, '00000000-0000-4000-8000-0000000011aa')$$,
  '23505', null, 'a new contact cannot be added as a second main contact');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.mark('00000000-0000-4000-8000-00000000a3aa', true)), 1,
  'another counterparty has a main contact of its own');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
  pg_temp.mark('00000000-0000-4000-8000-00000000a1bb', true)), 1,
  'another organization chooses its own main contact');

-- Changing it: the old one first, then the new one.
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.mark('00000000-0000-4000-8000-00000000a1aa', false)), 1,
  'an admin unmarks the main contact');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
  pg_temp.mark('00000000-0000-4000-8000-00000000a2aa', true)), 1,
  'and marks another');
select is(pg_temp.mains('00000000-0000-4000-8000-00000000c1aa'), array['Synthetic Ben'],
  'the main contact changed');
select is(pg_temp.mains('00000000-0000-4000-8000-00000000c1bb'), array['Synthetic Bo'],
  'the other organization''s main contact is its own');

-- Removing the main contact leaves none.
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
  $$delete from app.counterparty_contacts where id = '00000000-0000-4000-8000-00000000a2aa'$$), 1,
  'operations removes the main contact');
select is(pg_temp.mains('00000000-0000-4000-8000-00000000c1aa'), '{}'::text[],
  'the counterparty has no main contact left');

-- Audit -----------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity_id = '00000000-0000-4000-8000-00000000a1aa' and action = 'update'
      and changed_fields = array['is_main']
      and actor_id in ('00000000-0000-4000-8000-0000000011aa', '00000000-0000-4000-8000-0000000022aa')),
  2, 'choosing and unchoosing the main contact is audited, by whom and which column');

select * from finish();
rollback;
