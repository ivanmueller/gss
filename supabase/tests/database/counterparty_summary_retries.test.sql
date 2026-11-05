-- Codex's review of the company summaries (f6d3296), finding 1: something new after 5 failed
-- attempts starts the count again from 1, when the summary was asked for before anything had
-- happened, and while a person's request is pending. Runs in one transaction that is rolled
-- back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}');
insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A');
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now());
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Asked Early', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic Asked Later', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa');

grant app_api to current_user;

create function pg_temp.log(company uuid, minutes integer) returns void
language plpgsql as $fn$
declare
  entry uuid := gen_random_uuid();
begin
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
  insert into app.contact_log_entries (id, organization_id, counterparty_id, created_by, created_at)
  values (entry, '00000000-0000-4000-8000-0000000000aa', company, '00000000-0000-4000-8000-0000000044aa',
          now() - make_interval(mins => minutes));
  insert into app.contact_log_revisions (organization_id, entry_id, occurred_at, channel, contact_name,
                                         recorded_by, recorded_by_name, created_at)
  values ('00000000-0000-4000-8000-0000000000aa', entry, now() - make_interval(mins => minutes), 'call',
          'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'Tom', now() - make_interval(mins => minutes));
  perform set_config('app.user_id', '', true);
end
$fn$;

create function pg_temp.ask(company uuid) returns text
language plpgsql as $fn$
declare
  result text;
begin
  perform set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
  set local role app_api;
  result := app.request_counterparty_summary(company);
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

-- Whether the job claims the company now (as app_api); a claim made is let lapse at once.
create function pg_temp.claims(company uuid) returns boolean
language plpgsql as $fn$
declare
  found_it boolean;
begin
  set local role app_api;
  select exists (select 1 from app.claim_counterparty_summaries(10) c where c.counterparty_id = company)
    into found_it;
  reset role;
  update app.counterparty_summaries set claimed_at = now() - interval '11 minutes'
   where claimed_at is not null;
  return found_it;
end
$fn$;

create function pg_temp.attempts(company uuid) returns integer
language sql as $fn$
  select attempts from app.counterparty_summaries where counterparty_id = company
$fn$;

-- Asked for before anything happened; 5 attempts fail.
select pg_temp.ask('00000000-0000-4000-8000-00000000c1aa');
select pg_temp.claims('00000000-0000-4000-8000-00000000c1aa') from generate_series(1, 5);
select is(pg_temp.claims('00000000-0000-4000-8000-00000000c1aa'), false, 'after 5 attempts the job stops');
select pg_temp.log('00000000-0000-4000-8000-00000000c1aa', 10);
select is(pg_temp.claims('00000000-0000-4000-8000-00000000c1aa'), true,
  'a note after a request made before anything happened is tried again');
select is(pg_temp.attempts('00000000-0000-4000-8000-00000000c1aa'), 1, 'counting from 1');

-- Something had happened; asked for; 5 attempts fail; then something new.
select pg_temp.log('00000000-0000-4000-8000-00000000c2aa', 30);
select pg_temp.ask('00000000-0000-4000-8000-00000000c2aa');
select pg_temp.claims('00000000-0000-4000-8000-00000000c2aa') from generate_series(1, 5);
select pg_temp.log('00000000-0000-4000-8000-00000000c2aa', 10);
select is(pg_temp.claims('00000000-0000-4000-8000-00000000c2aa'), true, 'a note while a request is pending is tried');
select is(pg_temp.attempts('00000000-0000-4000-8000-00000000c2aa'), 1,
  'the pending request does not keep the count at 5');
select is(pg_temp.claims('00000000-0000-4000-8000-00000000c2aa'), true, 'so it is tried again after that');

select * from finish();
rollback;
