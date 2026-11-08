-- A publisher's filter on a map layer takes only plain quoting (Codex's re-reviews of 1a5f81c and
-- 813c5b6, F-138). 20261108020000_map_layer_arcgis_maps.sql (merged) checked that a filter's
-- parentheses and single quotes balance, so wrapped in parentheses it stays one condition and
-- cannot undo the layer's own limit. Other quoting hides parentheses from that check on a service
-- taking its database's own SQL: PostgreSQL's $$…$$, double-quoted names, backslash escapes,
-- brackets, backticks, and quotes opened right after a letter (Oracle's q'!…!', N'…', E'…').
--
-- Now a new filter holds only ASCII letters and digits, spaces, _ ' ( ) , . = < > ! + * / % : -
-- and characters from U+00A0 up (accented letters in values), checked by code point whatever the
-- database's locale; and a quote may not open right after a letter, digit or underscore. The
-- same checks as DEFINITION_EXPRESSION and balancedFilter in @grain/domain (app.plain_filter).
--
-- Checked when a layer is added, by a trigger, not by re-checking every row (Codex's re-review of
-- 7d0382e): a filter kept before this, such as NAME = N'Québec', would otherwise stop this
-- migration, or any later change to its layer, including removing it. A filter is never changed
-- after it is added (app_api has no update grant on it). A kept filter that fails these checks is
-- never sent: the Worker's whereOf asks its service for nothing (1=0) instead. app.balanced_filter,
-- which the merged check calls, is left as it was, so that check keeps its meaning; this
-- stricter one is app.plain_filter.

create function app.plain_filter(filter text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  depth int := 0;
  quoted boolean := false;
  i int := 1;
  c text;
begin
  while i <= length(filter) loop
    c := substr(filter, i, 1);
    if quoted then
      if c = '''' then
        if substr(filter, i + 1, 1) = '''' then
          i := i + 1;
        else
          quoted := false;
        end if;
      end if;
    elsif c = '''' then
      -- A quote opened right after a letter, digit or underscore is another kind of quoting.
      if i > 1 and substr(filter, i - 1, 1) ~ '[A-Za-z0-9_]' then
        return false;
      end if;
      quoted := true;
    elsif c = '(' then
      depth := depth + 1;
    elsif c = ')' then
      depth := depth - 1;
      if depth < 0 then
        return false;
      end if;
    end if;
    i := i + 1;
  end loop;
  return depth = 0 and not quoted;
end
$$;

revoke all on function app.plain_filter(text) from public, anon, authenticated, service_role;
grant execute on function app.plain_filter(text) to app_api;

create function app.check_map_layer_filter()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.definition_expression is not null and not (
    length(new.definition_expression) between 1 and 2000
    and new.definition_expression ~ ('^[A-Za-z0-9_ ''(),.=<>!+*/%:' || chr(160) || '-' || chr(1114111) || '-]+$')
    and position('--' in new.definition_expression) = 0
    and position('/*' in new.definition_expression) = 0
    and app.plain_filter(new.definition_expression)
  ) then
    raise exception 'A map layer''s filter takes only plain quoting'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger map_layers_filter_check
  before insert or update of definition_expression on app.map_layers
  for each row execute function app.check_map_layer_filter();

revoke all on function app.check_map_layer_filter() from public, anon, authenticated, service_role, app_api;
