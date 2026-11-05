import { describe, expect, it } from 'vitest';

import type { TranscriptLine } from './calls';
import {
  CALL_READING_JSON_SCHEMA,
  callReadingSchema,
  checkReading,
  decideDraftSchema,
  numberedTranscript,
  saidPhone,
  saidPrice,
  saidTonnes,
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

const quote = (
  overrides: Partial<CallReading['quotes'][number]> = {},
): CallReading['quotes'][number] => ({
  side: 'bid',
  commodity: 'canola',
  firmness: null,
  priceSaid: '$725.50 Canadian a tonne',
  grade: null,
  deliveryBasis: 'delivered',
  basisLocation: 'Lethbridge',
  quantityMinSaid: null,
  quantityMaxSaid: '1,500 tonnes',
  deliveryStart: null,
  deliveryEnd: null,
  validUntil: '2026-11-06T12:00',
  notes: null,
  lines: [1, 2],
  ...overrides,
});

const contact = (
  overrides: Partial<CallReading['contacts'][number]> = {},
): CallReading['contacts'][number] => ({
  contactId: null,
  name: 'Sam',
  role: null,
  email: null,
  phoneSaid: null,
  lines: [3],
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

describe('saidPrice', () => {
  it('reads a price said whole, with its currency and unit from the same words', () => {
    const line = ['We bid $725.50 Canadian a tonne, US$7.25 a bushel, CAD $310 per tonne.'];
    expect(saidPrice('$725.50 Canadian a tonne', line)).toEqual({
      amount: '725.50',
      currency: 'CAD',
      unit: 'MT',
    });
    expect(saidPrice('US$7.25 a bushel', line)).toEqual({
      amount: '7.25',
      currency: 'USD',
      unit: 'BU',
    });
    expect(saidPrice('CAD $310 per tonne', line)).toEqual({
      amount: '310',
      currency: 'CAD',
      unit: 'MT',
    });
    expect(saidPrice('12 US dollars per cwt', ['That is 12 US dollars per cwt.'])).toEqual({
      amount: '12',
      currency: 'USD',
      unit: 'CWT',
    });
    expect(saidPrice('$1,025 a short ton', ['Say $1,025 a short ton.'])).toEqual({
      amount: '1025',
      currency: null,
      unit: 'ST',
    });
  });

  it('needs the words exactly as said, in a cited line', () => {
    expect(saidPrice('$730 a tonne', ['We bid $725 a tonne.'])).toBeNull();
    expect(saidPrice('$725 a tonne', [])).toBeNull();
  });

  it('is not a price without a dollar sign, currency, dollars or unit', () => {
    expect(saidPrice('725', ['Maybe 725 for canola.'])).toBeNull();
    expect(saidPrice('1,500 tonnes', ['For 1,500 tonnes.'])).toBeNull();
  });

  it('never puts a currency and unit together from two prices (Codex, fourth review, finding 1)', () => {
    const line = ['Canola is CAD $725 per tonne; oats are USD $725 per short ton.'];
    expect(saidPrice('$725 per tonne', line)).toBeNull();
    expect(saidPrice('CAD $725 per tonne', line)).toEqual({
      amount: '725',
      currency: 'CAD',
      unit: 'MT',
    });
    expect(saidPrice('USD $725 per short ton', line)).toEqual({
      amount: '725',
      currency: 'USD',
      unit: 'ST',
    });
    // The currency of the next bid is not this one's (third review, finding 1).
    expect(
      saidPrice('$725 a tonne', ['Canola is $725 a tonne and oats are USD $300 a tonne.']),
    ).toEqual({ amount: '725', currency: null, unit: 'MT' });
  });

  it('refuses a signed or ranged price (Codex, third and fourth reviews, finding 2)', () => {
    expect(saidPrice('$5 a tonne', ['The bid is -$5 a tonne.'])).toBeNull();
    expect(saidPrice('-$5 a tonne', ['The bid is -$5 a tonne.'])).toBeNull();
    expect(saidPrice('CAD $5 a tonne', ['It is minus CAD $5 a tonne.'])).toBeNull();
    expect(saidPrice('$700', ['Somewhere $700-725 a tonne.'])).toBeNull();
    expect(saidPrice('725 a tonne', ['Somewhere $700-725 a tonne.'])).toBeNull();
    expect(saidPrice('$700', ['From $700 to $725 a tonne.'])).toBeNull();
    expect(saidPrice('$725 a tonne', ['Between $700 and $725 a tonne.'])).toBeNull();
  });

  it('reads a leading decimal whole and never a part of a number (Codex, second review, finding 2)', () => {
    expect(saidPrice('$.50 per bushel', ['Peas at $.50 per bushel.'])).toEqual({
      amount: '0.50',
      currency: null,
      unit: 'BU',
    });
    expect(saidPrice('$50 per bushel', ['Peas at $.50 per bushel.'])).toBeNull();
    expect(saidPrice('$7', ['It is $7.25 a bushel.'])).toBeNull();
    expect(saidPrice('$725', ['It is $725,000 in all.'])).toBeNull();
    expect(saidPrice('$725 a ton', ['It is $725 a tonne.'])).toBeNull();
  });

  it('refuses two currencies, zero, or anything more than one price', () => {
    expect(saidPrice('CAD $725 US', ['CAD $725 US'])).toBeNull();
    expect(saidPrice('$0 a tonne', ['$0 a tonne'])).toBeNull();
    expect(saidPrice('$725 or $730 a tonne', ['$725 or $730 a tonne'])).toBeNull();
  });
});

describe('saidTonnes', () => {
  it('reads a quantity said whole in metric tonnes', () => {
    expect(saidTonnes('1,500 tonnes', ['For 1,500 tonnes.'])).toBe('1500');
    expect(saidTonnes('.5 tonnes', ['Only .5 tonnes left.'])).toBe('0.5');
    expect(saidTonnes('200 mt', ['200 MT a month.'])).toBe('200');
  });

  it('never a price per tonne, tons, a signed, ranged or partial number', () => {
    expect(saidTonnes('725.50 a tonne', ['$725.50 a tonne'])).toBeNull();
    expect(saidTonnes('2,000 tons', ['2,000 tons'])).toBeNull();
    expect(saidTonnes('10 tonnes', ['minus 10 tonnes'])).toBeNull();
    expect(saidTonnes('500 tonnes', ['400-500 tonnes'])).toBeNull();
    expect(saidTonnes('5 tonnes', ['Only .5 tonnes left.'])).toBeNull();
    expect(saidTonnes('500 tonnes', ['1500 tonnes'])).toBeNull();
  });
});

describe('saidPhone', () => {
  it('reads a North American number said whole, written as the directory keeps it', () => {
    expect(saidPhone('403 555 0177', ['Reach Sam at 403 555 0177.'])).toBe('(403) 555-0177');
    expect(saidPhone('1-403-555-0177 extension 12', ['Call 1-403-555-0177 extension 12.'])).toBe(
      '(403) 555-0177 x12',
    );
  });

  it('keeps an extension only when said with that number (Codex, first and second reviews)', () => {
    expect(saidPhone('403 555 0177 x999', ['Sam is at 403 555 0177.'])).toBeNull();
    expect(
      saidPhone('403 555 0177 extension 999', [
        'Sam: 403 555 0177 extension 123; Pat: 403 555 0199 extension 999.',
      ]),
    ).toBeNull();
    expect(saidPhone('403 555 0177 x123 x999', ['403 555 0177 x123 x999'])).toBeNull();
  });

  it('never makes a number from part of a longer or foreign one (Codex, fourth review, finding 3)', () => {
    expect(saidPhone('+1 205 555 0177', ['Our London desk is +44 20 5555 0177.'])).toBeNull();
    expect(saidPhone('205 555 0177', ['Our London desk is +44 205 555 0177.'])).toBeNull();
    expect(saidPhone('403 555 0177', ['Dial 1 403 555 01778.'])).toBeNull();
    expect(saidPhone('+44 20 5555 0177', ['Our London desk is +44 20 5555 0177.'])).toBeNull();
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

  it('leaves a price or quantity blank when not said whole in its own lines', () => {
    const [draft] = checkReading(reading({ quotes: [quote({ lines: [0, 2] })] }), context()).drafts;
    const values = draft?.kind === 'quote' ? draft.fields.values : {};
    for (const field of ['price', 'currency', 'priceUnit', 'quantityMax']) {
      expect(values).not.toHaveProperty(field);
    }
  });

  it('never takes a quantity for a price or a price for a quantity (Codex, first review, finding 1)', () => {
    const [draft] = checkReading(
      reading({ quotes: [quote({ priceSaid: '1,500 tonnes', quantityMaxSaid: '$725.50' })] }),
      context(),
    ).drafts;
    const values = draft?.kind === 'quote' ? draft.fields.values : {};
    for (const field of ['price', 'currency', 'priceUnit', 'quantityMax']) {
      expect(values).not.toHaveProperty(field);
    }
  });

  it('leaves out what was not said rather than guessing', () => {
    const [draft] = checkReading(
      reading({
        quotes: [
          quote({ priceSaid: null, quantityMaxSaid: null, deliveryBasis: null, validUntil: null }),
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
  it('drafts a new person with a phone number said whole in its line', () => {
    const [draft] = checkReading(
      reading({ contacts: [contact({ role: 'Merchandiser', phoneSaid: '403 555 0177' })] }),
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

  it('leaves a phone number out when it was not said whole', () => {
    const [draft] = checkReading(
      reading({ contacts: [contact({ phoneSaid: '403 555 0178' })] }),
      context(),
    ).drafts;
    expect(draft?.fields.values).toEqual({ contactName: 'Sam' });
  });

  it('keeps only the changed details of a listed contact, and drops a draft that changes nothing', () => {
    const checked = checkReading(
      reading({
        contacts: [
          contact({
            contactId: PAT,
            name: 'Pat Buyer',
            role: 'Head buyer',
            email: 'PAT@example.test',
          }),
          contact({ contactId: PAT, name: 'pat buyer', role: 'buyer' }),
          contact({ contactId: 'not-listed', name: null, role: 'Trader' }),
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

  it('leaves out an email that is not one', () => {
    const [draft] = checkReading(
      reading({ contacts: [contact({ email: 'sam at example' })] }),
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
