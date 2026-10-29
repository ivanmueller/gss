-- Reference exchange rates (GT-052): the Bank of Canada's daily USD/CAD rate, the owner's
-- decision of 2026-10-27 (docs/DECISIONS.md), MASTER_PROJECT_SPECIFICATION.md sections 5.3
-- and 6.
--
-- One row per published day, as the Bank published it: CAD per 1 USD (series FXUSDCAD), the
-- day it applies to, and when the Worker fetched it. Rows are never changed or deleted, so a
-- saved scenario that names a day's rate can always find it as it was. A rate the Bank
-- later publishes differently for a day already stored is not written over; the Worker logs it.
--
-- The rate is public reference data, the same for everyone, not an organization's record, so
-- the table has no organization_id (like app.commodities). Signed-in users read it. Nobody
-- writes it directly: the Worker's daily job stores rates through
-- app.record_bank_of_canada_rate(), which runs without a user (there is none at 22:15 UTC)
-- and can only add a Bank of Canada USD/CAD row for a day not yet stored.

create table app.fx_quotes (
  id uuid primary key default gen_random_uuid(),
  -- The rate is quote_currency per 1 base_currency: CAD per USD (docs/TRADING_RULES.md 5.3).
  base_currency text not null check (base_currency = 'USD'),
  quote_currency text not null check (quote_currency = 'CAD'),
  -- Exactly as published (the Bank gives four decimals), never a float.
  rate numeric not null check (rate > 0 and rate < 10 and scale(rate) <= 10),
  -- The business day the rate is the average of. The Bank's daily series begins 2017-01-03.
  rate_date date not null check (rate_date >= date '2017-01-03'),
  source text not null check (source = 'bank_of_canada'),
  source_series text not null check (source_series = 'FXUSDCAD'),
  fetched_at timestamptz not null default now(),
  constraint fx_quotes_one_per_day unique (base_currency, quote_currency, source, rate_date)
);

-- Rates are history: nobody changes or deletes one, whatever their grants.
create function app.keep_fx_quotes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'reference exchange rates are never changed or deleted'
    using errcode = 'insufficient_privilege';
end
$$;

create trigger fx_quotes_immutable
  before update or delete on app.fx_quotes
  for each row execute function app.keep_fx_quotes();
create trigger fx_quotes_no_truncate
  before truncate on app.fx_quotes
  for each statement execute function app.keep_fx_quotes();

-- Stores one day's Bank of Canada USD/CAD rate. Answers 'stored' for a new day, 'unchanged'
-- when that day is already stored with the same rate, and 'differs' when it is stored with
-- another rate (the stored one is kept). Refuses a day after today in Ottawa, where the Bank
-- publishes, and a rate outside the table's bounds.
create function app.record_bank_of_canada_rate(day date, cad_per_usd numeric)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored numeric;
begin
  if day is null or cad_per_usd is null then
    raise exception 'a day and a rate are required' using errcode = 'not_null_violation';
  end if;
  if day > (now() at time zone 'America/Toronto')::date then
    raise exception 'a rate cannot be for a day that has not happened yet'
      using errcode = 'check_violation';
  end if;
  insert into app.fx_quotes (base_currency, quote_currency, rate, rate_date, source, source_series)
  values ('USD', 'CAD', cad_per_usd, day, 'bank_of_canada', 'FXUSDCAD')
  on conflict on constraint fx_quotes_one_per_day do nothing;
  if found then
    return 'stored';
  end if;
  select q.rate into stored
    from app.fx_quotes q
   where q.base_currency = 'USD' and q.quote_currency = 'CAD'
     and q.source = 'bank_of_canada' and q.rate_date = day;
  return case when stored = cad_per_usd then 'unchanged' else 'differs' end;
end
$$;

alter table app.fx_quotes enable row level security;

create policy fx_quotes_select_for_users on app.fx_quotes
  for select to app_api using (app.current_user_id() is not null);

-- Privileges: nothing for public or the Supabase API roles. app_api reads rates and stores a
-- day's rate only through the function; it never inserts, changes or deletes rows itself.
revoke all on app.fx_quotes from public, anon, authenticated, service_role;
revoke all on function app.keep_fx_quotes(), app.record_bank_of_canada_rate(date, numeric)
  from public, anon, authenticated, service_role;
revoke all on function app.keep_fx_quotes() from app_api;
grant select on app.fx_quotes to app_api;
grant execute on function app.record_bank_of_canada_rate(date, numeric) to app_api;
