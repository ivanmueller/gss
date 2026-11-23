import { describe, expect, it } from 'vitest';

import { GRID_FROM } from './gridMap';

// When the township grid starts to fade in (F-271; the owner, 2026-11-23: "once the user scrolls
// from 50km to 30km and they just started zooming in on 30km towards 20km").

/**
 * What the oil and gas map's distance bar reads at a zoom, as Mapbox's ScaleControl works it out
 * (mapbox-gl 3, `maxWidth: 120` in FacilityMap.tsx): the ground distance across 120 pixels at the
 * map's latitude (512-pixel world at zoom 0, the distance measured on a sphere of 6,371,008.8 m),
 * rounded down to 1, 2, 3 or 5 times a power of ten.
 */
function scaleBarKm(zoom: number, latitude: number): number {
  const metresPerPixel =
    (2 * Math.PI * 6371008.8 * Math.cos((latitude * Math.PI) / 180)) / (512 * 2 ** zoom);
  const km = (120 * metresPerPixel) / 1000;
  const pow10 = 10 ** (String(Math.floor(km)).length - 1);
  const d = km / pow10;
  return pow10 * (d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1);
}

describe('the township grid fading in', () => {
  it('starts as the distance bar turns from 50 km to 30 km around the Duvernay', () => {
    // Kaybob to Edmonton, the Duvernay's wells.
    for (const latitude of [53, 53.5, 54]) {
      expect(scaleBarKm(GRID_FROM - 0.1, latitude)).toBe(50);
      expect(scaleBarKm(GRID_FROM + 0.1, latitude)).toBe(30);
    }
  });

  it('reads the bar as Mapbox does', () => {
    expect(scaleBarKm(6.5, 53.5)).toBe(50);
    expect(scaleBarKm(7.5, 53.5)).toBe(30);
    expect(scaleBarKm(7.6, 53.5)).toBe(20);
    expect(scaleBarKm(8.2, 53.5)).toBe(10);
  });
});
