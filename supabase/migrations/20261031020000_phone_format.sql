-- Phone numbers in one format (the owner's choice of 2026-10-31, docs/DECISIONS.md).
--
-- The app now saves a North American number as (403) 555-0100, with an extension as " x7",
-- from forms and spreadsheets alike (formatPhone in packages/domain/src/directory.ts). Numbers
-- saved before are tidied the same way here, once: companies' phones and contacts' phones.
-- A number with another country code, or anything else that is not 10 digits (11 with a
-- leading 1), is kept as written. Each change is audited by the existing triggers, without a
-- person (made by this migration).
--
-- app.format_phone mirrors formatPhone for the values the database already accepts;
-- apps/api/src/phone.db.test.ts checks that the two agree. Nobody calls it but this migration.

create function app.format_phone(phone text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
  main text;
  extension text;
  digits text;
begin
  if phone is null then
    return null;
  end if;
  phone := btrim(phone);
  parts := pg_catalog.regexp_match(phone, '^(.*?)\s*[xX]\s*([0-9]+)$');
  main := coalesce(parts[1], phone);
  extension := parts[2];
  if main ~ '[^0-9+(). /-]' then
    return phone;
  end if;
  digits := pg_catalog.regexp_replace(main, '[^0-9]', '', 'g');
  if length(digits) = 11 and left(digits, 1) = '1' then
    digits := substr(digits, 2);
  elsif left(main, 1) = '+' then
    return phone;
  end if;
  if length(digits) <> 10 then
    return phone;
  end if;
  return '(' || substr(digits, 1, 3) || ') ' || substr(digits, 4, 3) || '-' || substr(digits, 7)
    || coalesce(' x' || extension, '');
end
$$;

revoke all on function app.format_phone(text) from public, anon, authenticated, service_role, app_api;

update app.counterparties set phone = app.format_phone(phone)
  where phone is distinct from app.format_phone(phone);
update app.counterparty_contacts set phone = app.format_phone(phone)
  where phone is distinct from app.format_phone(phone);
