-- The import a location came from (the owner's request of 2026-10-30, docs/DECISIONS.md).
--
-- An import now also adds new locations to companies already in the list. Those companies
-- carry an earlier import's id, or none, so the import's coordinates step finds the locations
-- it added by this column: set for every location an import adds, null for one added by
-- hand. A location can only name an import of its own organization (the tenant-matching
-- key). Inserts were already granted on the whole table; nothing updates it.

alter table app.facilities
  add column import_batch_id uuid,
  add constraint facilities_import_batch_fkey foreign key (organization_id, import_batch_id)
    references app.import_batches (organization_id, id);

create index facilities_import_batch_idx on app.facilities (import_batch_id)
  where import_batch_id is not null;
