-- The same file may be imported again (Codex's fourth review of ivanmueller/gss#88).
--
-- An import recorded its file's checksum as unique per organization, so the same content could
-- never be imported twice (20261027030100_counterparty_directory.sql). Since then every import
-- matches its file against the list under the organization's import lock
-- (20261030080000_counterparty_import_lock.sql) and writes only what the list lacks, and one
-- with nothing new writes nothing and records nothing. A repeated file is therefore already
-- harmless, while the unique checksum kept a file from finishing what an earlier import of it
-- skipped: a location for a company that was archived then, and restored since. The checksum
-- stays on each import as its record.

alter table app.import_batches
  drop constraint import_batches_organization_id_kind_content_sha256_key;

comment on column app.import_batches.content_sha256 is
  'SHA-256 of the validated rows, as a record of the file imported; the same file may be imported again, adding only what the list lacks.';
