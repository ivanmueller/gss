-- Geology (F-287 part 1, 20261209010000_petro_geology.sql). Members read, nobody but the
-- database's owner (the "Load geology" workflow) writes. One transaction, rolled back. Synthetic
-- wells and samples only.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;

select plan(17);

select ok((select petro.schema_version()) >= 22, 'the schema is at version 22 or later');
select is(
  (select count(*)::int
   from unnest(array['petro.geology_loads', 'petro.formation_pick_names',
                     'petro.formation_pick_wells', 'petro.maturity_samples']) t
   where has_table_privilege('petro_api', t, 'select')),
  4,
  'petro_api reads the picks, the samples and their loads'
);
select is(
  (select count(*)::int
   from unnest(array['petro.geology_loads', 'petro.formation_pick_names',
                     'petro.formation_pick_wells', 'petro.maturity_samples']) t,
        unnest(array['insert', 'update', 'delete', 'truncate']) p
   where has_table_privilege('petro_api', t, p)),
  0,
  'petro_api writes nothing: only the load does'
);
select is(
  (select count(*)::int
   from unnest(array['public', 'anon', 'authenticated', 'service_role']) as r(name),
        unnest(array['petro.geology_loads', 'petro.formation_pick_names',
                      'petro.formation_pick_wells', 'petro.maturity_samples']) as t(name),
        unnest(array['select', 'insert', 'update', 'delete']) as p(name)
   where has_table_privilege(r.name, t.name, p.name)),
  0,
  'the Supabase API roles hold nothing on the geology'
);
select ok(
  (select bool_and(relrowsecurity) from pg_class
   where oid in ('petro.geology_loads'::regclass, 'petro.formation_pick_names'::regclass,
                 'petro.formation_pick_wells'::regclass, 'petro.maturity_samples'::regclass)),
  'row level security is on'
);

-- The owner (the load) writes.
insert into petro.geology_loads (kind, source_url, source_date, rows_loaded, skipped)
values ('picks', 'https://aercclrsuatagsgispub01.blob.core.windows.net/example.zip', '2026-10-31', 2, 0);
insert into petro.formation_pick_names (id, name, surface)
values (1, 'Ireton Formation top', '67_D_Ir_FS_Gr_G_top'), (2, 'Duvernay Formation top', '68_D_Dv_Mu_top');
insert into petro.formation_pick_wells (uwi, licence_number, longitude, latitude, kb_elevation_m,
  names, tvd_m, sources)
values ('00/11-23-030-27W4/0', '0999999', -116.5, 54.2, 812.4, '{1,2}', '{3010.5,3105.2}', '{1,2}');
insert into petro.maturity_samples (sample_id, run, uwi, site, longitude, latitude, top_depth_m,
  unit, sample_type, tmax_c, toc_pct, s2)
values (9999001, 1, '00/11-23-030-27W4/0', 'well', -116.5, 54.2, 3120.5, 'Duvernay', 'core', 448, 4.25, 6.1),
       (9999001, 2, '00/11-23-030-27W4/0', 'well', -116.5, 54.2, 3120.5, 'Duvernay', 'core', 450, 4.1, 5.9);

select is(
  (select tvd_m[2] from petro.formation_pick_wells),
  3105.2::numeric,
  'a pick''s depth is kept exactly, as a decimal'
);
select throws_ok(
  $$insert into petro.formation_pick_wells (uwi, licence_number, longitude, latitude, names, tvd_m, sources)
    values ('00/11-23-030-27W4/2', '', -116.5, 54.2, '{1,2}', '{3010.5}', '{1,2}')$$,
  '23514', null, 'a well''s three lists are of one length'
);
select throws_ok(
  $$insert into petro.formation_pick_wells (uwi, licence_number, longitude, latitude, names, tvd_m, sources)
    values ('00/11-23-030-27W4/2', '', -116.5, 54.2, '{1}', '{3010.5}', '{3}')$$,
  '23514', null, 'a pick''s source is the Survey''s, the AER''s or unknown'
);
select throws_ok(
  $$insert into petro.maturity_samples (sample_id, run, site, longitude, latitude, sample_type)
    values (9999002, 1, 'well', -116.5, 54.2, 'standard_lab')$$,
  '23514', null, 'a laboratory''s standard is not a sample of the ground'
);
select throws_ok(
  $$insert into petro.geology_loads (kind, source_url, rows_loaded, skipped)
    values ('picks', 'https://example.test/x.zip', 1, 0)$$,
  '23514', null, 'a load names the Survey''s own site'
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

create function pg_temp.try(query text) returns text
language sql as $fn$ select format('select pg_temp.as_petro(%L)', query) $fn$;

create function pg_temp.be(usr text, org text, member_role text, job text) returns void
language sql as $fn$
  select set_config('petro.user_id', usr, true),
         set_config('petro.organization_id', org, true),
         set_config('petro.member_role', member_role, true),
         set_config('petro.job', job, true);
$fn$;

-- A member reads, and writes nothing.
select pg_temp.be('00000000-0000-4000-8000-0000000000a1',
                  '00000000-0000-4000-8000-0000000000b1', 'viewer', '');
select is(pg_temp.as_petro('select count(*)::text from petro.formation_pick_wells'), '1',
          'a member reads the picked wells');
select is(pg_temp.as_petro('select count(*)::text from petro.formation_pick_names'), '2',
          'a member reads the picks'' names');
select is(pg_temp.as_petro('select count(*)::text from petro.maturity_samples'), '2',
          'a member reads the samples');
select is(pg_temp.as_petro('select count(*)::text from petro.geology_loads'), '1',
          'a member reads the loads');
select throws_ok(
  pg_temp.try('with u as (update petro.maturity_samples set tmax_c = 0 returning 1) select count(*)::text from u'),
  '42501', null, 'a member changes no sample'
);

-- Without a member, nothing is read; a job reads nothing either.
select pg_temp.be('', '', '', '');
select is(
  pg_temp.as_petro('select ((select count(*) from petro.formation_pick_wells) + (select count(*) from petro.formation_pick_names) + (select count(*) from petro.maturity_samples) + (select count(*) from petro.geology_loads))::text'),
  '0', 'without a member nothing is read');
select pg_temp.be('', '', '', 'wells');
select is(pg_temp.as_petro('select count(*)::text from petro.maturity_samples'), '0',
          'a job reads no samples');

select * from finish();
rollback;
