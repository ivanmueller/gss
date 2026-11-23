// Facilities (F-278): the Alberta Energy Regulator's ST102 facility list, read from its shapefile
// (https://static.aer.ca/prd/data/codes/ST102-SHP.zip, ST102_Facility_GCS_NAD83.shp and .dbf) by
// the manual "Load facilities" workflow, and shown on the oil and gas map grouped by kind. The
// reader here is plain: a shapefile of points and its dBASE table, nothing else is needed.

/** The kinds of facility the map colours and filters by, from the AER's subtype codes. */
export const FACILITY_GROUPS = [
  { key: 'oil_battery', name: 'Oil batteries' },
  { key: 'gas_battery', name: 'Gas batteries' },
  { key: 'bitumen', name: 'Bitumen and oil sands' },
  { key: 'gas_plant', name: 'Gas plants' },
  { key: 'compressor', name: 'Compressor stations' },
  { key: 'gathering', name: 'Gathering and treating' },
  { key: 'meter', name: 'Meter stations and pipeline points' },
  { key: 'injection', name: 'Injection, disposal and waste' },
  { key: 'terminal', name: 'Terminals, tanks and refineries' },
  { key: 'water', name: 'Water sources' },
  { key: 'other', name: 'Other' },
] as const;
export type FacilityGroup = (typeof FACILITY_GROUPS)[number]['key'];

/**
 * A subtype's group, by the AER's codes (read from the file, 2026-11-22): 311 to 322 crude oil
 * batteries; 331 to 345 and 801 bitumen, in-situ and oil sands; 351 to 371 gas batteries; 401 to
 * 407 gas plants; 601 compressor stations; 611 to 622 custom treating and gas gathering; 631 to
 * 640 and 204 to 209 meter stations, interconnects and pipeline points; 501 to 509 and 701 to 702
 * injection, disposal, storage and waste; 651 and 671 to 675 refineries, tank farms and
 * terminals; 155 and 901 to 903 water and brine sources; anything else other (381 drilling and
 * completing, no code).
 */
export function facilityGroupOf(subCode: number | null): FacilityGroup {
  if (subCode === null) return 'other';
  const within = (from: number, to: number) => subCode >= from && subCode <= to;
  if (within(311, 322)) return 'oil_battery';
  if (within(331, 345) || subCode === 801) return 'bitumen';
  if (within(351, 371)) return 'gas_battery';
  if (within(401, 407)) return 'gas_plant';
  if (subCode === 601) return 'compressor';
  if (within(611, 622)) return 'gathering';
  if (within(631, 640) || within(204, 209)) return 'meter';
  if (within(501, 509) || within(701, 702)) return 'injection';
  if (subCode === 651 || within(671, 675)) return 'terminal';
  if (subCode === 155 || within(901, 903)) return 'water';
  return 'other';
}

/** Where a facility's point comes from, as the AER writes it. */
export const FACILITY_LOCATED = [
  'Well Licence',
  'Facility Licence',
  'LSD Centre',
  'Section Centre',
] as const;
export type FacilityLocated = (typeof FACILITY_LOCATED)[number];

/** One facility as the loader keeps it. */
export interface FacilityRow {
  facilityId: string;
  name: string | null;
  operatorCode: string | null;
  operator: string | null;
  subCode: number | null;
  subType: string | null;
  licenceNumber: string | null;
  licenceType: 'W' | 'F' | null;
  licenseeCode: string | null;
  licensee: string | null;
  status: string | null;
  located: FacilityLocated | null;
  longitude: number;
  latitude: number;
}

/** Alberta, a little wide, as the database checks it. */
const ALBERTA = { west: -120.1, south: 48.9, east: -109.9, north: 60.1 };

function text(value: string | undefined, max: number): string | null {
  const v = (value ?? '').trim();
  return v === '' ? null : v.slice(0, max);
}

/**
 * One facility from a record of the file and its point; null when the record is not one the
 * database would take (no AER facility ID, no point in Alberta). Text past a column's length is
 * cut, a code that is not the AER's form is left empty.
 */
export function facilityRow(
  record: Readonly<Record<string, string>>,
  point: readonly [number, number] | null,
): FacilityRow | null {
  const facilityId = (record.FAC_ID ?? '').trim();
  if (!/^AB[A-Z]{2}[0-9]{7}$/.test(facilityId) || point === null) return null;
  const [longitude, latitude] = point;
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < ALBERTA.west ||
    longitude > ALBERTA.east ||
    latitude < ALBERTA.south ||
    latitude > ALBERTA.north
  ) {
    return null;
  }
  const code = (value: string | undefined) => {
    const v = (value ?? '').trim();
    return /^[0-9A-Z]{4}$/.test(v) ? v : null;
  };
  const sub = (record.SUB_CODE ?? '').trim();
  const subCode = /^\d{3}$/.test(sub) && Number(sub) >= 100 ? Number(sub) : null;
  const licence = (record.LIC_NUMBER ?? '').trim();
  const licenceType = (record.LIC_TYPE ?? '').trim();
  const located = (record.LOC_SOURCE ?? '').trim();
  return {
    facilityId,
    name: text(record.FAC_NAME, 60),
    operatorCode: code(record.OP_BA_ID),
    operator: text(record.OPERATOR, 60),
    subCode,
    subType: text(record.FAC_SUB_TY, 100),
    licenceNumber: /^[0-9A-Z]{1,9}$/.test(licence) ? licence : null,
    licenceType: licenceType === 'W' || licenceType === 'F' ? licenceType : null,
    licenseeCode: code(record.LIC_BA_ID),
    licensee: text(record.LICENSEE, 60),
    status: text(record.FAC_STATUS, 20),
    located: FACILITY_LOCATED.find((l) => l === located) ?? null,
    longitude: Math.round(longitude * 1e6) / 1e6,
    latitude: Math.round(latitude * 1e6) / 1e6,
  };
}

/** The points of a shapefile of points (type 1), in record order; null for an empty shape. */
export function shapefilePoints(bytes: Uint8Array): ([number, number] | null)[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 100 || view.getInt32(0, false) !== 9994) {
    throw new Error('not a shapefile');
  }
  if (view.getInt32(32, true) !== 1) throw new Error('not a shapefile of points');
  const points: ([number, number] | null)[] = [];
  let at = 100;
  while (at + 8 <= bytes.byteLength) {
    const length = view.getInt32(at + 4, false) * 2;
    const start = at + 8;
    if (start + length > bytes.byteLength || length < 4) throw new Error('a record is cut short');
    const type = view.getInt32(start, true);
    if (type === 1 && length >= 20) {
      points.push([view.getFloat64(start + 4, true), view.getFloat64(start + 12, true)]);
    } else {
      points.push(null);
    }
    at = start + length;
  }
  return points;
}

/**
 * Text from UTF-8 bytes, as the AER's file says it is in its .cpg (read 2026-11-22). A sequence
 * that is not UTF-8 (a field cut in the middle of a letter) becomes U+FFFD.
 */
export function utf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] ?? 0;
    if (b < 0x80) {
      out += String.fromCharCode(b);
      i += 1;
      continue;
    }
    // How many bytes follow the first: 1 for C2 to DF, 2 for E0 to EF, 3 for F0 to F4.
    const need =
      b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : 0;
    if (need === 0 || i + need >= bytes.length) {
      out += '�';
      i += 1;
      continue;
    }
    let code = b & (0x3f >> need);
    let ok = true;
    for (let k = 1; k <= need; k += 1) {
      const next = bytes[i + k] ?? 0;
      if ((next & 0xc0) !== 0x80) ok = false;
      code = (code << 6) | (next & 0x3f);
    }
    if (!ok || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      out += '�';
      i += 1;
      continue;
    }
    out += String.fromCodePoint(code);
    i += need + 1;
  }
  return out;
}

/** A dBASE table read a record at a time, for tables too large to turn into objects at once. */
export interface DbaseTable {
  count: number;
  /**
   * Record `n`, each field's text by its name (only the fields named, when some are); null for
   * a record marked deleted, which keeps its place so the shapes stay in step.
   */
  record(n: number, only?: readonly string[]): Record<string, string> | null;
}

export function dbaseTable(bytes: Uint8Array): DbaseTable {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 33) throw new Error('not a dBASE table');
  const count = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const fields: { name: string; offset: number; length: number }[] = [];
  let offset = 1;
  for (let at = 32; at + 32 <= headerLength && bytes[at] !== 0x0d; at += 32) {
    let name = '';
    for (let i = 0; i < 11 && bytes[at + i] !== 0; i += 1) {
      name += String.fromCharCode(bytes[at + i] ?? 0);
    }
    const length = bytes[at + 16] ?? 0;
    fields.push({ name, offset, length });
    offset += length;
  }
  if (headerLength + count * recordLength > bytes.byteLength) {
    throw new Error('the table is cut short');
  }
  return {
    count,
    record(n, only) {
      const start = headerLength + n * recordLength;
      if (n < 0 || n >= count || bytes[start] === 0x2a) return null;
      const record: Record<string, string> = {};
      for (const field of fields) {
        if (only && !only.includes(field.name)) continue;
        const at = start + field.offset;
        record[field.name] = utf8(bytes.subarray(at, at + field.length)).trim();
      }
      return record;
    },
  };
}

/** The records of a dBASE table, each a field's text by its name; deleted records left out. */
export function dbaseRecords(bytes: Uint8Array): (Record<string, string> | null)[] {
  const table = dbaseTable(bytes);
  const records: (Record<string, string> | null)[] = [];
  for (let n = 0; n < table.count; n += 1) records.push(table.record(n));
  return records;
}
