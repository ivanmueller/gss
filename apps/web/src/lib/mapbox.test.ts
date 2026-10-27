import { describe, expect, it } from 'vitest';

import type { MapFacility } from './api';
import { facilityFeatures, mapboxToken } from './mapbox';

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

describe('facilityFeatures', () => {
  it('makes one point per facility with only its id and precision', () => {
    const facility: MapFacility = {
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
    expect(facilityFeatures([facility])).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [-106.670046, 52.133214] },
          properties: { id: facility.id, precision: 'approximate' },
        },
      ],
    });
  });
});
