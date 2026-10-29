-- A counterparty's website: the column privilege, who may set it, cross-organization
-- denials, the addresses the database refuses and the audit trail. Runs in one transaction
-- that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(39);

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

insert into app.counterparties (id, organization_id, legal_name, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', 'US', 'manual',
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

-- Sets counterparty A's website.
create function pg_temp.set_a(website text) returns text
language sql as $fn$
  select format($$update app.counterparties set website = %L
                   where id = '00000000-0000-4000-8000-00000000c1aa'$$, website)
$fn$;

create function pg_temp.website_a() returns text
language sql as $fn$
  select website from app.counterparties where id = '00000000-0000-4000-8000-00000000c1aa'
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_column_privilege('app_api', 'app.counterparties', 'website', 'select')
    and has_column_privilege('app_api', 'app.counterparties', 'website', 'insert')
    and has_column_privilege('app_api', 'app.counterparties', 'website', 'update'),
  'app_api can read, enter and change a counterparty''s website'
);
select ok(
  not has_column_privilege('anon', 'app.counterparties', 'website', 'select')
    and not has_column_privilege('authenticated', 'app.counterparties', 'website', 'select')
    and not has_column_privilege('service_role', 'app.counterparties', 'website', 'update'),
  'the Supabase API roles cannot reach the website'
);

-- Who may set it ------------------------------------------------------------------
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa', pg_temp.set_a('https://www.example.com')), 0,
  'a viewer cannot set a website');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa', pg_temp.set_a('https://www.example.com')), 0,
  'a trader cannot set a website');
select is(pg_temp.api_changed(null, pg_temp.set_a('https://www.example.com')), 0,
  'nothing is set without a user');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb', pg_temp.set_a('https://www.example.com')), 0,
  'another organization''s admin cannot set this organization''s website');
select is(pg_temp.website_a(), null, 'the website is still empty after the refused attempts');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.set_a('https://www.example.com/grain')), 1,
  'an operations member sets a website');
select is(pg_temp.website_a(), 'https://www.example.com/grain', 'the website is saved');
select is(pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa', pg_temp.set_a(null)), 1,
  'an org_admin clears a website');
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$insert into app.counterparties (organization_id, legal_name, primary_country, source, website, created_by)
      values ('00000000-0000-4000-8000-0000000000bb', 'Synthetic B Seller', 'US', 'manual',
              'http://example.com', app.current_user_id())$$),
  1, 'an editor enters a counterparty with an http website'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011aa',
    $$select 1 from app.counterparties where website = 'http://example.com'$$),
  0, 'another organization''s member does not see the website'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    $$select 1 from app.counterparties where website = 'http://example.com'$$),
  1, 'the organization''s own admin sees it'
);

-- Addresses the database refuses ------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('javascript:alert(1)')),
  '23514', null, 'a javascript: address is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('data:text/html,hi')),
  '23514', null, 'a data: address is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('https://example.com/a b')),
  '23514', null, 'an address with a space is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('https://example.com/' || repeat('a', 481))),
  '23514', null, 'an address longer than 500 characters is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.set_a('https:///example.com')),
  '23514', null, 'an address without a site name is refused'
);

-- Audit trail ----------------------------------------------------------------------------
select is(
  (select count(*)::int from app.audit_events
    where entity = 'counterparties' and entity_id = '00000000-0000-4000-8000-00000000c1aa'
      and action = 'update' and changed_fields = array['website']
      and actor_id in ('00000000-0000-4000-8000-0000000011aa', '00000000-0000-4000-8000-0000000022aa')),
  2, 'setting and clearing a website are each audited with who did it'
);

-- The same rules for site names as the API (Codex's review) -----------------------------
-- True when setting counterparty A's website to this is refused by the check constraint.
create function pg_temp.refused(website text) returns boolean
language plpgsql as $fn$
begin
  perform pg_temp.api_changed('00000000-0000-4000-8000-0000000011aa', pg_temp.set_a(website));
  return false;
exception when check_violation then
  return true;
end
$fn$;

select ok(pg_temp.refused('https://user:secret@example.com'), 'a user name and password are refused');
select ok(pg_temp.refused('https://user@example.com/'), 'a user name alone is refused');
select ok(pg_temp.refused('https://example.com:8443'), 'a port is refused');
select ok(pg_temp.refused('https://example.com:443/'), 'even the default https port is refused');
select ok(pg_temp.refused('http://example.com:80'), 'even the default http port is refused');
select ok(pg_temp.refused('https://127.0.0.1'), 'a number address is refused');
select ok(pg_temp.refused('http://169.254.169.254/latest'), 'a link-local number address is refused');
select ok(pg_temp.refused('https://[::1]/'), 'an IPv6 address is refused');
select ok(pg_temp.refused('https://localhost'), 'localhost is refused');
select ok(pg_temp.refused('https://printer.local'), 'a .local name is refused');
select ok(pg_temp.refused('https://grain.internal/x'), 'an .internal name is refused');
select ok(pg_temp.refused('https://intranet'), 'a single-label name is refused');
select ok(pg_temp.refused('https://Example.com'), 'a site name not in lower case is refused (the API lowers it)');
select ok(pg_temp.refused('https://example.com./'), 'a site name ending in a dot is refused');
select ok(pg_temp.refused('https://-bad-.example.com'), 'a label starting with a hyphen is refused');
select ok(pg_temp.refused('https://example.c0m'), 'a top-level name with a digit is refused');
select ok(pg_temp.refused('https://example.com\@evil.example.org'), 'a backslash in the site name is refused');
select ok(not pg_temp.refused('https://www.example.co.uk/grain?region=SK#bids'), 'a path, query and fragment are kept');
select ok(not pg_temp.refused('https://xn--bcher-kva.example.ca'), 'an international site name in its xn-- form is kept');
select is(pg_temp.website_a(), 'https://xn--bcher-kva.example.ca', 'the last accepted website is saved');

select * from finish();
rollback;
