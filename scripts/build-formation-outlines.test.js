// Tests of scripts/build-formation-outlines.js (F-281): a zone of the Survey's 3D model, whose
// extent comes in web-map coordinates, becomes an outline in longitude and latitude with its holes.
// A made-up square only.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { fromWebMercator, modelOutline } from './build-formation-outlines.js';

/** A point given as longitude and latitude, in web-map metres (the model's files). */
const toWebMercator = ([lon, lat]) => {
  const R = 6378137;
  return [(lon * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
};

describe('fromWebMercator', () => {
  test('turns web-map metres back into longitude and latitude', () => {
    for (const point of [
      [-114, 54],
      [-118.5, 49.1],
      [0, 0],
    ]) {
      const [lon, lat] = fromWebMercator(toWebMercator(point));
      assert.ok(Math.abs(lon - point[0]) < 1e-9);
      assert.ok(Math.abs(lat - point[1]) < 1e-9);
    }
  });
});

describe('modelOutline', () => {
  test('keeps the zone code, the outer ring and the hole inside it, to four decimals', () => {
    // A shapefile's outer ring runs clockwise, a hole counter-clockwise.
    const outer = [
      [-116, 53],
      [-116, 55],
      [-113, 55],
      [-113, 53],
      [-116, 53],
    ].map(toWebMercator);
    const hole = [
      [-115, 53.5],
      [-114, 53.5],
      [-114, 54.5],
      [-115, 54.5],
      [-115, 53.5],
    ].map(toWebMercator);
    const collection = modelOutline('69_D_Ld', [outer, hole]);
    const [feature] = collection.features;
    assert.deepEqual(feature.properties, { Zone: '69_D_Ld' });
    assert.equal(feature.geometry.type, 'MultiPolygon');
    assert.equal(feature.geometry.coordinates.length, 1);
    const [polygon] = feature.geometry.coordinates;
    assert.equal(polygon.length, 2);
    assert.deepEqual(polygon[0][1], [-116, 55]);
    assert.deepEqual(polygon[1][0], [-115, 53.5]);
  });
});
