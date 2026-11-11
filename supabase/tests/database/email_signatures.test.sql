-- Each person's title and phone for the team signature (20261111020000_email_signatures.sql,
-- F-114 step 3): admins only, read by the whole team, never across organizations; both blank
-- removes them; the phone and title rules; privileges. Runs in one transaction that is rolled
-- back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- Org A: tom (trader), adam (org_admin), victor (viewer), sue (suspended admin). Org B: bob (admin).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test', '{"first_name": "Adam"}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{"first_name": "Victor"}'),
  ('00000000-0000-4000-8000-0000000055aa', 'sue@example.test', '{"first_name": "Sue"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'org_admin', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

grant app_api to current_user;

create function pg_temp.api(uid text, query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);
  set local role app_api;
  execute query into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

create function pg_temp.save(uid text, member text, title text, phone text,
                             org text default '00000000-0000-4000-8000-0000000000aa')
returns text
language sql as $fn$
  select pg_temp.api(uid, format('select app.save_member_signature(%L, %L, %L, %L)', org, member, title, phone))
$fn$;

-- Privileges -------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'app.member_signature_details', 'select'),
  'authenticated cannot read signature details');
select ok(not has_table_privilege('anon', 'app.member_signature_details', 'select'),
  'anon cannot read signature details');
select ok(has_table_privilege('app_api', 'app.member_signature_details', 'select'), 'app_api reads them');
select ok(not has_table_privilege('app_api', 'app.member_signature_details', 'insert')
          and not has_table_privilege('app_api', 'app.member_signature_details', 'update')
          and not has_table_privilege('app_api', 'app.member_signature_details', 'delete'),
  'app_api writes only through the function');
select ok(not has_function_privilege('authenticated', 'app.save_member_signature(uuid, uuid, text, text)', 'execute'),
  'authenticated cannot call the function');
select ok(has_function_privilege('app_api', 'app.save_member_signature(uuid, uuid, text, text)', 'execute'),
  'app_api calls the function');

-- Admins only --------------------------------------------------------------------
select is(pg_temp.save('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-0000000044aa', 'Trader', null),
  'forbidden', 'a trader cannot set even their own');
select is(pg_temp.save('00000000-0000-4000-8000-0000000033aa', '00000000-0000-4000-8000-0000000044aa', 'Trader', null),
  'forbidden', 'a viewer cannot');
select is(pg_temp.save('00000000-0000-4000-8000-0000000055aa', '00000000-0000-4000-8000-0000000044aa', 'Trader', null),
  'forbidden', 'a suspended admin cannot');
select is(pg_temp.save('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-0000000044aa', 'Trader', null),
  'forbidden', 'another organization''s admin cannot set A''s member');
select is(pg_temp.save('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-0000000044aa', 'Trader', null,
                       '00000000-0000-4000-8000-0000000000bb'),
  'not_a_member', 'nor through their own organization');
select is(pg_temp.save(null, '00000000-0000-4000-8000-0000000044aa', 'Trader', null), 'forbidden',
  'nobody signed in cannot');

select is(pg_temp.save('00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000044aa',
                       '  Grain trader ', ' +1 (403) 555-0100 '),
  'saved', 'an admin sets a person''s title and phone');
select results_eq(
  $$select title, phone from app.member_signature_details where user_id = '00000000-0000-4000-8000-0000000044aa'$$,
  $$values ('Grain trader'::text, '+1 (403) 555-0100'::text)$$,
  'kept trimmed');

select is(pg_temp.save('00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000044aa', null, '403 555 0199'),
  'saved', 'saved again with the title cleared');
select results_eq(
  $$select title, phone from app.member_signature_details where user_id = '00000000-0000-4000-8000-0000000044aa'$$,
  $$values (null::text, '403 555 0199'::text)$$,
  'one row, changed');

-- Reading ------------------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa',
    'select count(*)::text from app.member_signature_details'), '1', 'a viewer of A reads the team''s details');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
    'select count(*)::text from app.member_signature_details'), '0', 'B''s admin reads none of A''s');

-- Rules ----------------------------------------------------------------------------
select throws_ok(
  $$select pg_temp.save('00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000044aa', null, 'call me')$$,
  '23514', null, 'a phone with letters is refused');
select throws_ok(
  format('select pg_temp.save(%L, %L, %L, null)', '00000000-0000-4000-8000-0000000022aa',
         '00000000-0000-4000-8000-0000000044aa', E'Two\nlines'),
  '23514', null, 'a title over two lines is refused');

select is(pg_temp.save('00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-0000000044aa', ' ', ''),
  'saved', 'both blank');
select is((select count(*)::int from app.member_signature_details), 0, 'removes the row');

select * from finish();
rollback;
