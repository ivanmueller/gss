import { describe, expect, it } from 'vitest';

import {
  AER_LICENCE_LIST_HEADER,
  compareHoldings,
  holdingsOf,
  licenceListRequests,
  readLicenceHolders,
} from './index';

// Made-up companies and licences, in the lists' own form.
const WELL_HEADER = AER_LICENCE_LIST_HEADER.join(',');
const well = (licence: string, holder: string, status = 'Issued') =>
  `${licence},${holder},52.1,-114.2,04-31-035-10W4,360,J,${status},04 Jan 2020,N,`;
const PIPELINE_HEADER =
  '01.Licence Number,02.Licensee,03.Licence Status,04.Licence Status Date,05.Energy Development Category Type,06.H2S Content,07.Non-Routine Licence (Y or N),08.Non-Routine Status';

describe('the licence lists', () => {
  it('asks for the wells a status at a time, the others whole', () => {
    const requests = licenceListRequests();
    expect(requests.filter((r) => r.kind === 'well')).toHaveLength(6);
    expect(requests[0]?.url).toBe(
      'https://www2.aer.ca/t/Production/views/COM-WellLicenceAllList/WellLicenceAllAB.csv?Licence%20Status=Issued',
    );
    expect(requests.filter((r) => r.kind !== 'well').map((r) => r.status)).toEqual([null, null]);
  });

  it('reads each licence and its holder, names with commas and brackets among them', () => {
    const text = [
      `${String.fromCharCode(0xfeff)}${WELL_HEADER}`,
      well('W 0123456', 'Test Oil Corp.(A9BY)'),
      well('W 0123456A', '"Smith, Test (Trustee)(0ND3)"'),
      well('WB0002835', 'Example Energy Ltd.(0HE9)'),
      well('X 1', 'Test Oil Corp.(A9BY)'),
      well('W 0123457', 'No code here'),
      '',
    ].join('\r\n');
    const read = readLicenceHolders(text, 'well', 'Issued');
    expect(read.holders.map((h) => [h.licence, h.baCode, h.name])).toEqual([
      ['W 0123456', 'A9BY', 'Test Oil Corp.'],
      ['W 0123456A', '0ND3', 'Smith, Test (Trustee)'],
      ['WB0002835', '0HE9', 'Example Energy Ltd.'],
    ]);
    expect(read.skipped).toBe(2);
  });

  it('refuses a list with another header, or another status than asked for', () => {
    expect(() => readLicenceHolders(`${PIPELINE_HEADER}\n`, 'well')).toThrow(/header/);
    expect(() =>
      readLicenceHolders(
        [WELL_HEADER, well('W 0123456', 'Test Oil Corp.(A9BY)', 'Amended')].join('\n'),
        'well',
        'Issued',
      ),
    ).toThrow(/filter was not applied/);
    const pipes = readLicenceHolders(
      [PIPELINE_HEADER, 'P1,Test Pipelines Ltd.(0144),Issued,20 Feb 2002,PPL,0,N,'].join('\n'),
      'pipeline',
    );
    expect(pipes.holders).toEqual([
      { licence: 'P1', baCode: '0144', name: 'Test Pipelines Ltd.', status: 'Issued' },
    ]);
  });

  it('leaves out a licence listed under two companies', () => {
    const h = (licence: string, baCode: string) => ({
      licence,
      baCode,
      name: 'x',
      status: 'Issued',
    });
    const { holdings, ambiguous } = holdingsOf([
      [h('W 1', 'AAAA'), h('W 2', 'AAAA')],
      [h('W 2', 'BBBB'), h('W 3', 'CCCC'), h('W 3', 'CCCC'), h('W 2', 'AAAA')],
    ]);
    expect([...holdings]).toEqual([
      ['W 1', 'AAAA'],
      ['W 3', 'CCCC'],
    ]);
    expect(ambiguous).toBe(1);
  });
});

describe('comparing with the holders last known', () => {
  it('finds the licences that changed company, adds new ones and keeps those not listed today', () => {
    const previous = new Map([
      ['W 1', 'AAAA'],
      ['W 2', 'AAAA'],
      ['W 3', 'BBBB'],
    ]);
    const today = new Map([
      ['W 2', 'CCCC'],
      ['W 3', 'BBBB'],
      ['W 4', 'DDDD'],
    ]);
    const { changes, merged, added } = compareHoldings(previous, today);
    expect(changes).toEqual([{ licence: 'W 2', fromBa: 'AAAA', toBa: 'CCCC' }]);
    expect(added).toBe(1);
    // W 1, missing from today's lists, keeps its holder: never a transfer.
    expect([...merged].sort()).toEqual([
      ['W 1', 'AAAA'],
      ['W 2', 'CCCC'],
      ['W 3', 'BBBB'],
      ['W 4', 'DDDD'],
    ]);
  });

  it('records nothing on the first day', () => {
    const { changes, added } = compareHoldings(new Map(), new Map([['W 1', 'AAAA']]));
    expect(changes).toEqual([]);
    expect(added).toBe(1);
  });
});
