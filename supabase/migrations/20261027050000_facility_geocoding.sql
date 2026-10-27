-- Coordinates for facilities that have none, found by geocoding their addresses (GT-021;
-- MASTER_PROJECT_SPECIFICATION.md section 6, location governance; docs/DECISIONS.md,
-- geocoding with Geocodio).
--
-- The API looks addresses up with Geocodio, an operations or admin member reviews the
-- results, and the chosen ones are saved here. Besides the source ('geocodio') and the
-- exact/approximate precision that facilities already carry, each saved point keeps
-- Geocodio's accuracy type (e.g. rooftop, place) and its confidence score.

alter table app.facilities
  add column geocoding_accuracy app.label,
  add column geocoding_confidence numeric(3, 2)
    check (geocoding_confidence between 0 and 1),
  add constraint facilities_geocoding_needs_location
    check (latitude is not null or (geocoding_accuracy is null and geocoding_confidence is null));

-- Operations and org_admin members may fill in the location of a facility that has none.
-- Existing coordinates are never overwritten this way (using: latitude is null), and only
-- the location columns are granted below; every change is audited by the existing trigger.
create policy facilities_update_missing_location_for_editors on app.facilities
  for update to app_api
  using (app.can_edit_directory(organization_id) and latitude is null)
  with check (app.can_edit_directory(organization_id));

grant update (
  latitude, longitude, location_precision, geocoding_source, geocoding_accuracy,
  geocoding_confidence
) on app.facilities to app_api;
