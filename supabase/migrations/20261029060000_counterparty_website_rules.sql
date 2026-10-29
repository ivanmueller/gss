-- A counterparty's website: the database holds the site name to the API's rules (Codex's
-- review of 20261029050000_counterparty_website.sql, which checked only the scheme, spaces
-- and length, so a website written another way could carry a user name, a port, a number
-- address or a private name).
--
-- The API tidies a website before saving it (packages/domain/src/website.ts); the check
-- now refuses anything that tidying would not produce:
-- * http:// or https://, then a site name in lower case: labels of letters, digits and
--   hyphens joined by dots, ending in a top-level name of letters (or xn-- for an
--   international one). So no user name or password (no @), no port (no :), no number
--   address (127.0.0.1 ends in a digit, [::1] has brackets) and no single-label name;
-- * not ending in a private name (localhost, .local, .internal, .test, …), the same list
--   as the API's;
-- * then nothing or a path, query or fragment without spaces or control characters, and
--   at most 500 characters in all.
--
-- Websites already saved were tidied by the API, so they meet these rules; adding the
-- constraint checks every row, and the migration stops if one does not.

alter table app.counterparties drop constraint counterparties_website_check;

alter table app.counterparties add constraint counterparties_website_check check (
  length(website) <= 500
  and website ~ '^https?://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})([/?#][^[:space:][:cntrl:]]*)?$'
  and substring(website from '^https?://[^/?#]*\.([a-z0-9-]+)(?:[/?#]|$)') not in (
    'arpa', 'corp', 'example', 'home', 'internal', 'intranet', 'invalid', 'lan', 'local',
    'localdomain', 'localhost', 'onion', 'test'
  )
);
