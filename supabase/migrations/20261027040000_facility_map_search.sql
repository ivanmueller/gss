-- Map viewport search (GT-022), MASTER_PROJECT_SPECIFICATION.md section 8: the API asks
-- for the facilities inside the map's visible box, filtered by PostGIS on the server.
--
-- app_api has no access to the extensions schema where PostGIS lives, and gets none here.
-- Instead this function's body is standard SQL (`return ...`, not a quoted string), which
-- Postgres resolves when the migration runs, as the migration's owner. Calling it then
-- needs only execute on this function (and on the PostGIS functions inside, which Postgres
-- grants to everyone by default). For the same reason it needs no `set search_path`; a
-- SET clause would also stop Postgres from inlining it into the API's query.
--
-- The box is planar in longitude and latitude, as a web map's viewport is: a point is
-- inside when west <= longitude <= east and south <= latitude <= north, edges included.
-- ST_Intersects is exact; the bare && operator compares single-precision boxes and lets
-- in points up to about a metre outside. The API refuses boxes without an area and boxes
-- that cross the antimeridian (it requires west < east and south < north). The function
-- reads no table, so row level security on app.facilities still decides which rows the
-- API sees.
create function app.location_in_bbox(
  location extensions.geography,
  west double precision,
  south double precision,
  east double precision,
  north double precision
)
returns boolean
language sql
immutable
strict
parallel safe
return extensions.st_intersects(
  location::extensions.geometry,
  extensions.st_makeenvelope(west, south, east, north, 4326)
);

revoke all on function app.location_in_bbox(
  extensions.geography, double precision, double precision, double precision, double precision
) from public, anon, authenticated, service_role;
grant execute on function app.location_in_bbox(
  extensions.geography, double precision, double precision, double precision, double precision
) to app_api;
