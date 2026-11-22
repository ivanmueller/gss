-- The layers of the ground around the wells (F-261 part 2,
-- 20261130010000_petro_formation_cells.sql): members read, nobody but the database's owner (the
-- manual load) writes. One transaction, rolled back. Synthetic data only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(14);

select ok((select petro.schema_version()) >= 13, 'the schema is at version 13 or later');
select ok(
  has_table_privilege('petro_api', 'petro.formation_cells', 'select')
  and has_table_privilege('petro_api', 'petro.formation_loads', 'select'),
  'petro_api reads the cells and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.formation_cells', 'petro.formation_loads']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the manual load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.formation_cells', 'petro.formation_loads']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the layers'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.formation_cells'::regclass, 'petro.formation_loads'::regclass)),
  'row level security is on'
);

-- The owner (the manual load) writes: two cells, the second without the Duvernay (zone 68).
insert into petro.formation_loads (source_url, source_date, model, lon_step, lat_step, cells)
values ('https://example.blob.core.windows.net/x/Modelled%20elevation%20surfaces.zip',
        '2026-11-02', 'Geological Framework of Alberta, Version 4', 0.016, 0.009, 2);
insert into petro.formation_cells (cell_x, cell_y, tops, bases)
select -7306, 6043,
       array_agg(case n when 1 then 840 when 68 then -2252 when 90 then -2722 end order by n)::smallint[],
       array_agg(case n when 1 then 830 when 68 then -2310 when 90 then -6000 end order by n)::smallint[]
from generate_series(1, 90) n;
insert into petro.formation_cells (cell_x, cell_y, tops, bases)
select -7305, 6043,
       array_agg(case n when 1 then 838 when 90 then -2700 end order by n)::smallint[],
       array_agg(case n when 1 then 829 when 90 then -6000 end order by n)::smallint[]
from generate_series(1, 90) n;

select is(
  (select tops[68]::text || ' ' || bases[68]::text from petro.formation_cells where cell_x = -7306),
  '-2252 -2310',
  'a cell keeps a zone''s top and base'
);
select is(
  (select count(*)::int from petro.formation_cells where tops[68] is null),
  1,
  'a zone absent under a cell is null there'
);
select throws_ok(
  $$insert into petro.formation_cells (cell_x, cell_y, tops, bases)
    values (1, 1, array[1, 2]::smallint[], array[0, 1]::smallint[])$$,
  '23514', null, 'a cell holds one value for each of the 90 zones'
);
select throws_ok(
  $$insert into petro.formation_cells (cell_x, cell_y, tops, bases)
    select -7306, 6043, array_agg(null::smallint), array_agg(null::smallint)
    from generate_series(1, 90)$$,
  '23505', null, 'a cell is kept once'
);
select throws_ok(
  $$insert into petro.formation_loads (source_url, model, lon_step, lat_step, cells)
    values ('ftp://example.test/x', 'm', 0.016, 0.009, 0)$$,
  '23514', null, 'a load names a web address'
);

grant petro_api to current_user;

create function pg_temp.as_petro(query text) returns text
language plpgsql as $fn$
declare
  result text;
begin
  set local role petro_api;
  execute query into result;
  reset role;
  return result;
end
$fn$;

create function pg_temp.be(usr text, org text, member_role text, job text) returns void
language sql as $fn$
  select set_config('petro.user_id', usr, true),
         set_config('petro.organization_id', org, true),
         set_config('petro.member_role', member_role, true),
         set_config('petro.job', job, true);
$fn$;

-- A member reads; without a member nothing is read; nobody writes as petro_api.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.formation_cells'),
  '2',
  'a member reads the cells'
);
select is(
  pg_temp.as_petro('select model from petro.formation_loads order by id desc limit 1'),
  'Geological Framework of Alberta, Version 4',
  'a member reads the load'
);
select throws_ok(
  $$select pg_temp.as_petro('delete from petro.formation_cells')$$,
  '42501', null, 'a member cannot remove a cell'
);
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select count(*)::text from petro.formation_cells'),
  '0',
  'without a member no cell is read'
);

select * from finish();
rollback;
