import { describe, expect, it } from 'vitest';

import { albertaInputToRequest, albertaNowInput } from './time';

describe('Alberta time in forms', () => {
  it('sends an Alberta wall time as UTC whatever the browser’s time zone', () => {
    expect(albertaInputToRequest('2026-10-30T14:00')).toBe('2026-10-30T20:00:00.000Z');
    // Winter too: Alberta's clocks stay at UTC−6.
    expect(albertaInputToRequest('2026-12-15T14:00')).toBe('2026-12-15T20:00:00.000Z');
    expect(albertaInputToRequest('')).toBe('');
    expect(albertaInputToRequest(undefined)).toBe('');
    expect(albertaInputToRequest('soon')).toBe('soon');
  });

  it('starts a form’s time at now in Alberta', () => {
    expect(albertaNowInput(new Date('2026-10-31T04:30:00.000Z'))).toBe('2026-10-30T22:30');
  });
});
