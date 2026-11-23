import { deflateRawSync } from 'node:zlib';

import { AER_LICENCE_LIST_HEADER, AER_LICENCE_LIST_URL } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveDayName,
  fetchRigArchive,
  fetchZipEntries,
  licenceArchiveUrls,
  licenceDayName,
  readLicenceTargets,
  RIG_TARGETS_SCHEMA_VERSION,
  readLicenceList,
  refreshAerLists,
  rigArchiveMonths,
  rigArchiveUrl,
  RIGS_SCHEMA_VERSION,
} from './aer-lists';
import type { PetroleumFactory } from './petroleum-db';
import { ENV } from './testing/helpers';
import { fakePetroleum } from './testing/petroleum';
import { readZip, ZipError } from './zip';

// Rigs on the oil and gas map (F-282): the AER's monthly rig archives and its list of every
// licence, read by the twice-daily job. Made-up files in the AER's layouts only (the AER's data is
// not under an open licence: docs/DECISIONS.md, 2026-11-19).

const bytes = (text: string) => new TextEncoder().encode(text);

/** A zip of the given files, deflated (or stored), as the AER's archives are made. */
function zipOf(files: { name: string; body: string | Uint8Array; stored?: boolean }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = bytes(file.name);
    const raw = typeof file.body === 'string' ? bytes(file.body) : file.body;
    const data = file.stored ? raw : new Uint8Array(deflateRawSync(raw));
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, file.stored ? 0 : 8, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, file.stored ? 0 : 8, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    locals.push(local);
    central.push(entry);
    offset += local.length;
  }
  const directorySize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + directorySize + 22);
  let at = 0;
  for (const part of [...locals, ...central, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A zip of zips (or any bytes), stored as they are given. */
function zipOfBytes(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  return zipOf(files.map((f) => ({ name: f.name, body: f.bytes })));
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

/** A body streamed in small pieces, as a large download arrives. */
function streamed(text: string, piece = 37): Response {
  const all = bytes(text);
  let at = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= all.length) {
        controller.close();
        return;
      }
      controller.enqueue(all.slice(at, at + piece));
      at += piece;
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/csv' } });
}

const HEADER = AER_LICENCE_LIST_HEADER.join(',');
const LIST = [
  HEADER,
  'W 0500001,Example Energy Ltd.(A1XX),53.512345,-116.412345,10-12-055-05W5,280,J,Issued,03 Jan 2026,N,',
  'W 0500002,"Example, Resources Inc.(A2XX)",54.1,-117.2,01-01-060-10W5,280,J,Amended,04 Jan 2026,N,',
  'W 0500003,Example Energy Ltd.(A1XX),,,01-01-060-10W5,280,J,Issued,04 Jan 2026,N,',
].join('\r\n');

describe('the zip reader', () => {
  it('opens deflated and stored files, folders left out', async () => {
    const zip = zipOf([
      { name: 'spud2026-09/', body: '', stored: true },
      { name: 'spud2026-09/SPUD0901.txt', body: 'first day '.repeat(50) },
      { name: 'spud2026-09/SPUD0902.txt', body: 'second day', stored: true },
    ]);
    const entries = await readZip(zip, 10_000);
    expect(entries.map((e) => e.name)).toEqual([
      'spud2026-09/SPUD0901.txt',
      'spud2026-09/SPUD0902.txt',
    ]);
    expect(new TextDecoder().decode(entries[0]?.bytes)).toBe('first day '.repeat(50));
    expect(new TextDecoder().decode(entries[1]?.bytes)).toBe('second day');
  });

  it('refuses what is not a zip, a file too large and too many files', async () => {
    await expect(readZip(bytes('not a zip at all, just text'), 100)).rejects.toThrow(ZipError);
    const zip = zipOf([{ name: 'SPUD0901.txt', body: 'x'.repeat(500) }]);
    await expect(readZip(zip, 100)).rejects.toThrow('too large');
    const many = zipOf([
      { name: 'a.txt', body: 'a' },
      { name: 'b.txt', body: 'b' },
    ]);
    await expect(readZip(many, 100, 1)).rejects.toThrow('too many');
  });
});

describe('the rig archives', () => {
  it('covers the months of the last 95 days in Alberta, this month left out', () => {
    // 23 November 2026 in Alberta: 95 days before is 20 August.
    expect(rigArchiveMonths(new Date('2026-11-23T18:00:00Z'))).toEqual([
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    // Across a new year.
    expect(rigArchiveMonths(new Date('2027-01-10T18:00:00Z'))).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
    ]);
    expect(rigArchiveUrl('2026-09')).toBe('https://static.aer.ca/prd/data/wells/spud2026-09.zip');
  });

  it('takes only the day files, by their names without folders', () => {
    expect(archiveDayName('spud2026-09/SPUD0901.txt')).toBe('SPUD0901.txt');
    expect(archiveDayName('SPUD0831.TXT')).toBe('SPUD0831.TXT');
    expect(archiveDayName('spud2026-09/readme.pdf')).toBeNull();
    expect(archiveDayName('spud2026-09/SPUD09011.txt')).toBeNull();
  });

  it('fetches a month and gives its day files, or why not', async () => {
    const zip = zipOf([
      { name: 'spud2026-09/SPUD0901.txt', body: 'day one' },
      { name: 'spud2026-09/notes.txt', body: 'not a day' },
    ]);
    const ok = await fetchRigArchive('https://x.test/a.zip', () =>
      Promise.resolve(new Response(zip, { status: 200 })),
    );
    expect(ok).toMatchObject({ kind: 'ok', files: [{ name: 'SPUD0901.txt', body: 'day one' }] });
    const missing = await fetchRigArchive('https://x.test/a.zip', () =>
      Promise.resolve(new Response('Not found', { status: 404 })),
    );
    expect(missing).toEqual({ kind: 'failed', reason: 'status 404' });
    const page = await fetchRigArchive('https://x.test/a.zip', () =>
      Promise.resolve(new Response('<html></html>', { status: 200 })),
    );
    expect(page.kind).toBe('refused');
  });
});

describe('the list of every licence', () => {
  it('finds the licences wanted, read in pieces, and says when it read the whole list', async () => {
    const list = await readLicenceList(new Set(['0500001', '0500002', '0599999']), () =>
      Promise.resolve(streamed(LIST)),
    );
    expect(list).toEqual({
      kind: 'ok',
      whole: true,
      found: [
        {
          licenceNumber: '0500001',
          licensee: 'Example Energy Ltd.(A1XX)',
          latitude: 53.512345,
          longitude: -116.412345,
          surfaceLocation: '10-12-055-05W5',
          status: 'Issued',
        },
        expect.objectContaining({
          licenceNumber: '0500002',
          licensee: 'Example, Resources Inc.(A2XX)',
        }),
      ],
    });
  });

  it('stops once every licence wanted is found, without calling the rest missing', async () => {
    const list = await readLicenceList(new Set(['0500001']), () => Promise.resolve(streamed(LIST)));
    expect(list).toMatchObject({ kind: 'ok', whole: false, found: [{ licenceNumber: '0500001' }] });
  });

  it('leaves out a licence with no point, and refuses a list with another header', async () => {
    const none = await readLicenceList(new Set(['0500003']), () => Promise.resolve(streamed(LIST)));
    expect(none).toEqual({ kind: 'ok', whole: true, found: [] });
    const other = await readLicenceList(new Set(['0500001']), () =>
      Promise.resolve(streamed(LIST.replace('01.Licence Number', 'Licence'))),
    );
    expect(other).toEqual({ kind: 'refused', reason: 'another header' });
  });
});

describe('the job, rigs on the map', () => {
  const env = {
    ...ENV,
    PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
  };
  let petroleum = fakePetroleum();
  const open = vi.fn<PetroleumFactory>(() => petroleum);

  beforeEach(() => {
    petroleum = fakePetroleum();
    petroleum.schemaVersion.mockResolvedValue(RIGS_SCHEMA_VERSION);
    vi.useFakeTimers({ now: new Date('2026-11-23T18:00:00Z'), toFake: ['Date'] });
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation(() => undefined);
    }
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps each day of the months not kept yet, at its own address, then reads them first', async () => {
    petroleum.aerArchiveMonthsKept.mockResolvedValue(['2026-08']);
    petroleum.aerCapture.mockImplementation((_report, url) =>
      Promise.resolve({ fileId: `file:${url}`, newFile: true, newEdition: true }),
    );
    const zip = zipOf([
      { name: 'spud2026-09/SPUD0901.txt', body: 'day one' },
      { name: 'spud2026-09/SPUD0902.txt', body: 'day two' },
    ]);
    const asked: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = urlOf(input);
      asked.push(url);
      return Promise.resolve(
        url === rigArchiveUrl('2026-09')
          ? new Response(zip, { status: 200 })
          : new Response('missing', { status: 404 }),
      );
    });
    expect(await refreshAerLists(env, open, fetchImpl)).toEqual({ status: 'done' });
    // August is kept; September is fetched; October is not posted yet (asked, 404).
    expect(asked).not.toContain(rigArchiveUrl('2026-08'));
    expect(asked).toContain(rigArchiveUrl('2026-10'));
    const archiveUrl = rigArchiveUrl('2026-09');
    expect(petroleum.aerCapture).toHaveBeenCalledWith(
      'st49',
      `${archiveUrl}#SPUD0901.txt`,
      'day one',
      expect.any(String),
      expect.any(Date),
    );
    expect(petroleum.aerFilesToRead).toHaveBeenCalledWith(
      expect.any(Number),
      [`file:${archiveUrl}#SPUD0901.txt`, `file:${archiveUrl}#SPUD0902.txt`],
      150,
    );
  });

  it('reads the list of every licence only for rigs with no location, marking missing ones only after the whole list', async () => {
    const fetchImpl = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        urlOf(input) === AER_LICENCE_LIST_URL
          ? streamed(LIST, 4096)
          : new Response('missing', { status: 404 }),
      ),
    );
    // None wanted: the list is never downloaded.
    await refreshAerLists(env, open, fetchImpl);
    expect(fetchImpl.mock.calls.map(([input]) => urlOf(input))).not.toContain(AER_LICENCE_LIST_URL);
    expect(petroleum.aerLicencesToLocate).toHaveBeenCalledWith('2026-08-20', 3000);

    petroleum.aerLicencesToLocate.mockResolvedValue(['0500001', '0599999']);
    await refreshAerLists(env, open, fetchImpl);
    expect(petroleum.aerStoreLicenceLocations).toHaveBeenCalledWith(
      [expect.objectContaining({ licenceNumber: '0500001', surfaceLocation: '10-12-055-05W5' })],
      ['0599999'],
    );
  });

  it('skips the rig steps before the rigs migration', async () => {
    petroleum.schemaVersion.mockResolvedValue(RIGS_SCHEMA_VERSION - 1);
    const fetchImpl = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('missing', { status: 404 })),
    );
    await refreshAerLists(env, open, fetchImpl);
    expect(petroleum.aerArchiveMonthsKept).not.toHaveBeenCalled();
    expect(petroleum.aerLicencesToLocate).not.toHaveBeenCalled();
  });
});

// What each rig is drilling for (F-283): the licence's terminating zone from the AER's ST1
// archives. Made-up lists in the ST1 layout only.

function at(...cells: [number, string][]): string {
  let line = '';
  for (const [column, text] of cells) line = line.padEnd(column) + text;
  return line;
}

/** A made-up daily licence list of one licence. */
function st1(date: string, licence: string, zone: string): string {
  return [
    at([40, 'ALBERTA ENERGY REGULATOR']),
    at([35, 'WELL LICENCES ISSUED  DAILY LIST']),
    `    DATE:  ${date}`,
    '    ' + '-'.repeat(92),
    at([4, 'WELL NAME'], [28, 'LICENCE NUMBER']),
    '    ' + '-'.repeat(92),
    '',
    at([4, 'EXAMPLE HZ TESTVILLE 1-2-3-4'], [41, licence], [51, 'ALBERTA CROWN'], [72, '700.1M']),
    at(
      [4, '100/01-02-003-04W5/00'],
      [27, 'S  120.5M  W  80.0M'],
      [51, 'RED DEER'],
      [72, '2500.0M'],
    ),
    at([4, 'DEV (NC)'], [41, 'TESTFIELD'], [72, zone]),
    at([4, 'HORIZONTAL'], [41, 'NEW'], [51, 'PRODUCTION'], [72, 'CRUDE OIL']),
    at([4, 'EXAMPLE ENERGY LTD.'], [72, '10-12-095-05W4']),
    '',
    '    -------------------- END OF WELL LICENCES DAILY LIST  -------------------- ',
  ].join('\n');
}

const zipBytes = (files: { name: string; body: string }[]) => zipOf(files);
/** A year's file: a zip of monthly zips, as the AER makes them. */
function yearZip(months: { name: string; files: { name: string; body: string }[] }[]) {
  return zipOfBytes(months.map((m) => ({ name: m.name, bytes: zipBytes(m.files) })));
}

describe('the licence archives (F-283)', () => {
  it('are this year’s months before this one, newest first, then each year back to 2017', () => {
    const urls = licenceArchiveUrls(new Date('2026-03-10T18:00:00Z'));
    expect(urls.slice(0, 3)).toEqual([
      {
        url: 'https://static.aer.ca/prd/data/well-lic/dwll2026-02.zip',
        year: 2026,
        monthly: true,
      },
      {
        url: 'https://static.aer.ca/prd/data/well-lic/dwll2026-01.zip',
        year: 2026,
        monthly: true,
      },
      { url: 'https://static.aer.ca/prd/data/well-lic/dwll2025.zip', year: 2025, monthly: false },
    ]);
    expect(urls.at(-1)?.url).toBe('https://static.aer.ca/prd/data/well-lic/dwll2017.zip');
    expect(licenceDayName('dwll2026-09/WELLS0901.TXT')).toBe('WELLS0901.TXT');
    expect(licenceDayName('dwll2026-09/SPUD0901.txt')).toBeNull();
  });

  it('opens the zips inside a year’s file', async () => {
    const year = yearZip([
      { name: 'dwll2025-01.zip', files: [{ name: 'WELLS0102.TXT', body: 'one' }] },
      { name: 'dwll2025-02.zip', files: [{ name: 'WELLS0203.TXT', body: 'two' }] },
    ]);
    const got = await fetchZipEntries('https://x.test/y.zip', () =>
      Promise.resolve(new Response(year, { status: 200 })),
    );
    expect(got.kind === 'ok' ? got.entries.map((e) => e.name) : got).toEqual([
      'WELLS0102.TXT',
      'WELLS0203.TXT',
    ]);
  });

  it('takes each licence’s zone from its newest list, stops once all are found, and counts a month not posted as read', async () => {
    const asked: string[] = [];
    const answers: Record<string, () => Response> = {
      // February not posted yet; January has an amendment of an older licence.
      'https://static.aer.ca/prd/data/well-lic/dwll2026-01.zip': () =>
        new Response(
          zipBytes([
            { name: 'WELLS0115.TXT', body: st1('15 January 2026', '0500001', 'MONTNEY FM') },
          ]),
          { status: 200 },
        ),
      'https://static.aer.ca/prd/data/well-lic/dwll2025.zip': () =>
        new Response(
          yearZip([
            {
              name: 'dwll2025-06.zip',
              files: [
                { name: 'WELLS0602.TXT', body: st1('2 June 2025', '0500001', 'DOIG FM') },
                { name: 'WELLS0603.TXT', body: st1('3 June 2025', '0500002', 'CARDIUM FM') },
              ],
            },
          ]),
          { status: 200 },
        ),
    };
    const fetchImpl = vi.fn<typeof fetch>((input) => {
      const url = urlOf(input);
      asked.push(url);
      return Promise.resolve(answers[url]?.() ?? new Response('missing', { status: 404 }));
    });
    const result = await readLicenceTargets(
      new Set(['0500001', '0500002']),
      fetchImpl,
      new Date('2026-03-10T18:00:00Z'),
    );
    expect(result.found).toEqual(
      expect.arrayContaining([
        { licenceNumber: '0500001', terminatingZone: 'MONTNEY FM', listDate: '2026-01-15' },
        { licenceNumber: '0500002', terminatingZone: 'CARDIUM FM', listDate: '2025-06-03' },
      ]),
    );
    // Both found by 2025: 2024 and earlier are never asked for.
    expect(asked).not.toContain('https://static.aer.ca/prd/data/well-lic/dwll2024.zip');
    expect(result.whole).toBe(true);
  });

  it('says it did not read every archive when a year cannot be fetched', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await readLicenceTargets(
      new Set(['0599999']),
      () => Promise.resolve(new Response('missing', { status: 404 })),
      new Date('2026-03-10T18:00:00Z'),
    );
    // The months not posted are fine; the years that 404 are failures.
    expect(result).toMatchObject({ found: [], whole: false, failed: 2025 - 2017 + 1 });
  });

  it('runs in the job only for licences with no target, marking the rest only after every archive', async () => {
    const env = {
      ...ENV,
      PETROLEUM_DATABASE_URL: 'postgresql://petro_api:x@db.example.test/postgres',
    };
    const petroleum = fakePetroleum();
    petroleum.schemaVersion.mockResolvedValue(RIG_TARGETS_SCHEMA_VERSION);
    petroleum.aerTargetsToFind.mockResolvedValue(['0500002']);
    for (const level of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation(() => undefined);
    }
    const year = new Date().getUTCFullYear();
    const fetchImpl = vi.fn<typeof fetch>((input) =>
      Promise.resolve(
        urlOf(input).endsWith(`/dwll${String(year - 1)}.zip`)
          ? new Response(
              yearZip([
                {
                  name: 'dwll-06.zip',
                  files: [
                    { name: 'WELLS0603.TXT', body: st1('3 June 2025', '0500002', 'VIKING FM') },
                  ],
                },
              ]),
              { status: 200 },
            )
          : new Response('missing', { status: 404 }),
      ),
    );
    await refreshAerLists(env, () => petroleum, fetchImpl);
    expect(petroleum.aerStoreTargets).toHaveBeenCalledWith(
      [{ licenceNumber: '0500002', terminatingZone: 'VIKING FM', listDate: '2025-06-03' }],
      [],
    );
  });
});
