-- Reference exchange rates: privileges, who reads them, that the Worker's job stores a day's
-- Bank of Canada rate only through app.record_bank_of_canada_rate(), and that stored rates
-- are never changed or deleted. Runs in one transaction that is rolled back. The rates are
-- synthetic.
begin;
create extension if not exists pgtap with schema extensions;

select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000044aa', 'tom@example.test');

-- Test-only: lets the test owner switch to app_api (see tenancy.test.sql).
grant app_api to current_user;

-- Runs a statement as app_api for the given user (none when null).
create function pg_temp.as_api(uid text, statement text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.user_id', coalesce(uid, ''), true);
  set local role app_api;
  execute statement;
  reset role;
  perform set_config('app.user_id', '', true);
end
$fn$;

-- The answer of a query run as app_api for the given user (none when null).
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

create function pg_temp.ottawa_today() returns date
language sql as $$ select (now() at time zone 'America/Toronto')::date $$;

-- Privileges -----------------------------------------------------------------------
select ok(
  has_table_privilege('app_api', 'app.fx_quotes', 'select'),
  'app_api reads exchange rates'
);
select ok(
  not has_table_privilege('app_api', 'app.fx_quotes', 'insert')
    and not has_table_privilege('app_api', 'app.fx_quotes', 'update')
    and not has_table_privilege('app_api', 'app.fx_quotes', 'delete')
    and not has_table_privilege('app_api', 'app.fx_quotes', 'truncate'),
  'app_api cannot write exchange rates directly'
);
select ok(
  not has_table_privilege('anon', 'app.fx_quotes', 'select')
    and not has_table_privilege('authenticated', 'app.fx_quotes', 'select')
    and not has_table_privilege('service_role', 'app.fx_quotes', 'select'),
  'the Supabase API roles cannot read exchange rates'
);
select ok(
  has_function_privilege('app_api', 'app.record_bank_of_canada_rate(date, numeric)', 'execute')
    and not has_function_privilege('app_api', 'app.keep_fx_quotes()', 'execute'),
  'app_api stores rates through the function and cannot call the trigger directly'
);
select ok(
  not has_function_privilege('anon', 'app.record_bank_of_canada_rate(date, numeric)', 'execute')
    and not has_function_privilege('authenticated', 'app.record_bank_of_canada_rate(date, numeric)', 'execute')
    and not has_function_privilege('service_role', 'app.record_bank_of_canada_rate(date, numeric)', 'execute'),
  'the Supabase API roles cannot store rates'
);
select ok(
  (select prosecdef and proconfig = array['search_path=""']
     from pg_proc where oid = 'app.record_bank_of_canada_rate(date, numeric)'::regprocedure),
  'the store function runs as its owner with an empty search path'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'app.fx_quotes'::regclass),
  'exchange rates have row level security'
);

-- Storing, as the Worker's daily job does (no user) -------------------------------------
select is(
  pg_temp.api_text(null, format(
    'select app.record_bank_of_canada_rate(%L, 1.3912)', pg_temp.ottawa_today() - 1)),
  'stored',
  'a new day''s rate is stored without a user'
);
select is(
  pg_temp.api_text(null, format(
    'select app.record_bank_of_canada_rate(%L, 1.3912)', pg_temp.ottawa_today() - 1)),
  'unchanged',
  'the same day and rate again changes nothing'
);
select is(
  pg_temp.api_text(null, format(
    'select app.record_bank_of_canada_rate(%L, 1.4000)', pg_temp.ottawa_today() - 1)),
  'differs',
  'another rate for a day already stored is reported'
);
select is(
  (select rate::text from app.fx_quotes where rate_date = pg_temp.ottawa_today() - 1),
  '1.3912',
  'the first stored rate is kept, exactly as given'
);
select is(
  pg_temp.api_text(null, format(
    'select app.record_bank_of_canada_rate(%L, 1.3900)', pg_temp.ottawa_today())),
  'stored',
  'today''s rate in Ottawa is stored'
);
select is(
  (select rate::text from app.fx_quotes where rate_date = pg_temp.ottawa_today()),
  '1.3900',
  'the decimal places published are kept'
);
select is(
  (select array[base_currency, quote_currency, source, source_series]
     from app.fx_quotes where rate_date = pg_temp.ottawa_today()),
  array['USD', 'CAD', 'bank_of_canada', 'FXUSDCAD'],
  'a stored rate is CAD per USD from the Bank of Canada''s FXUSDCAD series'
);

-- Refused values ---------------------------------------------------------------------
select throws_ok(
  format('select pg_temp.as_api(null, %L)', format(
    'select app.record_bank_of_canada_rate(%L, 1.39)', pg_temp.ottawa_today() + 1)),
  '23514', null, 'a rate for a day after today in Ottawa is refused'
);
select throws_ok(
  format('select pg_temp.as_api(null, %L)', format(
    'select app.record_bank_of_canada_rate(%L, 0)', pg_temp.ottawa_today() - 2)),
  '23514', null, 'a zero rate is refused'
);
select throws_ok(
  format('select pg_temp.as_api(null, %L)', format(
    'select app.record_bank_of_canada_rate(%L, -1.39)', pg_temp.ottawa_today() - 2)),
  '23514', null, 'a negative rate is refused'
);
select throws_ok(
  format('select pg_temp.as_api(null, %L)', format(
    'select app.record_bank_of_canada_rate(%L, 13.9)', pg_temp.ottawa_today() - 2)),
  '23514', null, 'an implausibly large rate is refused'
);
select throws_ok(
  $$select pg_temp.as_api(null, 'select app.record_bank_of_canada_rate(''2016-12-30'', 1.33)')$$,
  '23514', null, 'a day before the Bank''s daily series is refused'
);
select throws_ok(
  $$select pg_temp.as_api(null, 'select app.record_bank_of_canada_rate(null, 1.33)')$$,
  '23502', null, 'a rate without a day is refused'
);

-- Writing directly and changing history ------------------------------------------------
select throws_ok(
  format('select pg_temp.as_api(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    $$insert into app.fx_quotes (base_currency, quote_currency, rate, rate_date, source, source_series)
      values ('USD', 'CAD', 1.25, '2026-01-05', 'bank_of_canada', 'FXUSDCAD')$$),
  '42501', null, 'app_api cannot insert a rate directly'
);
select throws_ok(
  format('select pg_temp.as_api(%L, %L)', '00000000-0000-4000-8000-0000000044aa',
    'update app.fx_quotes set rate = 1.25'),
  '42501', null, 'app_api cannot change a rate'
);
select throws_ok(
  'update app.fx_quotes set rate = 1.25',
  '42501', null, 'not even the table owner can change a rate'
);
select throws_ok(
  'delete from app.fx_quotes',
  '42501', null, 'not even the table owner can delete a rate'
);

-- Reading ------------------------------------------------------------------------------
select is(
  pg_temp.api_text(null, 'select count(*)::text from app.fx_quotes'),
  '0',
  'without a signed-in user nothing is visible'
);
select is(
  pg_temp.api_text('00000000-0000-4000-8000-0000000044aa',
    'select string_agg(rate::text, '','' order by rate_date desc) from app.fx_quotes'),
  '1.3900,1.3912',
  'a signed-in user reads the stored rates'
);

select * from finish();
rollback;
