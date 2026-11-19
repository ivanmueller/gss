import { describe, expect, it } from 'vitest';

import { GRAIN_LAYERS, livePath, petroleumLayers } from './layerApi';
import { layerPictureStale, mapRequestRefusal, PictureSignIns } from './mapLayers';

// Mapbox GL JS reports a failed request as an error with its status and address (AJAXError).
const failed = (status: number, url: string) => ({ status, url, message: 'failed' });
const PICTURES = `${window.location.origin}/api/v1/map-layers/00000000-0000-4000-8000-0000000000a1/tiles/5/8/11.png`;
const OTHER_PICTURE = PICTURES.replace('5/8/11', '5/9/11');
const MAPBOX_STYLE = 'https://api.mapbox.com/styles/v1/mapbox/light-v11?access_token=pk.synthetic';

// F-247-2-R9-02: a layer's picture answered "not a member" or "no such layer" has the list of
// layers read again; a lapsed sign-in (401) is renewed instead, and Mapbox's own failures are not
// about layers.
describe('layerPictureStale', () => {
  it('is a layer picture refused for good, or of a layer no longer there', () => {
    expect(layerPictureStale(failed(404, PICTURES))).toBe('missing');
    expect(layerPictureStale(failed(403, PICTURES))).toBe('refused');
    expect(layerPictureStale(failed(401, PICTURES))).toBeNull();
    expect(layerPictureStale(failed(502, PICTURES))).toBeNull();
    expect(layerPictureStale(failed(404, MAPBOX_STYLE))).toBeNull();
    expect(layerPictureStale({ status: 404 })).toBeNull();
    expect(layerPictureStale(null)).toBeNull();
  });
});

// F-247-2-R18-01: the release before told browsers to keep a live layer's answers for an hour.
// The updated app asks under addresses that release never used.
describe('livePath', () => {
  it('marks a live layer’s address, with or without a query already', () => {
    expect(livePath('/a/legend')).toBe('/a/legend?c=2');
    expect(livePath('/a/features/5/5/10?g=x')).toBe('/a/features/5/5/10?g=x&c=2');
    expect(GRAIN_LAYERS.path(livePath('/a/tiles/{z}/{x}/{y}.png'))).toBe(
      '/map-layers/a/tiles/{z}/{x}/{y}.png?c=2',
    );
    expect(petroleumLayers('org-a').path(livePath('/a/legend'))).toBe(
      '/petroleum/layers/a/legend?c=2&organization_id=org-a',
    );
  });
});

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
