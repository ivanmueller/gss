-- Bids and offers: privileges, who may enter, revise and withdraw quotes, that revisions are
-- numbered by the database and never changed or deleted, that a withdrawn quote stays
-- withdrawn, cross-organization denials and the audit trail. Runs in one transaction that
-- is rolled back. All fixtures are synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(61);

-- Fixtures ------------------------------------------------------------------
-- Org A: tom (trader), adam (org_admin), olivia (operations), victor (viewer),
-- sue (suspended trader). Org B: bob (org_admin).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test'),
  ('00000000-0000-4000-8000-0000000022aa', 'adam@example.test'),
  ('00000000-0000-4000-8000-0000000011aa', 'olivia@example.test'),
  ('00000000-0000-4000-8000-0000000033aa', 'victor@example.test'),
  ('00000000-0000-4000-8000-0000000055aa', 'sue@example.test'),
  ('00000000-0000-4000-8000-0000000011bb', 'bob@example.test');

insert into app.organizations (id, display_name) values
  ('00000000-0000-4000-8000-0000000000aa', 'Synthetic Org A'),
  ('00000000-0000-4000-8000-0000000000bb', 'Synthetic Org B');

insert into app.organization_members (organization_id, user_id, role, status, joined_at) values
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000044aa', 'trader', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000022aa', 'org_admin', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000011aa', 'operations', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000033aa', 'viewer', 'active', now()),
  ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-0000000055aa', 'trader', 'suspended', now()),
  ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000011bb', 'org_admin', 'active', now());

-- A: c1a (buyer, location f1a), c2a (seller, location f2a), c3a (archived). B: c1b (location f1b).
insert into app.counterparties (id, organization_id, legal_name, types, primary_country, source, created_by, archived_at) values
  ('00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c2aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Seller', '{seller}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', null),
  ('00000000-0000-4000-8000-00000000c3aa', '00000000-0000-4000-8000-0000000000aa', 'Synthetic A Archived', '{buyer}', 'CA', 'manual',
   '00000000-0000-4000-8000-0000000011aa', now()),
  ('00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-0000000000bb', 'Synthetic B Buyer', '{buyer}', 'US', 'manual',
   '00000000-0000-4000-8000-0000000011bb', null);

insert into app.facilities (id, organization_id, counterparty_id, city, region, country, created_by) values
  ('00000000-0000-4000-8000-000000000f1a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa',
   'Synthetic Town', 'MN', 'US', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f2a', '00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c2aa',
   'Synthetic City', 'SK', 'CA', '00000000-0000-4000-8000-0000000011aa'),
  ('00000000-0000-4000-8000-000000000f1b', '00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-00000000c1bb',
   'Synthetic Village', 'ND', 'US', '00000000-0000-4000-8000-0000000011bb');

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

-- A bid from c1a at f1a in org A, entered by the given user, with the given id.
create function pg_temp.new_bid(id text, uid text, counterparty text default '00000000-0000-4000-8000-00000000c1aa',
                                facility text default '00000000-0000-4000-8000-000000000f1a',
                                org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.quotes (id, organization_id, counterparty_id, facility_id, side, commodity_code, created_by)
                  values (%L, %L, %L, %L, 'bid', 'flaxseed', %L)$$, id, org, counterparty, facility, uid)
$fn$;

-- A revision of the quote, recorded by the given user, at the given price.
create function pg_temp.new_revision(quote text, uid text, price text,
                                     org text default '00000000-0000-4000-8000-0000000000aa') returns text
language sql as $fn$
  select format($$insert into app.quote_revisions
                    (organization_id, quote_id, revision_number, firmness, price, currency, price_unit, grade,
                     delivery_basis, basis_location, quantity_min_mt, quantity_max_mt, delivery_start, delivery_end,
                     quoted_at, valid_from, valid_until, source_type, recorded_by, recorded_by_name)
                  values (%L, %L, 99, 'firm', %s, 'USD', 'MT', 'No. 1 CW', 'delivered', 'Synthetic Town, MN',
                          21.000, 84.000, '2026-11-01', '2026-11-30',
                          now(), now(), now() + interval '2 days', 'phone', %L, 'Synthetic Person')$$,
                org, quote, price, uid)
$fn$;

-- Privileges ---------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.quotes', 'select, insert')
    and has_table_privilege('app_api', 'app.quote_revisions', 'select, insert')
    and has_table_privilege('app_api', 'app.commodities', 'select'),
  'app_api reads and enters quotes and revisions and reads commodities'
);
select ok(
  not has_table_privilege('app_api', 'app.quotes', 'delete, truncate')
    and not has_table_privilege('app_api', 'app.quote_revisions', 'update, delete, truncate')
    and not has_table_privilege('app_api', 'app.commodities', 'insert, update, delete, truncate'),
  'app_api cannot delete quotes, change or delete revisions, or change commodities'
);
select ok(
  has_column_privilege('app_api', 'app.quotes', 'withdrawn_at', 'update')
    and has_column_privilege('app_api', 'app.quotes', 'withdrawn_by', 'update')
    and has_column_privilege('app_api', 'app.quotes', 'withdrawn_by_name', 'update'),
  'app_api can withdraw a quote'
);
select ok(
  not has_column_privilege('app_api', 'app.quotes', 'organization_id', 'update')
    and not has_column_privilege('app_api', 'app.quotes', 'counterparty_id', 'update')
    and not has_column_privilege('app_api', 'app.quotes', 'facility_id', 'update')
    and not has_column_privilege('app_api', 'app.quotes', 'side', 'update')
    and not has_column_privilege('app_api', 'app.quotes', 'commodity_code', 'update')
    and not has_column_privilege('app_api', 'app.quotes', 'created_by', 'update'),
  'app_api cannot move a quote or change its side or commodity'
);
select ok(
  not has_table_privilege('anon', 'app.quotes', 'select')
    and not has_table_privilege('authenticated', 'app.quote_revisions', 'select')
    and not has_table_privilege('service_role', 'app.commodities', 'select'),
  'the Supabase API roles cannot read quotes, revisions or commodities'
);
select ok(
  has_function_privilege('app_api', 'app.can_enter_quotes(uuid)', 'execute')
    and not has_function_privilege('app_api', 'app.number_quote_revision()', 'execute')
    and not has_function_privilege('app_api', 'app.keep_quote_revisions()', 'execute')
    and not has_function_privilege('app_api', 'app.keep_quote_identity()', 'execute'),
  'app_api can ask who enters quotes but cannot call the quote triggers directly'
);

-- Entering quotes: who may ------------------------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000033aa')),
  '42501', null, 'a viewer cannot enter a quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000011aa')),
  '42501', null, 'an operations member cannot enter a quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000055aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000055aa')),
  '42501', null, 'a suspended trader cannot enter a quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000011bb')),
  '42501', null, 'another organization''s admin cannot enter a quote in this organization'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-00000000c1aa', null, '00000000-0000-4000-8000-0000000000bb')),
  '42501', null, 'another organization''s admin cannot quote for this organization''s counterparty in their own'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000022aa')),
  '42501', null, 'a quote cannot be entered in someone else''s name'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000c3aa', null)),
  '42501', null, 'an archived counterparty gets no new quotes'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-000000000f2a')),
  '23503', null, 'a quote cannot name another counterparty''s location'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa',
      '00000000-0000-4000-8000-00000000c1aa', '00000000-0000-4000-8000-000000000f1b')),
  '23503', null, 'a quote cannot name another organization''s location'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$insert into app.quotes (organization_id, counterparty_id, side, commodity_code, created_by)
      values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-00000000c1aa', 'bid', 'gold',
              '00000000-0000-4000-8000-0000000044aa')$$),
  '23503', null, 'a quote needs a commodity from the list'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa')),
  1, 'a trader enters a bid at the counterparty''s location'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    $$insert into app.quotes (id, organization_id, counterparty_id, side, commodity_code, created_by)
      values ('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000aa',
              '00000000-0000-4000-8000-00000000c2aa', 'offer', 'canola', '00000000-0000-4000-8000-0000000022aa')$$),
  1, 'an admin enters an offer without a location'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_bid('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000011bb',
      '00000000-0000-4000-8000-00000000c1bb', '00000000-0000-4000-8000-000000000f1b',
      '00000000-0000-4000-8000-0000000000bb')),
  1, 'the other organization''s admin enters a bid in their own organization'
);

-- Revisions: numbered by the database, never changed ------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000033aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000033aa', '725.00')),
  '42501', null, 'a viewer cannot record a revision'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000022aa', '725.00')),
  '42501', null, 'a revision cannot be recorded in someone else''s name'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011bb',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000011bb', '725.00',
      '00000000-0000-4000-8000-0000000000bb')),
  '23503', null, 'another organization''s admin cannot revise this organization''s quote'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '725.00')),
  1, 'a trader records the first terms of the bid'
);
select is(
  (select revision_number from app.quote_revisions where quote_id = '00000000-0000-4000-8000-00000000a001'),
  1, 'the database numbers the first revision 1, whatever number was sent'
);
select is(
  (select price::text from app.quote_revisions where quote_id = '00000000-0000-4000-8000-00000000a001'),
  '725.00', 'the price keeps the decimal places it was entered with'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000022aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000022aa', '730.50')),
  1, 'an admin records new terms for the bid'
);
select is(
  (select array_agg(revision_number::text || ':' || price::text order by revision_number)::text
     from app.quote_revisions where quote_id = '00000000-0000-4000-8000-00000000a001'),
  '{1:725.00,2:730.50}', 'the new terms are revision 2 and the first terms are kept'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.quote_revisions set price = 1 where quote_id = '00000000-0000-4000-8000-00000000a001'$$),
  '42501', null, 'app_api cannot change a revision'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$delete from app.quote_revisions where quote_id = '00000000-0000-4000-8000-00000000a001'$$),
  '42501', null, 'app_api cannot delete a revision'
);
select throws_ok(
  $$update app.quote_revisions set price = 1 where quote_id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null, 'not even the table owner can change a revision'
);
select throws_ok(
  $$delete from app.quote_revisions where quote_id = '00000000-0000-4000-8000-00000000a001'$$,
  '42501', null, 'not even the table owner can delete a revision'
);
select throws_ok(
  $$truncate app.quote_revisions cascade$$,
  '42501', null, 'not even the table owner can empty the revisions'
);

-- Revisions: the values the database refuses ---------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '0')),
  '23514', null, 'a price of zero is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '-5.00')),
  '23514', null, 'a negative price is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''USD''', '''EUR''')),
  '23514', null, 'a currency other than CAD or USD is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''MT''', '''KG''')),
  '23514', null, 'an unknown price unit is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '21.000, 84.000', '90.000, 84.000')),
  '23514', null, 'a minimum quantity above the maximum is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '21.000, 84.000', 'null, 0')),
  '23514', null, 'no available quantity is refused'
);
-- Postgres ranks numeric NaN above every number, so "above zero" alone would let it in.
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '21.000, 84.000', '21.000, ''NaN''')),
  '23514', null, 'an available quantity of NaN is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '21.000, 84.000', 'null, ''NaN''')),
  '23514', null, 'an available quantity of NaN without a minimum is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '21.000, 84.000', '''NaN'', ''NaN''')),
  '23514', null, 'NaN as both the minimum and the available quantity is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '''NaN''')),
  '23514', null, 'a price of NaN is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            '''2026-11-01'', ''2026-11-30''', '''2026-12-01'', ''2026-11-30''')),
  '23514', null, 'a delivery window that ends before it starts is refused'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    replace(pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '1.00'),
            'now() + interval ''2 days''', 'now()')),
  '23514', null, 'a quote valid until the moment it starts is refused'
);

-- Withdrawing -----------------------------------------------------------------------
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000033aa',
    $$update app.quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000033aa', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000a001'$$),
  0, 'a viewer cannot withdraw a quote'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000011bb',
    $$update app.quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000011bb', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000a001'$$),
  0, 'another organization''s admin cannot withdraw this organization''s quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000022aa', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000a001'$$),
  '42501', null, 'a quote cannot be withdrawn in someone else''s name'
);
select is(
  pg_temp.api_changed('00000000-0000-4000-8000-0000000044aa',
    $$update app.quotes set withdrawn_at = now(), withdrawn_by = '00000000-0000-4000-8000-0000000044aa', withdrawn_by_name = 'Synthetic Person'
      where id = '00000000-0000-4000-8000-00000000a001'$$),
  1, 'a trader withdraws a quote'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$update app.quotes set withdrawn_at = null, withdrawn_by = null, withdrawn_by_name = null
      where id = '00000000-0000-4000-8000-00000000a001'$$),
  '23514', null, 'a withdrawn quote cannot be brought back'
);
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    pg_temp.new_revision('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000044aa', '740.00')),
  'GS002', null, 'a withdrawn quote cannot be revised'
);
select throws_ok(
  $$update app.quotes set side = 'bid' where id = '00000000-0000-4000-8000-00000000a002'$$,
  '23514', null, 'not even the table owner can change a quote''s side'
);

-- Reading ---------------------------------------------------------------------------
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa', 'select id from app.quotes'),
  2, 'a viewer reads the organization''s quotes, withdrawn included'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa', 'select id from app.quote_revisions'),
  2, 'a viewer reads the organization''s revisions, and only those'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000011bb',
    $$select id from app.quotes where organization_id = '00000000-0000-4000-8000-0000000000aa'
      union all select id from app.quote_revisions where organization_id = '00000000-0000-4000-8000-0000000000aa'$$),
  0, 'another organization''s admin reads none of this organization''s quotes or revisions'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000055aa',
    'select id from app.quotes union all select id from app.quote_revisions'),
  0, 'a suspended member reads no quotes or revisions'
);
select is(
  pg_temp.api_count(null, 'select id from app.quotes union all select id from app.quote_revisions'),
  0, 'nothing is read without a user'
);
select is(
  pg_temp.api_count('00000000-0000-4000-8000-0000000033aa', 'select code from app.commodities'),
  20, 'a signed-in member reads the commodity list'
);
select is(
  pg_temp.api_count(null, 'select code from app.commodities'),
  0, 'the commodity list is not read without a user'
);

-- Locations with quotes, and the audit trail ---------------------------------------
select throws_ok(
  format('select pg_temp.api_changed(%L, %L)', '00000000-0000-4000-8000-0000000011aa',
    $$delete from app.facilities where id = '00000000-0000-4000-8000-000000000f1a'$$),
  '23503', null, 'a location with quotes cannot be removed'
);
select is(
  (select array_agg(entity || ':' || action order by id)::text from app.audit_events
    where entity in ('quotes', 'quote_revisions')
      and organization_id = '00000000-0000-4000-8000-0000000000aa'),
  '{quotes:insert,quotes:insert,quote_revisions:insert,quote_revisions:insert,quotes:update}',
  'entering, revising and withdrawing quotes are audited'
);
select is(
  (select count(*)::int from app.audit_events
    where entity = 'quote_revisions' and actor_id is not null
      and request_id = '00000000-0000-4000-8000-0000000e0e0e'),
  2, 'each revision''s audit event names who recorded it and the request'
);

select * from finish();
rollback;
