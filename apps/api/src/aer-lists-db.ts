import type { AerLicenceLocation, AtsLsd } from '@grain/domain';
import type postgres from 'postgres';

import type { PetroleumContext } from './petroleum-db';

/**
 * The AER's daily lists in the oil and gas database (F-243 part 1;
 * 20261120010000_petro_aer_daily_lists.sql). The scheduled job writes as itself (`petro.job`, no
 * member); members read. Row level security decides both.
 */

export type AerReport = 'st1' | 'st49';

/** What the capture step recorded for one fetched file (F-243-1-D2-04: before any reading). */
export interface AerCapture {
  fileId: string;
  newFile: boolean;
  newEdition: boolean;
}

export interface AerStoredFile {
  id: string;
  report: AerReport;
  body: string;
}

export interface AerLicenceRow {
  lineNo: number;
  licenceNumber: string;
  wellName: string;
  mineralRights: string;
  groundElevation: string;
  uwi: string;
  surfaceOffsets: string;
  fieldCentre: string;
  projectedDepth: string;
  classification: string;
  field: string;
  terminatingZone: string;
  drillingOperation: string;
  wellPurpose: string;
  wellType: string;
  substance: string;
  licensee: string;
  surfaceLocation: string;
  location: AtsLsd;
}

export interface AerRigRow {
  lineNo: number;
  wellId: string;
  wellName: string;
  licenceNumber: string;
  contractorBaId: string;
  contractorName: string;
  rigNumber: string;
  activityLocal: string;
  activityWallTime: string;
  /** UTC, from the wall time by the platform's Alberta rule. */
  activityAt: string;
  fieldCentre: string;
  licenseeBaId: string;
  licenseeName: string;
  newProjectedDepth: string;
  activityType: string;
  bottomHole: AtsLsd;
}

/** One reading of a file, as the job stores it. */
export type AerReading =
  | { status: 'unreadable' }
  | {
      status: 'read' | 'partial';
      listDate: string;
      skipped: number;
      licences: AerLicenceRow[];
      rigs: AerRigRow[];
    };

export interface AerPoint extends AtsLsd {
  /** Null when the township grid has no such subdivision. */
  point: { longitude: number; latitude: number } | null;
}

export interface AerSourceDates {
  /** The newest list date served, or null with none. */
  latestListDate: string | null;
  /** When the newest change of this list was seen, ISO; null with none. */
  lastSeenAt: string | null;
}

export interface AerLicenceServed {
  licenceNumber: string;
  wellName: string;
  licensee: string;
  listDate: string;
  drillingOperation: string;
  substance: string;
  terminatingZone: string;
  projectedDepth: string;
  surfaceLocation: string;
  longitude: number | null;
  latitude: number | null;
}

export interface AerRigServed {
  wellId: string;
  wellName: string;
  licenceNumber: string;
  licenseeBaId: string;
  licenseeName: string;
  contractorBaId: string;
  contractorName: string;
  rigNumber: string;
  activityType: string;
  activityAt: string;
  listDate: string;
  /**
   * The licence's surface location: from the AER's list of every licence (F-282), else from the
   * stored ST1 lists; null when neither has it.
   */
  surfaceLocation: string | null;
  /**
   * 'well': the well's own surface point, from the list of every licence; 'lsd': the centre of
   * its surface legal subdivision, from ST1; null when unplaced.
   */
  place: 'well' | 'lsd' | null;
  longitude: number | null;
  latitude: number | null;
}

/** The most features a route returns; one more is read to tell the caller there were more. */
export const AER_MAX_FEATURES = 5000;

export interface AerListsDatabase {
  /**
   * Job: stores the file once and records an edition when the address's contents changed since
   * its latest edition; `fetchedAt` orders editions, and a fetch older than the latest edition
   * records none (F-243-1-R4-02).
   */
  aerCapture(
    report: AerReport,
    sourceUrl: string,
    body: string,
    sha256: string,
    fetchedAt: Date,
  ): Promise<AerCapture>;
  /**
   * Job: files with no reading at `readerVersion`, those named in `first` first, then the newest
   * stored, at most `limit`.
   */
  aerFilesToRead(readerVersion: number, first: string[], limit: number): Promise<AerStoredFile[]>;
  /**
   * Job: stores a reading and its rows in one transaction; 'exists' when another run read the
   * file at this version first. A database refusal throws (the caller stores it unreadable).
   */
  aerStoreReading(
    fileId: string,
    readerVersion: number,
    reading: AerReading,
  ): Promise<'stored' | 'exists'>;
  /**
   * Job: the subdivisions of served licences without a point at `version`, or not found at it
   * for a week.
   */
  aerSubdivisionsToLocate(limit: number, version: number): Promise<AtsLsd[]>;
  /** Job: stores the grid's answers at `version` (a not-found one replaced once a week old). */
  aerStorePoints(points: AerPoint[], version: number): Promise<void>;
  /** Members: served licences on lists dated `since` or later, newest first. */
  aerLicences(
    ctx: PetroleumContext,
    since: string,
  ): Promise<{ rows: AerLicenceServed[]; dates: AerSourceDates }>;
  /**
   * Members: served rig activity on lists dated `since` or later, newest first, and the list
   * dates held in that period.
   */
  aerRigs(
    ctx: PetroleumContext,
    since: string,
  ): Promise<{ rows: AerRigServed[]; dates: AerSourceDates; listDates: string[] }>;
  /** Job (F-282): the months ('2026-09') of the AER's rig archives already kept. */
  aerArchiveMonthsKept(): Promise<string[]>;
  /**
   * Job (F-282): the licences of rig activity on lists dated `since` or later with no location
   * yet, or not found for a week, at most `limit`.
   */
  aerLicencesToLocate(since: string, limit: number): Promise<string[]>;
  /**
   * Job (F-282): stores the locations found and the licences not found in the list; a licence
   * not found a week ago is replaced, any other kept as it is.
   */
  aerStoreLicenceLocations(found: AerLicenceLocation[], missing: string[]): Promise<void>;
}

const STATEMENT_TIMEOUT = '20s';

/** Runs `fn` as the AER job: its name set for this transaction, no member. */
async function asJob<T>(
  sql: postgres.Sql,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true),
                    set_config('petro.job', 'aer_lists', true)`;
    return fn(tx);
  })) as T;
}

async function asMember<T>(
  sql: postgres.Sql,
  ctx: PetroleumContext,
  fn: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return (await sql.begin(async (tx) => {
    await tx`select set_config('statement_timeout', '10s', true),
                    set_config('petro.user_id', ${ctx.userId}, true),
                    set_config('petro.organization_id', ${ctx.organizationId}, true),
                    set_config('petro.member_role', ${ctx.role}, true),
                    set_config('petro.request_id', ${ctx.requestId}, true)`;
    return fn(tx);
  })) as T;
}

async function sourceDates(
  tx: postgres.TransactionSql,
  report: AerReport,
): Promise<AerSourceDates> {
  const [row] = await tx<{ latest: string | null; seen: Date | null }[]>`
    select (select max(list_date)::text from petro.aer_served_reads where report = ${report})
             as latest,
           (select max(e.seen_at) from petro.aer_list_editions e
              join petro.aer_list_files f on f.id = e.file_id where f.report = ${report}) as seen`;
  return { latestListDate: row?.latest ?? null, lastSeenAt: row?.seen?.toISOString() ?? null };
}

/** The AER queries over an existing connection. */
export function aerListsQueries(sql: postgres.Sql): AerListsDatabase {
  return {
    aerCapture(report, sourceUrl, body, sha256, fetchedAt) {
      return asJob(sql, async (tx) => {
        // One run at a time per address, so a change is recorded once (F-243-1-D2-05); the
        // edition trigger takes the same lock.
        await tx`select pg_advisory_xact_lock(
                   hashtextextended('petro.aer_list_editions:' || ${sourceUrl}, 0))`;
        const inserted = await tx<{ id: string }[]>`
          insert into petro.aer_list_files (report, body, body_sha256)
          values (${report}, ${body}, ${sha256})
          on conflict (report, body_sha256) do nothing
          returning id`;
        const [file] =
          inserted.length > 0
            ? inserted
            : await tx<{ id: string }[]>`
                select id from petro.aer_list_files
                where report = ${report} and body_sha256 = ${sha256}`;
        if (!file) throw new Error('AER list file was not stored');
        const [latest] = await tx<{ file_id: string; seen_at: Date }[]>`
          select file_id, seen_at from petro.aer_list_editions where source_url = ${sourceUrl}
          order by seen_at desc, id desc limit 1`;
        // A fetch made before the address's latest edition is older news: no edition.
        const newEdition =
          latest === undefined ||
          (latest.file_id !== file.id && fetchedAt.getTime() > latest.seen_at.getTime());
        if (newEdition) {
          await tx`insert into petro.aer_list_editions (file_id, source_url, seen_at)
                   values (${file.id}, ${sourceUrl}, ${fetchedAt})`;
        }
        return { fileId: file.id, newFile: inserted.length > 0, newEdition };
      });
    },

    aerFilesToRead(readerVersion, first, limit) {
      return asJob(sql, (tx) =>
        tx<AerStoredFile[]>`
          select f.id, f.report, f.body from petro.aer_list_files f
          where not exists (select 1 from petro.aer_list_reads r
                            where r.file_id = f.id and r.reader_version = ${readerVersion})
          order by (f.id::text in (select jsonb_array_elements_text(${tx.json(first)}::jsonb)))
                     desc, f.stored_at desc, f.id
          limit ${limit}`.then((rows) => [...rows]),
      );
    },

    aerStoreReading(fileId, readerVersion, reading) {
      return asJob(sql, async (tx) => {
        const rowsRead =
          reading.status === 'unreadable' ? 0 : reading.licences.length + reading.rigs.length;
        const skipped = reading.status === 'unreadable' ? 0 : reading.skipped;
        const listDate = reading.status === 'unreadable' ? null : reading.listDate;
        const [read] = await tx<{ id: string }[]>`
          insert into petro.aer_list_reads (file_id, reader_version, status, list_date, rows_read,
            rows_skipped)
          values (${fileId}, ${readerVersion}, ${reading.status}, ${listDate}, ${rowsRead},
            ${skipped})
          on conflict (file_id, reader_version) do nothing
          returning id`;
        if (!read) return 'exists';
        if (reading.status === 'unreadable') return 'stored';
        // Rows go as JSON: the Worker's connection does not fetch types (the repository's way).
        if (reading.licences.length > 0) {
          await tx`
            insert into petro.aer_licences (read_id, line_no, licence_number, well_name,
              mineral_rights, ground_elevation, uwi, surface_offsets, field_centre,
              projected_depth, classification, field, terminating_zone, drilling_operation,
              well_purpose, well_type, substance, licensee, surface_location, lsd, section,
              township, range, meridian)
            select ${read.id}::uuid, x.line_no, x.licence_number, x.well_name, x.mineral_rights,
              x.ground_elevation, x.uwi, x.surface_offsets, x.field_centre, x.projected_depth,
              x.classification, x.field, x.terminating_zone, x.drilling_operation,
              x.well_purpose, x.well_type, x.substance, x.licensee, x.surface_location, x.lsd,
              x.section, x.township, x.range, x.meridian
            from jsonb_to_recordset(${tx.json(
              reading.licences.map((l) => ({
                line_no: l.lineNo,
                licence_number: l.licenceNumber,
                well_name: l.wellName,
                mineral_rights: l.mineralRights,
                ground_elevation: l.groundElevation,
                uwi: l.uwi,
                surface_offsets: l.surfaceOffsets,
                field_centre: l.fieldCentre,
                projected_depth: l.projectedDepth,
                classification: l.classification,
                field: l.field,
                terminating_zone: l.terminatingZone,
                drilling_operation: l.drillingOperation,
                well_purpose: l.wellPurpose,
                well_type: l.wellType,
                substance: l.substance,
                licensee: l.licensee,
                surface_location: l.surfaceLocation,
                lsd: l.location.lsd,
                section: l.location.section,
                township: l.location.township,
                range: l.location.range,
                meridian: l.location.meridian,
              })),
            )}::jsonb) as x(line_no int, licence_number text, well_name text,
              mineral_rights text, ground_elevation text, uwi text, surface_offsets text,
              field_centre text, projected_depth text, classification text, field text,
              terminating_zone text, drilling_operation text, well_purpose text, well_type text,
              substance text, licensee text, surface_location text, lsd smallint,
              section smallint, township smallint, range smallint, meridian smallint)`;
        }
        if (reading.rigs.length > 0) {
          await tx`
            insert into petro.aer_rig_activities (read_id, line_no, well_id, well_name,
              licence_number, contractor_ba_id, contractor_name, rig_number, activity_local,
              activity_wall_time, activity_at, field_centre, licensee_ba_id, licensee_name,
              new_projected_depth, activity_type, bottom_lsd, bottom_section, bottom_township,
              bottom_range, bottom_meridian)
            select ${read.id}::uuid, x.line_no, x.well_id, x.well_name, x.licence_number,
              x.contractor_ba_id, x.contractor_name, x.rig_number, x.activity_local,
              x.activity_wall_time, x.activity_at, x.field_centre, x.licensee_ba_id,
              x.licensee_name, x.new_projected_depth, x.activity_type, x.bottom_lsd,
              x.bottom_section, x.bottom_township, x.bottom_range, x.bottom_meridian
            from jsonb_to_recordset(${tx.json(
              reading.rigs.map((r) => ({
                line_no: r.lineNo,
                well_id: r.wellId,
                well_name: r.wellName,
                licence_number: r.licenceNumber,
                contractor_ba_id: r.contractorBaId,
                contractor_name: r.contractorName,
                rig_number: r.rigNumber,
                activity_local: r.activityLocal,
                activity_wall_time: r.activityWallTime,
                activity_at: r.activityAt,
                field_centre: r.fieldCentre,
                licensee_ba_id: r.licenseeBaId,
                licensee_name: r.licenseeName,
                new_projected_depth: r.newProjectedDepth,
                activity_type: r.activityType,
                bottom_lsd: r.bottomHole.lsd,
                bottom_section: r.bottomHole.section,
                bottom_township: r.bottomHole.township,
                bottom_range: r.bottomHole.range,
                bottom_meridian: r.bottomHole.meridian,
              })),
            )}::jsonb) as x(line_no int, well_id text, well_name text, licence_number text,
              contractor_ba_id text, contractor_name text, rig_number text, activity_local text,
              activity_wall_time text, activity_at timestamptz, field_centre text,
              licensee_ba_id text, licensee_name text, new_projected_depth text,
              activity_type text, bottom_lsd smallint, bottom_section smallint,
              bottom_township smallint, bottom_range smallint, bottom_meridian smallint)`;
        }
        return 'stored';
      });
    },

    aerSubdivisionsToLocate(limit, version) {
      return asJob(sql, (tx) =>
        tx<AtsLsd[]>`
          select distinct l.lsd, l.section, l.township, l.range, l.meridian
          from petro.aer_served_licences l
          left join petro.ats_lsd_points p
            on (p.meridian, p.range, p.township, p.section, p.lsd)
             = (l.meridian, l.range, l.township, l.section, l.lsd)
            and p.placement_version = ${version}
          where p.meridian is null
             or (not p.found and p.tried_at < now() - interval '7 days')
          order by l.meridian, l.range, l.township, l.section, l.lsd
          limit ${limit}`.then((rows) => [...rows]),
      );
    },

    async aerStorePoints(points, version) {
      if (points.length === 0) return;
      await asJob(sql, async (tx) => {
        await tx`
          insert into petro.ats_lsd_points (meridian, range, township, section, lsd, longitude,
            latitude, found, placement_version)
          select x.meridian, x.range, x.township, x.section, x.lsd, x.longitude, x.latitude,
            x.found, ${version}::int
          from jsonb_to_recordset(${tx.json(
            points.map((p) => ({
              meridian: p.meridian,
              range: p.range,
              township: p.township,
              section: p.section,
              lsd: p.lsd,
              longitude: p.point?.longitude ?? null,
              latitude: p.point?.latitude ?? null,
              found: p.point !== null,
            })),
          )}::jsonb) as x(meridian smallint, range smallint, township smallint,
            section smallint, lsd smallint, longitude numeric, latitude numeric, found boolean)
          on conflict (meridian, range, township, section, lsd, placement_version) do update
            set longitude = excluded.longitude, latitude = excluded.latitude,
                found = excluded.found, tried_at = now(),
                attempts = petro.ats_lsd_points.attempts + 1
            where not petro.ats_lsd_points.found
              and petro.ats_lsd_points.tried_at < now() - interval '7 days'`;
      });
    },

    aerLicences(ctx, since) {
      return asMember(sql, ctx, async (tx) => {
        const rows = await tx<AerLicenceServed[]>`
          select l.licence_number as "licenceNumber", l.well_name as "wellName", l.licensee,
                 l.list_date::text as "listDate", l.drilling_operation as "drillingOperation",
                 l.substance, l.terminating_zone as "terminatingZone",
                 l.projected_depth as "projectedDepth", l.surface_location as "surfaceLocation",
                 p.longitude::float8 as longitude, p.latitude::float8 as latitude
          from petro.aer_served_licences l
          left join petro.ats_lsd_current_points p
            on (p.meridian, p.range, p.township, p.section, p.lsd)
             = (l.meridian, l.range, l.township, l.section, l.lsd)
          where l.list_date >= ${since}::date
          order by l.list_date desc, l.licence_number
          limit ${AER_MAX_FEATURES + 1}`;
        return { rows: [...rows], dates: await sourceDates(tx, 'st1') };
      });
    },

    aerRigs(ctx, since) {
      return asMember(sql, ctx, async (tx) => {
        const rows = await tx<(Omit<AerRigServed, 'activityAt'> & { activityAt: Date })[]>`
          with served as (
            select read_id, list_date, seen_at from petro.aer_served_reads
            where report = 'st49' and list_date >= ${since}::date
          ), acts as (
            select distinct on (a.well_id, a.activity_wall_time, a.activity_type)
                   a.*, s.list_date
            from petro.aer_rig_activities a join served s on s.read_id = a.read_id
            order by a.well_id, a.activity_wall_time, a.activity_type, s.list_date desc,
                     s.seen_at desc, a.line_no
          )
          select a.well_id as "wellId", a.well_name as "wellName",
                 a.licence_number as "licenceNumber", a.licensee_ba_id as "licenseeBaId",
                 a.licensee_name as "licenseeName", a.contractor_ba_id as "contractorBaId",
                 a.contractor_name as "contractorName", a.rig_number as "rigNumber",
                 a.activity_type as "activityType", a.activity_at as "activityAt",
                 a.list_date::text as "listDate",
                 coalesce(w.surface_location, l.surface_location) as "surfaceLocation",
                 case when w.found then 'well' when p.longitude is not null then 'lsd' end
                   as place,
                 coalesce(w.longitude, p.longitude)::float8 as longitude,
                 coalesce(w.latitude, p.latitude)::float8 as latitude
          from acts a
          left join petro.aer_licence_locations w
            on w.licence_number = a.licence_number and w.found
          left join petro.aer_served_licences l on l.licence_number = a.licence_number
          left join petro.ats_lsd_current_points p
            on (p.meridian, p.range, p.township, p.section, p.lsd)
             = (l.meridian, l.range, l.township, l.section, l.lsd)
          order by a.activity_at desc, a.well_id, a.activity_type
          limit ${AER_MAX_FEATURES + 1}`;
        const days = await tx<{ list_date: string }[]>`
          select distinct list_date::text as list_date from petro.aer_served_reads
          where report = 'st49' and list_date >= ${since}::date
          order by list_date`;
        return {
          rows: rows.map((row) => ({ ...row, activityAt: row.activityAt.toISOString() })),
          dates: await sourceDates(tx, 'st49'),
          listDates: days.map((d) => d.list_date),
        };
      });
    },

    aerArchiveMonthsKept() {
      return asJob(sql, async (tx) => {
        const rows = await tx<{ month: string }[]>`
          select distinct substring(source_url from 'spud([0-9]{4}-[0-9]{2})[.]zip#') as month
          from petro.aer_list_editions
          where source_url like 'https://static.aer.ca/prd/data/wells/spud%.zip#%'
          order by month`;
        return rows.map((r) => r.month);
      });
    },

    aerLicencesToLocate(since, limit) {
      return asJob(sql, async (tx) => {
        const rows = await tx<{ licence_number: string }[]>`
          select distinct a.licence_number
          from petro.aer_rig_activities a
          join petro.aer_served_reads s
            on s.read_id = a.read_id and s.report = 'st49' and s.list_date >= ${since}::date
          left join petro.aer_licence_locations w on w.licence_number = a.licence_number
          where w.licence_number is null
             or (not w.found and w.tried_at < now() - interval '7 days')
          order by a.licence_number
          limit ${limit}`;
        return rows.map((r) => r.licence_number);
      });
    },

    async aerStoreLicenceLocations(found, missing) {
      if (found.length === 0 && missing.length === 0) return;
      await asJob(sql, async (tx) => {
        const rows = [
          ...found.map((f) => ({
            licence_number: f.licenceNumber,
            found: true,
            surface_location: f.surfaceLocation,
            licensee: f.licensee,
            licence_status: f.status,
            longitude: f.longitude,
            latitude: f.latitude,
          })),
          ...missing.map((licence) => ({
            licence_number: licence,
            found: false,
            surface_location: null,
            licensee: null,
            licence_status: null,
            longitude: null,
            latitude: null,
          })),
        ];
        // Rows go as JSON: the Worker's connection does not fetch types (the repository's way).
        await tx`
          insert into petro.aer_licence_locations (licence_number, found, surface_location,
            licensee, licence_status, longitude, latitude)
          select x.licence_number, x.found, x.surface_location, x.licensee, x.licence_status,
            x.longitude, x.latitude
          from jsonb_to_recordset(${tx.json(rows)}::jsonb) as x(licence_number text,
            found boolean, surface_location text, licensee text, licence_status text,
            longitude numeric, latitude numeric)
          on conflict (licence_number) do update
            set found = excluded.found, surface_location = excluded.surface_location,
                licensee = excluded.licensee, licence_status = excluded.licence_status,
                longitude = excluded.longitude, latitude = excluded.latitude,
                tried_at = now(), attempts = petro.aer_licence_locations.attempts + 1
            where not petro.aer_licence_locations.found
              and petro.aer_licence_locations.tried_at < now() - interval '7 days'`;
      });
    },
  };
}
