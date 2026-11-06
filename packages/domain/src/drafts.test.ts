import { describe, expect, it } from 'vitest';

import { defaultFollowUpDue, draftContactValues, draftReadiness } from './drafts';

// Synthetic values only (555 numbers, made-up names).
const NOW = new Date('2026-11-06T20:00:00Z');
const CALLER = '00000000-0000-4000-8000-0000000044aa';

const completeBid = {
  kind: 'quote' as const,
  fields: {
    side: 'bid' as const,
    commodity: 'canola' as const,
    values: {
      price: '725.00',
      currency: 'CAD',
      deliveryBasis: 'delivered',
      quantityMax: '500',
      quotedAt: '2026-11-06T19:00:00.000Z',
      validUntil: '2026-11-13T19:00:00.000Z',
      sourceType: 'phone',
    },
    checks: {},
  },
};

describe('draftReadiness', () => {
  it('saves a complete bid as drafted, indicative and per tonne unless said', () => {
    const ready = draftReadiness(completeBid, NOW);
    expect(ready).toMatchObject({
      status: 'ready',
      save: {
        kind: 'quote',
        side: 'bid',
        commodity: 'canola',
        terms: { firmness: 'indicative', priceUnit: 'MT', price: '725.00', currency: 'CAD' },
      },
    });
  });

  it('keeps what Claude drafted over the defaults', () => {
    const firm = {
      ...completeBid,
      fields: {
        ...completeBid.fields,
        values: { ...completeBid.fields.values, firmness: 'firm', priceUnit: 'ST' },
      },
    };
    expect(draftReadiness(firm, NOW)).toMatchObject({
      status: 'ready',
      save: { terms: { firmness: 'firm', priceUnit: 'ST' } },
    });
  });

  it('names what an incomplete bid is missing, in plain words, once each', () => {
    const values: Record<string, string> = { ...completeBid.fields.values };
    delete values.validUntil;
    delete values.deliveryBasis;
    const ready = draftReadiness(
      { kind: 'quote', fields: { ...completeBid.fields, commodity: null, values } },
      NOW,
    );
    expect(ready.status).toBe('incomplete');
    if (ready.status === 'incomplete') {
      expect(ready.missing).toEqual(
        expect.arrayContaining(['commodity', 'delivery basis', 'valid until']) as unknown,
      );
      expect(new Set(ready.missing).size).toBe(ready.missing.length);
    }
  });

  it('refuses a bid whose valid-until time has passed', () => {
    const late = draftReadiness(completeBid, new Date('2026-11-20T00:00:00Z'));
    expect(late.status === 'incomplete' && late.missing.includes('valid until')).toBe(true);
  });

  it('plans a follow-up due tomorrow at 9:00 am MT when no time was said', () => {
    expect(
      draftReadiness(
        {
          kind: 'follow_up',
          fields: { values: { task: 'Send the contract', assignedTo: CALLER } },
        },
        NOW,
      ),
    ).toEqual({
      status: 'ready',
      save: {
        kind: 'follow_up',
        followUp: {
          task: 'Send the contract',
          dueAt: '2026-11-07T15:00:00.000Z',
          assignedTo: CALLER,
        },
      },
    });
  });

  it('keeps a follow-up time that was said', () => {
    expect(
      draftReadiness(
        {
          kind: 'follow_up',
          fields: {
            values: { task: 'Call back', assignedTo: CALLER, dueAt: '2026-11-10T16:30:00.000Z' },
          },
        },
        NOW,
      ),
    ).toMatchObject({ save: { followUp: { dueAt: '2026-11-10T16:30:00.000Z' } } });
  });

  it("lays a listed contact's new details over its own", () => {
    const listed = {
      name: 'Pat Buyer',
      role: null,
      email: 'pat@example.test',
      phone: '(403) 555-0100',
    };
    expect(
      draftReadiness(
        { kind: 'contact', fields: { values: { contactRole: 'Head buyer' }, checks: {} } },
        NOW,
        listed,
      ),
    ).toEqual({
      status: 'ready',
      save: {
        kind: 'contact',
        contact: {
          name: 'Pat Buyer',
          role: 'Head buyer',
          email: 'pat@example.test',
          phone: '(403) 555-0100',
        },
      },
    });
  });

  it('adds a new person with a name, and asks for one without', () => {
    expect(
      draftReadiness(
        {
          kind: 'contact',
          fields: {
            values: { contactName: 'Sam Logistics', contactPhone: '403 555 0177' },
            checks: {},
          },
        },
        NOW,
      ),
    ).toMatchObject({ status: 'ready', save: { contact: { name: 'Sam Logistics' } } });
    expect(
      draftReadiness(
        { kind: 'contact', fields: { values: { contactRole: 'Driver' }, checks: {} } },
        NOW,
      ),
    ).toEqual({ status: 'incomplete', missing: ['name'] });
  });
});

describe('draftContactValues', () => {
  it('fills blanks for a new person', () => {
    expect(draftContactValues({ contactName: 'Sam' }, null)).toEqual({
      contactName: 'Sam',
      contactRole: '',
      contactEmail: '',
      contactPhone: '',
    });
  });
});

describe('defaultFollowUpDue', () => {
  it('is 9:00 am MT (15:00 UTC) on the next Alberta day, even late in the evening', () => {
    expect(defaultFollowUpDue(new Date('2026-11-06T20:00:00Z'))).toBe('2026-11-07T15:00:00.000Z');
    // 11:30 pm MT on 6 November is already 7 November in UTC.
    expect(defaultFollowUpDue(new Date('2026-11-07T05:30:00Z'))).toBe('2026-11-07T15:00:00.000Z');
  });
});
