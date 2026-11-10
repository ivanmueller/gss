import { describe, expect, it } from 'vitest';

import { mapRequestRefusal } from './mapLayers';

// Mapbox GL JS reports a failed request as an error with its status and address (AJAXError).
const failed = (status: number, url: string) => ({ status, url, message: 'failed' });
const PICTURES = `${window.location.origin}/api/v1/map-layers/00000000-0000-4000-8000-0000000000a1/tiles/5/8/11.png`;
const MAPBOX_STYLE = 'https://api.mapbox.com/styles/v1/mapbox/light-v11?access_token=pk.synthetic';

describe('mapRequestRefusal', () => {
  it('hides the map only when Mapbox refuses its own token', () => {
    expect(mapRequestRefusal(failed(401, MAPBOX_STYLE))).toBe('mapbox-token');
    expect(mapRequestRefusal(failed(403, MAPBOX_STYLE))).toBe('mapbox-token');
    // An error without an address keeps the earlier rule: a refusal is Mapbox's.
    expect(mapRequestRefusal({ status: 401 })).toBe('mapbox-token');
  });

  it("treats a map layer's pictures refused as a lapsed sign-in, not Mapbox's token", () => {
    // The bug: after an hour idle the sign-in expired, a picture was refused with 401, and the
    // whole map said "Mapbox refused the token" until the page was refreshed.
    expect(mapRequestRefusal(failed(401, PICTURES))).toBe('sign-in');
    expect(mapRequestRefusal(failed(403, PICTURES))).toBe('sign-in');
  });

  it('ignores other failures', () => {
    expect(mapRequestRefusal(failed(404, MAPBOX_STYLE))).toBeNull();
    expect(mapRequestRefusal(failed(500, PICTURES))).toBeNull();
    expect(mapRequestRefusal(new Error('WebGL lost'))).toBeNull();
    expect(mapRequestRefusal(undefined)).toBeNull();
  });
});
