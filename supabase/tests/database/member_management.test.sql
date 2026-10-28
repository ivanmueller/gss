-- Member management: who may add people, change roles and names, and suspend them; that an
-- organization always keeps an active admin; cross-organization denials; the audit trail.
-- Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(40);

-- Fixtures ------------------------------------------------------------------
-- Org A: adam (org_admin), olivia (operations), victor (viewer). Org B: bob (org_admin),
-- bea (viewer). newbie has a login but no membership.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test', '{"first_name": "Adam"}'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test', '{}'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test', '{}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{}'),
  ('00000000-0000-4000-8000-0000000022bb', 'bea@example.test', '{}'),
  ('00000000-0000-4000-8000-00000000ae00', 'Newbie@Example.test', '{"other": "kept"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (id, organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-00000000a0a1', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-00000000a0a2', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-00000000a0a3', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-00000000b0b1', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-00000000b0b2', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000022bb', 'viewer', 'active', now());

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

-- Runs a statement as app_api for the given user and returns how many rows it changed.
create function pg_temp.api_changed(uid text, statement text) returns int
language plpgsql as $fn$
declare
  changed int;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e1e1e', true);
  set local role app_api;
  execute statement;
  get diagnostics changed = row_count;
  reset role;
  perform set_config('app.user_id', '', true);
  return changed;
end
$fn$;

-- Runs a query as app_api for the given user and returns its first column as text.
create function pg_temp.api_value(uid text, query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  perform set_config('app.request_id', '00000000-0000-4000-8000-0000000e1e1e', true);
  set local role app_api;
  execute query into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

-- Adding newbie to org A as an operations member, as the API does.
create function pg_temp.add_newbie(status text) returns text
language sql as $fn$
  select format(
    $$insert into app.organization_members (organization_id, user_id, role, status, joined_at, created_by)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000ae00',
              'operations', %L, now(), app.current_user_id())$$,
    status)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_column_privilege('app_api', 'app.organization_members', 'role', 'update')
    and has_column_privilege('app_api', 'app.organization_members', 'status', 'update')
    and not has_column_privilege('app_api', 'app.organization_members', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.organization_members', 'user_id', 'update')
    and not has_column_privilege('app_api', 'app.organization_members', 'joined_at', 'update')
    and not has_column_privilege('app_api', 'app.organization_members', 'created_by', 'update'),
  'app_api can change a membership''s role and status, nothing else'
);
select ok(
  not has_table_privilege('app_api', 'app.organization_members', 'delete, truncate'),
  'memberships cannot be deleted through app_api, only suspended'
);
select ok(
  not has_function_privilege('app_api', 'app.keep_an_active_admin()', 'execute')
    and not has_function_privilege('public', 'app.find_login(uuid, text)', 'execute')
    and not has_function_privilege('public', 'app.member_directory(uuid)', 'execute')
    and not has_function_privilege('public', 'app.set_member_name(uuid, uuid, text, text)', 'execute'),
  'the guard is not callable, and the login functions are for app_api only'
);
select ok(not has_schema_privilege('app_api', 'auth', 'usage'), 'app_api still cannot use the auth schema');

-- The team list ----------------------------------------------------------------------
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000022aa',
    $$select string_agg(email || ':' || role || ':' || coalesce(first_name, '-'), ',' order by email)
        from app.member_directory('00000000-0000-4000-8000-0000000000aa')$$),
  'adam@example.test:org_admin:Adam,olivia@example.test:operations:-,victor@example.test:viewer:-',
  'an admin sees the organization''s members with their emails, roles and names'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011aa',
    $$select count(*)::text from app.member_directory('00000000-0000-4000-8000-0000000000aa')$$),
  '0', 'an operations member sees no team list'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011bb',
    $$select count(*)::text from app.member_directory('00000000-0000-4000-8000-0000000000aa')$$),
  '0', 'another organization''s admin sees no team list of this organization'
);

-- Finding a login ------------------------------------------------------------------------
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000022aa',
    $$select app.find_login('00000000-0000-4000-8000-0000000000aa', '  newbie@EXAMPLE.test ')::text$$),
  '00000000-0000-4000-8000-00000000ae00', 'an admin finds a login by email, ignoring case and spaces'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011aa',
    $$select app.find_login('00000000-0000-4000-8000-0000000000aa', 'newbie@example.test')::text$$),
  null, 'an operations member cannot look logins up'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011bb',
    $$select app.find_login('00000000-0000-4000-8000-0000000000aa', 'newbie@example.test')::text$$),
  null, 'another organization''s admin cannot look logins up for this organization'
);

-- Adding a member ------------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa', pg_temp.add_newbie('active')),
  '42501', null, 'an operations member cannot add a member'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb', pg_temp.add_newbie('active')),
  '42501', null, 'another organization''s admin cannot add a member to this organization'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa', pg_temp.add_newbie('invited')),
  '42501', null, 'a member is added active, not as invited'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', pg_temp.add_newbie('active')),
  1, 'an admin adds a person with a login as an active member'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa', pg_temp.add_newbie('active')),
  '23505', null, 'the same person cannot be added twice'
);

-- Changing roles and status ---------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.organization_members set role = 'org_admin' where id = '00000000-0000-4000-8000-00000000a0a3'$$),
  0, 'a viewer cannot make themselves an admin'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.organization_members set role = 'viewer' where id = '00000000-0000-4000-8000-00000000a0a3'$$),
  0, 'an operations member cannot change roles'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$update app.organization_members set status = 'suspended' where id = '00000000-0000-4000-8000-00000000a0a2'$$),
  0, 'another organization''s admin cannot suspend this organization''s members'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$update app.organization_members set role = 'trader' where id = '00000000-0000-4000-8000-00000000a0a2'$$),
  1, 'an admin changes a member''s role'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$update app.organization_members set status = 'suspended' where id = '00000000-0000-4000-8000-00000000a0a3'$$),
  1, 'an admin suspends a member'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000033aa', 'select count(*)::text from app.organizations'),
  '0', 'a suspended member reads nothing of the organization any more'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.organization_members set status = 'invited' where id = '00000000-0000-4000-8000-00000000a0a3'$$),
  '42501', null, 'a member cannot be put back to invited'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.organization_members set organization_id = '00000000-0000-4000-8000-0000000000bb' where id = '00000000-0000-4000-8000-00000000a0a2'$$),
  '42501', null, 'a membership cannot be moved to another organization'
);

-- An active admin always remains ------------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.organization_members set role = 'operations' where id = '00000000-0000-4000-8000-00000000a0a1'$$),
  'GS001', null, 'the last active admin cannot stop being an admin'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000022aa',
    $$update app.organization_members set status = 'suspended' where id = '00000000-0000-4000-8000-00000000a0a1'$$),
  'GS001', null, 'the last active admin cannot be suspended'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$update app.organization_members set role = 'org_admin' where id = '00000000-0000-4000-8000-00000000a0a2'$$),
  1, 'an admin makes another member an admin'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.organization_members set role = 'operations' where id = '00000000-0000-4000-8000-00000000a0a1'$$),
  1, 'with two admins, one can change the other''s role'
);

-- Names ----------------------------------------------------------------------------------
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011aa',
    $$select app.set_member_name('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a0a3', 'Victor', 'Synthetic')::text$$),
  'true', 'an admin sets a member''s first and last name'
);
select is(
  (select raw_user_meta_data::text from auth.users where id = '00000000-0000-4000-8000-0000000033aa'),
  '{"last_name": "Synthetic", "first_name": "Victor"}', 'the names are saved on the login'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000022aa',
    $$select app.set_member_name('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a0a3', 'Hijacked', null)::text$$),
  'false', 'a member who is no longer an admin cannot set names'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011bb',
    $$select app.set_member_name('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a0a3', 'Hijacked', null)::text$$),
  'false', 'another organization''s admin cannot set this organization''s names'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011aa',
    $$select app.set_member_name('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000b0b2', 'Hijacked', null)::text$$),
  'false', 'an admin cannot set the name of another organization''s member'
);
select is(
  (select raw_user_meta_data::text from auth.users where id = '00000000-0000-4000-8000-0000000022bb'),
  '{}', 'the other organization''s member is untouched'
);
select throws_ok(
  format('select pg_temp.api_value(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$select app.set_member_name('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000a0a3', ' Padded', null)$$),
  '23514', null, 'a name with spaces around it is refused'
);
select is(
  pg_temp.api_value('00000000-0000-4000-8000-0000000011aa',
    $$select app.set_member_name('00000000-0000-4000-8000-0000000000aa',
        (select id from app.organization_members where user_id = '00000000-0000-4000-8000-00000000ae00'),
        'New', null)::text$$),
  'true', 'an admin names the member just added'
);
select is(
  (select raw_user_meta_data::text from auth.users where id = '00000000-0000-4000-8000-00000000ae00'),
  '{"other": "kept", "first_name": "New"}', 'setting names keeps the login''s other details'
);

-- (That setting names moves the membership's version is checked in members.db.test.ts:
-- within this one transaction every timestamp is the same.)
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa',
    $$update app.organization_members set role = role where id = '00000000-0000-4000-8000-00000000a0a3'$$),
  1, 'an update that changes nothing runs'
);
select is(
  (select count(*)::int from app.audit_events where changed_fields = '{}' or (action = 'update' and changed_fields is null)),
  0, 'and, like every update that changes nothing, it is not audited'
);

-- Audit trail ----------------------------------------------------------------------------
select is(
  (select string_agg(action || ':' || coalesce(array_to_string(changed_fields, '+'), '-'), ',' order by id)
     from app.audit_events
    where entity = 'organization_members' and actor_id is not null),
  'insert:-,update:role,update:status,update:role,update:role',
  'adding members and changing roles and status are audited'
);
select is(
  (select count(*)::int from app.audit_events
    where entity = 'member_names' and actor_id = '00000000-0000-4000-8000-0000000011aa'
      and request_id = '00000000-0000-4000-8000-0000000e1e1e'),
  2, 'setting names is audited with who did it and the request'
);

select * from finish();
rollback;
