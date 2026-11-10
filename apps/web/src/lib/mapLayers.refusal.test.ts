import { describe, expect, it } from 'vitest';

import { mapRequestRefusal, PictureSignIns } from './mapLayers';

// Mapbox GL JS reports a failed request as an error with its status and address (AJAXError).
const failed = (status: number, url: string) => ({ status, url, message: 'failed' });
const PICTURES = `${window.location.origin}/api/v1/map-layers/00000000-0000-4000-8000-0000000000a1/tiles/5/8/11.png`;
const OTHER_PICTURE = PICTURES.replace('5/8/11', '5/9/11');
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

  it('asks for refused pictures again once the sign-in renews, once per sign-in', () => {
    const signIns = new PictureSignIns();
    signIns.sent(PICTURES, 'A');
    expect(signIns.refused(PICTURES, 'A')).toBe(false); // still the lapsed sign-in: wait
    expect(signIns.renewed('A')).toBe(false);
    expect(signIns.renewed('B')).toBe(true);
    expect(signIns.renewed('B')).toBe(false); // nothing refused since
  });

  it('reloads at once when a request sent with the old sign-in is refused after it renewed', () => {
    // Codex's finding F-157-R1-01: A sent, renewed to B, another picture sent with B, then A's
    // refusal arrives. The refused request used A, so the pictures reload at once with B.
    const signIns = new PictureSignIns();
    signIns.sent(PICTURES, 'A');
    expect(signIns.renewed('B')).toBe(false); // nothing refused yet
    signIns.sent(OTHER_PICTURE, 'B');
    expect(signIns.refused(PICTURES, 'B')).toBe(true);
    // The burst of A's other refusals reloads nothing more.
    expect(signIns.refused(PICTURES, 'B')).toBe(false);
    expect(signIns.renewed('B')).toBe(false);
  });

  it('ignores other failures', () => {
    expect(mapRequestRefusal(failed(404, MAPBOX_STYLE))).toBeNull();
    expect(mapRequestRefusal(failed(500, PICTURES))).toBeNull();
    expect(mapRequestRefusal(new Error('WebGL lost'))).toBeNull();
    expect(mapRequestRefusal(undefined)).toBeNull();
  });
});
