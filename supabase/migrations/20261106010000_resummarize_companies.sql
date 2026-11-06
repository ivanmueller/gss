-- Every company with history summarized again under the summaries' final rules (the owner's
-- request of 2026-11-06).
--
-- 20261105040000_counterparty_summary_retries.sql made every company with history due on
-- 2026-11-05, and the job wrote them under the rules of that day. The rules then changed four
-- times (ivanmueller/gss#153 to #157), ending with Claude writing no words: summaries written
-- before the last change went live (Deploy staging run #151, 2026-11-06 04:53 UTC) are in an
-- earlier form, and companies whose answers the stricter checks in between refused 5 times
-- stopped until something new happened.
--
-- So every company that is not archived, has a contact history, a call, a bid or offer, or a
-- follow-up, and has no summary written since then, is due again, with its attempts counted from
-- nothing. A summary already shown stays until its new one is written. The job writes 3 a run,
-- every 2 minutes, the companies with the latest activity first.

update app.counterparty_summaries s
   set source_at = null, attempts = 0
  from app.counterparties c
 where c.id = s.counterparty_id and c.organization_id = s.organization_id
   and c.archived_at is null
   and (s.written_at is null or s.written_at < timestamptz '2026-11-06 04:53:08+00')
   and app.counterparty_activity_at(s.organization_id, s.counterparty_id) is not null;
