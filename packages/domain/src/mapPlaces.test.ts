import { describe, expect, it } from 'vitest';

import {
  featuresBounds,
  legalLandLabel,
  legalLandQuery,
  parseLegalLand,
  townBounds,
  type LegalLand,
} from './mapPlaces';

// Places by name for the Ask bar (F-254 part 3): legal land locations read by plain code.

const land = (over: Partial<LegalLand>): LegalLand => ({
  meridian: 5,
  range: 22,
  township: 62,
  section: null,
  quarter: null,
  lsd: null,
  ...over,
});

describe('parseLegalLand', () => {
  it('reads a township written in words or dashed', () => {
    for (const text of [
      'Twp 62 Rge 22 W5',
      'wells in township 62 range 22 west of the 5th meridian',
      'T62 R22 W5M',
      'show me 62-22W5',
      'rigs near 062-22-W5',
    ]) {
      expect(parseLegalLand(text), text).toEqual(land({}));
    }
  });

  it('reads a section, a quarter and a legal subdivision', () => {
    expect(parseLegalLand('12-62-22W5')).toEqual(land({ section: 12 }));
    expect(parseLegalLand('section 12 twp 62 rge 22 w5')).toEqual(land({ section: 12 }));
    expect(parseLegalLand('SE 12-62-22W5')).toEqual(land({ section: 12, quarter: 'SE' }));
    expect(parseLegalLand('NW of section 12 twp 62 rge 22 w5')).toEqual(
      land({ section: 12, quarter: 'NW' }),
    );
    expect(parseLegalLand('10-12-062-22W5')).toEqual(land({ section: 12, lsd: 10 }));
    expect(parseLegalLand('lsd 10 sec 12 twp 62 rge 22 w5')).toEqual(
      land({ section: 12, lsd: 10 }),
    );
  });

  it('finds none in other requests, or outside Alberta’s grid', () => {
    for (const text of [
      'Duvernay wells drilled since 2020',
      'wells between 2018-2023',
      'rigs near Fox Creek',
      '62-22W3',
      '62-22W7',
      '127-22W5',
      '62-35W5',
      '37-62-22W5',
      '17-12-062-22W5',
      'twp 62 rge 22',
      'SE 62-22W5',
    ]) {
      expect(parseLegalLand(text), text).toBeNull();
    }
  });
});

describe('legalLandLabel and legalLandQuery', () => {
  it('names the location as Alberta writes it, and asks the province’s grid for it', () => {
    expect(legalLandLabel(land({}))).toBe('T62 R22 W5');
    expect(legalLandLabel(land({ section: 3 }))).toBe('Sec 03-062-22W5');
    expect(legalLandLabel(land({ section: 3, quarter: 'NE' }))).toBe('NE 03-062-22W5');
    expect(legalLandLabel(land({ section: 3, lsd: 9 }))).toBe('09-03-062-22W5');
    expect(legalLandQuery(land({}))).toEqual({
      level: 'township',
      where: 'M=5 AND RGE=22 AND TWP=62',
    });
    expect(legalLandQuery(land({ section: 3, quarter: 'NE' }))).toEqual({
      level: 'quarter',
      where: "M=5 AND RGE=22 AND TWP=62 AND SEC=3 AND QS='NE'",
    });
    expect(legalLandQuery(land({ section: 3, lsd: 9 }))).toEqual({
      level: 'lsd',
      where: 'M=5 AND RGE=22 AND TWP=62 AND SEC=3 AND LS=9',
    });
  });
});

describe('townBounds and featuresBounds', () => {
  it('gives a box about 25 km across around a town', () => {
    const [west, south, east, north] = townBounds(54.4, -116.8);
    expect(north - south).toBeCloseTo(0.22, 5);
    // A degree of longitude is shorter at 54°N: the box is wider in degrees than tall.
    expect(east - west).toBeGreaterThan(0.36);
    expect((west + east) / 2).toBeCloseTo(-116.8, 4);
  });

  it('boxes every point of the shapes, and nothing for none', () => {
    const square = (w: number, s: number) => ({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [w, s],
            [w + 1, s],
            [w + 1, s + 1],
            [w, s],
          ],
        ],
      },
    });
    expect(featuresBounds([square(-117, 54), square(-116.5, 54.5)])).toEqual([
      -117, 54, -115.5, 55.5,
    ]);
    expect(featuresBounds([])).toBeNull();
    expect(featuresBounds([{ geometry: null }])).toBeNull();
  });
});
