import { describe, expect, it } from 'vitest';

import { rightsClauses, rightsIncluding, rightsOrder, rightsZones } from './landRights';

// Which rights include a play (F-241, F-242). Formations named ALPHA to ECHO are made up, in
// that order from the surface down; the play's own name is the Duvernay's.

const PNG = 'PETROLEUM AND NATURAL GAS';

describe('rightsClauses', () => {
  it('reads the three forms of a clause, without the province’s zone codes', () => {
    expect(rightsClauses(`${PNG} IN THE ALPHA FM(D6)`).clauses).toEqual([
      { excepting: false, upper: 'T:ALPHA FM', lower: 'B:ALPHA FM' },
    ]);
    expect(rightsClauses(`${PNG} FROM SURFACE TO THE BASE OF THE BRAVO GRP(D4)`).clauses).toEqual([
      { excepting: false, upper: 'SURFACE', lower: 'B:BRAVO GRP' },
    ]);
    expect(
      rightsClauses(`${PNG} BELOW THE TOP OF THE ALPHA FM(D6) TO THE BASE OF THE BRAVO GRP(D4)`)
        .clauses,
    ).toEqual([{ excepting: false, upper: 'T:ALPHA FM', lower: 'B:BRAVO GRP' }]);
    expect(rightsClauses(`${PNG} BELOW THE BASE OF THE ALPHA FM TO BASEMENT`).clauses).toEqual([
      { excepting: false, upper: 'B:ALPHA FM', lower: 'BASEMENT' },
    ]);
  });

  it('reads several clauses, other substances and what is excepted', () => {
    const read = rightsClauses(
      `${PNG} FROM SURFACE TO BASEMENT EXCEPTING NATURAL GAS IN THE ALPHA FM(D6) PETROLEUM IN THE BRAVO GRP`,
    );
    expect(read.unread).toBe(0);
    expect(read.clauses).toEqual([
      { excepting: false, upper: 'SURFACE', lower: 'BASEMENT' },
      { excepting: true, upper: 'T:ALPHA FM', lower: 'B:ALPHA FM' },
      { excepting: false, upper: 'T:BRAVO GRP', lower: 'B:BRAVO GRP' },
    ]);
  });

  it('counts what it cannot read, and takes nothing from it', () => {
    expect(rightsClauses('COAL FROM SURFACE TO BASEMENT')).toEqual({ clauses: [], unread: 1 });
    expect(rightsClauses(`${PNG} BELOW THE BASE OF THE ALPHA FM`)).toEqual({
      clauses: [],
      unread: 1,
    });
    expect(rightsClauses('')).toEqual({ clauses: [], unread: 0 });
  });
});

// What the zones say of the order: ALPHA above BRAVO above the Duvernay above DELTA above ECHO.
const EVIDENCE = [
  `${PNG} BELOW THE BASE OF THE ALPHA FM TO THE BASE OF THE BRAVO GRP`,
  `${PNG} BELOW THE BASE OF THE BRAVO GRP TO THE BASE OF THE DUVERNAY FM(D286)`,
  `${PNG} BELOW THE BASE OF THE DUVERNAY-MAJEAU LAKE FM(D287) TO THE BASE OF THE DELTA GRP`,
  `${PNG} BELOW THE BASE OF THE DUVERNAY FM(D286) TO THE TOP OF THE DELTA GRP`,
  `${PNG} BELOW THE BASE OF THE DELTA GRP TO THE BASE OF THE ECHO FM`,
];

describe('rightsIncluding', () => {
  const includes = rightsIncluding(rightsOrder(EVIDENCE), 'duvernay');

  it('counts rights in the play, across it, down into it and up out of it', () => {
    for (const zone of [
      `${PNG} IN THE DUVERNAY FM(D286)`,
      `${PNG} FROM SURFACE TO BASEMENT`,
      `${PNG} FROM SURFACE TO THE BASE OF THE DUVERNAY FM(D286)`,
      `${PNG} BELOW THE TOP OF THE DUVERNAY FM(D286) TO BASEMENT`,
      // From a formation the zones place above it, to basement or to a deeper base.
      `${PNG} BELOW THE BASE OF THE ALPHA FM TO BASEMENT`,
      `${PNG} BELOW THE BASE OF THE BRAVO GRP TO THE BASE OF THE ECHO FM`,
      `${PNG} FROM SURFACE TO THE BASE OF THE DELTA GRP`,
      `${PNG} FROM SURFACE TO THE TOP OF THE DELTA GRP`,
      // One clause of several is enough.
      `${PNG} IN THE ALPHA FM ${PNG} BELOW THE BASE OF THE BRAVO GRP TO BASEMENT`,
    ]) {
      expect(includes(zone), zone).toBe(true);
    }
  });

  it('leaves out rights that stop above it or start below it', () => {
    for (const zone of [
      `${PNG} FROM SURFACE TO THE BASE OF THE BRAVO GRP`,
      `${PNG} BELOW THE BASE OF THE ALPHA FM TO THE TOP OF THE DUVERNAY FM(D286)`,
      `${PNG} BELOW THE BASE OF THE DUVERNAY FM(D286) TO BASEMENT`,
      `${PNG} BELOW THE BASE OF THE DELTA GRP TO BASEMENT`,
      `${PNG} IN THE ECHO FM`,
      `${PNG} IN THE ALPHA FM`,
      null,
    ]) {
      expect(includes(zone), String(zone)).toBe(false);
    }
  });

  it('leaves out what the zones do not settle, and what is only excepted', () => {
    // A formation no zone places against the play.
    expect(includes(`${PNG} BELOW THE BASE OF THE UNPLACED FM TO BASEMENT`)).toBe(false);
    expect(includes(`${PNG} FROM SURFACE TO THE BASE OF THE UNPLACED FM`)).toBe(false);
    expect(includes(`${PNG} IN THE ALPHA FM EXCEPTING ${PNG} IN THE DUVERNAY FM(D286)`)).toBe(
      false,
    );
  });

  it('counts nothing where two zones contradict each other on the order', () => {
    const muddled = rightsIncluding(
      rightsOrder([
        ...EVIDENCE,
        // Says DELTA's base lies above the Duvernay's: against the zones above.
        `${PNG} BELOW THE BASE OF THE DELTA GRP TO THE BASE OF THE DUVERNAY FM(D286)`,
      ]),
      'duvernay',
    );
    expect(muddled(`${PNG} BELOW THE BASE OF THE DELTA GRP TO BASEMENT`)).toBe(false);
    expect(muddled(`${PNG} BELOW THE BASE OF THE ALPHA FM TO BASEMENT`)).toBe(true);
  });

  it('counts nothing for a play it does not know, or one no zone names', () => {
    expect(
      rightsIncluding(rightsOrder(EVIDENCE), 'another')(`${PNG} FROM SURFACE TO BASEMENT`),
    ).toBe(false);
    const none = rightsIncluding(rightsOrder([`${PNG} IN THE ALPHA FM`]), 'duvernay');
    expect(none(`${PNG} FROM SURFACE TO BASEMENT`)).toBe(false);
  });
});

describe('rightsZones', () => {
  it('keeps the zones that include the play, reading the order from them all', () => {
    const zones = [
      ...EVIDENCE,
      `${PNG} BELOW THE BASE OF THE ALPHA FM TO BASEMENT`,
      `${PNG} FROM SURFACE TO THE BASE OF THE BRAVO GRP`,
    ];
    expect(rightsZones(zones, 'duvernay')).toEqual([
      // Down to the Duvernay's base; the two that start at its base are below it.
      EVIDENCE[1],
      `${PNG} BELOW THE BASE OF THE ALPHA FM TO BASEMENT`,
    ]);
  });
});
