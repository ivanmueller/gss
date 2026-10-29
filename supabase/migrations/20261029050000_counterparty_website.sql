-- A counterparty's website (the owner's request of 2026-10-29, docs/DECISIONS.md).
--
-- Optional. The API tidies a website before saving it (packages/domain/src/website.ts), and
-- the database holds the column to the same rules, so a website written any other way is
-- refused too:
-- * http:// or https://, then a site name in lower case: labels of letters, digits and
--   hyphens joined by dots, ending in a top-level name of letters (or xn-- for an
--   international one). So no user name or password (no @), no port (no :), no number
--   address (127.0.0.1 ends in a digit, [::1] has brackets) and no single-label name;
-- * not ending in a private name (localhost, .local, .internal, .test, …), the same list
--   as the API's;
-- * then nothing or a path, query or fragment without spaces or control characters, and
--   at most 500 characters in all.
--
-- Operations and org_admin members set it with the counterparty's other details: inserts
-- were already granted on the whole table, and updates go through the existing
-- counterparties_update_for_editors policy. The audit trigger records it like every other
-- column.

alter table app.counterparties add column website text
  constraint counterparties_website_check check (
    length(website) <= 500
    and website ~ '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})([/?#][^[:space:][:cntrl:]]*)?$'
    and substring(website from '^https?://[^/?#]*\.([a-z0-9-]+)(?:[/?#]|$)') not in (
      'arpa', 'corp', 'example', 'home', 'internal', 'intranet', 'invalid', 'lan', 'local',
      'localdomain', 'localhost', 'onion', 'test'
    )
  );

grant update (website) on app.counterparties to app_api;
