import { describe, expect, it } from 'vitest';

import {
  correctContactLogSchema,
  createContactLogSchema,
  parseContactLog,
  parseFollowUp,
  updateFollowUpSchema,
} from './crm';

// Synthetic values only.
const NOW = new Date('2026-10-29T15:00:00.000Z');
const PERSON = '00000000-0000-4000-8000-0000000044aa';

describe('parseContactLog', () => {
  it('cleans what was entered', () => {
    expect(
      parseContactLog(
        {
          occurredAt: '2026-10-29T14:30:00Z',
          channel: 'call',
          contactName: '  Pat   Buyer ',
          notes: 'Wants November\n\n\n\ndelivery.',
        },
        NOW,
      ),
    ).toEqual({
      status: 'ok',
      value: {
        occurredAt: '2026-10-29T14:30:00.000Z',
        channel: 'call',
        contactName: 'Pat Buyer',
        notes: 'Wants November\n\ndelivery.',
      },
    });
  });

  it('takes the time as now when it is left out, and notes as none', () => {
    expect(parseContactLog({ channel: 'visit', contactName: 'Pat Buyer' }, NOW)).toEqual({
      status: 'ok',
      value: {
        occurredAt: NOW.toISOString(),
        channel: 'visit',
        contactName: 'Pat Buyer',
        notes: null,
      },
    });
  });

  it('reports every field that needs fixing', () => {
    expect(parseContactLog({ occurredAt: 'yesterday', channel: 'fax', notes: ' ' }, NOW)).toEqual({
      status: 'invalid',
      issues: [
        { field: 'occurredAt', message: 'must be a date and time' },
        { field: 'channel', message: 'is not one of the choices' },
        { field: 'contactName', message: 'is required' },
      ],
    });
  });

  it('refuses a time in the future or before 2000, and allows a few minutes of clock skew', () => {
    const at = (occurredAt: string) =>
      parseContactLog({ occurredAt, channel: 'email', contactName: 'Pat' }, NOW).status;
    expect(at('2026-10-29T15:04:00Z')).toBe('ok');
    expect(at('2026-10-29T15:06:00Z')).toBe('invalid');
    expect(at('1999-12-31T23:00:00Z')).toBe('invalid');
  });

  it('refuses notes over 5,000 characters and a name over 200 or with control characters', () => {
    const result = parseContactLog(
      { channel: 'meeting', contactName: 'x'.repeat(201), notes: 'y'.repeat(5001) },
      NOW,
    );
    expect(result).toEqual({
      status: 'invalid',
      issues: [
        { field: 'contactName', message: 'is longer than 200 characters' },
        { field: 'notes', message: 'are longer than 5,000 characters' },
      ],
    });
    expect(parseContactLog({ channel: 'call', contactName: 'Pat\u0007' }, NOW).status).toBe(
      'invalid',
    );
    expect(
      parseContactLog({ channel: 'call', contactName: 'P', notes: 'y'.repeat(5000) }, NOW).status,
    ).toBe('ok');
  });
});

describe('parseFollowUp', () => {
  it('cleans what was entered', () => {
    expect(
      parseFollowUp({
        task: ' Send the  bid sheet ',
        dueAt: '2026-10-30T14:00:00Z',
        assignedTo: PERSON.toUpperCase(),
      }),
    ).toEqual({
      status: 'ok',
      value: { task: 'Send the bid sheet', dueAt: '2026-10-30T14:00:00.000Z', assignedTo: PERSON },
    });
  });

  it('allows a due time already past', () => {
    expect(
      parseFollowUp({ task: 'Call back', dueAt: '2026-10-01T14:00:00Z', assignedTo: PERSON })
        .status,
    ).toBe('ok');
  });

  it('reports every field that needs fixing', () => {
    expect(parseFollowUp({ dueAt: '2100-01-01T00:00:00Z', assignedTo: 'someone' })).toEqual({
      status: 'invalid',
      issues: [
        { field: 'task', message: 'is required' },
        { field: 'dueAt', message: 'must be between 2000 and 2099' },
        { field: 'assignedTo', message: 'is not one of the choices' },
      ],
    });
    expect(parseFollowUp({ task: 'Call', dueAt: '2026-10-30 14:00' })).toEqual({
      status: 'invalid',
      issues: [
        { field: 'dueAt', message: 'must be a date and time' },
        { field: 'assignedTo', message: 'is required' },
      ],
    });
  });
});

describe('request schemas', () => {
  it('take a contact with an optional follow-up', () => {
    const counterpartyId = '00000000-0000-4000-8000-00000000c1aa';
    expect(createContactLogSchema.safeParse({ counterpartyId, values: {} }).success).toBe(true);
    expect(
      createContactLogSchema.safeParse({ counterpartyId, values: {}, followUp: { task: 'Call' } })
        .success,
    ).toBe(true);
    expect(
      createContactLogSchema.safeParse({ counterpartyId, values: { colour: 'red' } }).success,
    ).toBe(false);
  });

  it('need the version a correction or change is based on', () => {
    expect(correctContactLogSchema.safeParse({ values: {} }).success).toBe(false);
    expect(correctContactLogSchema.safeParse({ basedOnRevision: 2, values: {} }).success).toBe(
      true,
    );
    expect(
      updateFollowUpSchema.safeParse({ version: '2026-10-28T14:05:09.123456Z', values: {} })
        .success,
    ).toBe(true);
    expect(updateFollowUpSchema.safeParse({ version: 'yesterday', values: {} }).success).toBe(
      false,
    );
  });
});
