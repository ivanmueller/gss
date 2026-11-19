import { createContext, useContext } from 'react';

// Which list of map layers a map and its settings work on (F-247 part 2): grain's (Team → Map
// layers, the Workspace and Counterparties maps), or the oil and gas map's own, kept in its own
// database. The same screens and code serve both; this says where they read and write, and
// what each side offers.

export interface LayerApi {
  /** The API's address of the list, without a query: what kept answers are forgotten by. */
  base: string;
  /** The address of a request under the list, with whatever every request there must carry. */
  path: (rest: string) => string;
  /** Layers from files. */
  files: boolean;
  /** A whole ArcGIS map's layers from its link. */
  arcgisMaps: boolean;
  /** Zoomed-out views of live layers, prepared in an admin's browser. */
  overviews: boolean;
  /**
   * Whether an admin chooses, per layer, if it is on when the map opens. Where they do, every
   * visit starts from that choice and a person's own switching is not remembered (the owner,
   * 2026-11-19); elsewhere each person's switches are remembered in their browser.
   */
  adminDefault: boolean;
  /** Where admins manage the layers, after "Admins add them …". */
  managedIn: string;
  /** The maps the layers show on, after "… under Layers on …". */
  shownOn: string;
  /** What an address to add may be. */
  addressHelp: string;
}

export const GRAIN_LAYERS: LayerApi = {
  base: '/map-layers',
  path: (rest) => `/map-layers${rest}`,
  files: true,
  arcgisMaps: true,
  overviews: true,
  adminDefault: false,
  managedIn: 'on Team → Map layers',
  shownOn: 'the Workspace map and Counterparties → map view',
  addressHelp:
    'An ArcGIS layer (ends in /FeatureServer, /MapServer or /ImageServer, often followed by a number) or a WMS map service, such as those on open.canada.ca.',
};

const PETROLEUM_BASE = '/petroleum/layers';

/**
 * The oil and gas map's layers. Every request names the person's organization, as the oil and
 * gas routes choose the membership per request (F-247-2-D1-04).
 */
export function petroleumLayers(organizationId: string): LayerApi {
  const organization = `organization_id=${encodeURIComponent(organizationId)}`;
  return {
    base: PETROLEUM_BASE,
    path: (rest) => {
      const path = `${PETROLEUM_BASE}${rest}`;
      if (/[?&]organization_id=/.test(path)) return path;
      return `${path}${path.includes('?') ? '&' : '?'}${organization}`;
    },
    files: false,
    arcgisMaps: false,
    overviews: false,
    adminDefault: true,
    managedIn: 'in Settings',
    shownOn: 'the oil and gas map',
    addressHelp:
      'A live ArcGIS layer: its address ends in /FeatureServer, /MapServer or /ImageServer, often followed by a number.',
  };
}

/**
 * A live layer's squares, pictures and legend are asked for under addresses that carry this mark.
 * The release before F-247 part 2 told browsers to keep those answers for an hour without asking
 * again; under a new address nothing kept from then is reused, so every answer the updated app
 * shows has passed the Worker's membership check (F-247-2-R18-01). The Worker ignores the mark.
 * Changed again only if the keeping rule of these answers ever changes again.
 */
const LIVE_MARK = 'c=2';

/** The path of a live layer's square, picture or legend, with the mark above. */
export function livePath(rest: string): string {
  return `${rest}${rest.includes('?') ? '&' : '?'}${LIVE_MARK}`;
}

/** The addresses under which a map layer's pictures are asked for with the person's sign-in. */
export const LAYER_PICTURE_BASES = [`/api/v1${GRAIN_LAYERS.base}/`, `/api/v1${PETROLEUM_BASE}/`];

export const LayerApiContext = createContext<LayerApi>(GRAIN_LAYERS);

export function useLayerApi(): LayerApi {
  return useContext(LayerApiContext);
}
