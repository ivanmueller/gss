-- Undoing an import (the owner's request of 2026-11-04): who may read what an import changed
-- (app.import_changes, app.import_retyped) and who may mark it undone, with cross-
-- organization denials. Runs in one transaction that is rolled back. Fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Org A: adam (org_admin), olivia (operations). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000011aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');
insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- An import by olivia now, and an older one an hour ago.
insert into app.import_batches (id, organization_id, kind, file_name, content_sha256, row_count,
                                created_count, skipped_count, created_by, created_at) values
  ('00000000-0000-4000-8000-00000000ba01', '00000000-0000-4000-8000-0000000000aa', 'counterparties',
   'synthetic-sellers.csv', repeat('1', 64), 1, 0, 0, '00000000-0000-4000-8000-0000000022aa', now()),
  ('00000000-0000-4000-8000-00000000ba02', '00000000-0000-4000-8000-0000000000aa', 'counterparties',
   'synthetic-older.csv', repeat('2', 64), 1, 1, 0, '00000000-0000-4000-8000-0000000022aa',
   now() - interval '1 hour');
insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by,
                                import_batch_id) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Listed Buyer',
   'CA', 'manual', '00000000-0000-4000-8000-0000000022aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Older Seller',
   'CA', 'file_import', '00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-00000000ba02');

grant app_api to current_user;

create function pg_temp.as_api(uid text, statement text) returns int
language plpgsql as $fn$
declare
  changed int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
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

-- Olivia's import changed the listed buyer's tier (in this transaction, so at the batch's time),
-- and later the older import's seller was made a buyer too.
select pg_temp.as_api('00000000-0000-4000-8000-0000000022aa',
  $$update app.counterparties set tier = 'A', types = '{buyer,seller}'
     where id in ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-00000000c2aa')$$);

-- Privileges -------------------------------------------------------------------------------
select ok(has_function_privilege('app_api', 'app.import_changes(uuid)', 'EXECUTE')
  and has_function_privilege('app_api', 'app.import_retyped(uuid)', 'EXECUTE'),
  'app_api may ask what an import changed');
select ok(not has_function_privilege('authenticated', 'app.import_changes(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'app.import_retyped(uuid)', 'EXECUTE'),
  'nobody else may');
select ok(has_column_privilege('app_api', 'app.import_batches', 'undone_at', 'UPDATE')
  and not has_column_privilege('app_api', 'app.import_batches', 'file_name', 'UPDATE'),
  'app_api marks an import undone, and changes nothing else of it');

-- What an import changed ----------------------------------------------------------------------
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000011aa',
  $$select * from app.import_changes('00000000-0000-4000-8000-00000000ba01')
     where entity = 'counterparties' and 'tier' = any (changed_fields)$$), 2,
  'an admin reads the companies the import changed, with their fields');
select throws_ok(
  $$select pg_temp.api_count('00000000-0000-4000-8000-0000000022aa',
    'select * from app.import_changes(''00000000-0000-4000-8000-00000000ba01'')')$$,
  '42501', null, 'operations may not');
select throws_ok(
  $$select pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    'select * from app.import_changes(''00000000-0000-4000-8000-00000000ba01'')')$$,
  '42501', null, 'nor another organization''s admin');
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000011aa',
  $$select * from app.import_changes('00000000-0000-4000-8000-00000000ba02')$$), 0,
  'the older import changed nothing at its own time');

-- Companies retyped since -------------------------------------------------------------------------
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000011aa',
  $$select * from app.import_retyped('00000000-0000-4000-8000-00000000ba02') id
     where id = '00000000-0000-4000-8000-00000000c2aa'$$), 1,
  'a company the older import created and was made a buyer since is found');
select is(pg_temp.api_count('00000000-0000-4000-8000-0000000011aa',
  $$select * from app.import_retyped('00000000-0000-4000-8000-00000000ba01')$$), 0,
  'the listed buyer is not one the newer import created');
select throws_ok(
  $$select pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    'select * from app.import_retyped(''00000000-0000-4000-8000-00000000ba02'')')$$,
  '42501', null, 'another organization''s admin may not ask');

-- Marked undone -------------------------------------------------------------------------------------
select is(pg_temp.as_api('00000000-0000-4000-8000-0000000022aa',
  $$update app.import_batches set undone_at = now(), undone_by = '00000000-0000-4000-8000-0000000022aa'
     where id = '00000000-0000-4000-8000-00000000ba01'$$), 0, 'operations cannot mark an import undone');
select is(pg_temp.as_api('00000000-0000-4000-8000-0000000011bb',
  $$update app.import_batches set undone_at = now(), undone_by = '00000000-0000-4000-8000-0000000011bb'
     where id = '00000000-0000-4000-8000-00000000ba01'$$), 0, 'nor another organization''s admin');
select throws_ok(
  $$select pg_temp.as_api('00000000-0000-4000-8000-0000000011aa',
    'update app.import_batches set undone_at = now(), undone_by = ''00000000-0000-4000-8000-0000000022aa''
      where id = ''00000000-0000-4000-8000-00000000ba01''')$$,
  '42501', null, 'an admin marks it undone in their own name only');
select throws_ok(
  $$select pg_temp.as_api('00000000-0000-4000-8000-0000000011aa',
    'update app.import_batches set undone_at = now()
      where id = ''00000000-0000-4000-8000-00000000ba01''')$$,
  '42501', null, 'nor without saying who (the policy, before the check of both together)');
select is(pg_temp.as_api('00000000-0000-4000-8000-0000000011aa',
  $$update app.import_batches set undone_at = now(), undone_by = '00000000-0000-4000-8000-0000000011aa'
     where id = '00000000-0000-4000-8000-00000000ba01'$$), 1, 'an admin marks it undone');
select is(pg_temp.as_api('00000000-0000-4000-8000-0000000011aa',
  $$update app.import_batches set undone_at = now(), undone_by = '00000000-0000-4000-8000-0000000011aa'
     where id = '00000000-0000-4000-8000-00000000ba01'$$), 0, 'once only');

select * from finish();
rollback;
