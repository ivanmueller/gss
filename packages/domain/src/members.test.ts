import { describe, expect, it } from 'vitest';

import { addMemberSchema, updateMemberSchema } from './members';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const VERSION = '2026-10-28T14:05:09.123456Z';

describe('addMemberSchema', () => {
  it('takes an email and a role', () => {
    expect(
      addMemberSchema.parse({ organizationId: ORG, email: ' ana@example.test ', role: 'trader' }),
    ).toEqual({ organizationId: ORG, email: 'ana@example.test', role: 'trader' });
    expect(
      addMemberSchema.safeParse({ organizationId: ORG, email: 'not-an-email', role: 'trader' })
        .success,
    ).toBe(false);
    expect(
      addMemberSchema.safeParse({ organizationId: ORG, email: 'a@example.test', role: 'owner' })
        .success,
    ).toBe(false);
  });
});

describe('updateMemberSchema', () => {
  it('cleans names, and takes empty as no name', () => {
    expect(
      updateMemberSchema.parse({
        organizationId: ORG,
        version: VERSION,
        firstName: '  Ana   Maria ',
        lastName: '',
      }),
    ).toMatchObject({ firstName: 'Ana Maria', lastName: null });
  });

  it('refuses invited, long or odd names, a missing version and an empty change', () => {
    const base = { organizationId: ORG, version: VERSION };
    for (const body of [
      { ...base, status: 'invited' },
      { ...base, firstName: 'x'.repeat(101) },
      { ...base, firstName: 'A\u0007' },
      { organizationId: ORG, role: 'viewer' },
      base,
    ]) {
      expect(updateMemberSchema.safeParse(body).success).toBe(false);
    }
  });
});
