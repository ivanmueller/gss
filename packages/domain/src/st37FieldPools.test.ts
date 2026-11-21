import { describe, expect, it } from 'vitest';

import { buildSt37Wells, st37FieldPools } from './st37';

// The AER's field and pool list (ST103) and a well's field code (F-256). Made-up names and codes.

const HEADER =
  'Field Name\tProduction Pool Name\tField Code\tProduction Pool Code\tGeological Pool Code\tGeological Pool Name\tConfidential';

describe('st37FieldPools', () => {
  it('reads each field once and each pool once per field', () => {
    const list = st37FieldPools(
      [
        HEADER,
        'EXAMPLE NORTH\tEXAMPLE A\t990001\t728001\t728001\tEXAMPLE A\t',
        'EXAMPLE SOUTH\tEXAMPLE A\t990002\t728001\t728001\tEXAMPLE A\t',
        'EXAMPLE SOUTH\tEXAMPLE B\t990002\t728002\t728002\tEXAMPLE B\t',
        // The same pool again: the first line names it.
        'EXAMPLE SOUTH\tEXAMPLE B AGAIN\t990002\t728002\t\t\t',
        '',
      ].join('\r\n'),
    );
    expect([...list.fields]).toEqual([
      [990001, 'EXAMPLE NORTH'],
      [990002, 'EXAMPLE SOUTH'],
    ]);
    expect(list.pools).toEqual([
      { fieldCode: 990001, poolCode: 728001, name: 'EXAMPLE A' },
      { fieldCode: 990002, poolCode: 728001, name: 'EXAMPLE A' },
      { fieldCode: 990002, poolCode: 728002, name: 'EXAMPLE B' },
    ]);
    expect(list.skipped).toBe(0);
  });

  it('keeps a field whose line names no pool, and counts lines it cannot read', () => {
    const list = st37FieldPools(
      [
        HEADER,
        'EXAMPLE EAST\t\t990003\t\t\t\t',
        '\tNO FIELD\t\t5\t\t\t',
        'BAD CODE\tX\tabc\t1\t\t\t',
      ].join('\n'),
    );
    expect([...list.fields]).toEqual([[990003, 'EXAMPLE EAST']]);
    expect(list.pools).toEqual([]);
    expect(list.skipped).toBe(2);
  });

  it('refuses a file without its columns', () => {
    expect(() => st37FieldPools('Field Name\tField Code\nX\t1')).toThrow(/no "pool" column/);
  });
});

describe("a well's field code", () => {
  const at = { type: 'Point', coordinates: [-113.6, 53.3] } as const;
  const layers = (fieldCode: unknown) => ({
    surface: [],
    paths: [],
    bottom: [
      {
        type: 'Feature' as const,
        geometry: at,
        properties: { Well_UWI: '00/11-23-030-27W4/2', Well_Licence_Number: '0505993' },
      },
    ],
    strings: [
      {
        type: 'Feature' as const,
        geometry: at,
        properties: {
          Prod_String_UWI: '00/11-23-030-27W4/2',
          Status_Mode: '11',
          Pool_Code: 728001,
          Field_Code: fieldCode,
        },
      },
    ],
  });
  const area = { west: -120, south: 49, east: -110, north: 60 };

  it('comes from the production string its status and pool come from', () => {
    const [well] = buildSt37Wells(layers(990002), area).wells;
    expect(well).toMatchObject({ poolCode: 728001, fieldCode: 990002 });
  });

  it('is left empty when the string has none that can be read', () => {
    expect(buildSt37Wells(layers('KAYBOB'), area).wells[0]?.fieldCode).toBeNull();
    expect(buildSt37Wells(layers(-1), area).wells[0]?.fieldCode).toBeNull();
  });
});
