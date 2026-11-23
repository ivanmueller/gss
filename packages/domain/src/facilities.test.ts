import { describe, expect, it } from 'vitest';

import { dbaseRecords, facilityGroupOf, facilityRow, shapefilePoints, utf8 } from './facilities';

// The AER's facility list (F-278): made-up facilities in files of the AER's form.

/** A shapefile of points: the 100-byte header, then a record of 20 bytes for each point. */
function shapefile(points: ([number, number] | null)[]): Uint8Array {
  const sizes = points.map((p) => (p ? 20 : 4));
  const total = 100 + sizes.reduce((sum, size) => sum + 8 + size, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, total / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 1, true);
  let at = 100;
  points.forEach((point, n) => {
    const size = sizes[n] ?? 4;
    view.setInt32(at, n + 1, false);
    view.setInt32(at + 4, size / 2, false);
    view.setInt32(at + 8, point ? 1 : 0, true);
    if (point) {
      view.setFloat64(at + 12, point[0], true);
      view.setFloat64(at + 20, point[1], true);
    }
    at += 8 + size;
  });
  return bytes;
}

/** UTF-8 bytes of a text, as the AER's file holds them. */
function bytesOf(text: string): Uint8Array {
  const out: number[] = [];
  for (const letter of text) {
    const c = letter.codePointAt(0) ?? 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
  }
  return Uint8Array.from(out);
}

/** A dBASE table of text fields. */
function dbase(
  fields: [string, number][],
  rows: { deleted?: boolean; values: Record<string, string> }[],
): Uint8Array {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, [, length]) => sum + length, 0);
  const bytes = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(bytes.buffer);
  bytes[0] = 3;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach(([name, length], i) => {
    const at = 32 + i * 32;
    bytes.set(bytesOf(name), at);
    bytes[at + 11] = 0x43;
    bytes[at + 16] = length;
  });
  bytes[headerLength - 1] = 0x0d;
  rows.forEach((row, n) => {
    let at = headerLength + n * recordLength;
    bytes[at] = row.deleted ? 0x2a : 0x20;
    at += 1;
    for (const [name, length] of fields) {
      const value = bytesOf((row.values[name] ?? '').padEnd(length, ' '));
      bytes.set(value.subarray(0, length), at);
      at += length;
    }
  });
  return bytes;
}

const RECORD = {
  FAC_ID: 'ABBT0000001',
  FAC_NAME: 'EXAMPLE 14-29 BATTERY',
  OP_BA_ID: 'A0X1',
  OPERATOR: 'Example Energy Ltd.',
  SUB_CODE: '311',
  FAC_SUB_TY: 'Crude Oil Single-Well Battery',
  LIC_NUMBER: '6422',
  LIC_TYPE: 'F',
  LIC_BA_ID: 'A0X1',
  LICENSEE: 'Example Energy Ltd.',
  FAC_STATUS: 'Active',
  LOC_SOURCE: 'Facility Licence',
};

describe('facilityGroupOf', () => {
  it('groups the AER subtypes as the map colours them', () => {
    expect(facilityGroupOf(311)).toBe('oil_battery');
    expect(facilityGroupOf(322)).toBe('oil_battery');
    expect(facilityGroupOf(331)).toBe('bitumen');
    expect(facilityGroupOf(801)).toBe('bitumen');
    expect(facilityGroupOf(351)).toBe('gas_battery');
    expect(facilityGroupOf(371)).toBe('gas_battery');
    expect(facilityGroupOf(401)).toBe('gas_plant');
    expect(facilityGroupOf(601)).toBe('compressor');
    expect(facilityGroupOf(621)).toBe('gathering');
    expect(facilityGroupOf(632)).toBe('meter');
    expect(facilityGroupOf(207)).toBe('meter');
    expect(facilityGroupOf(503)).toBe('injection');
    expect(facilityGroupOf(701)).toBe('injection');
    expect(facilityGroupOf(671)).toBe('terminal');
    expect(facilityGroupOf(651)).toBe('terminal');
    expect(facilityGroupOf(901)).toBe('water');
    expect(facilityGroupOf(381)).toBe('other');
    expect(facilityGroupOf(null)).toBe('other');
  });
});

describe('facilityRow', () => {
  it('keeps a facility as the database takes it', () => {
    expect(facilityRow(RECORD, [-116.5, 54.2])).toEqual({
      facilityId: 'ABBT0000001',
      name: 'EXAMPLE 14-29 BATTERY',
      operatorCode: 'A0X1',
      operator: 'Example Energy Ltd.',
      subCode: 311,
      subType: 'Crude Oil Single-Well Battery',
      licenceNumber: '6422',
      licenceType: 'F',
      licenseeCode: 'A0X1',
      licensee: 'Example Energy Ltd.',
      status: 'Active',
      located: 'Facility Licence',
      longitude: -116.5,
      latitude: 54.2,
    });
  });

  it('leaves out a record with no facility ID or no point in Alberta', () => {
    expect(facilityRow({ ...RECORD, FAC_ID: 'BT0000001' }, [-116.5, 54.2])).toBeNull();
    expect(facilityRow(RECORD, null)).toBeNull();
    expect(facilityRow(RECORD, [-100, 54.2])).toBeNull();
    expect(facilityRow(RECORD, [Number.NaN, 54.2])).toBeNull();
  });

  it('empties a code that is not in the AER form, and an unknown point source', () => {
    const row = facilityRow(
      { ...RECORD, OP_BA_ID: "x'; --", SUB_CODE: '', LIC_TYPE: 'Q', LOC_SOURCE: 'Guess' },
      [-116.5, 54.2],
    );
    expect(row?.operatorCode).toBeNull();
    expect(row?.subCode).toBeNull();
    expect(row?.licenceType).toBeNull();
    expect(row?.located).toBeNull();
  });
});

describe('the shapefile reader', () => {
  it('reads points in order, an empty shape as null', () => {
    expect(shapefilePoints(shapefile([[-116.5, 54.2], null, [-115.25, 53.125]]))).toEqual([
      [-116.5, 54.2],
      null,
      [-115.25, 53.125],
    ]);
  });

  it('refuses a file that is not a shapefile of points, or one cut short', () => {
    expect(() => shapefilePoints(new Uint8Array(100))).toThrow(/not a shapefile/);
    const lines = shapefile([[-116.5, 54.2]]);
    new DataView(lines.buffer).setInt32(32, 3, true);
    expect(() => shapefilePoints(lines)).toThrow(/points/);
    expect(() => shapefilePoints(shapefile([[-116.5, 54.2]]).subarray(0, 120))).toThrow(/cut/);
  });

  it('reads a table, keeping a deleted record in its place', () => {
    const table = dbase(
      [
        ['FAC_ID', 11],
        ['FAC_NAME', 20],
      ],
      [
        { values: { FAC_ID: 'ABBT0000001', FAC_NAME: 'ÉCOLE BATTERY' } },
        { deleted: true, values: { FAC_ID: 'ABBT0000002' } },
        { values: { FAC_ID: 'ABBT0000003', FAC_NAME: '' } },
      ],
    );
    expect(dbaseRecords(table)).toEqual([
      { FAC_ID: 'ABBT0000001', FAC_NAME: 'ÉCOLE BATTERY' },
      null,
      { FAC_ID: 'ABBT0000003', FAC_NAME: '' },
    ]);
    expect(() => dbaseRecords(table.subarray(0, 60))).toThrow(/cut short/);
  });
});

describe('utf8', () => {
  it('reads letters of one to four bytes, and a cut letter as a replacement', () => {
    expect(utf8(bytesOf('Rivière, Ål, €, 𝄞'))).toBe('Rivière, Ål, €, 𝄞');
    expect(utf8(bytesOf('é').subarray(0, 1))).toBe('�');
    expect(utf8(Uint8Array.from([0x41, 0xff, 0x42]))).toBe('A�B');
    // Past U+10FFFF: the first byte and each one after it replaced, as the standard does.
    expect(utf8(Uint8Array.from([0xf4, 0x90, 0x80, 0x80]))).toBe('�'.repeat(4));
  });
});
