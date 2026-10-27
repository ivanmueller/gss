import { describe, expect, it } from 'vitest';

import { displayName } from './useMe';

describe('displayName', () => {
  it('shows the first name and the last initial', () => {
    expect(displayName('Ivan', 'Mueller')).toBe('Ivan M.');
    expect(displayName('Ana', 'élan')).toBe('Ana É.');
  });

  it('shows the first name alone, or nothing without one', () => {
    expect(displayName('Ivan', null)).toBe('Ivan');
    expect(displayName(null, 'Mueller')).toBeNull();
  });
});
