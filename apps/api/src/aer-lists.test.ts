import { AER_LIST_MAX_CHARS, AER_READER_VERSION } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AER_SOURCES,
  ATS_LSD_QUERY,
  bodySha256,
  fetchAerList,
  licencesAnswer,
  lsdWhere,
  periodStart,
  pointsFromGrid,
  readAerFile,
  refreshAerLists,
  rigsAnswer,
} from './aer-lists';
import type { AerLicenceServed, AerRigServed } from './aer-lists-db';
import type { Database } from './db';
import { createApp } from './index';
import { PETROLEUM_SCHEMA_VERSION, type PetroleumFactory } from './petroleum-db';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';

// The AER's daily lists (F-243 part 1): fetching, capture before reading, reading, locating on the
// township grid, and the two routes. Made-up files in the AER's layout only (the AER's data is not
// under an open licence: docs/DECISIONS.md, 2026-11-19).

function at(...cells: [number, string][]): string {
  let line = '';
  for (const [column, text] of cells) line = line.padEnd(column) + text;
  return line;
}

const ST1 = [
  at([40, 'ALBERTA ENERGY REGULATOR']),
  at([35, 'WELL LICENCES ISSUED  DAILY LIST']),
  '    DATE:  17 November 2026',
  '    ' + '-'.repeat(92),
  at([4, 'WELL NAME'], [28, 'LICENCE NUMBER']),
  '    ' + '-'.repeat(92),
  '',
  at([4, 'EXAMPLE HZ TESTVILLE 1-2-3-4'], [41, '0526001'], [51, 'ALBERTA CROWN'], [72, '700.1M']),
  at([4, '100/01-02-003-04W5/00'], [27, 'S  120.5M  W  80.0M'], [51, 'RED DEER'], [72, '2500.0M']),
  at([4, 'DEV (NC)'], [41, 'TESTFIELD'], [72, 'CARDIUM FM']),
  at([4, 'HORIZONTAL'], [41, 'NEW'], [51, 'PRODUCTION'], [72, 'CRUDE OIL']),
  at([4, 'EXAMPLE ENERGY LTD.'], [72, '10-12-095-05W4']),
  '',
  '    -------------------- END OF WELL LICENCES DAILY LIST  -------------------- ',
].join('\n');

const WIDTHS = [19, 34, 7, 6, 30, 6, 23, 14, 5, 34, 13, 11];
const ST49 = [
  'Report Number: ST-49' + ' '.repeat(40) + 'Alberta Energy Regulator',
  'Run Date: 17 Nov 2026' + ' '.repeat(40) + 'DAILY DRILLING ACTIVITY LIST',
  ' '.repeat(40) + 'For the Notification Period 16 Nov 2026 To 17 Nov 2026',
  '',
  WIDTHS.map((w) => '-'.repeat(w)).join(' '),
  [
    '02/02-27-017-13W4/0',
    'EXAMPLE HZ TESTVILLE 2-27-17-13',
    '0526001',
    'A1XX',
    'Example Drilling Inc.',
    '11',
    '15 Nov 2026 08:30:15 PM',
    'Medicine Hat',
    'A7XX',
    'Example Energy Ltd.',
    '',
    'Drill to LD',
  ]
    .map((cell, k) => cell.padEnd(WIDTHS[k] ?? 0))
    .join(' '),
  '',
  '        *** END OF REPORT ***',
].join('\n');

/** The address a fetch was called with. */
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/plain' }, ...init });
}

describe('the AER addresses', () => {
  it('are the 14 fixed final addresses', () => {
    expect(AER_SOURCES).toHaveLength(14);
    expect(AER_SOURCES[0]).toEqual({
      report: 'st1',
      url: 'https://static.aer.ca/prd/data/well-lic/WELLSMON.TXT',
    });
    expect(AER_SOURCES[7]).toEqual({
      report: 'st49',
      url: 'https://static.aer.ca/prd/data/wells/SPUDMon.txt',
    });
  });
});

describe('fetchAerList', () => {
  it('keeps a plain text list and refuses redirects, errors, HTML and oversized files', async () => {
    const ok = vi.fn<typeof fetch>(() => Promise.resolve(text(ST1)));
    expect(await fetchAerList('https://x.test/a', ok)).toEqual({ kind: 'ok', body: ST1 });
    expect(ok.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });

    const thrown = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('redirect')));
    expect(await fetchAerList('https://x.test/a', thrown)).toMatchObject({ kind: 'failed' });
    const missing = vi.fn<typeof fetch>(() => Promise.resolve(text('gone', { status: 404 })));
    expect(await fetchAerList('https://x.test/a', missing)).toMatchObject({ kind: 'failed' });
    const html = vi.fn<typeof fetch>(() =>
      Promise.resolve(text('<p>x</p>', { headers: { 'Content-Type': 'text/html' } })),
    );
    expect(await fetchAerList('https://x.test/a', html)).toMatchObject({ kind: 'refused' });
    const htmlBody = vi.fn<typeof fetch>(() => Promise.resolve(text('  <!DOCTYPE html><p>')));
    expect(await fetchAerList('https://x.test/a', htmlBody)).toMatchObject({ kind: 'refused' });
    const big = vi.fn<typeof fetch>(() =>
      Promise.resolve(text('x'.repeat(AER_LIST_MAX_CHARS + 1))),
    );
    expect(await fetchAerList('https://x.test/a', big)).toEqual({
      kind: 'refused',
      reason: 'too large',
    });
  });

  it('keeps a list whose headings changed (the reader decides, the file is never lost)', async () => {
    const changed = ST1.replace('WELL LICENCES ISSUED', 'Well Licences Issued');
    const res = await fetchAerList('https://x.test/a', () => Promise.resolve(text(changed)));
    expect(res).toEqual({ kind: 'ok', body: changed });
  });
});

describe('readAerFile', () => {
  it('reads ST1 licences and ST49 activity, converting times with seconds', () => {
    expect(readAerFile('st1', ST1)).toMatchObject({
      status: 'read',
      listDate: '2026-11-17',
      skipped: 0,
      licences: [{ licenceNumber: '0526001', surfaceLocation: '10-12-095-05W4' }],
    });
    const rigs = readAerFile('st49', ST49);
    expect(rigs).toMatchObject({ status: 'read', listDate: '2026-11-17' });
    // 8:30:15 PM in Alberta (UTC−6 all year in the platform) is 02:30:15 UTC the next day.
    expect(rigs.status !== 'unreadable' && rigs.rigs[0]?.activityAt).toBe(
      '2026-11-16T02:30:15.000Z',
    );
  });

  it('is unreadable without the list structure', () => {
    expect(readAerFile('st1', 'ALBERTA ENERGY REGULATOR')).toEqual({ status: 'unreadable' });
    expect(readAerFile('st49', 'Report Number: ST-49')).toEqual({ status: 'unreadable' });
  });
});

describe('the township grid', () => {
  it('asks with numbers only', () => {
    expect(lsdWhere([{ lsd: 10, section: 12, township: 95, range: 5, meridian: 4 }])).toBe(
      '(M=4 AND RGE=5 AND TWP=95 AND SEC=12 AND LS=10)',
    );
    expect(() =>
      lsdWhere([{ lsd: 1.5, section: 1, township: 1, range: 1, meridian: 4 }]),
    ).toThrow();
  });

  it('places each subdivision at its largest piece, and marks the rest not found', () => {
    const asked = [
      { lsd: 10, section: 12, township: 95, range: 5, meridian: 4 },
      { lsd: 11, section: 12, township: 95, range: 5, meridian: 4 },
      { lsd: 12, section: 12, township: 95, range: 5, meridian: 4 },
    ];
    const square = (x: number, y: number, size: number) => [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ];
    const props = (ls: number) => ({ M: 4, RGE: 5, TWP: 95, SEC: 12, LS: ls });
    const body = {
      features: [
        {
          properties: props(10),
          geometry: { type: 'Polygon', coordinates: [square(-110.7, 57.2, 0.002)] },
        },
        {
          properties: props(10),
          geometry: { type: 'Polygon', coordinates: [square(-110.6, 57.3, 0.006)] },
        },
        // Outside Alberta: not found.
        {
          properties: props(12),
          geometry: { type: 'Polygon', coordinates: [square(-100, 57, 0.01)] },
        },
      ],
    };
    expect(pointsFromGrid(asked, body)).toEqual([
      { ...asked[0], point: { longitude: -110.597, latitude: 57.303 } },
      { ...asked[1], point: null },
      { ...asked[2], point: null },
    ]);
    expect(() => pointsFromGrid(asked, { error: 'x' })).toThrow();
  });
});

describe('refreshAerLists', () => {
  const env = {
    ...ENV,
    PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
  };
  let petroleum = fakePetroleum();
  const open = vi.fn<PetroleumFactory>(() => petroleum);
  let logs: string[] = [];

  beforeEach(() => {
    petroleum = fakePetroleum();
    open.mockClear();
    logs = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((line: unknown) => {
        logs.push(String(line));
      });
    }
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function fetchFor(answers: Record<string, () => Response>) {
    return vi.fn<typeof fetch>((input) => {
      const url = urlOf(input);
      const answer = answers[url];
      return Promise.resolve(answer ? answer() : text('missing', { status: 404 }));
    });
  }

  it('does nothing without the oil and gas database, or before its migration', async () => {
    expect(await refreshAerLists(ENV, open, fetchFor({}))).toEqual({ status: 'not_configured' });
    expect(open).not.toHaveBeenCalled();
    petroleum.schemaVersion.mockResolvedValue(PETROLEUM_SCHEMA_VERSION - 1);
    const fetchImpl = fetchFor({});
    expect(await refreshAerLists(env, open, fetchImpl)).toEqual({ status: 'not_ready' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(petroleum.close).toHaveBeenCalled();
  });

  it('captures each file before reading it, then reads the new ones first', async () => {
    const order: string[] = [];
    petroleum.aerCapture.mockImplementation((report) => {
      order.push(`capture ${report}`);
      return Promise.resolve({ fileId: `file-${report}`, newFile: true, newEdition: true });
    });
    petroleum.aerFilesToRead.mockImplementation(() => {
      order.push('files to read');
      return Promise.resolve([
        { id: 'file-st1', report: 'st1', body: ST1 },
        { id: 'file-st49', report: 'st49', body: ST49 },
      ]);
    });
    const st1Url = AER_SOURCES[0]?.url ?? '';
    const st49Url = AER_SOURCES[7]?.url ?? '';
    const result = await refreshAerLists(
      env,
      open,
      fetchFor({ [st1Url]: () => text(ST1), [st49Url]: () => text(ST49) }),
    );
    expect(result).toEqual({ status: 'done' });
    expect(order).toEqual(['capture st1', 'capture st49', 'files to read']);
    expect(petroleum.aerCapture).toHaveBeenCalledWith('st1', st1Url, ST1, await bodySha256(ST1));
    expect(petroleum.aerFilesToRead).toHaveBeenCalledWith(
      AER_READER_VERSION,
      ['file-st1', 'file-st49'],
      50,
    );
    expect(petroleum.aerStoreReading).toHaveBeenCalledWith(
      'file-st1',
      AER_READER_VERSION,
      expect.objectContaining({ status: 'read', listDate: '2026-11-17' }),
    );
    // Counts only: never a file's contents.
    expect(logs.join('\n')).not.toContain('EXAMPLE');
    expect(logs).toContain(
      'AER ST1: 1 fetched, 1 new edition(s), 0 unchanged, 0 refused, 6 failed',
    );
  });

  it('leaves a file to be read again after a timeout or a lost connection (F-243-1-R1-02)', async () => {
    petroleum.aerFilesToRead.mockResolvedValue([{ id: 'file-1', report: 'st1', body: ST1 }]);
    for (const code of ['57014', '08006', undefined]) {
      petroleum.aerStoreReading.mockReset();
      petroleum.aerStoreReading.mockRejectedValueOnce(Object.assign(new Error('x'), { code }));
      expect(await refreshAerLists(env, open, fetchFor({}))).toEqual({ status: 'done' });
      // No second write marking it unreadable: the next run reads it again.
      expect(petroleum.aerStoreReading).toHaveBeenCalledTimes(1);
    }
  });

  it('records a reading the database refuses as unreadable, keeping the file', async () => {
    petroleum.aerFilesToRead.mockResolvedValue([{ id: 'file-1', report: 'st1', body: ST1 }]);
    petroleum.aerStoreReading
      .mockRejectedValueOnce(Object.assign(new Error('check'), { code: '23514' }))
      .mockResolvedValueOnce('stored');
    expect(await refreshAerLists(env, open, fetchFor({}))).toEqual({ status: 'done' });
    expect(petroleum.aerStoreReading).toHaveBeenLastCalledWith('file-1', AER_READER_VERSION, {
      status: 'unreadable',
    });
  });

  it('locates subdivisions in batches; a failed batch writes nothing', async () => {
    const pending = Array.from({ length: 45 }, (_, i) => ({
      lsd: (i % 16) + 1,
      section: Math.floor(i / 16) + 1,
      township: 95,
      range: 5,
      meridian: 4,
    }));
    petroleum.aerSubdivisionsToLocate.mockResolvedValue(pending);
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>((input, init) => {
      if (urlOf(input) !== ATS_LSD_QUERY) return Promise.resolve(text('missing', { status: 404 }));
      call += 1;
      expect(init?.body instanceof URLSearchParams && init.body.get('where')).toContain('M=4');
      return Promise.resolve(
        call === 1 ? Response.json({ features: [] }) : text('down', { status: 500 }),
      );
    });
    expect(await refreshAerLists(env, open, fetchImpl)).toEqual({ status: 'done' });
    expect(petroleum.aerStorePoints).toHaveBeenCalledTimes(1);
    expect(petroleum.aerStorePoints.mock.calls[0]?.[0]).toHaveLength(40);
    expect(logs).toContain('AER locations: 45 asked, 0 found, 40 not found, 5 failed');
  });
});

describe('the answers', () => {
  const dates = { latestListDate: '2026-11-17', lastSeenAt: '2026-11-18T14:15:00.000Z' };
  const licence = (n: string, located: boolean): AerLicenceServed => ({
    licenceNumber: n,
    wellName: 'EXAMPLE',
    licensee: 'EXAMPLE ENERGY LTD.',
    listDate: '2026-11-17',
    drillingOperation: 'HORIZONTAL',
    substance: 'CRUDE OIL',
    terminatingZone: 'CARDIUM FM',
    projectedDepth: '2500.0M',
    surfaceLocation: '10-12-095-05W4',
    longitude: located ? -110.6 : null,
    latitude: located ? 57.2 : null,
  });

  it('gives located licences as points with their list date, counts the rest, names the source', () => {
    const answer = licencesAnswer([licence('0526001', true), licence('0526002', false)], dates, 30);
    expect(answer.source).toEqual({
      name: 'Alberta Energy Regulator, ST1 Well Licences Issued – Daily List',
      preliminary: true,
      ...dates,
    });
    expect(answer.unlocated).toBe(1);
    expect(answer.truncated).toBe(false);
    expect(answer.located.features[0]).toEqual({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-110.6, 57.2] },
      properties: expect.objectContaining({ listDate: '2026-11-17', precision: 'lsd' }) as object,
    });
  });

  it('caps the features and says so', () => {
    const many = Array.from({ length: 5001 }, (_, i) => licence(String(5000000 + i), true));
    const answer = licencesAnswer(many, dates, 90);
    expect(answer.located.features).toHaveLength(5000);
    expect(answer.truncated).toBe(true);
  });

  it('lists rigs without a placed licence apart, each with its list date', () => {
    const rig: AerRigServed = {
      wellId: '02/02-27-017-13W4/0',
      wellName: 'EXAMPLE',
      licenceNumber: '0526001',
      licenseeName: 'Example Energy Ltd.',
      contractorName: 'Example Drilling Inc.',
      rigNumber: '11',
      activityType: 'Drill to LD',
      activityAt: '2026-11-16T02:30:15.000Z',
      listDate: '2026-11-17',
      surfaceLocation: null,
      longitude: null,
      latitude: null,
    };
    const answer = rigsAnswer([rig], dates, 7);
    expect(answer.located.features).toEqual([]);
    expect(answer.unlocated).toEqual([expect.objectContaining({ listDate: '2026-11-17' })]);
  });

  it('starts a period at the Alberta date the given days ago', () => {
    expect(periodStart(new Date('2026-11-19T05:00:00Z'), 7)).toBe('2026-11-11');
  });
});

describe('GET /api/v1/petroleum/aer/licences and /rigs', () => {
  let db = fakeDatabase();
  let petroleum = fakePetroleum();
  const openDatabase = vi.fn<(url: string) => Database>(() => db);
  const openPetroleum = vi.fn<PetroleumFactory>(() => petroleum);
  const app = createApp(openDatabase, { petroleum: openPetroleum, petroleumReadyCacheMs: 0 });
  const WITH_PETROLEUM = { ...ENV, PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.test/x' };
  const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };

  beforeEach(() => {
    mockAuthServer(Response.json({ id: USER_ID, email: 'adam@example.test' }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    db = fakeDatabase();
    petroleum = fakePetroleum();
    openDatabase.mockClear();
    openPetroleum.mockClear();
  });

  it('requires sign-in', async () => {
    for (const path of ['/api/v1/petroleum/aer/licences', '/api/v1/petroleum/aer/rigs']) {
      expect((await app.request(path, {}, WITH_PETROLEUM)).status).toBe(401);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('refuses a person with no active membership without opening the oil and gas database', async () => {
    for (const path of ['/api/v1/petroleum/aer/licences', '/api/v1/petroleum/aer/rigs']) {
      db.memberships.mockResolvedValueOnce([]);
      const res = await app.request(path, { headers: AUTH }, WITH_PETROLEUM);
      expect(res.status).toBe(403);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });

  it('lets a viewer read both, as themselves, with no caching', async () => {
    db.memberships.mockResolvedValue([
      { organizationId: 'org-a', organizationName: 'Synthetic Org A', role: 'viewer' },
    ]);
    const licences = await app.request(
      '/api/v1/petroleum/aer/licences?days=90',
      { headers: AUTH },
      WITH_PETROLEUM,
    );
    expect(licences.status).toBe(200);
    expect(licences.headers.get('Cache-Control')).toBe('no-store');
    expect(await licences.json()).toMatchObject({ days: 90, source: { preliminary: true } });
    expect(petroleum.aerLicences).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, organizationId: 'org-a', role: 'viewer' }),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
    );
    const rigs = await app.request('/api/v1/petroleum/aer/rigs', { headers: AUTH }, WITH_PETROLEUM);
    expect(rigs.status).toBe(200);
    expect(await rigs.json()).toMatchObject({ days: 7 });
  });

  it('refuses a period it does not offer', async () => {
    for (const path of [
      '/api/v1/petroleum/aer/licences?days=14',
      '/api/v1/petroleum/aer/licences?days=30.0',
      '/api/v1/petroleum/aer/rigs?days=90',
    ]) {
      const res = await app.request(path, { headers: AUTH }, WITH_PETROLEUM);
      expect(res.status).toBe(400);
    }
    expect(openPetroleum).not.toHaveBeenCalled();
  });
});
