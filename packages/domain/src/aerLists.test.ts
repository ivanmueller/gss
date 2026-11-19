import { describe, expect, it } from 'vitest';

import {
  AER_LIST_MAX_CHARS,
  aerDate,
  looksLikeSt1,
  looksLikeSt49,
  lsdOfWellId,
  parseAtsLsd,
  parseSt1,
  parseSt49,
  st49WallTime,
} from './aerLists';

// Made-up lists in the AER's layout (F-243): no real file is committed, as the AER's data is not
// under an open licence (docs/DECISIONS.md, 2026-11-19). Names and numbers are invented.

/** Places each value at its column, as the AER's fixed-width files do. */
function at(...cells: [number, string][]): string {
  let line = '';
  for (const [column, text] of cells) line = line.padEnd(column) + text;
  return line.padEnd(100);
}

function st1Record(n: string, location: string, name = 'EXAMPLE HZ TESTVILLE 1-2-3-4'): string[] {
  return [
    at([4, name], [41, n], [51, 'ALBERTA CROWN'], [72, '700.10M']),
    at(
      [4, '100/01-02-003-04W5/00'],
      [27, 'S  120.5M  W  80.0M'],
      [51, 'RED DEER'],
      [72, '2500.0M'],
    ),
    at([4, 'DEV (NC)'], [41, 'TESTFIELD'], [72, 'CARDIUM FM']),
    at([4, 'HORIZONTAL'], [41, 'NEW'], [51, 'PRODUCTION'], [72, 'CRUDE OIL']),
    at([4, 'EXAMPLE ENERGY LTD.'], [72, location]),
    '',
  ];
}

function st1(records: string[][], { date = '09 November 2026', tail = true } = {}): string {
  return [
    at([40, 'ALBERTA ENERGY REGULATOR']),
    '',
    at([35, 'WELL LICENCES ISSUED  DAILY LIST']),
    '',
    `    DATE:  ${date}`,
    '',
    '    ' + '-'.repeat(92),
    at([4, 'WELL NAME'], [28, 'LICENCE NUMBER'], [51, 'MINERAL RIGHTS'], [72, 'GROUND ELEVATION']),
    at([4, 'UNIQUE IDENTIFIER'], [28, 'SURFACE CO-ORDINATES'], [51, 'AER FIELD CENTRE']),
    at([4, 'AER CLASSIFICATION'], [28, 'FIELD'], [72, 'TERMINATING ZONE']),
    at([4, 'DRILLING OPERATION'], [28, 'WELL PURPOSE'], [51, 'WELL TYPE'], [72, 'SUBSTANCE']),
    at([4, 'LICENSEE'], [72, 'SURFACE LOCATION']),
    '    ' + '-'.repeat(92),
    '',
    ...records.flat(),
    ...(tail
      ? [
          '    AMENDMENTS OF WELL LICENCES',
          '    ---------------------------',
          '',
          at([4, 'EXAMPLE 2-2-2-2'], [43, '0500001'], [53, 'WELL NAME:']),
          '',
        ]
      : []),
    '    -------------------- END OF WELL LICENCES DAILY LIST  -------------------- ',
  ].join('\r\n');
}

const WIDTHS = [19, 34, 7, 6, 30, 6, 23, 14, 5, 34, 13, 11];
const RULE = WIDTHS.map((w) => '-'.repeat(w)).join(' ');

function st49Row(cells: string[]): string {
  return WIDTHS.map((w, k) => (cells[k] ?? '').padEnd(w)).join(' ');
}

function st49Page(rows: string[][]): string[] {
  return [
    'Report Number: ST-49' + ' '.repeat(60) + 'Alberta Energy Regulator',
    'Run Date: 17 Nov 2026' + ' '.repeat(60) + 'DAILY DRILLING ACTIVITY LIST',
    ' '.repeat(70) + 'For the Notification Period 16 Nov 2026 To 17 Nov 2026',
    '',
    '      WELL ID                   WELL NAME              LICENCE  CONTRACTOR …',
    '',
    RULE,
    ...rows.map(st49Row),
  ];
}

/** A whole ST49 list: its pages, then the end line. */
function st49(...pages: string[][]): string {
  const rows = pages.flat().filter((line) => /^[0-9A-Z]{2}\/\d{2}-/.test(line)).length;
  return [
    ...pages.flat(),
    '',
    `            TOTAL NUMBER OF WELLS LISTED = ${String(rows)}`,
    '        *** END OF REPORT ***',
  ].join('\n');
}

const RIG_A = [
  '02/02-27-017-13W4/0',
  'EXAMPLE HZ TESTVILLE 2-27-17-13',
  '0526000',
  'A1XX',
  'Example Drilling Inc.',
  '11',
  '15 Nov 2026 08:30:15 PM',
  'Medicine Hat',
  'A7XX',
  'Example Energy Ltd.',
  '',
  'Drill to LD',
];

describe('AER legal subdivisions', () => {
  it('reads a surface location and a well ID, refusing values out of range', () => {
    expect(parseAtsLsd('10-12-095-05W4')).toEqual({
      lsd: 10,
      section: 12,
      township: 95,
      range: 5,
      meridian: 4,
    });
    expect(parseAtsLsd('17-12-095-05W4')).toBeNull();
    expect(parseAtsLsd('10-37-095-05W4')).toBeNull();
    expect(parseAtsLsd('10-12-095-05W3')).toBeNull();
    expect(parseAtsLsd('10-12-95-5W4')).toBeNull();
    // The well ID's subdivision is its bottom hole; it reads, but is never used to place a rig.
    expect(lsdOfWellId('02/02-27-017-13W4/3')).toEqual({
      lsd: 2,
      section: 27,
      township: 17,
      range: 13,
      meridian: 4,
    });
    expect(lsdOfWellId('02-27-017-13W4')).toBeNull();
  });

  it('reads dates and times as the AER writes them', () => {
    expect(aerDate('09', 'November', '2026')).toBe('2026-11-09');
    expect(aerDate('16', 'Nov', '2026')).toBe('2026-11-16');
    expect(aerDate('31', 'Nov', '2026')).toBeNull();
    expect(aerDate('1', 'Novem', '2026')).toBeNull();
    expect(st49WallTime('15 Nov 2026 08:30:15 PM')).toBe('2026-11-15T20:30:15');
    expect(st49WallTime('15 Nov 2026 12:00:00 AM')).toBe('2026-11-15T00:00:00');
    expect(st49WallTime('15 Nov 2026 12:05:00 PM')).toBe('2026-11-15T12:05:00');
    expect(st49WallTime('15 Nov 2026 13:00:00 PM')).toBeNull();
    expect(st49WallTime('15 Nov 2026 08:60:00 PM')).toBeNull();
  });
});

describe('parseSt1', () => {
  it('reads the issued licences and stops at the next section', () => {
    const text = st1([
      st1Record('0526001', '10-12-095-05W4'),
      st1Record('0526002', '01-05-062-26W4'),
    ]);
    expect(looksLikeSt1(text)).toBe(true);
    expect(looksLikeSt49(text)).toBe(false);
    const read = parseSt1(text);
    expect(read).toMatchObject({ listDate: '2026-11-09', structure: true, skipped: 0 });
    expect(read.rows.map((row) => row.licenceNumber)).toEqual(['0526001', '0526002']);
    expect(read.rows[0]).toMatchObject({
      wellName: 'EXAMPLE HZ TESTVILLE 1-2-3-4',
      mineralRights: 'ALBERTA CROWN',
      groundElevation: '700.10M',
      uwi: '100/01-02-003-04W5/00',
      surfaceOffsets: 'S 120.5M W 80.0M',
      fieldCentre: 'RED DEER',
      projectedDepth: '2500.0M',
      classification: 'DEV (NC)',
      field: 'TESTFIELD',
      terminatingZone: 'CARDIUM FM',
      drillingOperation: 'HORIZONTAL',
      wellPurpose: 'NEW',
      wellType: 'PRODUCTION',
      substance: 'CRUDE OIL',
      licensee: 'EXAMPLE ENERGY LTD.',
      surfaceLocation: '10-12-095-05W4',
      location: { lsd: 10, section: 12, township: 95, range: 5, meridian: 4 },
    });
  });

  it('reads a list with its structure and no records as a valid empty list', () => {
    expect(parseSt1(st1([]))).toEqual({
      listDate: '2026-11-09',
      structure: true,
      rows: [],
      skipped: 0,
    });
  });

  it('skips and counts a record whose licence number or location is not where expected', () => {
    const shifted = st1Record('0526003', '10-12-095-05W4');
    // One column either way still reads (fields are trimmed within their column); twelve does not.
    shifted[0] = ' '.repeat(12) + (shifted[0] ?? '');
    const read = parseSt1(
      st1([
        st1Record('0526001', '10-12-095-05W4'),
        shifted,
        st1Record('0526004', '10-12-095-05W9'),
      ]),
    );
    expect(read.rows.map((row) => row.licenceNumber)).toEqual(['0526001']);
    expect(read.skipped).toBe(2);
  });

  it('skips a record cut short and reads the next one', () => {
    const cut = st1Record('0526005', '10-12-095-05W4').slice(0, 3);
    const read = parseSt1(st1([cut, [''], st1Record('0526006', '10-12-095-05W4')]));
    expect(read.rows.map((row) => row.licenceNumber)).toEqual(['0526006']);
    expect(read.skipped).toBe(1);
  });

  it('reads past an extra divider before the column header (F-243-1-R3-01)', () => {
    const text = st1([st1Record('0526001', '10-12-095-05W4')]).replace(
      '    WELL NAME',
      '    ' + '-'.repeat(92) + '\r\n    WELL NAME',
    );
    expect(parseSt1(text)).toMatchObject({ structure: true, skipped: 0 });
    expect(parseSt1(text).rows.map((row) => row.licenceNumber)).toEqual(['0526001']);
  });

  it('is unreadable with a repeated column header or an unknown section (F-243-1-R4-01)', () => {
    const header = at([4, 'WELL NAME'], [28, 'LICENCE NUMBER']);
    const repeated = st1([
      st1Record('0526001', '10-12-095-05W4'),
      [header, '    ' + '-'.repeat(92), ''],
      st1Record('0526002', '01-05-062-26W4'),
    ]);
    expect(parseSt1(repeated)).toMatchObject({ structure: false, rows: [] });
    const unknown = st1([
      st1Record('0526001', '10-12-095-05W4'),
      ['    SOMETHING NEW', '    -------------', ''],
      st1Record('0526002', '01-05-062-26W4'),
    ]);
    expect(parseSt1(unknown)).toMatchObject({ structure: false, rows: [] });
  });

  it('has no structure when cut short, even between two records (F-243-1-R1-01)', () => {
    const whole = st1([
      st1Record('0526001', '10-12-095-05W4'),
      st1Record('0526002', '01-05-062-26W4'),
    ]);
    expect(parseSt1(whole).rows).toHaveLength(2);
    const cut = whole.slice(0, whole.indexOf('0526002') - 50);
    expect(parseSt1(cut)).toMatchObject({ structure: false, rows: [] });
  });

  it('has no structure without its date or its column header', () => {
    expect(parseSt1(st1([], { date: 'unknown' })).structure).toBe(false);
    expect(
      parseSt1('ALBERTA ENERGY REGULATOR\nWELL LICENCES ISSUED\nDATE:  09 November 2026'),
    ).toMatchObject({ structure: false, rows: [] });
  });

  it('refuses a file over the size limit and reads a very long line in linear time', () => {
    expect(() => parseSt1('x'.repeat(AER_LIST_MAX_CHARS + 1))).toThrow(RangeError);
    const started = Date.now();
    const read = parseSt1(st1([[' '.repeat(4) + 'A'.repeat(1_000_000)]], { tail: false }));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(read.rows).toEqual([]);
  });
});

describe('parseSt49', () => {
  it('reads every page, keeping seconds and the bottom hole apart from any surface', () => {
    const rigB = [...RIG_A];
    rigB[0] = '00/09-19-049-08W5/0';
    rigB[2] = '0526001';
    rigB[6] = '15 Nov 2026 08:30:59 PM';
    const text = [
      ...st49Page([RIG_A]),
      ...st49Page([rigB]),
      '',
      '        TOTAL  - Drill to LD - Drilling to Licensed Depth   = 2',
      '            TOTAL NUMBER OF WELLS LISTED = 2',
      '        *** END OF REPORT ***',
    ].join('\n');
    expect(looksLikeSt49(text)).toBe(true);
    const read = parseSt49(text);
    expect(read).toMatchObject({ listDate: '2026-11-17', structure: true, skipped: 0 });
    // Two activities in the same minute stay two.
    expect(read.rows.map((row) => row.activityWallTime)).toEqual([
      '2026-11-15T20:30:15',
      '2026-11-15T20:30:59',
    ]);
    expect(read.rows[0]).toMatchObject({
      wellId: '02/02-27-017-13W4/0',
      licenceNumber: '0526000',
      contractorName: 'Example Drilling Inc.',
      rigNumber: '11',
      activityLocal: '15 Nov 2026 08:30:15 PM',
      licenseeBaId: 'A7XX',
      licenseeName: 'Example Energy Ltd.',
      activityType: 'Drill to LD',
      bottomHole: { lsd: 2, section: 27, township: 17, range: 13, meridian: 4 },
    });
  });

  it('skips and counts a row without a licence number or a real time', () => {
    const bad = [...RIG_A];
    bad[2] = '';
    const late = [...RIG_A];
    late[6] = '31 Nov 2026 08:30:00 PM';
    const read = parseSt49(st49(st49Page([RIG_A, bad, late])));
    expect(read.rows).toHaveLength(1);
    expect(read.skipped).toBe(2);
  });

  it('is unreadable when a page has another number of columns', () => {
    expect(parseSt49(st49(st49Page([RIG_A]))).structure).toBe(true);
    const changed = st49Page([RIG_A]);
    changed[6] = RULE + ' ------';
    expect(parseSt49(st49(changed))).toMatchObject({ structure: false, rows: [] });
  });

  it('is unreadable when a later page changes layout or lacks its separator (F-243-1-R2-01)', () => {
    const later = st49Page([RIG_A]);
    later[6] = WIDTHS.slice(0, 10)
      .map((w) => '-'.repeat(w))
      .join(' ');
    expect(parseSt49(st49(st49Page([RIG_A]), later))).toMatchObject({
      structure: false,
      rows: [],
    });
    const noRule = st49Page([RIG_A]).filter((_, k) => k !== 6);
    expect(parseSt49(st49(st49Page([RIG_A]), noRule))).toMatchObject({
      structure: false,
      rows: [],
    });
  });

  it('is unreadable when its own total does not match its rows (F-243-1-R5-02)', () => {
    const whole = st49(st49Page([RIG_A]), st49Page([RIG_A]));
    expect(parseSt49(whole)).toMatchObject({ structure: true });
    // A page missing, the total and the end line intact.
    const missing = whole.replace(st49Page([RIG_A]).join('\n') + '\n', '');
    expect(parseSt49(missing)).toMatchObject({ structure: false, rows: [] });
  });

  it('has no structure when cut short, even between two pages (F-243-1-R1-01)', () => {
    expect(parseSt49(st49Page([RIG_A]).join('\n'))).toMatchObject({ structure: false, rows: [] });
    const whole = st49(st49Page([RIG_A]), st49Page([RIG_A]));
    expect(parseSt49(whole)).toMatchObject({ structure: true });
    const cut = whole.slice(0, whole.lastIndexOf('Report Number'));
    expect(parseSt49(cut)).toMatchObject({ structure: false, rows: [] });
  });

  it('has no structure without its period line', () => {
    const page = st49Page([RIG_A]);
    page[2] = '';
    expect(parseSt49(st49(page))).toMatchObject({ listDate: null, structure: false });
  });
});
