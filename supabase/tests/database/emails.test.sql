-- Emails stored (20261111010000_emails.sql, F-114 step 2): the settings and each person's
-- address (admins only); starting and finishing a sent email (anyone on the team, From their
-- own or the shared address, its contact of its company); received mail kept once per
-- Message-ID, put on a company only by a reply to GSS's email or a DMARC-passing sender who is a
-- contact of exactly one company, never across organizations; Bcc'd and widely addressed mail
-- kept; linking and removing; emails and removals never edited or deleted; the summary
-- watermark; privileges and cross-organization denials. Runs in one transaction that is rolled
-- back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(84);

-- Fixtures ------------------------------------------------------------------
-- Org A: tom (trader), adam (org_admin), victor (viewer), sue (suspended). Org B: bob (org_admin).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test', '{"first_name": "Tom", "last_name": "Trader"}'),
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
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'trader', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- A: c1a (buyer, Pat and Dana), c2a (seller, Sam), c3a (Lee), c4a (archived, Ari). B: c1b (Pat
-- again). Dana at c1a and Lee at c3a share one address.
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000022aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000022aa', null),
  ('00000000-0000-4000-8000-00000000c3aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Other', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000022aa', null),
  ('00000000-0000-4000-8000-00000000c4aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000022aa', now()),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

insert into app.counterparty_contacts (id, organization_id, counterparty_id, name, email, created_by) values
  ('00000000-0000-4000-8000-00000000d1aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Pat Buyer', 'Pat@Buyer.example', '00000000-0000-4000-8000-0000000022aa'),
  ('00000000-0000-4000-8000-00000000d5aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c1aa', 'Dana Buyer', 'shared@desk.example', '00000000-0000-4000-8000-0000000022aa'),
  ('00000000-0000-4000-8000-00000000d2aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c2aa', 'Sam Seller', 'sam@seller.example', '00000000-0000-4000-8000-0000000022aa'),
  ('00000000-0000-4000-8000-00000000d3aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c3aa', 'Lee Other', 'shared@desk.example', '00000000-0000-4000-8000-0000000022aa'),
  ('00000000-0000-4000-8000-00000000d4aa', '00000000-0000-4000-8000-0000000000aa',
   '00000000-0000-4000-8000-00000000c4aa', 'Ari Archived', 'ari@archived.example', '00000000-0000-4000-8000-0000000022aa'),
  ('00000000-0000-4000-8000-00000000d1bb', '00000000-0000-4000-8000-0000000000bb',
   '00000000-0000-4000-8000-00000000c1bb', 'Pat Elsewhere', 'pat@buyer.example', '00000000-0000-4000-8000-0000000011bb');

grant app_api to current_user;

-- A query as app_api for the given user (null: the Worker, with nobody signed in).
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

-- Starting a sent email from org A.
create function pg_temp.start(uid text, company text, contact text, from_part text,
                              to_list text[] default '{pat@buyer.example}', msg text default null,
                              org text default '00000000-0000-4000-8000-0000000000aa')
returns jsonb
language sql as $fn$
  select pg_temp.api(uid, format(
    'select app.start_outgoing_email(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text',
    org, company, contact, from_part, 'gss.example', to_list, '{}'::text[], 'Hello', 'Body text',
    coalesce(msg, '<' || gen_random_uuid() || '@gss.example>')))::jsonb
$fn$;

-- A received email, as the Worker passes it (nobody signed in unless uid is given).
create function pg_temp.receive(msg text, sender text, answers text default null,
                                refs text[] default '{}', dmarc boolean default true,
                                to_list text[] default '{info@gss.example}',
                                envelope text default 'info@gss.example',
                                org text default '00000000-0000-4000-8000-0000000000aa',
                                uid text default null)
returns jsonb
language sql as $fn$
  select pg_temp.api(uid, format(
    'select app.receive_email(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)::text',
    org, envelope, sender, 'Sender Name', to_list, '{}'::text[], null, 'Re: Hello', 'Reply body',
    false, msg, answers, refs, dmarc))::jsonb
$fn$;

create temp table ids (name text primary key, id uuid);

-- Privileges -------------------------------------------------------------------
select ok(not has_table_privilege('authenticated', 'app.emails', 'select')
          and not has_table_privilege('anon', 'app.emails', 'select')
          and not has_table_privilege('service_role', 'app.emails', 'select'),
  'the Supabase API roles cannot read emails');
select ok(has_table_privilege('app_api', 'app.emails', 'select')
          and not has_table_privilege('app_api', 'app.emails', 'insert')
          and not has_table_privilege('app_api', 'app.emails', 'update')
          and not has_table_privilege('app_api', 'app.emails', 'delete'),
  'app_api only reads emails');
select ok(not has_table_privilege('app_api', 'app.email_removals', 'insert')
          and not has_table_privilege('app_api', 'app.email_settings', 'insert')
          and not has_table_privilege('app_api', 'app.member_email_addresses', 'insert'),
  'app_api writes removals, settings and addresses only through the functions');
select ok(not has_function_privilege('authenticated',
            'app.receive_email(uuid, text, text, text, text[], text[], text, text, text, boolean, text, text, text[], boolean)', 'execute')
          and not has_function_privilege('anon', 'app.link_email(uuid, uuid, uuid)', 'execute'),
  'the Supabase API roles cannot call the email functions');
select ok(not has_function_privilege('app_api', 'app.check_email()', 'execute')
          and not has_function_privilege('app_api', 'app.email_contact_name(uuid, uuid, uuid)', 'execute'),
  'app_api cannot call the trigger functions');

-- Settings and addresses -------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  $$select app.save_email_settings('00000000-0000-4000-8000-0000000000aa', 'info', 'Sig')$$),
  'forbidden', 'a trader cannot save the email settings');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
  $$select app.save_email_settings('00000000-0000-4000-8000-0000000000aa', 'info', 'Sig')$$),
  'forbidden', 'another organization''s admin cannot save them');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  $$select app.save_email_settings('00000000-0000-4000-8000-0000000000aa', ' Info ', '{name}, GSS')$$),
  'saved', 'an admin saves them');
select is((select shared_local_part::text || '|' || signature || '|' || updated_by_name
             from app.email_settings where organization_id = '00000000-0000-4000-8000-0000000000aa'),
  'info|{name}, GSS|Adam', 'the shared address is kept in lowercase with the signature and who saved it');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  $$select app.save_member_email_address('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'Tom')$$),
  'saved', 'an admin sets a person''s own address');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  $$select app.save_member_email_address('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'tom')$$),
  'address_taken', 'another person''s address is refused');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  $$select app.save_member_email_address('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'info')$$),
  'address_taken', 'the shared address is refused as a person''s');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  $$select app.save_member_email_address('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011bb', 'bob')$$),
  'not_a_member', 'another organization''s person gets no address here');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  $$select app.save_member_email_address('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'boss')$$),
  'forbidden', 'a trader cannot set addresses, not even their own');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  $$select app.save_email_settings('00000000-0000-4000-8000-0000000000aa', 'tom', null)$$),
  'address_taken', 'the shared address cannot be a person''s own');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  $$select app.save_member_email_address('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'victor')$$),
  'saved', 'the viewer gets an address too');
select throws_ok(
  $$select pg_temp.api('00000000-0000-4000-8000-0000000022aa',
    'select app.save_member_email_address(''00000000-0000-4000-8000-0000000000aa'', ''00000000-0000-4000-8000-0000000022aa'', ''a b'')')$$,
  '23514', null, 'an address with a space is refused');

-- Sent emails --------------------------------------------------------------------
insert into ids
select 'out1', (pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                              '00000000-0000-4000-8000-00000000d1aa', 'tom', '{Pat@Buyer.example}',
                              '<out1@gss.example>') ->> 'id')::uuid;
select isnt((select id from ids where name = 'out1'), null, 'a trader starts an email from their own address');
select is((select status::text || '|' || from_address::text || '|' || sent_by_name || '|' || contact_name || '|' || to_addresses[1]::text
             from app.emails where id = (select id from ids where name = 'out1')),
  'sending|tom@gss.example|Tom Trader|Pat Buyer|pat@buyer.example',
  'it starts as sending, from their address, in their name, to its contact, addresses in lowercase');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa', null, 'info') ->> 'status',
  'started', 'the shared address is allowed');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa', null, 'victor') ->> 'status',
  'from_not_allowed', 'another person''s address is refused');
select is(pg_temp.start('00000000-0000-4000-8000-0000000022aa', '00000000-0000-4000-8000-00000000c1aa', null, 'adam') ->> 'status',
  'from_not_allowed', 'an address nobody was given is refused');
select is(pg_temp.start('00000000-0000-4000-8000-0000000033aa', '00000000-0000-4000-8000-00000000c1aa', null, 'victor') ->> 'status',
  'started', 'a viewer sends too (everyone on the team)');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c4aa', null, 'tom') ->> 'status',
  'archived', 'not to an archived company');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1bb', null, 'tom') ->> 'status',
  'company_not_found', 'not to another organization''s company');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                        '00000000-0000-4000-8000-00000000d2aa', 'tom') ->> 'status',
  'contact_not_found', 'not with a contact of another company');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                        '00000000-0000-4000-8000-00000000d1bb', 'tom') ->> 'status',
  'contact_not_found', 'not with another organization''s contact');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa',
                        '00000000-0000-4000-8000-0000000000ff', 'tom') ->> 'status',
  'contact_not_found', 'not with a contact that does not exist');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa', null, 'tom', '{}') ->> 'status',
  'bad_recipients', 'not to nobody');
select is(pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa', null, 'tom',
                        (select array_agg('r' || i || '@x.example') from generate_series(1, 51) i)) ->> 'status',
  'bad_recipients', 'not to more than 50');
select is(pg_temp.start('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-00000000c1aa', null, 'info') ->> 'status',
  'forbidden', 'another organization''s person cannot send as this one');
select is(pg_temp.start('00000000-0000-4000-8000-0000000055aa', '00000000-0000-4000-8000-00000000c1aa', null, 'info') ->> 'status',
  'forbidden', 'a suspended person cannot send');
select is(pg_temp.start('00000000-0000-4000-8000-0000000011bb', '00000000-0000-4000-8000-00000000c1bb', null, 'info',
                        org => '00000000-0000-4000-8000-0000000000bb') ->> 'status',
  'no_settings', 'an organization without settings sends nothing');

select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  format('select app.finish_outgoing_email(%L, true, %L, null)', (select id from ids where name = 'out1'), 'cf-1')),
  'not_found', 'only its sender finishes an email');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.finish_outgoing_email(%L, true, %L, null)', (select id from ids where name = 'out1'), 'cf-1')),
  'done', 'its sender records that it was sent');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.finish_outgoing_email(%L, false, null, %L)', (select id from ids where name = 'out1'), 'late')),
  'already_finished', 'it is finished once');
select is((select status::text || '|' || provider_message_id::text from app.emails where id = (select id from ids where name = 'out1')),
  'sent|cf-1', 'it is sent, with the sending service''s id');

insert into ids
select 'out2', (pg_temp.start('00000000-0000-4000-8000-0000000044aa', '00000000-0000-4000-8000-00000000c1aa', null, 'tom') ->> 'id')::uuid;
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.finish_outgoing_email(%L, false, null, %L)', (select id from ids where name = 'out2'), 'Refused: over the limit')),
  'done', 'a refusal is recorded');
select is((select status::text || '|' || failure from app.emails where id = (select id from ids where name = 'out2')),
  'failed|Refused: over the limit', 'the email is failed, with the reason');

-- Emails are never edited or deleted, even by the table owner ----------------------
select throws_ok(
  $$select pg_temp.api('00000000-0000-4000-8000-0000000044aa',
    'insert into app.emails (organization_id, direction, status, counterparty_id, sent_by, sent_by_name, from_address, to_addresses, body_text, message_id)
     values (''00000000-0000-4000-8000-0000000000aa'', ''outgoing'', ''sending'', ''00000000-0000-4000-8000-00000000c1aa'',
             ''00000000-0000-4000-8000-0000000044aa'', ''Tom'', ''tom@gss.example'', ''{a@x.example}'', ''x'', ''<x@y>'') returning id::text')$$,
  '42501', null, 'app_api cannot write an email directly');
select throws_ok(
  format('update app.emails set subject = %L where id = %L', 'Changed', (select id from ids where name = 'out1')),
  '42501', null, 'a sent email''s subject is never changed');
select throws_ok(
  format('update app.emails set status = %L where id = %L', 'sending', (select id from ids where name = 'out1')),
  '23514', null, 'a sent email never goes back to sending');
select throws_ok(
  format('delete from app.emails where id = %L', (select id from ids where name = 'out2')),
  '42501', null, 'an email is never deleted');
select throws_ok('truncate app.email_removals', '42501', null, 'removals are never truncated');
select throws_ok(
  $$insert into app.emails (organization_id, direction, status, counterparty_id, contact_id, sent_by, sent_by_name, from_address, to_addresses, body_text, message_id)
    values ('00000000-0000-4000-8000-0000000000aa', 'outgoing', 'sending', '00000000-0000-4000-8000-00000000c1aa',
            '00000000-0000-4000-8000-00000000d2aa', '00000000-0000-4000-8000-0000000044aa', 'Tom', 'tom@gss.example',
            '{a@x.example}', 'x', '<direct@x>')$$,
  '23503', null, 'even the table owner cannot keep an email with another company''s contact');

-- Received emails ------------------------------------------------------------------
select is(pg_temp.receive('<in0@x>', 'pat@buyer.example', org => '00000000-0000-4000-8000-0000000000cc') ->> 'status',
  'unknown_organization', 'mail for an organization that does not exist is refused');
select is(pg_temp.receive('<in0@x>', 'pat@buyer.example', uid => '00000000-0000-4000-8000-0000000044aa') ->> 'status',
  'forbidden', 'a signed-in person cannot pass mail off as received');

insert into ids select 'reply', (pg_temp.receive('<in1@x>', 'someone@else.example', answers => '<out1@gss.example>') ->> 'id')::uuid;
select is((select counterparty_id::text || '|' || contact_name from app.emails where id = (select id from ids where name = 'reply')),
  '00000000-0000-4000-8000-00000000c1aa|Pat Buyer', 'a reply to GSS''s email goes on its company and contact');
select is(pg_temp.receive('<in2@x>', 'someone@else.example', refs => '{<z@x>,<out1@gss.example>}', dmarc => false) ->> 'counterparty_id',
  '00000000-0000-4000-8000-00000000c1aa', 'a reply found by its References too, whatever DMARC said');
insert into ids select 'bycontact', (pg_temp.receive('<in3@x>', 'PAT@buyer.example') ->> 'id')::uuid;
select is((select counterparty_id::text || '|' || contact_name from app.emails where id = (select id from ids where name = 'bycontact')),
  '00000000-0000-4000-8000-00000000c1aa|Pat Buyer',
  'a DMARC-passing sender who is a contact of one company goes on it (not the other organization''s)');
select is(pg_temp.receive('<in4@x>', 'pat@buyer.example', dmarc => false) ->> 'counterparty_id',
  null, 'a sender who did not pass DMARC is left to link by hand');
select is(pg_temp.receive('<in5@x>', 'shared@desk.example') ->> 'counterparty_id',
  null, 'a sender listed at two companies is left to link by hand');
select is(pg_temp.receive('<in6@x>', 'ari@archived.example') ->> 'counterparty_id',
  null, 'a sender at an archived company is left to link by hand');
select is(pg_temp.receive('<inb1@x>', 'pat@buyer.example', answers => '<out1@gss.example>',
                          org => '00000000-0000-4000-8000-0000000000bb') ->> 'counterparty_id',
  '00000000-0000-4000-8000-00000000c1bb', 'another organization''s mail never goes on this organization''s company');
select is(pg_temp.receive('<inb2@x>', 'sam@seller.example', answers => '<out1@gss.example>',
                          org => '00000000-0000-4000-8000-0000000000bb') ->> 'counterparty_id',
  null, 'nor answers this organization''s email');
select is(pg_temp.receive('<in1@x>', 'someone@else.example') ->> 'id',
  (select id::text from ids where name = 'reply'), 'the same message received again is kept once');
select is(pg_temp.receive('<in1@x>', 'someone@else.example') ->> 'duplicate', 'true', 'and says so');
insert into ids select 'bcc', (pg_temp.receive('<in7@x>', 'stranger@else.example', to_list => '{}',
                                               envelope => 'Tom@gss.example') ->> 'id')::uuid;
select is((select cardinality(to_addresses) || '|' || envelope_to::text || '|' || gss_member::text
             from app.emails where id = (select id from ids where name = 'bcc')),
  '0|tom@gss.example|00000000-0000-4000-8000-0000000044aa',
  'Bcc''d mail is kept, with the address it came to and whose that is');
select is(pg_temp.receive('<in8@x>', 'list@else.example',
                          to_list => (select array_agg('r' || i || '@x.example') from generate_series(1, 60) i)) ->> 'status',
  'received', 'mail to more than 50 people is kept');
select is((select count(*)::int from app.emails where organization_id = '00000000-0000-4000-8000-0000000000aa'
             and direction = 'incoming'), 8, 'eight received emails kept in org A');

-- Reading -------------------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa', 'select count(*)::text from app.emails'),
  (select count(*)::text from app.emails where organization_id = '00000000-0000-4000-8000-0000000000aa'),
  'a viewer reads all of the organization''s email, sent to anyone');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
  $$select count(*)::text from app.emails where organization_id = '00000000-0000-4000-8000-0000000000aa'$$),
  '0', 'another organization reads none of it');
select is(pg_temp.api('00000000-0000-4000-8000-0000000055aa', 'select count(*)::text from app.emails'),
  '0', 'a suspended person reads none');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb', 'select count(*)::text from app.member_email_addresses'),
  '0', 'another organization reads none of the addresses');

-- Linking -------------------------------------------------------------------------
insert into ids select 'loose1', id from app.emails where message_id = '<in5@x>';
insert into ids select 'loose2', id from app.emails where message_id = '<in6@x>';
select is(app.counterparty_activity_at('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa'),
  null, 'the seller has no activity yet');
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
  format('select app.link_email(%L, %L, null)', (select id from ids where name = 'loose1'), '00000000-0000-4000-8000-00000000c1bb')),
  'not_found', 'another organization cannot link this organization''s mail');
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa',
  format('select app.link_email(%L, %L, null)', (select id from ids where name = 'loose1'), '00000000-0000-4000-8000-00000000c4aa')),
  'company_not_found', 'not to an archived company');
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa',
  format('select app.link_email(%L, %L, null)', (select id from ids where name = 'loose1'), '00000000-0000-4000-8000-00000000c1bb')),
  'company_not_found', 'not to another organization''s company');
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa',
  format('select app.link_email(%L, %L, %L)', (select id from ids where name = 'loose1'),
         '00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-00000000d1aa')),
  'company_not_found', 'not with a contact of another company');
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa',
  format('select app.link_email(%L, %L, %L)', (select id from ids where name = 'loose1'),
         '00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-00000000d2aa')),
  'done', 'anyone on the team links mail to a company and contact');
select is((select counterparty_id::text || '|' || contact_name || '|' || linked_by_name
             from app.emails where id = (select id from ids where name = 'loose1')),
  '00000000-0000-4000-8000-00000000c2aa|Sam Seller|Victor', 'it is on the company, with who linked it');
select isnt(app.counterparty_activity_at('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa'),
  null, 'linked mail is new activity for the company''s summary');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.link_email(%L, %L, null)', (select id from ids where name = 'loose1'), '00000000-0000-4000-8000-00000000c1aa')),
  'already_linked', 'it is linked once');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.link_email(%L, %L, null)', (select id from ids where name = 'out1'), '00000000-0000-4000-8000-00000000c2aa')),
  'not_found', 'a sent email is never linked elsewhere');
select throws_ok(
  format('update app.emails set counterparty_id = %L where id = %L', '00000000-0000-4000-8000-00000000c1aa',
         (select id from ids where name = 'loose1')),
  '23514', null, 'even the table owner cannot move linked mail');

-- Removing ------------------------------------------------------------------------
select is(pg_temp.api('00000000-0000-4000-8000-0000000011bb',
  format('select app.remove_email(%L)', (select id from ids where name = 'loose2'))),
  'not_found', 'another organization cannot remove this organization''s mail');
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa',
  format('select app.remove_email(%L)', (select id from ids where name = 'loose2'))),
  'done', 'anyone on the team removes mail on no company');
select is(pg_temp.api('00000000-0000-4000-8000-0000000033aa',
  format('select app.remove_email(%L)', (select id from ids where name = 'loose2'))),
  'already_removed', 'it is removed once');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.link_email(%L, %L, null)', (select id from ids where name = 'loose2'), '00000000-0000-4000-8000-00000000c2aa')),
  'removed', 'removed mail is not linked');
select is(pg_temp.api('00000000-0000-4000-8000-0000000044aa',
  format('select app.remove_email(%L)', (select id from ids where name = 'loose1'))),
  'forbidden', 'a trader cannot remove mail on a company');
select is(pg_temp.api('00000000-0000-4000-8000-0000000022aa',
  format('select app.remove_email(%L)', (select id from ids where name = 'loose1'))),
  'done', 'an admin removes mail on a company');
select is((select removed_by_name from app.email_removals where email_id = (select id from ids where name = 'loose1')),
  'Adam', 'the removal says who');
select throws_ok(
  format('delete from app.email_removals where email_id = %L', (select id from ids where name = 'loose1')),
  '42501', null, 'a removal is never undone, even by the table owner');
select throws_ok(
  format('update app.email_removals set removed_by_name = %L where email_id = %L', 'Nobody', (select id from ids where name = 'loose1')),
  '42501', null, 'a removal is never changed');

select * from finish();
rollback;
