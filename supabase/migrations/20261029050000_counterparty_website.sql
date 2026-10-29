-- A counterparty's website (the owner's request of 2026-10-29, docs/DECISIONS.md).
--
-- Optional. Only an http or https address with no spaces or control characters is stored,
-- at most 500 characters; the API tidies it first and refuses other schemes, user names,
-- ports, number addresses and private names (packages/domain/src/website.ts). The check
-- here keeps a javascript: or data: address out even if another path wrote the column.
--
-- Operations and org_admin members set it with the counterparty's other details: inserts
-- were already granted on the whole table, and updates go through the existing
-- counterparties_update_for_editors policy. The audit trigger records it like every other
-- column.

alter table app.counterparties add column website text
  constraint counterparties_website_check check (
    length(website) <= 500 and website ~ '^https?://[^[:space:][:cntrl:]/?#]+([/?#][^[:space:][:cntrl:]]*)?$'
  );

grant update (website) on app.counterparties to app_api;
