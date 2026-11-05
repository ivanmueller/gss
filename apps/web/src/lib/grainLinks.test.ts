import { COMMODITIES } from '@grain/domain';
import { describe, expect, it } from 'vitest';

import { grainForCommodity } from './grains';
import { grainHref } from './grainLinks';

describe('grainHref', () => {
  it('links every commodity to the grain whose data lists it', () => {
    for (const { code } of COMMODITIES) {
      const grain = grainForCommodity(code);
      expect(grain, code).toBeDefined();
      expect(grainHref(code), code).toBe(`/grains/${grain?.id ?? ''}`);
    }
  });

  it('links nothing for an unknown code', () => {
    expect(grainHref('not_a_commodity')).toBeUndefined();
  });
});
