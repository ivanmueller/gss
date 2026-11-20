import { describe, expect, it } from 'vitest';

import { parseWellPage } from './wells';

// Made-up wells in the service's layout (F-243 part 3).
const well = (objectId: number, extra: Record<string, unknown> = {}) => ({
  attributes: {
    OBJECTID: objectId,
    UWI: '0514250908000',
    WELL_NAME: 'EXAMPLE 1-2-3-4',
    OPERATOR: 'A62D',
    OPERATOR_NAME: 'Example Energy Ltd.',
    WELLTYPE: 'Abandoned Oil',
    CURRENT_STATUS: '0102000000',
    WELL_STATUS: 'Crude Oil/Abandon',
    FINAL_DRILL_DATE: '1949-07-02',
    SURFACE_LONGITUDE: 113.617905,
    SURFACE_LATITUDE: 53.386619,
    ...extra,
  },
});

describe('parseWellPage', () => {
  it('reads a well, storing longitude west as negative', () => {
    const page = parseWellPage({ features: [well(1)], exceededTransferLimit: false }, 2000);
    expect(page).toMatchObject({ unidentified: 0, lastObjectId: 1, more: false });
    expect(page.rows[0]).toEqual({
      uwi: '0514250908000',
      objectId: 1,
      wellName: 'EXAMPLE 1-2-3-4',
      operatorCode: 'A62D',
      operatorName: 'Example Energy Ltd.',
      wellType: 'Abandoned Oil',
      statusCode: '0102000000',
      status: 'Crude Oil/Abandon',
      finalDrillDate: '1949-07-02',
      longitude: -113.617905,
      latitude: 53.386619,
      invalid: [],
    });
  });

  it('keeps a well with a bad field as seen, naming the field (F-243-3-D1-01)', () => {
    const page = parseWellPage(
      {
        features: [
          well(1, { FINAL_DRILL_DATE: '1949-02-30' }),
          well(2, { UWI: '0514250908001', SURFACE_LONGITUDE: 90, SURFACE_LATITUDE: 40 }),
          well(3, { UWI: '0514250908002', WELL_NAME: 'x'.repeat(201), FINAL_DRILL_DATE: null }),
        ],
      },
      2000,
    );
    expect(page.rows.map((r) => [r.uwi, r.invalid])).toEqual([
      ['0514250908000', ['finalDrillDate']],
      ['0514250908001', ['location']],
      ['0514250908002', ['wellName']],
    ]);
    expect(page.rows[2]?.finalDrillDate).toBeNull();
  });

  it('keeps the stored value for a field missing from the answer or holding a NUL (F-243-3-R1-04, R1-05)', () => {
    const missing = well(1);
    const attributes = missing.attributes as Record<string, unknown>;
    delete attributes.OPERATOR_NAME;
    delete attributes.FINAL_DRILL_DATE;
    delete attributes.SURFACE_LONGITUDE;
    delete attributes.SURFACE_LATITUDE;
    const nul = well(2, { UWI: '0514250908001', WELL_NAME: 'BAD\u0000NAME' });
    const lone = well(3, { UWI: '0514250908002', OPERATOR_NAME: 'BAD \ud800' });
    const page = parseWellPage({ features: [missing, nul, lone] }, 2000);
    // F-243-3-R2-04: half of a character pair alone, refused by Postgres.
    expect(page.rows[2]?.invalid).toEqual(['operatorName']);
    expect([...(page.rows[0]?.invalid ?? [])].sort()).toEqual([
      'finalDrillDate',
      'location',
      'operatorName',
    ]);
    expect(page.rows[1]?.invalid).toEqual(['wellName']);
  });

  it('refuses a page it cannot trust: a bad continuation flag, or rows before the cursor (F-243-3-R1-01)', () => {
    expect(() =>
      parseWellPage({ features: [well(1)], exceededTransferLimit: 'yes' }, 2000),
    ).toThrow();
    expect(() => parseWellPage({ features: [well(5)] }, 2000, 5)).toThrow();
    expect(parseWellPage({ features: [well(6)] }, 2000, 5).lastObjectId).toBe(6);
  });

  it('counts rows without a valid UWI as unidentified', () => {
    const page = parseWellPage(
      { features: [well(1, { UWI: 'bad' }), well(2, { UWI: null })] },
      2000,
    );
    expect(page).toMatchObject({ rows: [], unidentified: 2, lastObjectId: 2 });
  });

  it('keeps one row per UWI, the highest OBJECTID (F-243-3-D1-04)', () => {
    const page = parseWellPage(
      { features: [well(7, { WELL_NAME: 'LATER' }), well(5, { WELL_NAME: 'EARLIER' })] },
      2000,
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0]).toMatchObject({ objectId: 7, wellName: 'LATER' });
  });

  it('says whether more follow, and refuses a page it cannot trust', () => {
    expect(parseWellPage({ features: [well(1)], exceededTransferLimit: true }, 2000).more).toBe(
      true,
    );
    expect(parseWellPage({ features: [well(1), well(2, { UWI: '0514250908001' })] }, 2).more).toBe(
      true,
    );
    expect(parseWellPage({ features: [] }, 2000)).toMatchObject({
      lastObjectId: null,
      more: false,
    });
    expect(() => parseWellPage({ error: { code: 400 } }, 2000)).toThrow();
    expect(() =>
      parseWellPage({ features: [{ attributes: { UWI: '0514250908000' } }] }, 2000),
    ).toThrow();
  });
});
