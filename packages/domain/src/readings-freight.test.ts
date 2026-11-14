import { describe, expect, it } from 'vitest';

import type { TranscriptLine } from './calls';
import { draftReadiness, verifyDraftSchema } from './drafts';
import {
  checkReading,
  DRAFTS_MAX,
  saidPayload,
  saidRate,
  type CallReading,
  type CitedLine,
  type DraftInput,
  type ReadingContext,
} from './readings';

// Freight rates drafted from calls and email (F-235 part 2). Synthetic text only; the routes are
// the owner's examples of 2026-11-13 with made-up rates.

const one = (text: string): CitedLine[] => [{ line: 0, text }];
const rate = (said: string, text: string) => {
  const result = saidRate(said, one(text));
  return result === null
    ? null
    : ([result.amount, result.currency, result.unit, result.check.doubt] as const);
};
const payload = (said: string, text: string) => {
  const result = saidPayload(said, one(text));
  return result === null ? null : ([result.amount, result.unit, result.check.doubt] as const);
};

describe('saidRate', () => {
  it('reads CMT as Canadian dollars per metric tonne', () => {
    expect(rate('335/CMT', 'rate 335/CMT')).toEqual(['335', 'CAD', 'MT', null]);
    expect(rate('182 / cmt', 'rate 182 / cmt')).toEqual(['182', 'CAD', 'MT', null]);
    expect(rate('$182 CMT', 'rate $182 CMT')).toEqual(['182', 'CAD', 'MT', null]);
  });

  it('reads a rate per load with its currency', () => {
    expect(rate('$2500 usd per load', 'rate $2500 usd per load')).toEqual([
      '2500',
      'USD',
      'LOAD',
      null,
    ]);
    expect(rate('CAD 1,850/ld', 'CAD 1,850/ld')).toEqual(['1850', 'CAD', 'LOAD', null]);
  });

  it('reads the units of a price too', () => {
    expect(rate('US$ 42.50 a tonne', 'US$ 42.50 a tonne')).toEqual(['42.50', 'USD', 'MT', null]);
    expect(rate('$0.85/bu', '$0.85/bu')).toEqual(['0.85', null, 'BU', null]);
    // "ton" alone does not say short or metric.
    expect(rate('$40 per ton', '$40 per ton')).toEqual(['40', null, null, null]);
  });

  it('refuses two currencies, a bare number, a copy not in the line, and zero', () => {
    expect(rate('US$ 335/CMT', 'US$ 335/CMT')).toBeNull();
    expect(rate('335 usd/cmt', '335 usd/cmt')).toBeNull();
    expect(rate('335', 'Muncie 335')).toBeNull();
    expect(rate('335/CMT', 'Muncie 353/CMT')).toBeNull();
    expect(rate('0/CMT', '0/CMT')).toBeNull();
    // Part of a longer number.
    expect(rate('35/CMT', 'Muncie 335/CMT')).toBeNull();
  });

  it('marks a dash, another number or a sign word in the line', () => {
    expect(rate('$2500 usd per load', 'Cochrane, Wi: $2500 usd per load-25st loads')?.[3]).toBe(
      'The line has a dash, minus or plus sign.',
    );
    expect(rate('335/CMT', 'Muncie 335/CMT and Lacrosse 182/CMT')?.[3]).toBe(
      'The line has another number, “182”.',
    );
    expect(rate('335/CMT', '335/CMT less fuel')?.[3]).toBe('The line says “less”.');
    expect(rate('-335/CMT', 'we pay -335/CMT')?.[3]).toBe('It was said with a sign.');
  });
});

describe('saidPayload', () => {
  it('reads a load size glued or spaced to its unit', () => {
    expect(payload('25st', 'loads of 25st')).toEqual(['25', 'ST', null]);
    expect(payload('25 tonnes', 'loads of 25 tonnes')).toEqual(['25', 'MT', null]);
    expect(payload('52,000 lbs', 'loads of 52,000 lbs')).toEqual(['52000', 'LB', null]);
  });

  it('keeps "tons" without a unit, and refuses a number without one', () => {
    expect(payload('25 tons', 'loads of 25 tons')).toEqual(['25', null, null]);
    expect(payload('25', 'loads of 25')).toBeNull();
    expect(payload('25st', 'loads of 26st')).toBeNull();
  });

  it('marks a size said after "per"', () => {
    expect(payload('25 tonnes', '$900 per 25 tonnes')?.[2]).toMatch(/after “per”/);
  });
});

const EMAIL: TranscriptLine[] = [
  { side: 'counterparty', start: 0, text: 'Here are our rates this week.' },
  { side: 'counterparty', start: 0, text: 'Morris MB to Muncie IN 335/CMT' },
  { side: 'counterparty', start: 0, text: 'Morris MB to Lacrosse WI 182/CMT' },
  {
    side: 'counterparty',
    start: 0,
    text: 'Or Morris, Mb to Cochrane, Wi: $2500 usd per load-25st loads',
  },
];

const context = (overrides: Partial<ReadingContext> = {}): ReadingContext => ({
  lines: EMAIL,
  counterpartyTypes: ['buyer'],
  contacts: [],
  callerId: null,
  calledAt: '2026-11-13T16:00:00.000Z',
  source: 'email',
  ...overrides,
});

type Said = CallReading['freightRates'][number];
const freight = (overrides: Partial<Said> = {}): Said => ({
  originSaid: 'Morris MB',
  destinationSaid: 'Muncie IN',
  rateSaid: '335/CMT',
  payloadSaid: null,
  mode: null,
  firmness: null,
  validUntil: null,
  inclusions: null,
  notes: null,
  lines: [1],
  ...overrides,
});

const reading = (freightRates: Said[], overrides: Partial<CallReading> = {}): CallReading => ({
  voicemail: false,
  summary: null,
  quotes: [],
  followUps: [],
  contacts: [],
  freightRates,
  email: { wanted: false, about: null, lines: [] },
  ...overrides,
});

type FreightDraft = Extract<DraftInput, { kind: 'freight' }>;
const drafted = (said: Said[], ctx = context()) =>
  checkReading(reading(said), ctx).drafts.filter((d): d is FreightDraft => d.kind === 'freight');

describe('checkReading: freight rates', () => {
  it("drafts the owner's examples, from any company", () => {
    const [muncie, lacrosse, cochrane] = drafted([
      freight(),
      freight({ destinationSaid: 'Lacrosse WI', rateSaid: '182/CMT', lines: [2] }),
      freight({
        originSaid: 'Morris, Mb',
        destinationSaid: 'Cochrane, Wi',
        rateSaid: '$2500 usd per load',
        payloadSaid: '25st',
        lines: [3],
      }),
    ]);
    expect(muncie?.fields).toEqual({
      mode: null,
      origin: { text: 'Morris MB', region: 'CA-MB' },
      destination: { text: 'Muncie IN', region: 'US-IN' },
      values: {
        quotedAt: '2026-11-13T16:00:00.000Z',
        sourceType: 'email',
        sourceReference: expect.stringMatching(/^Email of .*, drafted by Claude$/) as string,
        rate: '335',
        currency: 'CAD',
        rateUnit: 'MT',
      },
      checks: { rate: { said: '335/CMT', line: 1, doubt: null } },
    });
    expect(lacrosse?.fields.destination).toEqual({ text: 'Lacrosse WI', region: 'US-WI' });
    expect(lacrosse?.fields.values).toMatchObject({ rate: '182', currency: 'CAD' });
    expect(cochrane?.fields.origin).toEqual({ text: 'Morris, Mb', region: 'CA-MB' });
    expect(cochrane?.fields.destination).toEqual({ text: 'Cochrane, Wi', region: 'US-WI' });
    expect(cochrane?.fields.values).toMatchObject({
      rate: '2500',
      currency: 'USD',
      rateUnit: 'LOAD',
      payload: '25',
      payloadUnit: 'ST',
    });
    expect(cochrane?.fields.checks.rate?.doubt).not.toBeNull();
    expect(cochrane?.fields.checks.payload?.line).toBe(3);
  });

  it('leaves an end empty when it is not written in the cited lines', () => {
    const [draft] = drafted([freight({ destinationSaid: 'Peoria IL' })]);
    expect(draft?.fields.destination).toEqual({ text: null, region: null });
    expect(draft?.fields.origin.region).toBe('CA-MB');
  });

  it('keeps an end without a province or state with no region', () => {
    const [draft] = drafted([freight({ originSaid: 'Morris' })]);
    expect(draft?.fields.origin).toEqual({ text: 'Morris', region: null });
  });

  it('keeps a load size only for a rate per load', () => {
    const [draft] = drafted([freight({ payloadSaid: '25st', lines: [1, 3] })]);
    expect(draft?.fields.values.payload).toBeUndefined();
    expect(draft?.fields.checks.payload).toBeUndefined();
  });

  it('marks a rate whose line names neither end', () => {
    const lines: TranscriptLine[] = [
      { side: 'counterparty', start: 0, text: 'Morris MB to Muncie IN:' },
      { side: 'counterparty', start: 0, text: '335/CMT' },
    ];
    const [draft] = drafted([freight({ lines: [0, 1] })], context({ lines }));
    expect(draft?.fields.checks.rate?.doubt).toBe('The route is not on the same line as the rate.');
  });

  it('drops a rate without a line, keeps mode and firmness only as choices, and an end date only when later', () => {
    expect(drafted([freight({ lines: [] })])).toEqual([]);
    expect(drafted([freight({ lines: [99] })])).toEqual([]);
    const [draft] = drafted([
      freight({ mode: 'truck', firmness: 'firm', validUntil: '2026-11-20T17:00' }),
    ]);
    expect(draft?.fields.mode).toBe('truck');
    expect(draft?.fields.values).toMatchObject({
      firmness: 'firm',
      validUntil: '2026-11-20T23:00:00.000Z',
    });
    const [past] = drafted([freight({ validUntil: '2026-11-01T17:00' })]);
    expect(past?.fields.values.validUntil).toBeUndefined();
  });

  it('keeps at most ten rates, and at most thirty drafts in all', () => {
    expect(drafted(Array.from({ length: 12 }, () => freight()))).toHaveLength(10);
    const many = checkReading(
      reading(
        Array.from({ length: 10 }, () => freight()),
        {
          followUps: Array.from({ length: 10 }, () => ({ task: 'Call', dueAt: null, lines: [0] })),
          contacts: Array.from({ length: 10 }, (_, n) => ({
            contactId: null,
            name: `Person ${String(n)}`,
            role: null,
            email: null,
            phoneSaid: null,
            lines: [0],
          })),
        },
      ),
      context(),
    );
    expect(many.drafts).toHaveLength(DRAFTS_MAX);
  });
});

const NOW = new Date('2026-11-14T16:00:00.000Z');
const fields = (overrides: Partial<FreightDraft['fields']> = {}): FreightDraft['fields'] => ({
  mode: 'truck',
  origin: { text: 'Morris MB', region: 'CA-MB' },
  destination: { text: 'Muncie IN', region: 'US-IN' },
  values: {
    firmness: 'firm',
    rate: '335',
    currency: 'CAD',
    rateUnit: 'MT',
    quotedAt: '2026-11-13T16:00:00.000Z',
    sourceType: 'email',
  },
  checks: {},
  ...overrides,
});

describe('draftReadiness: freight', () => {
  it('is ready with both ends, mode and terms, and saves the areas without a point', () => {
    const ready = draftReadiness({ kind: 'freight', fields: fields() }, NOW);
    expect(ready).toMatchObject({
      status: 'ready',
      save: {
        kind: 'freight',
        mode: 'truck',
        origin: { area: { text: 'Morris MB', region: 'CA-MB' } },
        destination: { area: { text: 'Muncie IN', region: 'US-IN' } },
        terms: { rate: '335', currency: 'CAD', rateUnit: 'MT', validUntil: null },
      },
    });
  });

  it('names what is missing', () => {
    const ready = draftReadiness(
      {
        kind: 'freight',
        fields: fields({
          mode: null,
          origin: { text: 'Morris', region: null },
          destination: { text: null, region: null },
          values: { quotedAt: '2026-11-13T16:00:00.000Z', sourceType: 'email', rate: '335' },
        }),
      },
      NOW,
    );
    expect(ready.status).toBe('incomplete');
    if (ready.status !== 'incomplete') return;
    expect(ready.missing).toEqual(
      expect.arrayContaining([
        'from (town and province or state)',
        'to (town and province or state)',
        'truck or rail',
        'firm or indicative',
        'currency',
        'rate unit',
      ]),
    );
  });

  it('refuses the same place at both ends, case aside', () => {
    const ready = draftReadiness(
      {
        kind: 'freight',
        fields: fields({ destination: { text: 'morris mb', region: 'CA-MB' } }),
      },
      NOW,
    );
    expect(ready.status === 'incomplete' && ready.missing).toEqual([
      'a different place at each end',
    ]);
  });

  it('takes the route the person saved in the form, and needs one', () => {
    const edited = {
      values: fields().values as Record<string, string>,
      freight: {
        mode: 'rail' as const,
        origin: { facilityId: '00000000-0000-4000-8000-000000000001' },
        destination: { area: { text: 'Muncie, IN', region: 'US-IN' } },
      },
    };
    expect(verifyDraftSchema.safeParse({ edited }).success).toBe(true);
    const ready = draftReadiness({ kind: 'freight', fields: fields() }, NOW, null, edited);
    expect(ready).toMatchObject({
      status: 'ready',
      save: { mode: 'rail', origin: edited.freight.origin },
    });
    const without = draftReadiness({ kind: 'freight', fields: fields() }, NOW, null, {
      values: edited.values,
    });
    expect(without.status === 'incomplete' && without.missing).toEqual([
      'from (town and province or state)',
      'to (town and province or state)',
      'truck or rail',
    ]);
  });
});
