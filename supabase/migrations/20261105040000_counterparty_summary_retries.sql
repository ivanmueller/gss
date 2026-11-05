-- Codex's review of 20261105030000_counterparty_summaries.sql (f6d3296, merged as
-- ivanmueller/gss#151), and the owner's request of 2026-11-05 to summarize every company with
-- history at once:
--
-- - Something new after 5 failed attempts starts the count again from 1 (finding 1): also when
--   the company had no activity at its earlier claims (a summary asked for before anything
--   happened: NULL never compared as older), and also while a person's request is pending (the
--   request no longer kept the count at 5).
-- - Every company listed before the summaries began that has a contact history, a call, a bid or
--   offer, or a follow-up, and no summary yet, is due now: the job writes them 3 a run, every
--   2 minutes, the companies with the latest activity first. Archived companies are left out.

create or replace function app.claim_counterparty_summaries(most integer)
returns table (counterparty_id uuid, claim_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  stamp timestamptz := pg_catalog.clock_timestamp();
  due record;
  token uuid;
  taken integer := 0;
begin
  if most is null or most < 1 then
    return;
  end if;
  for due in
    select cp.organization_id, cp.id, a.activity_at, s.requested_at
      from app.counterparties cp
      left join app.counterparty_summaries s on s.counterparty_id = cp.id
      cross join lateral (
        select app.counterparty_activity_at(cp.organization_id, cp.id) as activity_at
      ) a
     where cp.archived_at is null
       and (s.claimed_at is null or s.claimed_at < stamp - interval '10 minutes')
       and (
         (s.requested_at is not null and s.attempts < 5)
         or (a.activity_at is not null
             and a.activity_at > coalesce(s.source_at, '-infinity')
             and (s.written_at is null or s.written_at < stamp - interval '1 hour')
             and a.activity_at < stamp - interval '3 minutes'
             and (coalesce(s.attempts, 0) < 5
                  or a.activity_at > coalesce(s.activity_at, '-infinity'))
             and not exists (
               select 1
                 from app.calls c
                 join app.call_recordings cr on cr.call_id = c.id
                where c.organization_id = cp.organization_id and c.counterparty_id = cp.id
                  and cr.read_at is null and cr.reading_attempts < 5
                  and cr.created_at > stamp - interval '1 hour'
                  and (cr.transcript is null or pg_catalog.btrim(cr.transcript) <> '')))
       )
     order by s.requested_at nulls last, a.activity_at desc
  loop
    token := null;
    insert into app.counterparty_summaries as s
      (counterparty_id, organization_id, attempts, activity_at, claimed_at, claim_token)
    values (due.id, due.organization_id, 1, due.activity_at, stamp, gen_random_uuid())
    on conflict on constraint counterparty_summaries_pkey do update
      set attempts = case
            when excluded.activity_at > coalesce(s.activity_at, '-infinity') then 1
            else least(s.attempts + 1, 5)
          end,
          activity_at = excluded.activity_at,
          claimed_at = excluded.claimed_at,
          claim_token = excluded.claim_token
      where s.claimed_at is null or s.claimed_at < stamp - interval '10 minutes'
    returning s.claim_token into token;
    if token is not null then
      counterparty_id := due.id;
      claim_token := token;
      return next;
      taken := taken + 1;
      exit when taken >= least(most, 10);
    end if;
  end loop;
end
$$;


update app.counterparty_summaries s
   set source_at = null
  from app.counterparties c
 where c.id = s.counterparty_id and c.organization_id = s.organization_id
   and c.archived_at is null
   and s.summary is null
   and app.counterparty_activity_at(s.organization_id, s.counterparty_id) is not null;

revoke all on function app.claim_counterparty_summaries(integer)
  from public, anon, authenticated, service_role;
grant execute on function app.claim_counterparty_summaries(integer) to app_api;
