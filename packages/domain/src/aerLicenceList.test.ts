import { describe, expect, it } from 'vitest';

import {
  AER_LICENCE_LIST_HEADER,
  aerLicenceListNumber,
  csvFields,
  isAerLicenceListHeader,
  parseAerLicenceListLine,
} from './aerLicenceList';

// The AER's list of every well licence (F-282), read for the licences rigs are on. Made-up lines
// in the list's layout only.

describe('the list of every licence', () => {
  it('knows its header, with or without a byte order mark', () => {
    const header = AER_LICENCE_LIST_HEADER.join(',');
    expect(isAerLicenceListHeader(header)).toBe(true);
    expect(isAerLicenceListHeader(`${String.fromCharCode(0xfeff)}${header}\r`)).toBe(true);
    expect(isAerLicenceListHeader(header.replace('03.Latitude', 'Latitude'))).toBe(false);
  });

  it('splits quoted fields, commas and doubled quotes included', () => {
    expect(csvFields('a,"b, c","say ""hi""",')).toEqual(['a', 'b, c', 'say "hi"', '']);
    expect(csvFields('a,"never closed')).toBeNull();
  });

  it('reads the licence number cheaply, before the line', () => {
    expect(aerLicenceListNumber('W 0319903,Example Ltd.(A1XX),55.3,-118.5')).toBe('0319903');
    expect(aerLicenceListNumber('"W 0319903",x')).toBe('0319903');
    expect(aerLicenceListNumber('F 0001234,x')).toBeNull();
  });

  it('reads a licence with its point, and leaves out one with none or outside Alberta', () => {
    expect(
      parseAerLicenceListLine(
        'W 0500001,Example Energy Ltd.(A1XX),53.5123456,-116.4123454,10-12-055-05W5,280,J,Issued,03 Jan 2026,N,\r',
      ),
    ).toEqual({
      licenceNumber: '0500001',
      licensee: 'Example Energy Ltd.(A1XX)',
      latitude: 53.512346,
      longitude: -116.412345,
      surfaceLocation: '10-12-055-05W5',
      status: 'Issued',
    });
    const line = (lat: string, lon: string, place = '10-12-055-05W5') =>
      `W 0500001,Example Energy Ltd.(A1XX),${lat},${lon},${place},280,J,Issued,03 Jan 2026,N,`;
    expect(parseAerLicenceListLine(line('', ''))).toBeNull();
    expect(parseAerLicenceListLine(line('45.1', '-116.4'))).toBeNull();
    expect(parseAerLicenceListLine(line('53.5', '-116.4', '99-12-055-05W5'))).toBeNull();
    expect(parseAerLicenceListLine('W 0500001,too,few')).toBeNull();
  });
});
