/**
 * The Alberta Energy Regulator's daily lists (F-243 part 1, docs/FEATURES_OIL_GAS.md): ST1, Well
 * Licences Issued – Daily List, and ST49, Daily Drilling Activity List. Both are fixed-width text
 * files the AER posts each night and overwrites a week later. These readers are pure, run in
 * linear time and never guess: a record that does not fit is skipped and counted.
 *
 * The AER's data is not under an open licence; it is used on the owner's decision
 * (docs/DECISIONS.md, 2026-11-19): shown with its source and date, marked preliminary, to signed-in
 * members only, never exported.
 */

/**
 * The readers' version. Raised whenever a reader changes what it reads, so the job reads the
 * stored files again (docs/FEATURES_OIL_GAS.md, F-243; plan F-243-1-D1-02).
 */
export const AER_READER_VERSION = 1;

/** The largest file the readers accept, in characters (a day's ST1 is about 70,000). */
export const AER_LIST_MAX_CHARS = 2_000_000;
/** The most lines read from one file. */
const MAX_LINES = 60_000;
/** The longest text kept for one field. */
const MAX_FIELD = 200;

/** A legal subdivision of the Alberta Township System, west of the 4th, 5th or 6th meridian. */
export interface AtsLsd {
  lsd: number;
  section: number;
  township: number;
  range: number;
  meridian: number;
}

/** A legal subdivision's text as the AER writes it: `10-12-095-05W4`. */
const LSD_TEXT = /^(\d{2})-(\d{2})-(\d{3})-(\d{2})W([4-6])$/;
/** A well identifier in ST49: `02/02-27-017-13W4/0` (location exception, LSD…, event). */
const WELL_ID = /^[0-9A-Z]{2}\/(\d{2}-\d{2}-\d{3}-\d{2}W[4-6])\/\d$/;

function lsdFromParts(parts: string[]): AtsLsd | null {
  const [lsd, section, township, range, meridian] = parts.map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const ok =
    lsd >= 1 &&
    lsd <= 16 &&
    section >= 1 &&
    section <= 36 &&
    township >= 1 &&
    township <= 126 &&
    range >= 1 &&
    range <= 34 &&
    meridian >= 4 &&
    meridian <= 6;
  return ok ? { lsd, section, township, range, meridian } : null;
}

/** A legal subdivision written `10-12-095-05W4`, or null. */
export function parseAtsLsd(text: string): AtsLsd | null {
  const match = LSD_TEXT.exec(text.trim());
  return match ? lsdFromParts(match.slice(1)) : null;
}

/** The legal subdivision of an ST49 well identifier, or null. */
export function lsdOfWellId(wellId: string): AtsLsd | null {
  const match = WELL_ID.exec(wellId.trim());
  return match?.[1] ? parseAtsLsd(match[1]) : null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/** `09 November 2026` or `16 Nov 2026` as `2026-11-09`; null when not a real date. */
export function aerDate(day: string, month: string, year: string): string | null {
  const lower = month.toLowerCase();
  const index = MONTHS.findIndex((name) =>
    lower.length === 3 ? name.startsWith(lower) : name === lower,
  );
  const d = Number(day);
  const y = Number(year);
  if (index < 0 || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  const date = new Date(Date.UTC(y, index, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== index || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function field(line: string, start: number, end?: number): string {
  return line.slice(start, end).trim().slice(0, MAX_FIELD);
}

function linesOf(text: string): string[] {
  if (text.length > AER_LIST_MAX_CHARS) throw new RangeError('AER list too large');
  return text.split(/\r?\n/, MAX_LINES);
}

/** One licence of an ST1 list, every field as published. */
export interface St1Licence {
  /** The record's first line in the file, from 1. */
  lineNo: number;
  licenceNumber: string;
  wellName: string;
  mineralRights: string;
  groundElevation: string;
  uwi: string;
  /** The surface location's distances from the section's edges, as published (`S 647.5M W 518.7M`). */
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
  /** As published: `10-12-095-05W4`. */
  surfaceLocation: string;
  location: AtsLsd;
}

export interface AerListRead<Row> {
  /** The list's date from its contents; null when it cannot be read. */
  listDate: string | null;
  /**
   * Whether the list's structure was found (its date line and its column header). Without it the
   * file is unreadable; with it and no records, it is a valid empty list.
   */
  structure: boolean;
  rows: Row[];
  skipped: number;
}

/** Whether the text is an ST1 list at all (an error page is never kept). */
export function looksLikeSt1(text: string): boolean {
  const head = text.slice(0, 2000);
  return head.includes('ALBERTA ENERGY REGULATOR') && head.includes('WELL LICENCES ISSUED');
}

/** Whether the text is an ST49 list at all. */
export function looksLikeSt49(text: string): boolean {
  const head = text.slice(0, 2000);
  return head.includes('Alberta Energy Regulator') && head.includes('DAILY DRILLING ACTIVITY LIST');
}

const ST1_DATE = /^\s*DATE:\s+(\d{1,2}) ([A-Za-z]+) (\d{4})\s*$/;
const DASHES = /^\s*-{10,}\s*$/;
const ST1_END = 'END OF WELL LICENCES';
const SEVEN_DIGITS = /^\d{7}$/;
const OFFSETS = /^([NS])\s+(\d{1,5}(?:\.\d{1,2})?)M\s+([EW])\s+(\d{1,5}(?:\.\d{1,2})?)M$/;

/**
 * The columns of an ST1 record's data lines. The AER's column headings do not sit over the data
 * (the licence number is printed at column 41, under nothing), so the data columns themselves are
 * fixed here; a record whose licence number or location is not where expected is skipped, which
 * the job's log counts, so a change of layout shows at once.
 */
const C = { a: 4, b: 41, c: 51, d: 72 } as const;
/** Line 2: the offsets sit between the identifier and the field centre. */
const OFFSETS_START = 27;

/**
 * The issued licences of an ST1 daily list: the 5-line records between the column header and the
 * first section that follows them (amendments, updates, cancellations: not read here; the whole
 * file is kept).
 */
export function parseSt1(text: string): AerListRead<St1Licence> {
  const lines = linesOf(text);
  let listDate: string | null = null;
  let dashes = 0;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const date = listDate === null ? ST1_DATE.exec(line) : null;
    if (date) listDate = aerDate(date[1] ?? '', date[2] ?? '', date[3] ?? '');
    if (DASHES.test(line)) {
      dashes += 1;
      if (dashes === 2) {
        start = i + 1;
        break;
      }
    }
  }
  const rows: St1Licence[] = [];
  let skipped = 0;
  if (start < 0 || listDate === null) return { listDate, structure: false, rows, skipped };

  let i = start;
  while (i < lines.length) {
    const first = lines[i] ?? '';
    if (first.trim() === '') {
      i += 1;
      continue;
    }
    // The list's end line, or a new section: a heading followed by its own underline
    // (`AMENDMENTS OF WELL LICENCES`).
    if (first.includes(ST1_END) || DASHES.test(lines[i + 1] ?? '')) break;
    const begin = i;
    const block = lines.slice(begin, begin + 5);
    const blank = block.findIndex((line) => line.trim() === '');
    if (block.length < 5 || blank >= 0) {
      skipped += 1;
      // Realign on the blank line that cut the record short.
      i = blank >= 0 ? begin + blank : lines.length;
      continue;
    }
    i = begin + 5;
    const [l1, l2, l3, l4, l5] = block as [string, string, string, string, string];
    const licenceNumber = field(l1, C.b, C.c);
    const surfaceLocation = field(l5, C.d);
    const location = parseAtsLsd(surfaceLocation);
    const offsets = l2.slice(OFFSETS_START, C.c).trim().replace(/\s+/g, ' ');
    if (!SEVEN_DIGITS.test(licenceNumber) || !location) {
      skipped += 1;
      continue;
    }
    rows.push({
      lineNo: i - 5 + 1,
      licenceNumber,
      wellName: field(l1, C.a, C.b),
      mineralRights: field(l1, C.c, C.d),
      groundElevation: field(l1, C.d),
      uwi: field(l2, C.a, OFFSETS_START),
      surfaceOffsets: OFFSETS.test(offsets) ? offsets : '',
      fieldCentre: field(l2, C.c, C.d),
      projectedDepth: field(l2, C.d),
      classification: field(l3, C.a, C.b),
      field: field(l3, C.b, C.d),
      terminatingZone: field(l3, C.d),
      drillingOperation: field(l4, C.a, C.b),
      wellPurpose: field(l4, C.b, C.c),
      wellType: field(l4, C.c, C.d),
      substance: field(l4, C.d),
      licensee: field(l5, C.a, C.d),
      surfaceLocation,
      location,
    });
  }
  return { listDate, structure: true, rows, skipped };
}

/** One row of an ST49 daily list, every field as published. */
export interface St49Activity {
  lineNo: number;
  wellId: string;
  wellName: string;
  licenceNumber: string;
  contractorBaId: string;
  contractorName: string;
  rigNumber: string;
  /** As published: `15 Nov 2026 08:30:00 PM`, Alberta local time. */
  activityLocal: string;
  /** The same as an Alberta wall-clock time with seconds: `2026-11-15T20:30:15`. */
  activityWallTime: string;
  fieldCentre: string;
  licenseeBaId: string;
  licenseeName: string;
  newProjectedDepth: string;
  activityType: string;
  /**
   * The well ID's subdivision: the well's bottom hole, not where the rig stands (a horizontal
   * well's bottom hole can be a kilometre or more from its surface). Never used to place the rig
   * (F-243-1-D1-03); the rig is placed at its licence's surface location from ST1.
   */
  bottomHole: AtsLsd;
}

const ST49_PERIOD = /Notification Period\s+.+?\s+To\s+(\d{1,2}) ([A-Za-z]{3}) (\d{4})/;
const ST49_TIME = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (AM|PM)$/;
/** The separator under ST49's column header: runs of dashes, one per column. */
const ST49_RULE = /^-{5,}(?: -+){10,}\s*$/;
const ST49_COLUMNS = 12;

/** `15 Nov 2026 08:30:15 PM` as `2026-11-15T20:30:15`; null when not a real time. */
export function st49WallTime(text: string): string | null {
  const match = ST49_TIME.exec(text.trim());
  if (!match) return null;
  const date = aerDate(match[1] ?? '', match[2] ?? '', match[3] ?? '');
  const hour12 = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!date || hour12 < 1 || hour12 > 12 || minute > 59 || second > 59) return null;
  const hour = (hour12 % 12) + (match[7] === 'PM' ? 12 : 0);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date}T${two(hour)}:${two(minute)}:${two(second)}`;
}

/** ST49's page header, repeated at the top of each page. */
const ST49_PAGE = 'Report Number:';
/** The totals after the last row, or the report's end line. */
const ST49_END = /^\s+TOTAL\b|\*\*\* END OF REPORT \*\*\*/;

/**
 * The rig activity of an ST49 daily list. The list runs over pages: each repeats the report header
 * and the column header, ending in a separator whose dash runs give that page's column widths
 * (they differ from file to file). Rows are read after each separator, until the next page header,
 * the totals or the end line. A separator with another number of columns makes the whole file
 * unreadable (structure false), so a changed layout is never half read.
 */
export function parseSt49(text: string): AerListRead<St49Activity> {
  const lines = linesOf(text);
  let listDate: string | null = null;
  let columns: [number, number][] | null = null;
  let sawPage = false;
  const rows: St49Activity[] = [];
  let skipped = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (listDate === null) {
      const period = ST49_PERIOD.exec(line);
      if (period) listDate = aerDate(period[1] ?? '', period[2] ?? '', period[3] ?? '');
    }
    if (ST49_RULE.test(line)) {
      columns = [...line.matchAll(/-+/g)].map((run) => [run.index, run.index + run[0].length]);
      if (columns.length !== ST49_COLUMNS)
        return { listDate, structure: false, rows: [], skipped: 0 };
      sawPage = true;
      continue;
    }
    if (line.startsWith(ST49_PAGE)) {
      columns = null;
      continue;
    }
    if (columns === null || line.trim() === '') continue;
    if (ST49_END.test(line)) break;
    // Each column ends where the next begins, so a value one space wider still reads whole.
    const cols = columns;
    const cells = cols.map(([from], k) => field(line, from, cols[k + 1]?.[0]));
    const [wellId, wellName, licenceNumber, contractorBaId, contractorName, rigNumber, when] =
      cells as [string, string, string, string, string, string, string];
    const bottomHole = lsdOfWellId(wellId);
    const wallTime = st49WallTime(when);
    if (!bottomHole || !wallTime || !SEVEN_DIGITS.test(licenceNumber)) {
      skipped += 1;
      continue;
    }
    rows.push({
      lineNo: i + 1,
      wellId,
      wellName,
      licenceNumber,
      contractorBaId,
      contractorName,
      rigNumber,
      activityLocal: when,
      activityWallTime: wallTime,
      fieldCentre: cells[7] ?? '',
      licenseeBaId: cells[8] ?? '',
      licenseeName: cells[9] ?? '',
      newProjectedDepth: cells[10] ?? '',
      activityType: cells[11] ?? '',
      bottomHole,
    });
  }
  if (!sawPage || listDate === null) return { listDate, structure: false, rows: [], skipped: 0 };
  return { listDate, structure: true, rows, skipped };
}
