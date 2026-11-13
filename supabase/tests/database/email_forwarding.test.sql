-- Forwarded email (20261118010000_email_forwarding.sql, F-233): each member's own forwarding
-- addresses (any role, own rows only, one live owner per address, 5 each, take-over of a long
-- unconfirmed one, own domain refused); code emails reserved under limits before sending (one a
-- minute and 10 a day per member, 5 per address, every reservation counted; Codex's design
-- review D1-03); codes kept as hashes, 5 tries, 30 minutes; rows never deleted; receive_email
-- honouring a forward only from a confirmed address of an active member of the organization,
-- with DMARC passed, to a GSS address, with the original sender off GSS's domain and offsets
-- (in code points, D1-01) that fit the body; matching on the original sender; the email as
-- Claude is shown it. Runs in one transaction that is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(65);

-- Fixtures ------------------------------------------------------------------
-- Org A: tom (trader), vic (viewer), sam (trader, suspended); org B: bob (admin).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom"}'),
  ('00000000-0000-4000-8000-0000000055aa', 'vic@example.test', '{"first_name": "Vic"}'),
  ('00000000-0000-4000-8000-0000000066aa', 'sam@example.test', '{"first_name": "Sam"}'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test', '{"first_name": "Bob"}');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000066aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

insert into app.member_email_addresses (organization_id, user_id, local_part) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'tom');

insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Carrier', '{carrier}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000044aa');

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Pat Carrier', 'pat@carrier.example', '00000000-0000-4000-8000-0000000044aa');

select set_config('app.request_id', '00000000-0000-4000-8000-0000000e0e0e', true);

grant app_api to current_user;

create function pg_temp.api(uid text, query text) returns text
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

create function pg_temp.add(uid text, address text,
                            org text default '00000000-0000-4000-8000-0000000000aa')
returns jsonb
language sql as $fn$
  select pg_temp.api(uid, format('select app.add_forwarding_address(%L, %L, %L)::text',
                                 org, address, 'gss.example'))::jsonb
$fn$;

create function pg_temp.reserve(uid text, address text,
                                org text default '00000000-0000-4000-8000-0000000000aa')
returns jsonb
language sql as $fn$
  select pg_temp.api(uid, format('select app.reserve_forwarding_code(%L, %L)::text', org, address))::jsonb
$fn$;

create function pg_temp.finish(uid text, send text, hash text) returns text
language sql as $fn$
  select pg_temp.api(uid, format('select app.finish_forwarding_code(%L, %L, %L)',
                                 '00000000-0000-4000-8000-0000000000aa', send, hash))
$fn$;

create function pg_temp.confirm(uid text, address text, hash text) returns text
language sql as $fn$
  select pg_temp.api(uid, format('select app.confirm_forwarding_address(%L, %L, %L)',
                                 '00000000-0000-4000-8000-0000000000aa', address, hash))
$fn$;

create function pg_temp.row_of(address text) returns app.member_forwarding_addresses
language sql as $fn$
  select * from app.member_forwarding_addresses
   where address = $1 and removed_at is null
$fn$;

create function pg_temp.hash(c text) returns text
language sql as $fn$ select repeat(c, 64) $fn$;

-- Privileges ----------------------------------------------------------------
select ok(not has_table_privilege('app_api', 'app.member_forwarding_addresses', 'select')
          and not has_table_privilege('app_api', 'app.member_forwarding_addresses', 'insert')
          and not has_table_privilege('app_api', 'app.member_forwarding_addresses', 'update')
          and not has_table_privilege('app_api', 'app.forwarding_code_sends', 'select')
          and not has_table_privilege('app_api', 'app.forwarding_code_sends', 'insert'),
  'app_api reaches the forwarding tables only through the functions');
select ok(not has_table_privilege('authenticated', 'app.member_forwarding_addresses', 'select')
          and not has_table_privilege('anon', 'app.forwarding_code_sends', 'select')
          and not has_table_privilege('service_role', 'app.member_forwarding_addresses', 'select'),
  'the Supabase API roles cannot read the forwarding tables');
select ok(has_function_privilege('app_api', 'app.add_forwarding_address(uuid, text, text)', 'execute')
          and has_function_privilege('app_api', 'app.reserve_forwarding_code(uuid, uuid)', 'execute')
          and has_function_privilege('app_api', 'app.finish_forwarding_code(uuid, uuid, text)', 'execute')
          and has_function_privilege('app_api', 'app.fail_forwarding_code(uuid, uuid)', 'execute')
          and has_function_privilege('app_api', 'app.confirm_forwarding_address(uuid, uuid, text)', 'execute')
          and has_function_privilege('app_api', 'app.remove_forwarding_address(uuid, uuid)', 'execute')
          and has_function_privilege('app_api', 'app.my_forwarding_addresses(uuid)', 'execute')
          and has_function_privilege('app_api',
            'app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text, text[], boolean, boolean, boolean, text, integer, jsonb, timestamptz, text, text, text, text, integer, integer, integer)',
            'execute'),
  'app_api calls the forwarding functions and the new receive_email');
select ok(not has_function_privilege('authenticated', 'app.add_forwarding_address(uuid, text, text)', 'execute')
          and not has_function_privilege('anon', 'app.confirm_forwarding_address(uuid, uuid, text)', 'execute')
          and not has_function_privilege('service_role', 'app.reserve_forwarding_code(uuid, uuid)', 'execute'),
  'the Supabase API roles cannot call the forwarding functions');
select ok(not has_function_privilege('app_api', 'app.email_as_shown(app.emails, integer)', 'execute')
          and not has_function_privilege('app_api', 'app.lock_own_membership(uuid)', 'execute')
          and not has_function_privilege('app_api', 'app.keep_forwarding_rows()', 'execute')
          and not has_function_privilege('app_api', 'app.forwarder_name(uuid)', 'execute'),
  'app_api cannot call the helpers');

-- Adding ----------------------------------------------------------------------
select is(pg_temp.add('00000000-0000-4000-8000-0000000044aa', '  Tom.Home@Mail.Example ') ->> 'status',
  'added', 'a trader adds a personal address');
select is((pg_temp.row_of('tom.home@mail.example')).user_id, '00000000-0000-4000-8000-0000000044aa'::uuid,
  'kept lowercase, as the caller''s');
select is(pg_temp.add('00000000-0000-4000-8000-0000000044aa', 'tom.home@mail.example') ->> 'status',
  'exists', 'adding it again answers exists');
select is(pg_temp.add('00000000-0000-4000-8000-0000000055aa', 'vic.home@mail.example') ->> 'status',
  'added', 'a viewer adds their own (every role)');
select is(pg_temp.add('00000000-0000-4000-8000-0000000055aa', 'tom.home@mail.example') ->> 'status',
  'taken', 'another member''s recent address is taken');
select is(pg_temp.add('00000000-0000-4000-8000-0000000044aa', 'desk@GSS.example') ->> 'status',
  'on_own_domain', 'an address at GSS''s own domain is refused');
select is(pg_temp.add('00000000-0000-4000-8000-0000000044aa', 'not an address') ->> 'status',
  'invalid', 'a malformed address is refused');
select is(pg_temp.add('00000000-0000-4000-8000-0000000011bb', 'bob.home@mail.example') ->> 'status',
  'forbidden', 'a member of org B cannot add in org A');
select is(pg_temp.add(null, 'nobody@mail.example') ->> 'status',
  'forbidden', 'nobody signed in cannot add');
select is(pg_temp.add('00000000-0000-4000-8000-0000000011bb', 'bob.home@mail.example',
                      '00000000-0000-4000-8000-0000000000bb') ->> 'status',
  'added', 'org B''s member adds in org B');

select pg_temp.add('00000000-0000-4000-8000-0000000044aa', 'tom' || n || '@mail.example')
  from generate_series(2, 5) n;
select is(pg_temp.add('00000000-0000-4000-8000-0000000044aa', 'tom6@mail.example') ->> 'status',
  'too_many', 'at most 5 live addresses per member');

-- A pending address of vic's, added two days ago and never sent a code, is taken over.
insert into app.member_forwarding_addresses (organization_id, user_id, address, created_at)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa',
        'old.typo@mail.example', now() - interval '2 days');
select is(pg_temp.add('00000000-0000-4000-8000-0000000066aa', 'old.typo@mail.example') ->> 'status',
  'added', 'a long unconfirmed address of another member is taken over');
select ok((select removed_at is not null from app.member_forwarding_addresses
            where address = 'old.typo@mail.example'
              and user_id = '00000000-0000-4000-8000-0000000055aa'),
  'the earlier row is marked removed, not deleted');

-- Code sends ----------------------------------------------------------------
select is(pg_temp.reserve('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom.home@mail.example')).id::text) ->> 'status',
  'reserved', 'a code email is reserved');
select is(pg_temp.reserve('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom2@mail.example')).id::text) ->> 'status',
  'too_soon', 'a second within the minute is refused, even for another address');
select is(pg_temp.reserve('00000000-0000-4000-8000-0000000055aa',
                          (pg_temp.row_of('tom.home@mail.example')).id::text) ->> 'status',
  'not_found', 'nobody reserves for another member''s address');
select is(pg_temp.reserve('00000000-0000-4000-8000-0000000011bb',
                          (pg_temp.row_of('tom.home@mail.example')).id::text,
                          '00000000-0000-4000-8000-0000000000bb') ->> 'status',
  'not_found', 'nor from another organization');

-- Finish: the hash kept for 30 minutes on the address.
select is(pg_temp.finish('00000000-0000-4000-8000-0000000044aa',
                         (select id::text from app.forwarding_code_sends
                           where address_id = (pg_temp.row_of('tom.home@mail.example')).id),
                         pg_temp.hash('a')),
  'done', 'the sent code is recorded');
select ok((select code_hash = pg_temp.hash('a')
                  and code_expires_at between now() + interval '29 minutes' and now() + interval '31 minutes'
                  and code_attempts = 0
             from pg_temp.row_of('tom.home@mail.example')),
  'its hash is kept for 30 minutes');
select is(pg_temp.finish('00000000-0000-4000-8000-0000000044aa',
                         (select id::text from app.forwarding_code_sends
                           where address_id = (pg_temp.row_of('tom.home@mail.example')).id),
                         pg_temp.hash('b')),
  'not_found', 'a send is finished once');

-- An older reservation finishing after a newer one never replaces the newer code.
insert into app.forwarding_code_sends (id, organization_id, user_id, address_id, reserved_at) values
  ('00000000-0000-4000-8000-0000000f0001', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-0000000055aa', (pg_temp.row_of('vic.home@mail.example')).id, now() - interval '10 minutes'),
  ('00000000-0000-4000-8000-0000000f0002', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-0000000055aa', (pg_temp.row_of('vic.home@mail.example')).id, now() - interval '5 minutes');
select pg_temp.finish('00000000-0000-4000-8000-0000000055aa', '00000000-0000-4000-8000-0000000f0002', pg_temp.hash('c'));
select pg_temp.finish('00000000-0000-4000-8000-0000000055aa', '00000000-0000-4000-8000-0000000f0001', pg_temp.hash('d'));
select is((pg_temp.row_of('vic.home@mail.example')).code_hash, pg_temp.hash('c'),
  'a late older send keeps the newer code');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
                      format('select app.finish_forwarding_code(%L, %L, %L)',
                             '00000000-0000-4000-8000-0000000000aa',
                             '00000000-0000-4000-8000-0000000f0001', pg_temp.hash('e'))),
  'not_found', 'nobody finishes another member''s send');

-- Fail: marked failed, still counted.
insert into app.forwarding_code_sends (id, organization_id, user_id, address_id, reserved_at) values
  ('00000000-0000-4000-8000-0000000f0003', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-0000000055aa', (pg_temp.row_of('vic.home@mail.example')).id, now() - interval '3 minutes');
select is(pg_temp.api('00000000-0000-4000-8000-0000000055aa',
                      format('select app.fail_forwarding_code(%L, %L)',
                             '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000f0003')),
  'done', 'a send that failed is marked');
select is((select outcome from app.forwarding_code_sends where id = '00000000-0000-4000-8000-0000000f0003'),
  'failed', 'and kept as failed');

-- Limits: 5 per address (failed ones counted), 10 a day per member.
-- Vic's address has 3 sends (f0001 to f0003); two failed ones more make 5.
insert into app.forwarding_code_sends (organization_id, user_id, address_id, reserved_at, outcome, finished_at)
select '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa',
       (pg_temp.row_of('vic.home@mail.example')).id, now() - n * interval '2 minutes', 'failed', now()
  from generate_series(1, 2) n;
select is(pg_temp.reserve('00000000-0000-4000-8000-0000000055aa',
                          (pg_temp.row_of('vic.home@mail.example')).id::text) ->> 'status',
  'too_many', 'at most 5 codes per address, failed ones counted');
insert into app.member_forwarding_addresses (organization_id, user_id, address)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'vic2@mail.example');
insert into app.forwarding_code_sends (organization_id, user_id, address_id, reserved_at)
select '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa',
       (pg_temp.row_of('vic2@mail.example')).id, now() - interval '1 hour' - n * interval '1 minute'
  from generate_series(1, 4) n;
-- Vic has 5 + 4 = 9 in the day; one more on a fresh address reaches 10.
insert into app.member_forwarding_addresses (organization_id, user_id, address)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'vic3@mail.example');
insert into app.forwarding_code_sends (organization_id, user_id, address_id, reserved_at)
values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa',
        (pg_temp.row_of('vic3@mail.example')).id, now() - interval '3 hours');
select is(pg_temp.reserve('00000000-0000-4000-8000-0000000055aa',
                          (pg_temp.row_of('vic3@mail.example')).id::text) ->> 'status',
  'too_many', 'at most 10 codes a day per member');

-- Confirming --------------------------------------------------------------------
select is(pg_temp.confirm('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom.home@mail.example')).id::text, pg_temp.hash('f')),
  'wrong', 'a wrong code');
select is((pg_temp.row_of('tom.home@mail.example')).code_attempts, 1, 'counts one try');
select is(pg_temp.confirm('00000000-0000-4000-8000-0000000055aa',
                          (pg_temp.row_of('tom.home@mail.example')).id::text, pg_temp.hash('a')),
  'not_found', 'nobody confirms another member''s address, even with its code');
select is(pg_temp.confirm('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom.home@mail.example')).id::text, pg_temp.hash('a')),
  'confirmed', 'the right code confirms');
select ok((select confirmed_at is not null and code_hash is null and code_expires_at is null
             from pg_temp.row_of('tom.home@mail.example')),
  'confirmed, the code cleared');
select is(pg_temp.confirm('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom.home@mail.example')).id::text, pg_temp.hash('z')),
  'confirmed', 'confirming again answers confirmed');
select is(pg_temp.reserve('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom.home@mail.example')).id::text) ->> 'status',
  'already_confirmed', 'no code for a confirmed address');

-- Expired, and spent after 5 wrong tries.
update app.member_forwarding_addresses
   set code_hash = pg_temp.hash('1'), code_expires_at = now() - interval '1 second'
 where id = (pg_temp.row_of('tom2@mail.example')).id;
select is(pg_temp.confirm('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom2@mail.example')).id::text, pg_temp.hash('1')),
  'expired', 'a code past its 30 minutes has expired');
update app.member_forwarding_addresses
   set code_hash = pg_temp.hash('2'), code_expires_at = now() + interval '30 minutes', code_attempts = 5
 where id = (pg_temp.row_of('tom3@mail.example')).id;
select is(pg_temp.confirm('00000000-0000-4000-8000-0000000044aa',
                          (pg_temp.row_of('tom3@mail.example')).id::text, pg_temp.hash('2')),
  'expired', 'a code tried 5 times is spent, even when right');

-- Listing and removing --------------------------------------------------------------
select is(jsonb_array_length(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select app.my_forwarding_addresses(%L)::text', '00000000-0000-4000-8000-0000000000aa'))::jsonb),
  5, 'a member lists their own live addresses');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
            format('select app.my_forwarding_addresses(%L)::text', '00000000-0000-4000-8000-0000000000aa')),
  null, 'nobody lists in another organization');
select is(pg_temp.api('00000000-0000-4000-8000-0000000055aa',
            format('select app.remove_forwarding_address(%L, %L)', '00000000-0000-4000-8000-0000000000aa',
                   (pg_temp.row_of('tom5@mail.example')).id)),
  'not_found', 'nobody removes another member''s address');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
            format('select app.remove_forwarding_address(%L, %L)', '00000000-0000-4000-8000-0000000000aa',
                   (pg_temp.row_of('tom5@mail.example')).id)),
  'done', 'a member removes their own');
select ok((select removed_at is not null from app.member_forwarding_addresses where address = 'tom5@mail.example'),
  'kept, marked removed');

-- Kept rows ---------------------------------------------------------------------
select throws_ok($$delete from app.member_forwarding_addresses where address = 'tom5@mail.example'$$,
  '42501', null, 'an address row is never deleted');
select throws_ok($$update app.member_forwarding_addresses set address = 'x@mail.example'
                    where address = 'tom4@mail.example'$$,
  '42501', null, 'its address never changes');
select throws_ok($$update app.forwarding_code_sends set outcome = 'sent', finished_at = now()
                    where id = '00000000-0000-4000-8000-0000000f0003'$$,
  '42501', null, 'a send''s outcome changes once');

-- Receiving forwards ----------------------------------------------------------------
-- A confirmed address of sam's, then sam suspended; and bob's confirmed in org B.
update app.member_forwarding_addresses set confirmed_at = now()
 where address in ('old.typo@mail.example', 'bob.home@mail.example') and removed_at is null;
update app.organization_members set status = 'suspended'
 where user_id = '00000000-0000-4000-8000-0000000066aa';

create function pg_temp.body(note text default 'FYI') returns text
language sql as $fn$
  select note || E'\n\n---------- Forwarded message ---------\nFrom: Pat <pat@carrier.example>\n'
         || E'Date: Thu, Nov 12, 2026\nSubject: Lane rate\n\nWe can do 2 loads at 4,200.'
$fn$;

create function pg_temp.forward(msg text, sender text default 'tom.home@mail.example',
                                original text default 'pat@carrier.example',
                                dmarc boolean default true,
                                envelope text default 'info@gss.example',
                                body text default pg_temp.body(),
                                fwd_offset integer default null,
                                fwd_text_offset integer default null)
returns jsonb
language sql as $fn$
  select pg_temp.api(null, format(
    'select app.receive_email(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text',
    '00000000-0000-4000-8000-0000000000aa', envelope, sender, 'Tom at home', '{info@gss.example}'::text[],
    '{}'::text[], null, 'Fwd: Lane rate', body, false, msg, null, '{}'::text[], dmarc, false, false,
    'raw/00000000-0000-4000-8000-0000000000aa/' || encode(sha256(convert_to(msg, 'UTF8')), 'hex') || '.eml',
    100, '[]', now(), original, 'Pat', 'Lane rate', 'Thu, Nov 12, 2026',
    coalesce(fwd_offset, strpos(body, '----------') - 1),
    coalesce(fwd_text_offset, strpos(body, 'We can do') - 1), 0))::jsonb
$fn$;

create function pg_temp.kept(msg text) returns app.emails
language sql as $fn$
  select * from app.emails where direction = 'incoming' and message_id = msg
$fn$;

select is(pg_temp.forward('<f1@mail.example>') ->> 'forwarded', 'true',
  'a forward from a confirmed address is honoured');
select ok((select forwarded_by = '00000000-0000-4000-8000-0000000044aa'
                  and counterparty_id = '00000000-0000-4000-8000-00000000c1aa'
                  and contact_id = '00000000-0000-4000-8000-00000000d1aa'
                  and from_address = 'tom.home@mail.example'
                  and original_from_address = 'pat@carrier.example'
                  and original_subject = 'Lane rate' and original_date_text = 'Thu, Nov 12, 2026'
                  and forward_offset = 5 and forward_depth = 0
             from pg_temp.kept('<f1@mail.example>')),
  'matched on the original sender; the member stays the sender of record');
select ok((select app.email_as_shown(e, 12000) ->> 'from' = 'pat@carrier.example'
                  and app.email_as_shown(e, 12000) ->> 'body' = 'We can do 2 loads at 4,200.'
                  and app.email_as_shown(e, 12000) -> 'forward' ->> 'note' = E'FYI\n\n'
                  and app.email_as_shown(e, 12000) -> 'forward' ->> 'byName' = 'Tom'
             from pg_temp.kept('<f1@mail.example>') e),
  'Claude is shown the original sender, the forwarded text and the note');
select is((pg_temp.forward('<f2@mail.example>', sender => 'tom2@mail.example')) ->> 'forwarded', 'false',
  'not from an unconfirmed address');
select ok((select forwarded_by is null and counterparty_id is null and original_from_address is null
             from pg_temp.kept('<f2@mail.example>')),
  'kept as ordinary mail, on no company');
select is((pg_temp.forward('<f3@mail.example>', dmarc => false)) ->> 'forwarded', 'false',
  'not without DMARC');
select is((pg_temp.forward('<f4@mail.example>', sender => 'tom5@mail.example')) ->> 'forwarded', 'false',
  'not from a removed address');
select is((pg_temp.forward('<f5@mail.example>', sender => 'old.typo@mail.example')) ->> 'forwarded', 'false',
  'not from a suspended member''s address');
select is((pg_temp.forward('<f6@mail.example>', sender => 'bob.home@mail.example')) ->> 'forwarded', 'false',
  'not from another organization''s member');
select is((pg_temp.forward('<f7@mail.example>', original => 'desk@gss.example')) ->> 'forwarded', 'false',
  'not when the original sender is on GSS''s own domain');
select is((pg_temp.forward('<f8@mail.example>', envelope => 'nobody@gss.example')) ->> 'forwarded', 'false',
  'not to an address of nobody');
select is((pg_temp.forward('<f9@mail.example>', fwd_text_offset => 10000)) ->> 'forwarded', 'false',
  'not when the offsets do not fit the body');
select is((pg_temp.forward('<f10@mail.example>', original => null)) ->> 'forwarded', 'false',
  'not without a forward');
-- Offsets in code points (D1-01): ten emoji before the block.
select is((pg_temp.forward('<f11@mail.example>', body => pg_temp.body(repeat(U&'\+01F33E', 10)),
                           fwd_offset => 12,
                           fwd_text_offset => strpos(pg_temp.body(repeat(U&'\+01F33E', 10)), 'We can do') - 1))
            ->> 'forwarded', 'true',
  'code point offsets after emoji are honoured');
select is((select app.email_as_shown(e, 100) ->> 'body' from pg_temp.kept('<f11@mail.example>') e),
  'We can do 2 loads at 4,200.', 'and slice the forwarded text exactly');
select throws_like($$insert into app.emails (organization_id, direction, status, from_address, subject,
                                          body_text, message_id, raw_key, raw_size, forwarded_by,
                                          original_from_address, original_subject, forward_offset,
                                          forward_text_offset, forward_depth)
                  values ('00000000-0000-4000-8000-0000000000aa', 'incoming', 'received', 'a@mail.example',
                          '', 'short', '<bad@mail.example>',
                          'raw/00000000-0000-4000-8000-0000000000aa/' || repeat('0', 64) || '.eml', 1,
                          '00000000-0000-4000-8000-0000000044aa', 'p@c.example', 'x', 0, 99, 0)$$,
  '%emails_forward_shape%', 'a forward''s offsets must fit its body');
select ok((select app.email_as_shown(e, 100) ->> 'from' = 'tom2@mail.example'
                  and app.email_as_shown(e, 100) -> 'forward' is null
             from pg_temp.kept('<f2@mail.example>') e),
  'ordinary mail is shown as before');

select * from finish();
rollback;
