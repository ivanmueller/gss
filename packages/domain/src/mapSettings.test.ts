import { describe, expect, it } from 'vitest';

import { readMapRequest } from './mapRequestWords';
import { describeMapSettings, mapSettingsSchema } from './mapSettings';

// The oil and gas map's settings in one shape, and the Ask the map bar's word reader (F-254).

describe('mapSettingsSchema', () => {
  it('takes a partial set of the map’s choices', () => {
    const settings = {
      open: 'wells',
      basemap: 'satellite',
      goTo: 'duvernay',
      wells: { on: true, statuses: ['producing'], spudFrom: 2020, spudTo: null, operator: 'X' },
      sales: { rights: null, period: '1', sale: 'next' },
      land: { kinds: ['freehold'], terms: [] },
      facilities: { kinds: ['gas_plant'], activeOnly: true },
      pipelines: { statuses: ['Operating'], substances: ['sour_gas'], minSizeMm: 168 },
      rigs: { period: 'now' },
      formations: { shown: ['cardium'] },
      prices: { product: 'oil', period: '15' },
      geology: { on: true, shown: 'maturity' },
      grid: { on: false },
    };
    expect(mapSettingsSchema.parse(settings)).toEqual(settings);
    expect(mapSettingsSchema.parse({})).toEqual({});
  });

  it('refuses unknown keys and values, repeats and years out of order', () => {
    const refused = [
      { zoom: 5 },
      { wells: { colour: 'red' } },
      { wells: { statuses: ['flowing'] } },
      { wells: { statuses: ['producing', 'producing'] } },
      { wells: { spudFrom: 2024, spudTo: 2020 } },
      { wells: { spudFrom: 2020.5 } },
      { goTo: 'montney' },
      { open: 'production' },
      { sales: { period: '3' } },
      { pipelines: { minSizeMm: -1 } },
      { wells: { operator: 'x'.repeat(81) } },
      { formations: { shown: ['../secret'] } },
    ];
    for (const settings of refused) {
      expect(mapSettingsSchema.safeParse(settings).success, JSON.stringify(settings)).toBe(false);
    }
  });
});

describe('describeMapSettings', () => {
  it('names each setting in a short phrase', () => {
    expect(
      describeMapSettings({
        goTo: 'duvernay',
        wells: { on: true, statuses: ['producing', 'suspended'], spudFrom: 2020 },
        rigs: { period: '30' },
        open: 'wells',
      }),
    ).toEqual([
      'Moved to the Duvernay',
      'Wells on',
      'Wells: producing or injecting, suspended',
      'Spud since 2020',
      'Rigs: past 30 days',
      'Wells & licences open',
    ]);
    expect(describeMapSettings({ wells: { spudFrom: 2021, spudTo: 2021 } })).toEqual([
      'Spud in 2021',
    ]);
    expect(describeMapSettings({ wells: { spudFrom: null, spudTo: null } })).toEqual([
      'Any spud year',
    ]);
    expect(describeMapSettings({})).toEqual([]);
  });
});

describe('readMapRequest', () => {
  it('reads Duvernay wells drilled since a year', () => {
    expect(readMapRequest('Duvernay wells drilled since 2020')).toEqual({
      settings: {
        goTo: 'duvernay',
        wells: { on: true, play: 'duvernay', spudFrom: 2020 },
        open: 'wells',
      },
      reasons: [],
    });
  });

  it('reads spud years before, after, in and between', () => {
    expect(readMapRequest('wells spud after 2019').settings.wells).toMatchObject({
      spudFrom: 2020,
    });
    expect(readMapRequest('wells drilled before 2015').settings.wells).toMatchObject({
      spudTo: 2014,
    });
    expect(readMapRequest('wells drilled in 2022').settings.wells).toMatchObject({
      spudFrom: 2022,
      spudTo: 2022,
    });
    expect(readMapRequest('wells drilled between 2023 and 2018').settings.wells).toMatchObject({
      spudFrom: 2018,
      spudTo: 2023,
    });
  });

  it('reads statuses and an operator’s name as typed', () => {
    expect(
      readMapRequest('Producing and suspended wells operated by Chevron Canada').settings,
    ).toEqual({
      wells: { on: true, statuses: ['producing', 'suspended'], operator: 'chevron canada' },
      open: 'wells',
    });
  });

  it('reads the other sections', () => {
    expect(readMapRequest('rigs now').settings).toEqual({
      rigs: { on: true, period: 'now' },
      open: 'rigs',
    });
    expect(readMapRequest('Gas plants and compressors').settings).toEqual({
      facilities: { on: true, kinds: ['gas_plant', 'compressor'] },
      open: 'facilities',
    });
    expect(readMapRequest('Duvernay land sales of the past year').settings).toEqual({
      goTo: 'duvernay',
      sales: { on: true, rights: 'duvernay', period: '1' },
      open: 'sales',
    });
    expect(readMapRequest('the next sale').settings.sales).toMatchObject({ sale: 'next' });
    expect(readMapRequest('Duvernay maturity').settings).toEqual({
      goTo: 'duvernay',
      geology: { on: true, shown: 'maturity' },
      open: 'geology',
    });
    expect(readMapRequest('sour gas pipelines 168 mm').settings.pipelines).toEqual({
      on: true,
      substances: ['sour_gas'],
      minSizeMm: 168,
    });
    expect(readMapRequest('propane prices over 15 years').settings.prices).toEqual({
      on: true,
      product: 'propane',
      period: '15',
    });
    expect(readMapRequest('land expiring, held by Example Energy').settings.land).toEqual({
      on: true,
      holder: 'example energy',
      terms: ['expiring'],
    });
    expect(readMapRequest('Show the Cardium and Winterburn outlines').settings.formations).toEqual({
      on: true,
      shown: ['cardium', 'nisku'],
    });
    expect(readMapRequest('satellite').settings).toEqual({ basemap: 'satellite' });
  });

  it('leaves the first section named open', () => {
    expect(readMapRequest('rigs and wells').settings.open).toBe('rigs');
    expect(readMapRequest('wells and rigs').settings.open).toBe('wells');
  });

  it('gives fixed reasons for what the map cannot do', () => {
    expect(readMapRequest('what is the weather').reasons).toEqual(['not_understood']);
    expect(readMapRequest('wells above 1,000 bbl a day').reasons).toContain('production_filter');
    expect(readMapRequest('wells near Fox Creek').reasons).toContain('place_not_found');
    expect(readMapRequest('wells in the Pembina field').reasons).toContain('field_or_pool');
    expect(readMapRequest('Montney wells in British Columbia').reasons).toEqual([
      'other_play',
      'other_province',
    ]);
    // A name the map does not know is never turned into settings.
    expect(readMapRequest('wells near Fox Creek').settings).toEqual({
      wells: { on: true },
      open: 'wells',
    });
  });

  it('always answers within the schema', () => {
    for (const text of [
      '',
      'x'.repeat(500),
      'wells operated by ' + 'a'.repeat(200),
      'wells since 1850',
      'wells in 2150',
    ]) {
      expect(mapSettingsSchema.safeParse(readMapRequest(text).settings).success).toBe(true);
    }
  });
});
