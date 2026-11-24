import { describe, expect, it } from 'vitest';

import { FORMATION_OUTLINES } from './formationOutlines';
import {
  keepTypedNames,
  MAP_ASK_INSTRUCTIONS,
  MAP_ASK_JSON_SCHEMA,
  mapAskAnswerSchema,
  mapAskRequestSchema,
} from './mapAskClaude';

// Ask the map, read by Claude (F-254 part 2): the shape Claude answers in, and the checks the
// Worker makes on it.

/** Every object schema in a JSON schema, depth first. */
function objects(schema: unknown): Record<string, unknown>[] {
  if (typeof schema !== 'object' || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const here = node.type === 'object' ? [node] : [];
  return [...here, ...Object.values(node).flatMap(objects)];
}

describe('MAP_ASK_JSON_SCHEMA', () => {
  it('closes every object and uses nothing structured outputs refuse', () => {
    for (const object of objects(MAP_ASK_JSON_SCHEMA)) {
      expect(object.additionalProperties).toBe(false);
    }
    const text = JSON.stringify(MAP_ASK_JSON_SCHEMA);
    for (const refused of ['minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'minItems']) {
      expect(text).not.toContain(`"${refused}"`);
    }
  });

  it('offers only what the map’s settings take', () => {
    const settings = (MAP_ASK_JSON_SCHEMA.properties.settings as { properties: object }).properties;
    expect(Object.keys(settings).sort()).toEqual(
      [
        'open',
        'basemap',
        'goTo',
        'wells',
        'sales',
        'land',
        'facilities',
        'pipelines',
        'rigs',
        'formations',
        'prices',
        'geology',
        'grid',
      ].sort(),
    );
    // Claude never names a field or pool in the settings, nor the reasons only the Worker gives.
    const wells = (settings as { wells: { properties: object } }).wells.properties;
    expect(Object.keys(wells)).not.toContain('field');
    expect(Object.keys(wells)).not.toContain('pool');
    const reasons = JSON.stringify(MAP_ASK_JSON_SCHEMA.properties.reasons);
    for (const worker of [
      'place_not_found',
      'field_not_found',
      'field_not_loaded',
      'pool_needs_field',
    ]) {
      expect(reasons).not.toContain(worker);
    }
    // Each outline offered is one the map has, and the instructions name it.
    for (const f of FORMATION_OUTLINES) expect(MAP_ASK_INSTRUCTIONS).toContain(f.key);
  });
});

describe('mapAskAnswerSchema and mapAskRequestSchema', () => {
  it('takes settings and reasons, and refuses anything else', () => {
    expect(
      mapAskAnswerSchema.safeParse({ settings: { rigs: { period: 'now' } }, reasons: [] }).success,
    ).toBe(true);
    for (const answer of [
      { settings: {}, reasons: ['weather'] },
      { settings: {}, reasons: ['other_play', 'other_play'] },
      { settings: { wells: { spudFrom: 1850 } }, reasons: [] },
      { settings: {}, reasons: [], note: 'hi' },
      { settings: {} },
    ]) {
      expect(mapAskAnswerSchema.safeParse(answer).success, JSON.stringify(answer)).toBe(false);
    }
  });

  it('takes a request of 1 to 500 characters', () => {
    expect(mapAskRequestSchema.safeParse({ text: ' rigs now ' }).data).toEqual({
      text: 'rigs now',
    });
    for (const body of [{ text: '  ' }, { text: 'x'.repeat(501) }, { text: 'a', more: 1 }, {}]) {
      expect(mapAskRequestSchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('keepTypedNames', () => {
  it('keeps a name found in the request, letters and digits compared, and drops the rest', () => {
    expect(
      keepTypedNames(
        {
          wells: { on: true, operator: 'Chevron Canada' },
          sales: { buyer: 'Canadian Natural Resources' },
          land: { holder: '' },
          facilities: { operator: 'Tourmaline' },
          pipelines: { licensee: 'TC Energy' },
          rigs: { contractor: 'Ensign', operator: 'Ovintiv' },
        },
        'Wells of chevron-canada; land of any holder; tc energy pipelines; Ensign rigs',
      ),
    ).toEqual({
      wells: { on: true, operator: 'Chevron Canada' },
      sales: {},
      land: { holder: '' },
      facilities: {},
      pipelines: { licensee: 'TC Energy' },
      rigs: { contractor: 'Ensign' },
    });
  });

  it('matches whole words only', () => {
    expect(keepTypedNames({ wells: { operator: 'Ten' } }, 'wells of Tenaz')).toEqual({ wells: {} });
  });
});
