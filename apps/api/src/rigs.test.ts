import { deflateRawSync } from 'node:zlib';

import { AER_LICENCE_LIST_HEADER, AER_LICENCE_LIST_URL } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveDayName,
  fetchRigArchive,
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
function zipOf(files: { name: string; body: string; stored?: boolean }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = bytes(file.name);
    const raw = bytes(file.body);
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
