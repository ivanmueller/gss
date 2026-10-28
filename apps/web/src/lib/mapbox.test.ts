import { describe, expect, it } from 'vitest';

import type { MapFacility } from './api';
import {
  basemapStyle,
  facilityPin,
  mapboxToken,
  mapPaint,
  pinFeatures,
  readMapColours,
  type MapColours,
} from './mapbox';

describe('mapboxToken', () => {
  it('uses a public token', () => {
    expect(mapboxToken(' pk.eyJ1Ijoic3ludGhldGljIn0.c3ludGhldGlj ')).toEqual({
      status: 'ok',
      token: 'pk.eyJ1Ijoic3ludGhldGljIn0.c3ludGhldGlj',
    });
  });

  it('reports a missing token', () => {
    expect(mapboxToken(undefined)).toEqual({ status: 'missing' });
    expect(mapboxToken('  ')).toEqual({ status: 'missing' });
  });

  it.each([
    ['sk.eyJ1Ijoic3ludGhldGljIn0.c2VjcmV0', 'a secret token'],
    ['tk.eyJ1Ijoic3ludGhldGljIn0', 'a temporary token'],
    ['pk.with spaces', 'spaces'],
    ['pk.', 'nothing after the prefix'],
  ])('refuses %s (%s)', (value) => {
    expect(mapboxToken(value)).toEqual({ status: 'invalid' });
  });
});

const FACILITY: MapFacility = {
  id: '00000000-0000-4000-8000-00000000fac1',
  counterpartyId: '00000000-0000-4000-8000-00000000c0aa',
  legalName: 'Synthetic Prairie Mills',
  tradingName: null,
  counterpartyTypes: ['buyer'],
  name: 'Synthetic Elevator',
  facilityType: 'elevator',
  city: 'Synthetic Town',
  region: 'SK',
  country: 'CA',
  latitude: '52.133214',
  longitude: '-106.670046',
  locationPrecision: 'approximate',
};

describe('map pins', () => {
  it('makes one point per pin with only its id, tone and fill', () => {
    expect(pinFeatures([facilityPin(FACILITY)])).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-106.670046, 52.133214] },
          properties: { id: FACILITY.id, tone: 'bid', hollow: true },
        },
      ],
    });
  });

  it('colours buyers as bids, sellers as offers, both or neither apart; fills exact locations', () => {
    expect(
      facilityPin({ ...FACILITY, counterpartyTypes: ['seller'], locationPrecision: 'exact' }),
    ).toMatchObject({ tone: 'offer', hollow: false });
    expect(facilityPin({ ...FACILITY, counterpartyTypes: ['buyer', 'seller'] }).tone).toBe('mixed');
    expect(facilityPin({ ...FACILITY, counterpartyTypes: ['broker'] }).tone).toBe('mixed');
    expect(facilityPin({ ...FACILITY, counterpartyTypes: ['buyer', 'broker'] }).tone).toBe('bid');
  });
});

describe('basemaps', () => {
  it("uses Mapbox's light or dark style for the map, and one satellite style", () => {
    expect(basemapStyle('map', 'light')).toBe('mapbox://styles/mapbox/light-v11');
    expect(basemapStyle('map', 'dark')).toBe('mapbox://styles/mapbox/dark-v11');
    expect(basemapStyle('satellite', 'light')).toBe(basemapStyle('satellite', 'dark'));
  });
});

const COLOURS: MapColours = {
  land: '#ffffff',
  water: '#e5e5e5',
  border: '#d4d4d4',
  road: '#f5f5f5',
  label: '#525252',
  labelHalo: '#ffffff',
  bid: '#4f39f6',
  offer: '#00786f',
  mixed: '#155dfc',
  hollow: '#ffffff',
  selected: '#0a0a0a',
};

describe('mapPaint', () => {
  it.each([
    [{ id: 'land', type: 'background' }, [['background-color', '#ffffff']]],
    [{ id: 'water', type: 'fill' }, [['fill-color', '#e5e5e5']]],
    [{ id: 'water-shadow', type: 'fill' }, [['fill-color', '#e5e5e5']]],
    [{ id: 'landcover', type: 'fill' }, [['fill-color', '#ffffff']]],
    [{ id: 'national-park', type: 'fill' }, [['fill-color', '#ffffff']]],
    [{ id: 'waterway', type: 'line' }, [['line-color', '#e5e5e5']]],
    [{ id: 'admin-0-boundary', type: 'line' }, [['line-color', '#d4d4d4']]],
    [{ id: 'road-primary', type: 'line' }, [['line-color', '#f5f5f5']]],
    [
      { id: 'country-label', type: 'symbol' },
      [
        ['text-color', '#525252'],
        ['text-halo-color', '#ffffff'],
      ],
    ],
    [{ id: 'building', type: 'fill' }, []],
    [{ id: 'hillshade', type: 'hillshade' }, []],
    [{ id: 'facilities', type: 'circle' }, []],
  ])('paints %o', (layer, paint) => {
    expect(mapPaint(layer, COLOURS)).toEqual(paint);
  });
});

describe('readMapColours', () => {
  it('reads the tokens on an element and converts them for Mapbox', () => {
    const element = document.createElement('div');
    element.style.setProperty('--map-land', 'oklch(0.39 0.024 257.3)');
    element.style.setProperty('--bid', '#A3B3FF');
    document.body.append(element);
    const colours = readMapColours(element);
    expect(colours.land).toBe('#3d4652');
    expect(colours.bid).toBe('#a3b3ff');
    // Tokens it cannot read keep the light theme's values.
    expect(colours.water).toBe('#e5e5e5');
    element.remove();
  });
});
