import { describe, expect, it } from 'vitest';

import regions from '../data/lane-regions.json';
import { areaBounds, laneAreas, quotedOnly, type LaneRegionData } from './lanes';

/** A square place around a point, for tests. */
function place(code: string, x: number, y: number): LaneRegionData['features'][number] {
  return {
    type: 'Feature',
    properties: { code, center: [x, y] },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [x - 1, y - 1],
            [x + 1, y - 1],
            [x + 1, y + 1],
            [x - 1, y + 1],
            [x - 1, y - 1],
          ],
        ],
      ],
    },
  };
}

const DATA: LaneRegionData = {
  type: 'FeatureCollection',
  features: [
    place('CA-AB', -115, 55),
    place('CA-SK', -106, 54),
    place('US-MT', -110, 47),
    place('US-ND', -100, 47),
    // Alaska's islands across the 180th meridian.
    place('US-AK', 175, 52),
  ],
};

const roles = (areas: ReturnType<typeof laneAreas>) =>
  Object.fromEntries(
    areas.regions.features.map((feature) => [feature.properties.code, feature.properties.role]),
  );

describe('laneAreas', () => {
  it('shades where lanes start darker than where they end, with no lines between them', () => {
    const areas = laneAreas(
      DATA,
      [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
        { origin: 'CA-AB', destination: 'US-ND', transport: 'truck' },
      ],
      [],
    );
    expect(roles(areas)).toEqual({ 'CA-AB': 'from', 'US-MT': 'to', 'US-ND': 'to' });
    // Only shaded places (owner's request, 2026-11-02).
    expect(Object.keys(areas)).toEqual(['regions']);
  });

  it('adds the freight rates’ other places and lanes, dashed', () => {
    const areas = laneAreas(
      DATA,
      [{ origin: 'CA-AB', destination: 'US-MT', transport: 'truck' }],
      [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
        { origin: 'CA-SK', destination: 'US-MT', transport: 'rail' },
      ],
    );
    // Montana is a lane's end, so it stays shaded; only Saskatchewan is the rates' alone.
    expect(roles(areas)).toEqual({ 'CA-AB': 'from', 'US-MT': 'to', 'CA-SK': 'quoted' });
  });

  it('marks a place lanes start and end in as a start', () => {
    const areas = laneAreas(
      DATA,
      [
        { origin: 'CA-AB', destination: 'CA-AB', transport: 'truck' },
        { origin: 'CA-SK', destination: 'CA-AB', transport: 'truck' },
      ],
      [],
    );
    expect(roles(areas)).toEqual({ 'CA-AB': 'from', 'CA-SK': 'from' });
  });
});

describe('quotedOnly', () => {
  it('leaves out the rates’ lanes that are entered too', () => {
    expect(
      quotedOnly(
        [{ origin: 'CA-AB', destination: 'US-MT', transport: 'truck' }],
        [
          { origin: 'CA-AB', destination: 'US-MT', transport: 'rail' },
          { origin: 'CA-SK', destination: 'US-MT', transport: 'rail' },
        ],
      ),
    ).toEqual([{ origin: 'CA-SK', destination: 'US-MT', transport: 'rail' }]);
  });
});

describe('areaBounds', () => {
  it('holds every shaded place', () => {
    const areas = laneAreas(
      DATA,
      [{ origin: 'CA-AB', destination: 'US-ND', transport: 'truck' }],
      [],
    );
    expect(areaBounds(areas)).toEqual([-116, 46, -99, 56]);
  });

  it('leaves out land across the 180th meridian', () => {
    const areas = laneAreas(
      DATA,
      [{ origin: 'CA-AB', destination: 'US-AK', transport: 'truck' }],
      [],
    );
    expect(areaBounds(areas)).toEqual([-116, 54, -114, 56]);
  });

  it('is null with nothing to show', () => {
    expect(areaBounds(laneAreas(DATA, [], []))).toBeNull();
  });
});

describe('lane-regions.json', () => {
  it('has the 64 places, each with an outline and a centre', () => {
    const data = regions as unknown as LaneRegionData;
    expect(data.features).toHaveLength(64);
    for (const feature of data.features) {
      expect(feature.properties.code).toMatch(/^(CA|US)-[A-Z]{2}$/);
      expect(feature.properties.center).toHaveLength(2);
      expect(feature.geometry.coordinates.length).toBeGreaterThan(0);
    }
    const alberta = data.features.find((feature) => feature.properties.code === 'CA-AB');
    const [x = 0, y = 0] = alberta?.properties.center ?? [];
    // Alberta's label point lies within it.
    expect(x).toBeGreaterThan(-120);
    expect(x).toBeLessThan(-110);
    expect(y).toBeGreaterThan(49);
    expect(y).toBeLessThan(60);
  });
});
