import { describe, expect, it } from 'vitest';

import type { TranscriptLine } from './calls';
import {
  CALL_READING_JSON_SCHEMA,
  callReadingSchema,
  checkReading,
  decideDraftSchema,
  numberedTranscript,
  mentionsIn,
  type CallReading,
  type ReadingContext,
} from './readings';

// Synthetic calls only.
const CALLER = '00000000-0000-4000-8000-0000000044aa';
const PAT = '00000000-0000-4000-8000-00000000d1aa';

const LINES: TranscriptLine[] = [
  { side: 'caller', start: 0, text: 'Hi Pat, any interest in canola this week?' },
  {
    side: 'counterparty',
    start: 3,
    text: 'We can bid $725.50 Canadian a tonne delivered Lethbridge for 1,500 tonnes.',
  },
  { side: 'counterparty', start: 9, text: 'Good until Friday noon. Call me back Thursday at 2.' },
  { side: 'counterparty', start: 15, text: 'Talk to Sam, our new merchandiser, at 403 555 0177.' },
];

const context = (overrides: Partial<ReadingContext> = {}): ReadingContext => ({
  lines: LINES,
  counterpartyTypes: ['buyer'],
  contacts: [{ id: PAT, name: 'Pat Buyer', role: 'Buyer', email: 'pat@example.test', phone: null }],
  callerId: CALLER,
  // Thursday 5 Nov 2026, 9:00 am MT.
  calledAt: '2026-11-05T15:00:00.000Z',
  ...overrides,
});

const quote = (overrides: Partial<CallReading['quotes'][number]> = {}) => ({
  side: 'bid' as const,
  commodity: 'canola' as const,
  firmness: null,
  price: '725.50',
  currency: 'CAD' as const,
  priceUnit: 'MT' as const,
  grade: null,
  deliveryBasis: 'delivered' as const,
  basisLocation: 'Lethbridge',
  quantityMinMt: null,
  quantityMaxMt: '1500',
  deliveryStart: null,
  deliveryEnd: null,
  validUntil: '2026-11-06T12:00',
  notes: null,
  lines: [1, 2],
  ...overrides,
});

const reading = (overrides: Partial<CallReading> = {}): CallReading => ({
  voicemail: false,
  summary: 'Pat bids on canola delivered Lethbridge.',
  quotes: [],
  followUps: [],
  contacts: [],
  ...overrides,
});

describe('mentionsIn', () => {
  const said = (value: string, more: Record<string, unknown> = {}) => ({
    value,
    price: false,
    priceUnit: null,
    tonnes: false,
    currency: null,
    ...more,
  });

  it('tells a price per unit from a quantity in tonnes', () => {
    expect(mentionsIn('$725.50 a tonne for 1,500 tonnes.')).toEqual([
      said('725.5', { price: true, priceUnit: 'MT' }),
      said('1500', { tonnes: true }),
    ]);
    expect(mentionsIn('7.25 US a bushel, 12 dollars per cwt, 300 bucks, 9 per short ton')).toEqual([
      said('7.25', { price: true, priceUnit: 'BU', currency: 'USD' }),
      said('12', { price: true, priceUnit: 'CWT' }),
      said('300', { price: true }),
      said('9', { price: true, priceUnit: 'ST' }),
    ]);
  });

  it('says nothing of a bare number, or of a ton that is not clearly metric', () => {
    expect(mentionsIn('call me at 2, 725 maybe, 400 a ton')).toEqual([
      said('2'),
      said('725'),
      said('400', { price: true }),
    ]);
    expect(mentionsIn('2000 tons')).toEqual([said('2000')]);
  });

  it('takes a currency only from the price expression itself (Codex, third review, finding 1)', () => {
    expect(mentionsIn('Canola is $725 a tonne and oats are USD $300 a tonne.')).toEqual([
      said('725', { price: true, priceUnit: 'MT' }),
      said('300', { price: true, priceUnit: 'MT', currency: 'USD' }),
    ]);
    expect(
      mentionsIn('$725 a tonne, Canadian funds; C$9 a bushel; 12 US dollars a bushel'),
    ).toEqual([
      said('725', { price: true, priceUnit: 'MT' }),
      said('9', { price: true, priceUnit: 'BU', currency: 'CAD' }),
      said('12', { price: true, priceUnit: 'BU', currency: 'USD' }),
    ]);
  });

  it('never reads a negative amount as a price or quantity (Codex, third review, finding 2)', () => {
    expect(mentionsIn('The bid is -$5 a tonne, minus 10 tonnes, negative $3 a bushel')).toEqual([
      said('5'),
      said('10'),
      said('3'),
    ]);
    expect(mentionsIn('700-725 a tonne')).toEqual([said('700'), said('725')]);
  });

  it('reads a leading decimal point as part of the number (Codex, second review, finding 2)', () => {
    expect(mentionsIn('$.50 per bushel, .5 tonnes')).toEqual([
      said('0.5', { price: true, priceUnit: 'BU' }),
      said('0.5', { tonnes: true }),
    ]);
  });

  it("takes the currency from the price's own clause only (Codex, second review, finding 1)", () => {
    expect(
      mentionsIn('Canola is $725 Canadian a tonne. Oats are $300 USD a tonne. Ship it to us.'),
    ).toEqual([
      said('725', { price: true, priceUnit: 'MT', currency: 'CAD' }),
      said('300', { price: true, priceUnit: 'MT', currency: 'USD' }),
    ]);
    expect(mentionsIn('US$7.25 a bushel, CAD 310 a tonne, $9 sell to us')).toEqual([
      said('7.25', { price: true, priceUnit: 'BU', currency: 'USD' }),
      said('310', { price: true, priceUnit: 'MT', currency: 'CAD' }),
      said('9', { price: true }),
    ]);
  });
});

describe('checkReading: bids and offers', () => {
  it('keeps what was said, quoted at the call, from a phone call', () => {
    const checked = checkReading(reading({ quotes: [quote()] }), context());
    expect(checked.drafts).toEqual([
      {
        kind: 'quote',
        fields: {
          side: 'bid',
          commodity: 'canola',
          values: {
            quotedAt: '2026-11-05T15:00:00.000Z',
            sourceType: 'phone',
            sourceReference: 'Call of Thu 5 Nov 2026, 9:00 am MT, drafted by Claude',
            price: '725.50',
            currency: 'CAD',
            priceUnit: 'MT',
            deliveryBasis: 'delivered',
            basisLocation: 'Lethbridge',
            quantityMax: '1500',
            // Friday noon in Alberta (UTC−6).
            validUntil: '2026-11-06T18:00:00.000Z',
          },
        },
        lines: [1, 2],
      },
    ]);
  });

  it('leaves a price or quantity blank when its digits were not said in its lines', () => {
    const [draft] = checkReading(
      reading({ quotes: [quote({ price: '730', quantityMaxMt: '1500', lines: [0, 2] })] }),
      context(),
    ).drafts;
    expect(draft?.kind === 'quote' && draft.fields.values).not.toHaveProperty('price');
    expect(draft?.kind === 'quote' && draft.fields.values).not.toHaveProperty('quantityMax');
  });

  it('never takes a quantity for a price or a price for a quantity (Codex, finding 1)', () => {
    const [draft] = checkReading(
      reading({ quotes: [quote({ price: '1500', quantityMaxMt: '725.50' })] }),
      context(),
    ).drafts;
    const values = draft?.kind === 'quote' ? draft.fields.values : {};
    expect(values).not.toHaveProperty('price');
    expect(values).not.toHaveProperty('quantityMax');
    expect(values).not.toHaveProperty('priceUnit');
    expect(values).not.toHaveProperty('currency');
  });

  it('does not take a currency or a whole number from another bid (Codex, second review)', () => {
    const lines: TranscriptLine[] = [
      {
        side: 'counterparty',
        start: 0,
        text: 'Canola is $725 Canadian a tonne. Oats are $300 USD a tonne.',
      },
      { side: 'counterparty', start: 5, text: 'Peas at $.50 per bushel, .5 tonnes only.' },
    ];
    const [canola, peas] = checkReading(
      reading({
        quotes: [
          quote({ price: '725', currency: 'USD', quantityMaxMt: null, lines: [0] }),
          quote({ price: '50', quantityMaxMt: '5', currency: null, lines: [1] }),
        ],
      }),
      context({ lines }),
    ).drafts;
    expect(canola?.kind === 'quote' && canola.fields.values.price).toBe('725');
    expect(canola?.kind === 'quote' && canola.fields.values).not.toHaveProperty('currency');
    expect(peas?.kind === 'quote' && peas.fields.values).not.toHaveProperty('price');
    expect(peas?.kind === 'quote' && peas.fields.values).not.toHaveProperty('quantityMax');
  });

  it('leaves a negative price blank (Codex, third review, finding 2)', () => {
    const [draft] = checkReading(
      reading({ quotes: [quote({ price: '5', quantityMaxMt: null, currency: null, lines: [0] })] }),
      context({ lines: [{ side: 'counterparty', start: 0, text: 'The bid is -$5 a tonne.' }] }),
    ).drafts;
    expect(draft?.kind === 'quote' && draft.fields.values).not.toHaveProperty('price');
    expect(draft?.kind === 'quote' && draft.fields.values).not.toHaveProperty('priceUnit');
  });

  it('keeps a unit or currency only when said with the price', () => {
    const [draft] = checkReading(
      reading({ quotes: [quote({ priceUnit: 'BU', currency: 'USD' })] }),
      context(),
    ).drafts;
    const values = draft?.kind === 'quote' ? draft.fields.values : {};
    expect(values.price).toBe('725.50');
    expect(values).not.toHaveProperty('priceUnit');
    expect(values).not.toHaveProperty('currency');
  });

  it('never converts: a price that is not plain digits stays blank', () => {
    const [draft] = checkReading(
      reading({ quotes: [quote({ price: 'about 725', quantityMaxMt: '-5' })] }),
      context(),
    ).drafts;
    expect(draft?.kind === 'quote' && draft.fields.values.price).toBeUndefined();
    expect(draft?.kind === 'quote' && draft.fields.values.quantityMax).toBeUndefined();
  });

  it('leaves out what was not said rather than guessing', () => {
    const [draft] = checkReading(
      reading({
        quotes: [
          quote({
            price: null,
            currency: null,
            quantityMaxMt: null,
            deliveryBasis: null,
            validUntil: null,
          }),
        ],
      }),
      context(),
    ).drafts;
    const values = draft?.kind === 'quote' ? draft.fields.values : {};
    for (const field of ['price', 'currency', 'quantityMax', 'deliveryBasis', 'validUntil']) {
      expect(values).not.toHaveProperty(field);
    }
  });

  it('drops a valid-until time not after the call, and dates that are not dates', () => {
    const [draft] = checkReading(
      reading({
        quotes: [
          quote({
            validUntil: '2026-11-04T12:00',
            deliveryStart: '2026-02-30',
            deliveryEnd: 'soon',
          }),
        ],
      }),
      context(),
    ).drafts;
    const values = draft?.kind === 'quote' ? draft.fields.values : {};
    expect(values).not.toHaveProperty('validUntil');
    expect(values).not.toHaveProperty('deliveryStart');
    expect(values).not.toHaveProperty('deliveryEnd');
  });

  it('leaves out a bid from a company that does not buy, and drafts with no line', () => {
    const checked = checkReading(
      reading({ quotes: [quote(), quote({ side: 'offer' }), quote({ lines: [99, -1, 1.5] })] }),
      context(),
    );
    expect(checked.drafts).toHaveLength(1);
    expect(
      checkReading(reading({ quotes: [quote()] }), context({ counterpartyTypes: ['seller'] }))
        .drafts,
    ).toEqual([]);
  });

  it('keeps line numbers once each, in order', () => {
    const [draft] = checkReading(
      reading({ quotes: [quote({ lines: [2, 1, 2, 7] })] }),
      context(),
    ).drafts;
    expect(draft?.lines).toEqual([1, 2]);
  });
});

describe('checkReading: follow-ups', () => {
  it('assigns the follow-up to the caller, due in Alberta time when a time was said', () => {
    const checked = checkReading(
      reading({
        followUps: [
          { task: 'Call Pat back', dueAt: '2026-11-12T14:00', lines: [2] },
          { task: 'Send the bid sheet', dueAt: null, lines: [2] },
          { task: '   ', dueAt: null, lines: [2] },
          { task: 'Not said', dueAt: null, lines: [] },
        ],
      }),
      context(),
    );
    expect(checked.drafts).toEqual([
      {
        kind: 'follow_up',
        fields: {
          values: { task: 'Call Pat back', assignedTo: CALLER, dueAt: '2026-11-12T20:00:00.000Z' },
        },
        lines: [2],
      },
      {
        kind: 'follow_up',
        fields: { values: { task: 'Send the bid sheet', assignedTo: CALLER } },
        lines: [2],
      },
    ]);
  });
});

describe('checkReading: contacts', () => {
  it('drafts a new person with a phone number said in its line', () => {
    const [draft] = checkReading(
      reading({
        contacts: [
          {
            contactId: null,
            name: 'Sam',
            role: 'Merchandiser',
            email: null,
            phone: '(403) 555-0177',
            lines: [3],
          },
        ],
      }),
      context(),
    ).drafts;
    expect(draft).toEqual({
      kind: 'contact',
      contactId: null,
      fields: {
        values: { contactName: 'Sam', contactRole: 'Merchandiser', contactPhone: '(403) 555-0177' },
      },
      lines: [3],
    });
  });

  it('leaves a phone number out when its digits were not said', () => {
    const [draft] = checkReading(
      reading({
        contacts: [
          {
            contactId: null,
            name: 'Sam',
            role: null,
            email: null,
            phone: '403 555 0178',
            lines: [3],
          },
        ],
      }),
      context(),
    ).drafts;
    expect(draft?.fields.values).toEqual({ contactName: 'Sam' });
  });

  it('keeps only the changed details of a listed contact, and drops a draft that changes nothing', () => {
    const checked = checkReading(
      reading({
        contacts: [
          {
            contactId: PAT,
            name: 'Pat Buyer',
            role: 'Head buyer',
            email: 'PAT@example.test',
            phone: null,
            lines: [3],
          },
          {
            contactId: PAT,
            name: 'pat buyer',
            role: 'buyer',
            email: null,
            phone: null,
            lines: [3],
          },
          {
            contactId: 'not-listed',
            name: null,
            role: 'Trader',
            email: null,
            phone: null,
            lines: [3],
          },
        ],
      }),
      context(),
    );
    expect(checked.drafts).toEqual([
      {
        kind: 'contact',
        contactId: PAT,
        fields: { values: { contactRole: 'Head buyer' } },
        lines: [3],
      },
    ]);
  });

  it('keeps an extension only when it was said (Codex, finding 2)', () => {
    const phoneOf = (phone: string, text: string) =>
      checkReading(
        reading({
          contacts: [{ contactId: null, name: 'Sam', role: null, email: null, phone, lines: [0] }],
        }),
        context({ lines: [{ side: 'counterparty', start: 0, text }] }),
      ).drafts[0]?.fields.values;
    expect(phoneOf('403 555 0177 x999', 'Sam is at 403 555 0177.')).toEqual({
      contactName: 'Sam',
      contactPhone: '403 555 0177',
    });
    expect(phoneOf('403 555 0177 x12', 'Sam is at 403 555 0177 extension 12.')).toEqual({
      contactName: 'Sam',
      contactPhone: '403 555 0177 x12',
    });
  });

  it("does not take another number's extension (Codex, second review, finding 3)", () => {
    const [draft] = checkReading(
      reading({
        contacts: [
          {
            contactId: null,
            name: 'Sam',
            role: null,
            email: null,
            phone: '403 555 0177 x999',
            lines: [0],
          },
        ],
      }),
      context({
        lines: [
          {
            side: 'counterparty',
            start: 0,
            text: 'Sam: 403 555 0177 extension 123; Pat: 403 555 0199 extension 999.',
          },
        ],
      }),
    ).drafts;
    expect(draft?.fields.values).toEqual({ contactName: 'Sam', contactPhone: '403 555 0177' });
  });

  it('keeps a phone number with one extension at most, rebuilt from what was checked (Codex, third review, finding 3)', () => {
    const phoneOf = (phone: string) =>
      checkReading(
        reading({
          contacts: [{ contactId: null, name: 'Sam', role: null, email: null, phone, lines: [0] }],
        }),
        context({
          lines: [{ side: 'counterparty', start: 0, text: 'Sam: 403 555 0177 extension 123.' }],
        }),
      ).drafts[0]?.fields.values;
    expect(phoneOf('403 555 0177 x123 x999')).toEqual({ contactName: 'Sam' });
    expect(phoneOf('403 555 0177 x 123')).toEqual({
      contactName: 'Sam',
      contactPhone: '403 555 0177 x123',
    });
  });

  it('leaves out an email that is not one', () => {
    const [draft] = checkReading(
      reading({
        contacts: [
          {
            contactId: null,
            name: 'Sam',
            role: null,
            email: 'sam at example',
            phone: null,
            lines: [3],
          },
        ],
      }),
      context(),
    ).drafts;
    expect(draft?.fields.values).toEqual({ contactName: 'Sam' });
  });
});

describe('checkReading: notes and voicemail', () => {
  it('keeps the voicemail answer and tidy notes, at most 2000 characters', () => {
    const checked = checkReading(
      reading({
        voicemail: true,
        summary: `  Left a message.\u0007\n\n\n\nAsked for a call back. ${'x'.repeat(2100)}`,
      }),
      context(),
    );
    expect(checked.voicemail).toBe(true);
    expect(checked.summary?.startsWith('Left a message.\n\nAsked for a call back.')).toBe(true);
    expect(checked.summary).toHaveLength(2000);
    expect(checkReading(reading({ summary: '   ' }), context()).summary).toBeNull();
  });

  it('keeps at most 10 drafts of a kind', () => {
    const many = Array.from({ length: 12 }, () => ({ task: 'Call back', dueAt: null, lines: [2] }));
    expect(checkReading(reading({ followUps: many }), context()).drafts).toHaveLength(10);
  });
});

describe('numberedTranscript', () => {
  it('numbers each line with who said it', () => {
    expect(
      numberedTranscript([...LINES.slice(0, 2), { side: null, start: 20, text: ' Bye  now ' }], {
        caller: 'Tom',
        counterparty: 'Pat Buyer',
      }),
    ).toBe(
      '[0] GSS (Tom): Hi Pat, any interest in canola this week?\n' +
        '[1] Counterparty (Pat Buyer): We can bid $725.50 Canadian a tonne delivered Lethbridge for 1,500 tonnes.\n' +
        '[2] Unknown side: Bye now',
    );
  });
});

describe('the schema Claude answers with', () => {
  it('names the same fields as the check, every object closed with all fields required', () => {
    const shape = callReadingSchema.shape;
    const schema = CALL_READING_JSON_SCHEMA as {
      properties: Record<string, { items?: { properties: Record<string, unknown> } }>;
      required: string[];
      additionalProperties: boolean;
    };
    expect(Object.keys(schema.properties)).toEqual(Object.keys(shape));
    expect(schema.required).toEqual(Object.keys(shape));
    expect(schema.additionalProperties).toBe(false);
    for (const key of ['quotes', 'followUps', 'contacts'] as const) {
      const items = schema.properties[key]?.items as unknown as {
        properties: Record<string, unknown>;
        required: string[];
        additionalProperties: boolean;
      };
      expect(Object.keys(items.properties)).toEqual(Object.keys(shape[key].element.shape));
      expect(items.required).toEqual(Object.keys(items.properties));
      expect(items.additionalProperties).toBe(false);
    }
    expect(JSON.stringify(schema)).not.toMatch(
      /minLength|maxLength|minimum|maximum|minItems|maxItems/,
    );
  });

  it('parses an answer in that shape', () => {
    expect(callReadingSchema.safeParse(reading({ quotes: [quote()] })).success).toBe(true);
    expect(callReadingSchema.safeParse({ voicemail: 'no' }).success).toBe(false);
  });
});

describe('decideDraftSchema', () => {
  it('needs what was saved to accept, and nothing to dismiss', () => {
    expect(decideDraftSchema.safeParse({ decision: 'accepted', resultId: PAT }).success).toBe(true);
    expect(decideDraftSchema.safeParse({ decision: 'accepted' }).success).toBe(false);
    expect(decideDraftSchema.safeParse({ decision: 'dismissed' }).success).toBe(true);
    expect(decideDraftSchema.safeParse({ decision: 'dismissed', resultId: PAT }).success).toBe(
      false,
    );
    expect(decideDraftSchema.safeParse({ decision: 'maybe' }).success).toBe(false);
  });
});
