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
  type CitedLine,
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

/** One cited transcript line, number 0. */
const one = (text: string): CitedLine[] => [{ line: 0, text }];
/** What saidPrice gives, in short: amount, currency, unit and the doubt (null: nothing unusual). */
const price = (said: string, text: string) => {
  const result = saidPrice(said, one(text));
  return result === null
    ? null
    : ([result.amount, result.currency, result.unit, result.check.doubt] as const);
};
const tonnes = (said: string, text: string) => {
  const result = saidTonnes(said, one(text));
  return result === null ? null : ([result.amount, result.check.doubt] as const);
};
const phone = (said: string, text: string) => {
  const result = saidPhone(said, one(text));
  return result === null ? null : ([result.phone, result.check.doubt] as const);
};

describe('saidPrice: what was said is filled in, with where', () => {
  it('reads a price said whole, its currency and unit from the same words', () => {
    expect(price('$725.50 Canadian a tonne', 'We bid $725.50 Canadian a tonne.')).toEqual([
      '725.50',
      'CAD',
      'MT',
      null,
    ]);
    expect(price('US$7.25 a bushel', 'Oats are US$7.25 a bushel.')).toEqual([
      '7.25',
      'USD',
      'BU',
      null,
    ]);
    expect(price('CAD $310 per tonne', 'Barley at CAD $310 per tonne.')).toEqual([
      '310',
      'CAD',
      'MT',
      null,
    ]);
    expect(price('12 US dollars per cwt', 'That is 12 US dollars per cwt.')).toEqual([
      '12',
      'USD',
      'CWT',
      null,
    ]);
    expect(price('$1,025 a short ton', 'Say $1,025 a short ton.')).toEqual([
      '1025',
      null,
      'ST',
      null,
    ]);
  });

  it('records the line and the words it came from', () => {
    expect(
      saidPrice('$725 a tonne', [
        { line: 3, text: 'Hello.' },
        { line: 7, text: 'We can do $725 a tonne delivered.' },
      ])?.check,
    ).toEqual({ said: '$725 a tonne', line: 7, doubt: null });
  });

  it('reads the wordings Codex found left blank (Codex, matrix review, P3)', () => {
    expect(
      price('725 dollars Canadian per tonne', 'We bid 725 dollars Canadian per tonne.'),
    ).toEqual(['725', 'CAD', 'MT', null]);
    expect(
      price('Canadian dollars 725 per tonne', 'We bid Canadian dollars 725 per tonne.'),
    ).toEqual(['725', 'CAD', 'MT', null]);
    expect(price('$725 per tonne CAD', 'We bid $725 per tonne CAD.')).toEqual([
      '725',
      'CAD',
      'MT',
      null,
    ]);
    expect(price('Cdn. $725 per tonne', 'We bid Cdn. $725 per tonne.')).toEqual([
      '725',
      'CAD',
      'MT',
      null,
    ]);
    expect(price('725 CAD / t', 'We bid 725 CAD / t.')).toEqual(['725', 'CAD', 'MT', null]);
    expect(price('CAD 1 025 per tonne', 'We bid CAD 1 025 per tonne.')).toEqual([
      '1025',
      'CAD',
      'MT',
      null,
    ]);
    expect(price('US $725 per tonne', 'That is US $725 per tonne.')).toEqual([
      '725',
      'USD',
      'MT',
      null,
    ]);
  });

  it('keeps two prices and agreements in one sentence plain', () => {
    const line = 'We bid $7.25 a bushel and $310 a tonne for feed.';
    expect(price('$7.25 a bushel', line)?.[3]).toMatch(/another number/);
    expect(price('$725 a tonne', 'We can agree to $725 a tonne.')).toEqual([
      '725',
      null,
      'MT',
      null,
    ]);
    expect(price('$725 a tonne', 'For two loads, we agree to $725 a tonne.')).toEqual([
      '725',
      null,
      'MT',
      null,
    ]);
  });
});

describe('saidPrice: plain errors are refused', () => {
  it('needs the words exactly as said, in a cited line', () => {
    expect(price('$730 a tonne', 'We bid $725 a tonne.')).toBeNull();
    expect(saidPrice('$725 a tonne', [])).toBeNull();
  });

  it('is not a price without a dollar sign, currency code, dollars or unit', () => {
    expect(price('725', 'Maybe 725 for canola.')).toBeNull();
    expect(price('725 US', 'We serve 725 US customers.')).toBeNull();
    expect(price('725 Canadian', 'We have 725 Canadian growers.')).toBeNull();
    expect(price('1,500 tonnes', 'For 1,500 tonnes.')).toBeNull();
  });

  it('never a part of a number: a decimal point, separator or digit against it', () => {
    expect(price('$50 per bushel', 'Peas at $.50 per bushel.')).toBeNull();
    expect(price('$7', 'It is $7.25 a bushel.')).toBeNull();
    expect(price('$725', 'It is $725,000 in all.')).toBeNull();
    expect(price('$725 a ton', 'It is $725 a tonne.')).toBeNull();
  });

  it('refuses two currencies or zero', () => {
    expect(price('CAD $725 US', 'CAD $725 US')).toBeNull();
    expect(price('$0 a tonne', '$0 a tonne')).toBeNull();
  });
});

describe('saidPrice: anything unusual is filled in and marked for a second look', () => {
  /** Expect the price never filled in plain: refused, or filled and marked. */
  const notPlain = (said: string, text: string) => {
    const result = price(said, text);
    // Refused (null), or filled with a reason to look twice.
    expect(result?.[3] !== null, text).toBe(true);
  };
  /** Expect the price filled in, with a doubt matching `why`. */
  const doubtful = (said: string, text: string, why: RegExp) => {
    const result = price(said, text);
    expect(result, text).not.toBeNull();
    expect(result?.[3], text).toMatch(why);
  };

  it('a sign or a deduction anywhere in the line (Codex, all reviews)', () => {
    for (const text of [
      'The bid is -$5 a tonne.',
      'It is minus CAD $5 a tonne.',
      'It is minus Canadian $5 a tonne.',
      'The bid is negative: $725 per tonne.',
      'The bid is negative ($725 per tonne).',
      'The bid is negative amount of $725 per tonne.',
      'The bid is below zero: $725 per tonne.',
      'The price is $725 per tonne below zero.',
      'The bid is minus EUR $725 per tonne.',
      'The net bid is $725 per tonne minus $25 per tonne.',
    ]) {
      const said = /\$\d+ (?:a|per) tonne/.exec(text)?.[0] ?? '';
      doubtful(said, text, /line says|dash|minus/);
    }
  });

  it('a dash of any kind against it, before or after', () => {
    for (const dash of ['-', '‐', '‑', '‒', '–', '—', '−', '﹣', '－']) {
      doubtful('$725 per tonne', `The bid is ${dash}$725 per tonne.`, /dash, minus or plus/);
    }
    doubtful('$725', 'Accounting price: $725- per tonne.', /dash/);
    doubtful('$725 per tonne', 'The bid is - ($725 per tonne).', /dash/);
    doubtful('$725 per tonne', 'The bid is - EUR $725 per tonne.', /dash/);
    doubtful('$725 per tonne', 'The bid is + $725 per tonne.', /plus/);
  });

  it('a range in any wording: another number in the sentence', () => {
    for (const [said, text] of [
      ['$725 a tonne', 'Offers went from $700 a tonne to $725 a tonne.'],
      ['$725 a tonne', 'Offers range from $700 Canadian dollars per metric tonne to $725 a tonne.'],
      ['725 CAD', 'Bids range from 700 CAD to 725 CAD.'],
      ['725 dollars a tonne', 'Bids range from 700 to 725 dollars a tonne.'],
      ['$750 per tonne', 'Bids range from $725 per tonne through $750 per tonne.'],
      ['$725 per tonne', 'Bids range from $725 per tonne thru $750 per tonne.'],
      ['750 CAD', 'From 700 up to 750 CAD.'],
      ['$725 per tonne', 'Bids range from $725 per tonne..$750 per tonne.'],
      ['$750 per tonne', 'Bids range from $725 per tonne through $750 per tonne.'],
      ['USD $750 per tonne', 'Between U.S. $725 per tonne and USD $750 per tonne.'],
      ['$725 a tonne', 'Between $700 and $725 a tonne.'],
    ] as const) {
      doubtful(said, text, /another number|dash/);
    }
  });

  it('a fraction or scale after it, or currency words left out of the copy', () => {
    // "…" and "½" are read as "..." and "1⁄2": the copy is then part of a longer number, refused.
    notPlain('$750 per tonne', 'Bids range from $725 per tonne…$750 per tonne.');
    notPlain('$7', 'We bid $7½ per bushel.');
    doubtful('$1.5', 'The price is $1.5 M per tonne.', /said with “m”/);
    doubtful('$725 per tonne', 'Prices range from 700 U.S. to $725 per tonne.', /another number/);
    doubtful('-$5 per tonne', 'The bid is -$5 per tonne.', /minus sign/);
    doubtful('$1.5', 'We bid $1.5 million per tonne.', /said with “million”/);
    doubtful('$725', 'We bid $725 thousand.', /said with “thousand”/);
    doubtful('$725 per tonne', 'Give us $725 per tonne.', /next to it/);
    doubtful('$725 per tonne', 'We bid $725 per tonne 500 tonnes available.', /another number/);
  });
});

describe('saidTonnes', () => {
  it('reads a quantity said whole in metric tonnes', () => {
    expect(tonnes('1,500 tonnes', 'For 1,500 tonnes.')).toEqual(['1500', null]);
    expect(tonnes('.5 tonnes', 'Only .5 tonnes left.')).toEqual(['0.5', null]);
    expect(tonnes('200 mt', '200 MT a month.')).toEqual(['200', null]);
    expect(tonnes('500 t', 'We have 500 t.')).toEqual(['500', null]);
    expect(tonnes('500 mts', 'We have 500 mts.')).toEqual(['500', null]);
    expect(tonnes('500 metric-tonnes', 'We have 500 metric-tonnes.')).toEqual(['500', null]);
    expect(tonnes('1 500 tonnes', 'We have 1 500 tonnes.')).toEqual(['1500', null]);
  });

  it('refuses a number cut out of one written with other digits (Codex, 5d1ecfa)', () => {
    expect(tonnes('500 tonnes', 'We have \uff11500 tonnes.')).toBeNull();
    expect(tonnes('1500 tonnes', 'We have \uff11500 tonnes.')).toEqual(['1500', null]);
  });

  it('marks a quantity said after "per": part of a price (Codex, 5d1ecfa)', () => {
    expect(tonnes('500 tonnes', 'The freight price is per 500 tonnes.')?.[1]).toMatch(/per/);
  });

  it('refuses tons, a price per tonne, or part of a number', () => {
    expect(tonnes('725.50 a tonne', '$725.50 a tonne')).toBeNull();
    expect(tonnes('2,000 tons', '2,000 tons')).toBeNull();
    expect(tonnes('5 tonnes', 'Only .5 tonnes left.')).toBeNull();
    expect(tonnes('500 tonnes', '1500 tonnes')).toBeNull();
  });

  it('marks a signed, ranged or net quantity for a second look', () => {
    expect(tonnes('10 tonnes', 'minus 10 tonnes')?.[1]).toMatch(/minus/);
    expect(tonnes('500 tonnes', '400-500 tonnes')?.[1]).toMatch(/dash/);
    expect(tonnes('750 tonnes', 'We have from 500 tonnes to 750 tonnes.')?.[1]).toMatch(
      /another number/,
    );
    expect(tonnes('500 tonnes', 'Available quantity is 500 tonnes less 25 tonnes.')?.[1]).toMatch(
      /less/,
    );
  });
});

describe('saidPhone', () => {
  it('reads a North American number said whole, written as the directory keeps it', () => {
    expect(phone('403 555 0177', 'Reach Sam at 403 555 0177.')).toEqual(['(403) 555-0177', null]);
    expect(phone('1-403-555-0177 extension 12', 'Call 1-403-555-0177 extension 12.')).toEqual([
      '(403) 555-0177 x12',
      null,
    ]);
    expect(phone('403/555/0177', 'Call 403/555/0177.')).toEqual(['(403) 555-0177', null]);
    for (const [said, text] of [
      ['403 555 0177 extension: 12', 'Call 403 555 0177 extension: 12.'],
      ['403 555 0177 ext12', 'Call 403 555 0177 ext12.'],
      ['403 555 0177 #12', 'Call 403 555 0177 #12.'],
      ['403 555 0177 extn 12', 'Call 403 555 0177 extn 12.'],
      ['403 555 0177 ext=12', 'Call 403 555 0177 ext=12.'],
    ] as const) {
      expect(phone(said, text), text).toEqual(['(403) 555-0177 x12', null]);
    }
  });

  it('reads an extension in brackets or after a semicolon (Codex, 5d1ecfa, P3)', () => {
    expect(phone('403 555 0177 (extension 12)', 'Call 403 555 0177 (extension 12).')).toEqual([
      '(403) 555-0177 x12',
      null,
    ]);
    expect(phone('403 555 0177; extension 12', 'Call 403 555 0177; extension 12.')).toEqual([
      '(403) 555-0177 x12',
      null,
    ]);
  });

  it('fills a number followed by a separate count, marked (Codex, 5d1ecfa, P3)', () => {
    expect(phone('403 555 0177', 'Call 403 555 0177 2 loads.')).toEqual([
      '(403) 555-0177',
      'The line has another number.',
    ]);
  });

  it('refuses a number that is part of a longer or foreign one', () => {
    expect(phone('+1 205 555 0177', 'Our London desk is +44 20 5555 0177.')).toBeNull();
    expect(phone('205 555 0177', 'Our London desk is +44 205 555 0177.')).toBeNull();
    expect(phone('4035550177', 'Our foreign number is +44/4035550177.')).toBeNull();
    expect(phone('4035550177', 'Our foreign number is +44:4035550177.')).toBeNull();
    expect(phone('4035550177', 'The number is 4035550177/9.')).toBeNull();
    expect(phone('4035550177', 'The number is 4035550177,9.')).toBeNull();
    expect(phone('403 555 0177', 'Dial 1 403 555 01778.')).toBeNull();
    expect(phone('403 555 0177 x123 x999', '403 555 0177 x123 x999')).toBeNull();
    expect(phone('403 555 0177 x999', 'Sam is at 403 555 0177.')).toBeNull();
  });

  it('marks a number that may have left out its extension, or shares its sentence', () => {
    for (const text of [
      'Call 403 555 0177 extension 12.',
      'Call 403 555 0177, ext. 12.',
      'Call 403 555 0177 ext12.',
      'Call 403 555 0177 extension: 12.',
      'Call 403 555 0177 (extension 12).',
      'Call 403 555 0177 #12.',
      'Call 403 555 0177 extension twelve.',
    ]) {
      expect(phone('403 555 0177', text)?.[1], text).toMatch(/extension/);
    }
    expect(phone('403 555 0177', 'Call 403 555 0177 about 2 loads.')?.[1]).toMatch(
      /another number/,
    );
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
          checks: {
            price: { said: '$725.50 Canadian a tonne', line: 1, doubt: null },
            quantityMax: { said: '1,500 tonnes', line: 1, doubt: null },
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

  it('lets only filled-in amounts explain other numbers in the line (Codex, 5d1ecfa)', () => {
    const lines: TranscriptLine[] = [
      { side: 'counterparty', start: 0, text: 'Prices range from $700 to $725 per tonne.' },
    ];
    const [draft] = checkReading(
      reading({
        quotes: [
          quote({
            priceSaid: '$725 per tonne',
            quantityMaxSaid: '$700',
            validUntil: null,
            lines: [0],
          }),
        ],
      }),
      context({ lines }),
    ).drafts;
    const fields = draft?.kind === 'quote' ? draft.fields : null;
    expect(fields?.values.price).toBe('725');
    expect(fields?.values).not.toHaveProperty('quantityMax');
    expect(fields?.checks.price?.doubt).toMatch(/another number/);
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
        checks: { contactPhone: { said: '403 555 0177', line: 3, doubt: null } },
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
        fields: { values: { contactRole: 'Head buyer' }, checks: {} },
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
