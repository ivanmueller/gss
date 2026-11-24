// Tests of scripts/build-geology-grids.js (F-287 part 3): GDAL's ENVI header read, the floats
// packed as the app's grid file wants them, and the contour lines kept with their value only.
// Made-up numbers only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { GEOLOGY_GRID_ABSENT } from '../packages/domain/src/geologyGrid.ts';
import { contourLines, enviHeader, packValues } from './build-geology-grids.js';

const HEADER = `ENVI
samples = 868
lines   = 1091
bands   = 1
header offset = 0
data type = 4
interleave = bsq
byte order = 0
map info = {Mercator_1SP, 1, 1, -13586520, 8533170, 1770, 1770}
data ignore value = -9999
`;

describe('enviHeader', () => {
  test('reads the size and place', () => {
    assert.deepEqual(enviHeader(HEADER), {
      columns: 868,
      rows: 1091,
      west: -13586520,
      north: 8533170,
      cell: 1770,
    });
  });

  test('refuses anything but one band of floats in web mercator', () => {
    assert.throws(() => enviHeader(HEADER.replace('data type = 4', 'data type = 2')), /floats/);
    assert.throws(() => enviHeader(HEADER.replace('Mercator_1SP', 'UTM')), /web mercator/);
    assert.throws(() => enviHeader(HEADER.replace('1770, 1770', '1770, 1000')), /square/);
    assert.throws(() => enviHeader(HEADER.replace(/^samples.*$/m, '')), /samples/);
  });
});

describe('packValues', () => {
  test('rounds each value, scaled, and marks no data absent', () => {
    const floats = new Float32Array([3093.4, -9999, 57.26, Number.NaN]);
    const bytes = new Uint8Array(floats.buffer);
    assert.deepEqual(
      [...packValues(bytes, 1)],
      [3093, GEOLOGY_GRID_ABSENT, 57, GEOLOGY_GRID_ABSENT],
    );
    assert.equal(packValues(bytes, 10)[2], 573);
  });

  test('refuses a value too large for the file', () => {
    const bytes = new Uint8Array(new Float32Array([4000]).buffer);
    assert.throws(() => packValues(bytes, 10), /does not fit/);
  });
});

describe('contourLines', () => {
  test('keeps the lines with their value in whole metres', () => {
    const lines = contourLines({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { ID: 1, value: 2500.0001 },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-116, 54],
              [-115.9, 54.1],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { value: 10 },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
        {
          type: 'Feature',
          properties: { value: 'x' },
          geometry: { type: 'LineString', coordinates: [] },
        },
      ],
    });
    assert.equal(lines.features.length, 1);
    assert.deepEqual(lines.features[0].properties, { value: 2500 });
  });
});
