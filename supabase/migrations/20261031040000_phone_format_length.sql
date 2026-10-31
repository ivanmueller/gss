-- A formatted phone never longer than a phone may be (Codex's review of ivanmueller/gss#95).
--
-- app.format_phone (20261031020000_phone_format.sql) could turn a valid 40-character number
-- with a long extension into a longer one, which the phone check refuses. It now keeps such a
-- number as written, as formatPhone in the app does. The phones it tidied are unaffected:
-- staging applied it without such a number.

create or replace function app.format_phone(phone text)
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
  formatted text;
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
  formatted := '(' || substr(digits, 1, 3) || ') ' || substr(digits, 4, 3) || '-'
    || substr(digits, 7) || coalesce(' x' || extension, '');
  return case when length(formatted) > 40 then phone else formatted end;
end
$$;

revoke all on function app.format_phone(text) from public, anon, authenticated, service_role, app_api;
