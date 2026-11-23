import { parseAtsLsd } from './aerLists';

/**
 * The AER's list of every well licence in Alberta (WellLicenceAllAB.csv, refreshed daily; F-282):
 * one line a licence, with its licensee, the surface location's latitude and longitude and its
 * status. The Worker reads it only for the licences rigs are on, to place each rig where its well
 * starts. The AER's data is not under an open licence (docs/DECISIONS.md, 2026-11-19).
 */

export const AER_LICENCE_LIST_URL =
  'https://www2.aer.ca/t/Production/views/COM-WellLicenceAllList/WellLicenceAllAB.csv';

/** The header as read on 2026-11-23; a list with another header is not read. */
export const AER_LICENCE_LIST_HEADER = [
  '01.Licence Number',
  '02.Company Name',
  '03.Latitude',
  '04.Longitude',
  '05.Surface Location',
  '06.Energy Development Category Type',
  '07.Rating Level',
  '08.Licence Status',
  '09.Licence Status Date',
  '10.Non-Routine Licence (Y or N)',
  '11.Non-Routine Status',
] as const;

export interface AerLicenceLocation {
  /** Seven digits, as ST1 and ST49 write it. */
  licenceNumber: string;
  licensee: string;
  latitude: number;
  longitude: number;
  surfaceLocation: string;
  status: string;
}

/** The fields of one CSV line, quotes as the CSV standard has them; null for a broken line. */
export function csvFields(line: string): string[] | null {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (line.charAt(i + 1) === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      fields.push(field);
      field = '';
    } else field += ch;
  }
  if (quoted) return null;
  fields.push(field);
  return fields;
}

/** Whether a line is the list's header as read on 2026-11-23. */
export function isAerLicenceListHeader(line: string): boolean {
  // A byte order mark (U+FEFF) may lead the file.
  const text = line.charCodeAt(0) === 0xfeff ? line.slice(1) : line;
  const fields = csvFields(text.trimEnd());
  return (
    fields !== null &&
    fields.length === AER_LICENCE_LIST_HEADER.length &&
    fields.every((f, i) => f.trim() === AER_LICENCE_LIST_HEADER[i])
  );
}

/** The licence number of a line, cheaply, before it is read whole: `W 0319903` → `0319903`. */
export function aerLicenceListNumber(line: string): string | null {
  const match = /^"?W ?(\d{7})"?,/.exec(line);
  return match?.[1] ?? null;
}

const ALBERTA = { west: -120.1, east: -109.9, south: 48.9, north: 60.1 };

/** One line of the list, or null when it is not a licence with a place in Alberta. */
export function parseAerLicenceListLine(line: string): AerLicenceLocation | null {
  const fields = csvFields(line.trimEnd());
  if (fields?.length !== AER_LICENCE_LIST_HEADER.length) return null;
  const [number, company, lat, lon, surface, , , status] = fields.map((f) => f.trim());
  const licence = /^W ?(\d{7})$/.exec(number ?? '');
  const latitude = Number(lat);
  const longitude = Number(lon);
  if (
    !licence?.[1] ||
    lat === '' ||
    lon === '' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    longitude < ALBERTA.west ||
    longitude > ALBERTA.east ||
    latitude < ALBERTA.south ||
    latitude > ALBERTA.north ||
    parseAtsLsd(surface ?? '') === null
  ) {
    return null;
  }
  return {
    licenceNumber: licence[1],
    licensee: (company ?? '').slice(0, 200),
    // As the database keeps them: six decimals.
    latitude: Math.round(latitude * 1e6) / 1e6,
    longitude: Math.round(longitude * 1e6) / 1e6,
    surfaceLocation: surface ?? '',
    status: (status ?? '').slice(0, 60),
  };
}
