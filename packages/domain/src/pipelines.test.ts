import { describe, expect, it } from 'vitest';

import { dbaseTable } from './facilities';
import {
  decodeParts,
  encodeParts,
  partsBounds,
  pipelineLevelAt,
  pipelineLevelOfSquare,
  pipelineRow,
  pipelineSubstanceOf,
  shapefileLines,
  thinLine,
  thinParts,
  type PipelineParts,
} from './pipelines';

// The AER's pipeline file (F-249): made-up segments in files of the AER's form.

/** A shapefile of lines (type 3): the 100-byte header, then each record's parts and points. */
function lineShapefile(records: (PipelineParts | null)[]): Uint8Array {
  const sizes = records.map((parts) =>
    parts ? 44 + 4 * parts.length + 16 * parts.reduce((n, p) => n + p.length, 0) : 4,
  );
  const total = 100 + sizes.reduce((sum, size) => sum + 8 + size, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, 9994, false);
  view.setInt32(24, total / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 3, true);
  let at = 100;
  records.forEach((parts, n) => {
    const size = sizes[n] ?? 4;
    view.setInt32(at, n + 1, false);
    view.setInt32(at + 4, size / 2, false);
    const s = at + 8;
    view.setInt32(s, parts ? 3 : 0, true);
    if (parts) {
      const points = parts.flat();
      const lons = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      view.setFloat64(s + 4, Math.min(...lons), true);
      view.setFloat64(s + 12, Math.min(...lats), true);
      view.setFloat64(s + 20, Math.max(...lons), true);
      view.setFloat64(s + 28, Math.max(...lats), true);
      view.setInt32(s + 36, parts.length, true);
      view.setInt32(s + 40, points.length, true);
      let start = 0;
      parts.forEach((part, p) => {
        view.setInt32(s + 44 + 4 * p, start, true);
        start += part.length;
      });
      const first = s + 44 + 4 * parts.length;
      points.forEach(([x, y], i) => {
        view.setFloat64(first + 16 * i, x, true);
        view.setFloat64(first + 16 * i + 8, y, true);
      });
    }
    at += 8 + size;
  });
  return bytes;
}

/** A dBASE table of text fields, ASCII only. */
function dbase(fields: [string, number][], rows: Record<string, string>[]): Uint8Array {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((sum, [, length]) => sum + length, 0);
  const bytes = new Uint8Array(headerLength + rows.length * recordLength + 1);
  const view = new DataView(bytes.buffer);
  bytes[0] = 3;
  view.setUint32(4, rows.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach(([name, length], i) => {
    for (let k = 0; k < name.length; k += 1) bytes[32 + i * 32 + k] = name.charCodeAt(k);
    bytes[32 + i * 32 + 11] = 0x43;
    bytes[32 + i * 32 + 16] = length;
  });
  bytes[headerLength - 1] = 0x0d;
  rows.forEach((row, n) => {
    let at = headerLength + n * recordLength;
    bytes[at] = 0x20;
    at += 1;
    for (const [name, length] of fields) {
      const text = (row[name] ?? '').padEnd(length, ' ');
      for (let k = 0; k < length; k += 1) bytes[at + k] = text.charCodeAt(k);
      at += length;
    }
  });
  return bytes;
}

const RECORD: Record<string, string> = {
  LICENCE_NO: '11130',
  IS_NEB: 'N',
  LINE_NO: '1',
  PLLICSEGID: '51822',
  COMP_NAME: 'Example Pipelines Ltd.',
  BA_CODE: 'A0X1',
  SEG_LENGTH: '10.27',
  SEG_STATUS: 'Operating',
  FROM_FAC: 'Regulator Station',
  FROM_LOC: '16-33-044-24W4',
  TO_FAC: 'Regulator Station',
  TO_LOC: '01-24-045-25W4',
  H2S_CONT: '0',
  OUT_DIAMET: '60.3',
  WALL_THICK: '2.16',
  PIPE_TYPE: '6063',
  PIPE_GRADE: 'T1A',
  PIP_MATERL: 'Aluminum',
  PIPE_MAOP: '3100',
  FLD_CTR_NM: 'Edmonton',
  SUBSTANCE1: 'Natural Gas',
  SUBSTANCE2: '',
  SUBSTANCE3: '',
  LICAPPDATE: '20020920',
  LAST_OCCYR: '1977',
  GEOM_SRCE: 'Mapping',
};
const LINE: PipelineParts = [
  [
    [-116.5, 54.1],
    [-116.45, 54.15],
    [-116.4, 54.2],
  ],
];

describe('pipelineSubstanceOf', () => {
  it('groups the substances as the AER names them', () => {
    expect(pipelineSubstanceOf('Natural Gas')).toBe('gas');
    expect(pipelineSubstanceOf('Fuel Gas')).toBe('gas');
    expect(pipelineSubstanceOf('Sour Natural Gas')).toBe('sour_gas');
    expect(pipelineSubstanceOf('Oil-Well Effluent')).toBe('effluent');
    expect(pipelineSubstanceOf('Crude Oil')).toBe('crude');
    expect(pipelineSubstanceOf('Liquid Ethane')).toBe('products');
    expect(pipelineSubstanceOf('HVP Products')).toBe('products');
    expect(pipelineSubstanceOf('Salt Water')).toBe('water');
    expect(pipelineSubstanceOf('Fresh Water')).toBe('water');
    expect(pipelineSubstanceOf('Polymer')).toBe('other');
    expect(pipelineSubstanceOf(null)).toBe('other');
  });
});

describe('pipelineRow', () => {
  it('keeps a segment as the AER writes it', () => {
    const row = pipelineRow(RECORD, LINE);
    expect(row).toEqual({
      segmentId: '51822',
      licenceNumber: '11130',
      lineNumber: '1',
      federal: false,
      licenseeCode: 'A0X1',
      licensee: 'Example Pipelines Ltd.',
      status: 'Operating',
      substances: ['Natural Gas'],
      fromFacility: 'Regulator Station',
      fromLocation: '16-33-044-24W4',
      toFacility: 'Regulator Station',
      toLocation: '01-24-045-25W4',
      lengthKm: 10.27,
      diameterMm: 60.3,
      wallMm: 2.16,
      material: 'Aluminum',
      pipeType: '6063',
      pipeGrade: 'T1A',
      maxPressure: 3100,
      h2s: 0,
      fieldCentre: 'Edmonton',
      licenceApproved: '2002-09-20',
      lastOccurrenceYear: 1977,
      geometrySource: 'Mapping',
      // The middle point lies on the line between the others: thinned away.
      parts: [
        [
          [-116.5, 54.1],
          [-116.4, 54.2],
        ],
      ],
      bounds: { west: -116.5, south: 54.1, east: -116.4, north: 54.2 },
    });
  });

  it('leaves out what is not in the AER’s form, and refuses what the database would', () => {
    const odd = pipelineRow(
      {
        ...RECORD,
        IS_NEB: 'Y',
        LINE_NO: '1-2',
        BA_CODE: 'TOOLONG',
        SEG_LENGTH: 'n/a',
        LICAPPDATE: '20021340',
        LAST_OCCYR: '77',
        SUBSTANCE2: 'Fuel Gas',
      },
      LINE,
    );
    expect(odd).toMatchObject({
      federal: true,
      lineNumber: null,
      licenseeCode: null,
      lengthKm: null,
      licenceApproved: null,
      lastOccurrenceYear: null,
      substances: ['Natural Gas', 'Fuel Gas'],
    });
    expect(pipelineRow({ ...RECORD, LICENCE_NO: '' }, LINE)).toBeNull();
    expect(pipelineRow({ ...RECORD, LICENCE_NO: '11-130' }, LINE)).toBeNull();
    expect(pipelineRow(RECORD, null)).toBeNull();
    // Toronto.
    expect(
      pipelineRow(RECORD, [
        [
          [-79.4, 43.7],
          [-79.3, 43.8],
        ],
      ]),
    ).toBeNull();
    // A line of one point, twice.
    expect(
      pipelineRow(RECORD, [
        [
          [-116.5, 54.1],
          [-116.5, 54.1],
        ],
      ]),
    ).toBeNull();
  });
});

describe('thinning and the database’s form', () => {
  it('drops the points within the distance of the line through their neighbours', () => {
    // 0.00004 degrees of latitude is about 4.4 m.
    const line: [number, number][] = [
      [-116.5, 54.1],
      [-116.45, 54.10004],
      [-116.4, 54.1],
    ];
    expect(thinLine(line, 3)).toEqual(line);
    expect(thinLine(line, 5)).toEqual([
      [-116.5, 54.1],
      [-116.4, 54.1],
    ]);
  });

  it('rounds to five decimals and keeps points that fall together once', () => {
    expect(
      thinParts(
        [
          [
            [-116.500001, 54.1],
            [-116.500002, 54.100001],
            [-116.4, 54.2],
          ],
          [[-116.3, 54.3]],
        ],
        0,
      ),
    ).toEqual([
      [
        [-116.5, 54.1],
        [-116.4, 54.2],
      ],
    ]);
  });

  it('keeps a line of several parts as whole numbers and gives it back', () => {
    const parts: PipelineParts = [
      [
        [-116.5, 54.1],
        [-116.45, 54.15],
      ],
      [
        [-116.45, 54.15],
        [-116.4, 54.2],
        [-116.35, 54.21],
      ],
    ];
    const kept = encodeParts(parts);
    expect(kept).toEqual({
      path: [
        -11650000, 5410000, -11645000, 5415000, -11645000, 5415000, -11640000, 5420000, -11635000,
        5421000,
      ],
      breaks: [2],
    });
    expect(decodeParts(kept.path, kept.breaks)).toEqual(parts);
    expect(partsBounds(parts)).toEqual({ west: -116.5, south: 54.1, east: -116.35, north: 54.21 });
    expect(partsBounds([])).toBeNull();
  });
});

describe('shapefileLines and dbaseTable', () => {
  it('reads each record’s box and parts, a record at a time', () => {
    const file = shapefileLines(lineShapefile([LINE, null]));
    expect(file.count).toBe(2);
    expect(file.bounds(0)).toEqual({ west: -116.5, south: 54.1, east: -116.4, north: 54.2 });
    expect(file.parts(0)).toEqual(LINE);
    expect(file.bounds(1)).toBeNull();
    expect(file.parts(1)).toBeNull();
    expect(file.parts(2)).toBeNull();
  });

  it('refuses a file that is not a shapefile of lines', () => {
    const points = lineShapefile([LINE]);
    new DataView(points.buffer).setInt32(32, 1, true);
    expect(() => shapefileLines(points)).toThrow('not a shapefile of lines');
    expect(() => shapefileLines(new Uint8Array(10))).toThrow('not a shapefile');
  });

  it('reads only the fields asked for', () => {
    const table = dbaseTable(
      dbase(
        [
          ['LICENCE_NO', 9],
          ['COMP_NAME', 30],
        ],
        [{ LICENCE_NO: '11130', COMP_NAME: 'Example Pipelines Ltd.' }],
      ),
    );
    expect(table.count).toBe(1);
    expect(table.record(0)).toEqual({ LICENCE_NO: '11130', COMP_NAME: 'Example Pipelines Ltd.' });
    expect(table.record(0, ['LICENCE_NO'])).toEqual({ LICENCE_NO: '11130' });
    expect(table.record(1)).toBeNull();
  });
});

describe('pipeline levels', () => {
  it('asks for the large lines from about the 10 km bar and every line from about 2 km', () => {
    expect(pipelineLevelAt(7)).toBeNull();
    expect(pipelineLevelAt(7.8)).toBe('main');
    expect(pipelineLevelAt(9.9)).toBe('main');
    expect(pipelineLevelAt(10)).toBe('all');
    expect(pipelineLevelAt(15)).toBe('all');
    expect(pipelineLevelOfSquare({ z: 8, x: 44, y: 81 })).toBe('main');
    expect(pipelineLevelOfSquare({ z: 10, x: 178, y: 327 })).toBe('all');
    expect(pipelineLevelOfSquare({ z: 9, x: 89, y: 163 })).toBeNull();
  });
});
