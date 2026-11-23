import { describe, expect, it } from 'vitest';

import { squareImage } from '../lib/facilitiesMap';
import {
  FACILITY_GROUPS_AT_START,
  FACILITY_STATUSES_AT_START,
  facilitiesShown,
  facilityEntries,
  facilityKey,
  facilityLive,
} from './Facilities';
import { facilityLicence, facilityPlace } from './FacilityPanel';

// Facilities on the oil and gas map (F-278): the answer read back into facilities, the filters,
// and the words of the panel. Made-up facilities only.

const ANSWER = {
  load: {
    loadedAt: '2026-11-23T04:00:00.000Z',
    fileDate: '2026-11-02',
    area: { west: -119.86, south: 51.32, east: -110.97, north: 56.23 },
    facilities: 3,
  },
  subtypes: [
    { code: 311, name: 'Crude Oil Single-Well Battery', group: 'oil_battery' as const },
    { code: 401, name: 'Gas Plant Sweet', group: 'gas_plant' as const },
  ],
  statuses: ['Active', 'Suspended'],
  companies: [
    { code: 'A0X1', name: 'Example Energy Ltd.' },
    { code: 'B0Y2', name: 'Other Example Corp.' },
  ],
  located: ['Well Licence', 'Facility Licence', 'LSD Centre', 'Section Centre'],
  facilities: [
    ['ABBT0000001', 'EXAMPLE BATTERY', -116.5, 54.2, 0, 0, 0, 0, 'F 6422', 1],
    ['ABGP0000002', null, -115.5, 53.5, 1, 1, 1, -1, null, 2],
    ['ABBT0000003', 'OTHER BATTERY', -115.4, 53.4, 0, 1, 1, 1, 'W 0123456', -1],
  ] as [
    string,
    string | null,
    number,
    number,
    number,
    number,
    number,
    number,
    string | null,
    number,
  ][],
};

describe('facilityEntries', () => {
  it('looks up each facility’s subtype, status and companies', () => {
    const [first, second, third] = facilityEntries(ANSWER);
    expect(first).toEqual({
      id: 'ABBT0000001',
      key: 'facility:ABBT0000001',
      name: 'EXAMPLE BATTERY',
      longitude: -116.5,
      latitude: 54.2,
      subCode: 311,
      subType: 'Crude Oil Single-Well Battery',
      group: 'oil_battery',
      status: 'Active',
      operator: { code: 'A0X1', name: 'Example Energy Ltd.' },
      licensee: { code: 'A0X1', name: 'Example Energy Ltd.' },
      licence: 'F 6422',
      located: 'Facility Licence',
    });
    expect(second?.licensee).toBeNull();
    expect(second?.group).toBe('gas_plant');
    expect(third?.located).toBeNull();
  });
});

describe('facilitiesShown', () => {
  const all = facilityEntries(ANSWER);
  const every = new Set(['oil_battery', 'gas_plant'] as const);

  const both = new Set(['Active', 'Suspended']);

  it('keeps the kinds on, the statuses on, and an operator holding the text', () => {
    expect(facilitiesShown(all, every, both, '')).toHaveLength(3);
    expect(
      facilitiesShown(all, new Set(['gas_plant'] as const), both, '').map((f) => f.id),
    ).toEqual(['ABGP0000002']);
    expect(facilitiesShown(all, every, new Set(['Active']), '').map((f) => f.id)).toEqual([
      'ABBT0000001',
    ]);
    expect(facilitiesShown(all, every, both, '  other ').map((f) => f.id)).toEqual([
      'ABGP0000002',
      'ABBT0000003',
    ]);
  });

  it('shows nothing when first switched on until a kind is picked, then active ones only (F-284)', () => {
    expect(
      facilitiesShown(all, FACILITY_GROUPS_AT_START, FACILITY_STATUSES_AT_START, ''),
    ).toHaveLength(0);
    expect(facilitiesShown(all, every, FACILITY_STATUSES_AT_START, '').map((f) => f.id)).toEqual([
      'ABBT0000001',
    ]);
  });
});

describe('the facility’s words', () => {
  it('tells a working facility from the others', () => {
    expect(facilityLive('Active')).toBe(true);
    expect(facilityLive('New')).toBe(true);
    expect(facilityLive('Suspended')).toBe(false);
    expect(facilityLive(null)).toBe(false);
    expect(facilityKey('ABBT0000001')).toBe('facility:ABBT0000001');
  });

  it('says where the point comes from, and which licence it is', () => {
    expect(facilityPlace('LSD Centre')).toMatch(/legal subdivision.*not its own spot/);
    expect(facilityPlace('Facility Licence')).toBe('From the facility’s licence');
    expect(facilityPlace(null)).toBe('Not said by the AER');
    expect(facilityLicence('F 6422')).toBe('Facility 6422');
    expect(facilityLicence('W 0123456')).toBe('Well 0123456');
    expect(facilityLicence(null)).toBe('—');
  });
});

describe('squareImage', () => {
  it('is a square the map can colour: solid inside, fading out past its edge', () => {
    const image = squareImage(24, 6);
    const alpha = (x: number, y: number) => image.data[(y * 24 + x) * 4 + 3];
    expect(image.data).toHaveLength(24 * 24 * 4);
    expect(alpha(12, 12)).toBe(255);
    // 5.5 from the centre's 11.5, half a pixel inside the edge at 6.
    expect(alpha(17, 12)).toBeGreaterThan(191);
    // The corner, 5.5 pixels out: only the last of the fade a halo can use.
    expect(alpha(0, 0)).toBeLessThan(32);
  });
});
