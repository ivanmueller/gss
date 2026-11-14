-- Claude's freight rate drafts (F-235 part 2, 20261120010000_freight_drafts.sql): the kind
-- 'freight' is admitted; a freight draft is decided only by someone who may enter freight
-- rates, of the draft's organization, and accepted only with a freight quote of the draft's
-- company that this person entered and that accepts no other draft. Runs in one transaction
-- that is rolled back. All fixtures synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(16);

-- Org A: tom and tina (traders), olga (operations), victor (viewer), alan (analyst).
-- Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000045aa', 'tina@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'olga@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000066aa', 'alan@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');
insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');
insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000045aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000066aa', 'analyst', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Other', '{carrier}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa'),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb');

-- A call of Tom's to Synthetic A Buyer and its recording, which the drafts come from.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.calls (id, organization_id, counterparty_id, contact_name, placed_by, placed_by_name,
                       from_phone, counterparty_phone)
values ('00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', '00000000-0000-4000-8000-0000000044aa', 'x',
        '+18255550199', '+14035550100');
select set_config('app.user_id', '', true);
insert into app.call_recordings (id, organization_id, call_id, telnyx_recording_id, transcript,
                                 transcript_lines, transcribed_at) values
  ('00000000-0000-4000-8000-0000000ec01a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000ca11a',
   'rec-freight', 'Counterparty: Synthetic Town A MB to Synthetic Town B IN 335/CMT.',
   '[{"side":"counterparty","start":0,"text":"Synthetic Town A MB to Synthetic Town B IN 335/CMT."}]', now());

-- Freight drafts 0 to 3 of that call, as app.keep_call_reading writes them.
insert into app.call_drafts (organization_id, counterparty_id, call_id, recording_id, position, kind, fields, lines)
select '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
       '00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000ec01a', n, 'freight',
       '{"mode": null, "origin": {"text": "Synthetic Town A MB", "region": "CA-MB"}, "destination": {"text": "Synthetic Town B IN", "region": "US-IN"}, "values": {"rate": "335"}, "checks": {}}',
       '[0]'
  from generate_series(0, 3) n;

-- Freight quotes: Tom's of Synthetic A Buyer (f1) and of Synthetic A Other (f2), Tina's of
-- Synthetic A Buyer (f3), Bob's of Synthetic B Buyer in org B (f4), each between two areas.
create function pg_temp.rate(id text, org text, company text, uid text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.user_id', uid, true);
  insert into app.freight_quotes (id, organization_id, carrier_id, mode, created_by,
                                  origin_area_text, origin_area_region,
                                  destination_area_text, destination_area_region)
  values (id::uuid, org::uuid, company::uuid, 'truck', uid::uuid,
          'Synthetic Town A MB', 'CA-MB', 'Synthetic Town B IN', 'US-IN');
  perform set_config('app.user_id', '', true);
end
$fn$;
select pg_temp.rate('00000000-0000-4000-8000-0000000ef001', '00000000-0000-4000-8000-0000000000aa',
                    '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000044aa');
select pg_temp.rate('00000000-0000-4000-8000-0000000ef002', '00000000-0000-4000-8000-0000000000aa',
                    '00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000044aa');
select pg_temp.rate('00000000-0000-4000-8000-0000000ef003', '00000000-0000-4000-8000-0000000000aa',
                    '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000045aa');
select pg_temp.rate('00000000-0000-4000-8000-0000000ef004', '00000000-0000-4000-8000-0000000000bb',
                    '00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000011bb');
-- And a bid of Tom's on Synthetic A Buyer, which is not a freight quote.
select set_config('app.user_id', '00000000-0000-4000-8000-0000000044aa', true);
insert into app.quotes (id, organization_id, counterparty_id, side, commodity_code, created_by)
values ('00000000-0000-4000-8000-0000000e0e01', '00000000-0000-4000-8000-0000000000aa',
        '00000000-0000-4000-8000-00000000c1aa', 'bid', 'canola', '00000000-0000-4000-8000-0000000044aa');
select set_config('app.user_id', '', true);

grant app_api to current_user;

create function pg_temp.api_text(uid text, query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute query into result;
  reset role;
  perform set_config('app.user_id', '', true);
  return result;
end
$fn$;

create temp table drafts on commit drop as
  select position, id from app.call_drafts where recording_id = '00000000-0000-4000-8000-0000000ec01a';
grant select on drafts to app_api;

-- Deciding as `uid`: draft at `position`, decision, result (an id, or null).
create function pg_temp.decide(uid text, pos int, decision text, result text) returns text
language sql as $fn$
  select pg_temp.api_text(uid, format(
    $$select app.decide_call_draft((select id from drafts where position = %s), %L, %L::uuid)$$,
    pos, decision, result))
$fn$;

-- The kind --------------------------------------------------------------------------------
select is((select count(*)::int from drafts), 4, 'freight drafts are kept');
select throws_ok(
  $$insert into app.call_drafts (organization_id, counterparty_id, call_id, recording_id, position, kind, fields, lines)
    values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
            '00000000-0000-4000-8000-0000000ca11a', '00000000-0000-4000-8000-0000000ec01a', 9, 'freight_rate', '{}', '[0]')$$,
  '23514', null, 'no other kind is'
);

-- Who decides -----------------------------------------------------------------------------
select is(pg_temp.decide('00000000-0000-4000-8000-0000000033aa', 0, 'dismissed', null), 'forbidden',
  'a viewer cannot decide a freight draft');
select is(pg_temp.decide('00000000-0000-4000-8000-0000000066aa', 0, 'dismissed', null), 'forbidden',
  'nor an analyst');
select is(pg_temp.decide('00000000-0000-4000-8000-0000000011bb', 0, 'dismissed', null), 'not_found',
  'another organization cannot find one');

-- What it is accepted with ----------------------------------------------------------------
select is(pg_temp.decide('00000000-0000-4000-8000-0000000044aa', 0, 'accepted', '00000000-0000-4000-8000-0000000ef002'),
  'result_not_found', 'not with a rate of another company');
select is(pg_temp.decide('00000000-0000-4000-8000-0000000044aa', 0, 'accepted', '00000000-0000-4000-8000-0000000ef003'),
  'result_not_found', 'not with a rate someone else entered');
select is(pg_temp.decide('00000000-0000-4000-8000-0000000044aa', 0, 'accepted', '00000000-0000-4000-8000-0000000ef004'),
  'result_not_found', 'not with a rate of another organization');
select is(pg_temp.decide('00000000-0000-4000-8000-0000000044aa', 0, 'accepted', '00000000-0000-4000-8000-0000000e0e01'),
  'result_not_found', 'not with a bid');
select is(pg_temp.decide('00000000-0000-4000-8000-0000000044aa', 0, 'accepted', '00000000-0000-4000-8000-0000000ef001'),
  'decided', 'a trader accepts it with the rate they entered for that company');
select is(
  (select status || ' ' || result_id::text || ' ' || (decided_by = '00000000-0000-4000-8000-0000000044aa')::text
     from app.call_drafts where id = (select id from drafts where position = 0)),
  'accepted 00000000-0000-4000-8000-0000000ef001 true',
  'the draft names the rate and who accepted it'
);
select is(pg_temp.decide('00000000-0000-4000-8000-0000000044aa', 1, 'accepted', '00000000-0000-4000-8000-0000000ef001'),
  'result_not_found', 'one rate accepts one draft');
select throws_ok(
  $$update app.call_drafts set status = 'accepted', decided_by = '00000000-0000-4000-8000-0000000044aa',
           decided_by_name = 'x', decided_at = now(), result_id = '00000000-0000-4000-8000-0000000ef001'
     where id = (select id from drafts where position = 2)$$,
  '23505', null, 'and the database refuses a second one'
);
select is(pg_temp.decide('00000000-0000-4000-8000-0000000045aa', 0, 'dismissed', null), 'already_decided',
  'a decided draft stays decided');

-- Operations decide freight drafts too ----------------------------------------------------
select is(pg_temp.decide('00000000-0000-4000-8000-0000000055aa', 1, 'dismissed', null), 'decided',
  'operations dismiss a freight draft');
select is(
  (select status from app.call_drafts where id = (select id from drafts where position = 1)),
  'dismissed', 'and it is set aside'
);

select * from finish();
rollback;
