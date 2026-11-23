import {
  decodeParts,
  encodeParts,
  isTile,
  PIPELINE_LEVELS,
  pipelineLevelOfSquare,
  squareInAlberta,
  thinParts,
  tileBounds,
  type PipelineLevel,
  type Tile,
} from '@grain/domain';

import type { PipelineLineRow, PipelineLoad, PipelineSegmentRow } from './petro-pipelines-db';

/** The Worker's pipelines routes need this oil and gas schema (20261203010000). */
export const PIPELINES_SCHEMA_VERSION = 16;

/** The most segments one square answers with, the largest first; `truncated` beyond. */
export const PIPELINE_SQUARE_MAX = 20_000;

/** A square of the map the pipelines are asked for in, with its level; null for any other. */
export function parsePipelineSquare(
  z: string,
  x: string,
  y: string,
): { level: PipelineLevel; tile: Tile } | null {
  const plain = /^\d{1,6}$/;
  if (![z, x, y].every((part) => plain.test(part))) return null;
  const tile = { z: Number(z), x: Number(x), y: Number(y) };
  if (!isTile(tile)) return null;
  const level = pipelineLevelOfSquare(tile);
  return level !== null && squareInAlberta(tile) ? { level, tile } : null;
}

/** A segment's row id, as the panel asks for it; null for anything else. */
export function parsePipelineId(raw: string | undefined): string | null {
  return raw !== undefined && /^[1-9]\d{0,11}$/.test(raw) ? raw : null;
}

/**
 * One segment in a square's answer, as a short list to keep the answer small: its row id, its
 * licence and line ("58864-2"), indexes into the answer's lists of statuses, substances and
 * companies (-1 for none), its outside diameter in millimetres, and its line as the database
 * keeps it (points in hundred-thousandths of a degree, and where each new part starts).
 */
export type PipelineTuple = [
  id: number,
  line: string,
  status: number,
  substance: number,
  licensee: number,
  diameterMm: number | null,
  path: number[],
  breaks: number[],
];

export interface PipelineSquareAnswer {
  load: PipelineLoad | null;
  level: PipelineLevel;
  truncated: boolean;
  statuses: (string | null)[];
  substances: (string | null)[];
  companies: { code: string | null; name: string | null }[];
  lines: PipelineTuple[];
}

/** The box a square covers, for the database's search. */
export function pipelineSquareBox(tile: Tile) {
  return tileBounds(tile);
}

/**
 * Builds a square's answer: each status, substance and company written once and pointed to; at
 * the large lines' level each line thinned further, as the map draws them from farther out.
 */
export function pipelineSquareAnswer(
  level: PipelineLevel,
  load: PipelineLoad | null,
  rows: readonly PipelineLineRow[],
  limit = PIPELINE_SQUARE_MAX,
): PipelineSquareAnswer {
  const statuses: (string | null)[] = [];
  const substances: (string | null)[] = [];
  const companies: PipelineSquareAnswer['companies'] = [];
  const indexOf = <T>(list: T[], at: Map<string, number>, key: string, value: T) => {
    let found = at.get(key);
    if (found === undefined) {
      found = list.push(value) - 1;
      at.set(key, found);
    }
    return found;
  };
  const statusAt = new Map<string, number>();
  const substanceAt = new Map<string, number>();
  const companyAt = new Map<string, number>();
  const metres = PIPELINE_LEVELS[level].simplifyM;

  const lines: PipelineTuple[] = [];
  for (const r of rows.slice(0, limit)) {
    let { path, breaks } = r;
    if (metres > 0) {
      const thin = encodeParts(thinParts(decodeParts(path, breaks), metres));
      if (thin.path.length < 4) continue;
      ({ path, breaks } = thin);
    }
    lines.push([
      Number(r.id),
      r.line_number === null ? r.licence_number : `${r.licence_number}-${r.line_number}`,
      indexOf(statuses, statusAt, r.status ?? '', r.status),
      indexOf(substances, substanceAt, r.substance ?? '', r.substance),
      r.licensee_code === null && r.licensee === null
        ? -1
        : indexOf(companies, companyAt, `${r.licensee_code ?? ''}|${r.licensee ?? ''}`, {
            code: r.licensee_code,
            name: r.licensee,
          }),
      r.diameter_mm,
      path,
      breaks,
    ]);
  }
  return {
    load,
    level,
    truncated: rows.length > limit,
    statuses,
    substances,
    companies,
    lines,
  };
}

/** One segment's panel, every column the loader keeps. */
export interface PipelineSegmentAnswer {
  id: number;
  segmentId: string | null;
  licence: string;
  line: string | null;
  federal: boolean;
  licensee: { code: string | null; name: string | null } | null;
  status: string | null;
  substances: string[];
  from: { facility: string | null; location: string | null };
  to: { facility: string | null; location: string | null };
  lengthKm: string | null;
  diameterMm: string | null;
  wallMm: string | null;
  material: string | null;
  pipeType: string | null;
  pipeGrade: string | null;
  maxPressure: string | null;
  h2s: string | null;
  fieldCentre: string | null;
  licenceApproved: string | null;
  lastOccurrenceYear: number | null;
  geometrySource: string | null;
  bounds: [number, number, number, number];
}

/** Numbers as the database writes them, without trailing zeros ("508.00" reads "508"). */
function plain(value: string | null): string | null {
  if (value === null) return null;
  return value.includes('.') ? value.replace(/\.?0+$/, '') : value;
}

export function pipelineSegmentAnswer(row: PipelineSegmentRow): PipelineSegmentAnswer {
  return {
    id: Number(row.id),
    segmentId: row.segment_id,
    licence: row.licence_number,
    line: row.line_number,
    federal: row.federal,
    licensee:
      row.licensee_code === null && row.licensee === null
        ? null
        : { code: row.licensee_code, name: row.licensee },
    status: row.status,
    substances: row.substances,
    from: { facility: row.from_facility, location: row.from_location },
    to: { facility: row.to_facility, location: row.to_location },
    lengthKm: plain(row.length_km),
    diameterMm: plain(row.diameter_mm),
    wallMm: plain(row.wall_mm),
    material: row.material,
    pipeType: row.pipe_type,
    pipeGrade: row.pipe_grade,
    maxPressure: plain(row.max_pressure),
    h2s: plain(row.h2s),
    fieldCentre: row.field_centre,
    licenceApproved: row.licence_approved,
    lastOccurrenceYear: row.last_occurrence_year,
    geometrySource: row.geometry_source,
    bounds: [row.west, row.south, row.east, row.north],
  };
}
