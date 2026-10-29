import type { FollowUp } from '@grain/domain';
import { describe, expect, it } from 'vitest';

import { canFinish, canLogContacts, defaultDueInput, dueState } from './crm';

// Synthetic values only.
const ME = '00000000-0000-4000-8000-0000000033aa';
const FOLLOW_UP = {
  dueAt: '2026-10-30T19:00:00.000Z',
  doneAt: null,
  assignedTo: { userId: ME, name: 'Victor' },
} as FollowUp;

describe('who may do what', () => {
  it('lets traders, operations and admins log contacts, not viewers or analysts', () => {
    expect(['trader', 'operations', 'org_admin'].every(canLogContacts)).toBe(true);
    expect(['viewer', 'analyst'].some(canLogContacts)).toBe(false);
  });

  it('lets the person responsible mark their own follow-up done whatever their role', () => {
    expect(canFinish(FOLLOW_UP, 'viewer', ME)).toBe(true);
    expect(canFinish(FOLLOW_UP, 'viewer', '00000000-0000-4000-8000-0000000066aa')).toBe(false);
    expect(canFinish(FOLLOW_UP, 'viewer', undefined)).toBe(false);
    expect(canFinish(FOLLOW_UP, 'trader', undefined)).toBe(true);
  });
});

describe('a follow-up’s first due time', () => {
  it('is 9 am tomorrow in Alberta', () => {
    const now = new Date('2026-10-31T04:30:00.000Z'); // 10:30 pm in Alberta on 30 October
    expect(defaultDueInput(now)).toBe('2026-10-31T09:00');
    expect(defaultDueInput(new Date('2026-12-31T20:00:00.000Z'))).toBe('2027-01-01T09:00');
  });
});

describe('dueState', () => {
  const now = new Date('2026-10-30T16:00:00.000Z'); // 10 am in Alberta
  it('tells overdue, due later today in Alberta time, upcoming and done apart', () => {
    expect(dueState({ dueAt: '2026-10-30T15:59:00.000Z', doneAt: null }, now)).toBe('overdue');
    expect(dueState({ dueAt: '2026-10-31T05:59:00.000Z', doneAt: null }, now)).toBe('today');
    expect(dueState({ dueAt: '2026-10-31T06:00:00.000Z', doneAt: null }, now)).toBe('upcoming');
    expect(
      dueState({ dueAt: '2026-10-29T14:00:00.000Z', doneAt: '2026-10-29T15:00:00.000Z' }, now),
    ).toBe('done');
  });
});
