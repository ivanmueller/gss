-- A publisher's filter on a map layer takes only plain quoting (Codex's re-reviews of 1a5f81c and
-- 813c5b6, F-138). 20261108020000_map_layer_arcgis_maps.sql (merged) checked that a filter's
-- parentheses and single quotes balance, so wrapped in parentheses it stays one condition and
-- cannot undo the layer's own limit. Other quoting hides parentheses from that check on a service
-- taking its database's own SQL: PostgreSQL's $$…$$, double-quoted names, backslash escapes,
-- brackets, backticks, and quotes opened right after a letter (Oracle's q'!…!', N'…', E'…').
--
-- Now a filter holds only ASCII letters and digits, spaces, _ ' ( ) , . = < > ! + * / % : - and
-- characters from U+00A0 up (accented letters in values), checked by code point whatever the
-- database's locale; and a quote may not open right after a letter, digit or underscore. The
-- same checks as DEFINITION_EXPRESSION and balancedFilter in @grain/domain.

create or replace function app.balanced_filter(filter text)
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

revoke all on function app.balanced_filter(text) from public, anon, authenticated, service_role;
grant execute on function app.balanced_filter(text) to app_api;

alter table app.map_layers
  drop constraint map_layers_definition_expression_check,
  add constraint map_layers_definition_expression_check check (
    length(definition_expression) between 1 and 2000
    and definition_expression ~ '^[A-Za-z0-9_ ''(),.=<>!+*/%: -\U0010ffff-]+$'
    and position('--' in definition_expression) = 0
    and position('/*' in definition_expression) = 0
    and app.balanced_filter(definition_expression)
  );
