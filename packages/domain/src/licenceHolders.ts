/**
 * Licence transfers (F-295; the owner, 2026-11-23, option A: "record transfers quietly now"): who
 * holds every well, facility and pipeline licence in Alberta, read each day from the AER's three
 * licence lists, so that a licence moving from one company to another is noticed the day after.
 * The AER publishes no free list of transfers (its approvals are $10 each, item 709 of its
 * catalogue), so the record starts on the first day read and has no history before it.
 *
 * The lists, read 2026-11-23 from the AER's Licence Reports page: one CSV line a licence, the
 * licensee written as "Name(BA code)". The whole well list takes longer than the AER's server
 * allows (it answers 504 after two minutes), so it is asked a licence status at a time, the
 * filter the AER's server takes as `?Licence%20Status=Issued`; the six statuses below gave
 * 476,023 well licences on 2026-11-23, and facilities and pipelines come whole (41,642 and
 * 57,166). The AER's data, on the owner's decision for its lists (docs/DECISIONS.md, 2026-11-19):
 * members only, non-commercial, the AER named.
 */

export type LicenceKind = 'well' | 'facility' | 'pipeline';

// No runtime import: scripts/load-licences.js runs this file as it is, with Node's type
// stripping, which does not resolve the package's extensionless imports. So the list's address,
// header and CSV reading are written here again, the same as in aerLicenceList.ts (F-282).
const WELL_LICENCE_LIST_URL =
  'https://www2.aer.ca/t/Production/views/COM-WellLicenceAllList/WellLicenceAllAB.csv';

/** The fields of one CSV line, quotes as the CSV standard has them; null for a broken line. */
function csvFields(line: string): string[] | null {
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

export const LICENCE_KINDS: readonly LicenceKind[] = ['well', 'facility', 'pipeline'];

export const FACILITY_LICENCE_LIST_URL =
  'https://www2.aer.ca/t/Production/views/COM-FacilityLicenceAll/FacilityLicenceAllAB.csv';
export const PIPELINE_LICENCE_LIST_URL =
  'https://www2.aer.ca/t/Production/views/COM-PipelineLicenceAll/PipelineLicenceAllAB.csv';

/** The well licence statuses seen on 2026-11-23 (and the only ones in the facility list). */
export const WELL_LICENCE_STATUSES = [
  'Issued',
  'Amended',
  'Abandoned',
  'Cancelled',
  'RecCertified',
  'RecExempt',
] as const;

/** The lists to fetch: the wells a status at a time, the others whole. */
export function licenceListRequests(): { kind: LicenceKind; status: string | null; url: string }[] {
  return [
    ...WELL_LICENCE_STATUSES.map((status) => ({
      kind: 'well' as const,
      status,
      url: `${WELL_LICENCE_LIST_URL}?Licence%20Status=${encodeURIComponent(status)}`,
    })),
    { kind: 'facility', status: null, url: FACILITY_LICENCE_LIST_URL },
    { kind: 'pipeline', status: null, url: PIPELINE_LICENCE_LIST_URL },
  ];
}

/** Each list's header as read on 2026-11-23, and where its licensee and status are. */
const LISTS: Record<
  LicenceKind,
  { header: readonly string[]; holder: number; status: number; licence: RegExp }
> = {
  well: {
    header: [
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
    ],
    holder: 1,
    status: 7,
    // W 0319903, W 0319903A, WB0002835, WY0001234A, and a few with eight digits.
    licence: /^W[ A-Z]?\d{7,8}[A-Z]?$/,
  },
  facility: {
    header: [
      '01.Licence Number',
      '02.Company Name',
      '03.Latitude',
      '04.Longitude',
      '05.Surface Location',
      '06.Energy Development Category Type',
      '07.Rating Level',
      '08.Licence Status',
      '09.Licence Status Date',
      '10.Max H2S Concentration',
      '11.Non-Routine Licence (Y or N)',
      '12.Non-Routine Status',
    ],
    holder: 1,
    status: 7,
    licence: /^F\d{1,8}$/,
  },
  pipeline: {
    header: [
      '01.Licence Number',
      '02.Licensee',
      '03.Licence Status',
      '04.Licence Status Date',
      '05.Energy Development Category Type',
      '06.H2S Content',
      '07.Non-Routine Licence (Y or N)',
      '08.Non-Routine Status',
    ],
    holder: 1,
    status: 2,
    licence: /^P\d{1,8}$/,
  },
};

/** "501 Energy Corp.(A9BY)": the name, then the AER's four-character business associate code. */
const HOLDER = /^(.{1,200}?)\s*\(([0-9A-Z]{4})\)\s*$/;

export interface LicenceHolder {
  licence: string;
  baCode: string;
  name: string;
  status: string;
}

/**
 * The licences of one list and who holds each. A list whose header is not the one read on
 * 2026-11-23 is refused (thrown), as is a line of another status than the one asked for (the
 * filter not applied). Lines that cannot be read are counted, never guessed.
 */
export function readLicenceHolders(
  text: string,
  kind: LicenceKind,
  status: string | null = null,
): { holders: LicenceHolder[]; skipped: number } {
  const list = LISTS[kind];
  const lines = text.split(/\r?\n/);
  const first = lines[0] ?? '';
  const header = csvFields((first.charCodeAt(0) === 0xfeff ? first.slice(1) : first).trimEnd());
  if (
    header?.length !== list.header.length ||
    !header.every((f, i) => f.trim() === list.header[i])
  ) {
    throw new Error(`The AER's ${kind} licence list does not have the header read on 2026-11-23.`);
  }
  const holders: LicenceHolder[] = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue;
    const fields = csvFields(line.trimEnd());
    const licence = fields?.[0]?.trim() ?? '';
    const holder = HOLDER.exec(fields?.[list.holder]?.trim() ?? '');
    const lineStatus = fields?.[list.status]?.trim() ?? '';
    if (fields?.length !== list.header.length || !list.licence.test(licence) || !holder) {
      skipped += 1;
      continue;
    }
    if (status !== null && lineStatus !== status) {
      throw new Error(
        `The AER's ${kind} licence list asked for status ${status} gave another status: the filter was not applied.`,
      );
    }
    holders.push({
      licence,
      baCode: holder[2] ?? '',
      name: (holder[1] ?? '').trim(),
      status: lineStatus,
    });
  }
  return { holders, skipped };
}

/**
 * Who holds each licence of a kind, from every list read for it. A licence listed twice under
 * different companies is left out (ambiguous) and counted.
 */
export function holdingsOf(lists: readonly (readonly LicenceHolder[])[]): {
  holdings: Map<string, string>;
  ambiguous: number;
} {
  const holdings = new Map<string, string>();
  const ambiguousLicences = new Set<string>();
  for (const list of lists) {
    for (const h of list) {
      const held = holdings.get(h.licence);
      if (held !== undefined && held !== h.baCode) ambiguousLicences.add(h.licence);
      else holdings.set(h.licence, h.baCode);
    }
  }
  for (const licence of ambiguousLicences) holdings.delete(licence);
  return { holdings, ambiguous: ambiguousLicences.size };
}

export interface HolderChange {
  licence: string;
  fromBa: string;
  toBa: string;
}

/**
 * Compares today's holders of a kind with those last known. A licence held by another company
 * than before is a change (a transfer, or a company's licences moved under a new code in an
 * amalgamation). A licence not in today's lists keeps its last known holder: a list that missed
 * it is never read as a transfer. A licence new today is added, not a change.
 */
export function compareHoldings(
  previous: ReadonlyMap<string, string>,
  today: ReadonlyMap<string, string>,
): { changes: HolderChange[]; merged: Map<string, string>; added: number } {
  const merged = new Map(previous);
  const changes: HolderChange[] = [];
  let added = 0;
  for (const [licence, toBa] of today) {
    const fromBa = previous.get(licence);
    if (fromBa === undefined) added += 1;
    else if (fromBa !== toBa) changes.push({ licence, fromBa, toBa });
    merged.set(licence, toBa);
  }
  changes.sort((a, b) => a.licence.localeCompare(b.licence));
  return { changes, merged, added };
}
