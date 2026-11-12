import { CALL_READING_JSON_SCHEMA, emailLines, type CallReading } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Anthropic from '@anthropic-ai/sdk';

import { READING_MODEL, type ClaudeClient } from './anthropic';
import type { Database } from './db';
import { EMAIL_READING_INSTRUCTIONS, emailReadingMessage, readNewEmails } from './email-readings';
import type { EmailReadingContextRow } from './readings-db';
import { htmlToText } from './inbound-email';
import { ENV, fakeDatabase } from './testing/helpers';

// Synthetic values only: made-up names, ids, addresses and 555 numbers.
const EMAIL = '00000000-0000-4000-8000-0000000e3a11';
const TOM = '00000000-0000-4000-8000-0000000044aa';
const PAT = '00000000-0000-4000-8000-00000000d1aa';
const CLAUDE_ENV = { ...ENV, ANTHROPIC_API_KEY: 'sk-ant-synthetic-test-only' };
const claimOf = (emailId: string) => ({ emailId, token: `token-${emailId.slice(-4)}` });

const CONTEXT: EmailReadingContextRow = {
  emailId: EMAIL,
  counterpartyId: '00000000-0000-4000-8000-00000000c1aa',
  counterpartyName: 'Synthetic Prairie Mills',
  counterpartyTypes: ['buyer'],
  fromName: 'Pat Buyer',
  fromAddress: 'pat@buyer.example',
  contactId: PAT,
  subject: 'Re: Canola',
  body: [
    'We bid 725 a tonne delivered for 2 loads.',
    'Please send the contract.',
    'Pat Buyer, Purchasing, 403 555 0177',
    '',
    'On Tue, Nov 10, 2026 at 9:00 AM Tom <tom@gss.example> wrote:',
    '> Our offer is 690 a tonne.',
  ].join('\n'),
  receivedAt: '2026-11-11T16:00:00.000Z',
  assigneeId: TOM,
  contacts: [{ id: PAT, name: 'Pat Buyer', role: null, email: 'pat@buyer.example', phone: null }],
};

const ANSWER: CallReading = {
  voicemail: false,
  email: { wanted: false, about: null, lines: [] },
  summary: 'Pat bids on canola and asks for the contract.',
  quotes: [
    {
      side: 'bid',
      commodity: 'canola',
      firmness: null,
      priceSaid: '725 a tonne',
      grade: null,
      deliveryBasis: 'delivered',
      basisLocation: null,
      quantityMinSaid: null,
      quantityMaxSaid: null,
      deliveryStart: null,
      deliveryEnd: null,
      validUntil: null,
      notes: null,
      lines: [1],
    },
    // A price only in the quoted part: not in any line Claude was given.
    {
      side: 'bid',
      commodity: 'canola',
      firmness: null,
      priceSaid: '690 a tonne',
      grade: null,
      deliveryBasis: null,
      basisLocation: null,
      quantityMinSaid: null,
      quantityMaxSaid: null,
      deliveryStart: null,
      deliveryEnd: null,
      validUntil: null,
      notes: null,
      lines: [9],
    },
  ],
  followUps: [{ task: 'Send the contract to Pat', dueAt: null, lines: [2] }],
  contacts: [
    {
      contactId: PAT,
      name: 'Pat Buyer',
      role: 'Purchasing',
      email: null,
      phoneSaid: '403 555 0177',
      lines: [3],
    },
  ],
};

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let claude: { readCall: ReturnType<typeof vi.fn<ClaudeClient['readCall']>> };

beforeEach(() => {
  db = fakeDatabase();
  db.claimEmailReadings.mockResolvedValueOnce([claimOf(EMAIL)]).mockResolvedValue([]);
  db.emailReadingContext.mockResolvedValue(CONTEXT);
  claude = {
    readCall: vi.fn<ClaudeClient['readCall']>(() =>
      Promise.resolve({
        status: 'read',
        json: ANSWER,
        model: READING_MODEL,
        inputTokens: 1200,
        outputTokens: 300,
      }),
    ),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readNewEmails', () => {
  it('sends the email without its quoted part and keeps what its lines bear out', async () => {
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    const { lines } = emailLines(CONTEXT.subject, CONTEXT.body);
    expect(lines).toEqual([
      'Subject: Re: Canola',
      'We bid 725 a tonne delivered for 2 loads.',
      'Please send the contract.',
      'Pat Buyer, Purchasing, 403 555 0177',
    ]);
    expect(claude.readCall).toHaveBeenCalledWith({
      system: EMAIL_READING_INSTRUCTIONS,
      user: emailReadingMessage(CONTEXT, lines),
      schema: CALL_READING_JSON_SCHEMA,
    });
    expect(claude.readCall.mock.calls[0]?.[0].user).not.toContain('690');

    expect(db.keepEmailReading).toHaveBeenCalledTimes(1);
    const [claim, keptLines, cut, answer] = db.keepEmailReading.mock.calls[0] ?? [];
    expect([claim, keptLines, cut]).toEqual([claimOf(EMAIL), lines, false]);
    expect(answer?.model).toBe(READING_MODEL);
    expect([answer?.inputTokens, answer?.outputTokens]).toEqual([1200, 300]);
    const drafts = answer?.reading.drafts ?? [];
    // The quoted price had no line of its own: dropped.
    expect(drafts.filter((d) => d.kind === 'quote')).toHaveLength(1);
    const [quote, followUp, contact] = drafts;
    expect(quote?.kind === 'quote' && quote.fields.values).toMatchObject({
      price: '725',
      sourceType: 'email',
      quotedAt: '2026-11-11T16:00:00.000Z',
      sourceReference: expect.stringMatching(/^Email of .*, drafted by Claude$/) as string,
    });
    expect(followUp).toEqual({
      kind: 'follow_up',
      fields: { values: { task: 'Send the contract to Pat', assignedTo: TOM } },
      lines: [2],
    });
    expect(contact?.kind === 'contact' && contact.fields.values).toMatchObject({
      contactRole: 'Purchasing',
    });
    expect(db.close).toHaveBeenCalled();
  });

  it('leaves a follow-up without a person when the email answers nobody', async () => {
    db.emailReadingContext.mockResolvedValue({ ...CONTEXT, assigneeId: null });
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    const followUp = db.keepEmailReading.mock.calls[0]?.[3]?.reading.drafts[1];
    expect(followUp).toEqual({
      kind: 'follow_up',
      fields: { values: { task: 'Send the contract to Pat' } },
      lines: [2],
    });
  });

  it('keeps an email with only quoted text and a bare "Re:" as read without asking Claude', async () => {
    db.emailReadingContext.mockResolvedValue({
      ...CONTEXT,
      subject: 'Re:',
      body: '> Our offer is 690 a tonne.',
    });
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    expect(claude.readCall).not.toHaveBeenCalled();
    expect(db.keepEmailReading).toHaveBeenCalledWith(claimOf(EMAIL), ['Subject: Re:'], false, null);
  });

  it('never drafts a price quoted in an HTML-only email (R2-01)', async () => {
    // As kept at receipt: the HTML turned into text, its blockquote marked.
    const body = htmlToText(
      '<p>Thanks, I will check.</p><blockquote type="cite"><p>We offer canola CAD $725 per tonne delivered.</p></blockquote>',
    );
    db.emailReadingContext.mockResolvedValue({ ...CONTEXT, body });
    // Claude cites the quoted line anyway (line 2, were it given).
    claude.readCall.mockResolvedValue({
      status: 'read',
      json: {
        ...ANSWER,
        quotes: ANSWER.quotes
          .slice(0, 1)
          .map((quote) => ({ ...quote, priceSaid: 'CAD $725 per tonne', lines: [2] })),
      },
      model: READING_MODEL,
      inputTokens: 1,
      outputTokens: 1,
    });
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    expect(claude.readCall.mock.calls[0]?.[0].user).not.toContain('725');
    const drafts = db.keepEmailReading.mock.calls[0]?.[3]?.reading.drafts ?? [];
    expect(drafts.filter((d) => d.kind === 'quote')).toEqual([]);
  });

  it('asks Claude about a bid in the subject above a quoted-only body (R1-01)', async () => {
    db.emailReadingContext.mockResolvedValue({
      ...CONTEXT,
      subject: 'Re: now 730 a tonne',
      body: '> Our offer is 690 a tonne.',
    });
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    expect(claude.readCall).toHaveBeenCalledTimes(1);
    expect(claude.readCall.mock.calls[0]?.[0].user).toContain('[0] Subject: Re: now 730 a tonne');
    expect(claude.readCall.mock.calls[0]?.[0].user).not.toContain('690');
  });

  it('does nothing without the API key', async () => {
    await readNewEmails(ENV, openDatabase);
    expect(db.claimEmailReadings).not.toHaveBeenCalled();
  });

  it('skips a claim that is no longer current', async () => {
    db.emailReadingContext.mockResolvedValue(null);
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    expect(claude.readCall).not.toHaveBeenCalled();
    expect(db.keepEmailReading).not.toHaveBeenCalled();
  });

  it('keeps nothing when Claude declines, is cut off, or answers in another shape', async () => {
    claude.readCall
      .mockResolvedValueOnce({ status: 'refused', model: READING_MODEL })
      .mockResolvedValueOnce({ status: 'cut_off', model: READING_MODEL })
      .mockResolvedValueOnce({
        status: 'read',
        json: { voicemail: 'maybe' },
        model: READING_MODEL,
        inputTokens: 1,
        outputTokens: 1,
      });
    db.claimEmailReadings.mockReset();
    db.claimEmailReadings
      .mockResolvedValueOnce([claimOf('00000000-0000-4000-8000-0000000e3a01')])
      .mockResolvedValueOnce([claimOf('00000000-0000-4000-8000-0000000e3a02')])
      .mockResolvedValueOnce([claimOf('00000000-0000-4000-8000-0000000e3a03')])
      .mockResolvedValue([]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    expect(db.keepEmailReading).not.toHaveBeenCalled();
    expect(db.releaseEmailReading).not.toHaveBeenCalled();
    expect(errors.mock.calls.map(([line]) => String(line))).toEqual([
      'Email not read: refused model=claude-opus-5-5',
      'Email not read: cut_off model=claude-opus-5-5',
      'Email not read: answer not in the expected shape model=claude-opus-5-5',
    ]);
  });

  it('refunds the request and stops the run when Anthropic did not take it', async () => {
    claude.readCall.mockRejectedValueOnce(
      new Anthropic.RateLimitError(
        429,
        undefined,
        'email text that must not be logged',
        new Headers(),
      ),
    );
    db.claimEmailReadings.mockReset();
    db.claimEmailReadings.mockResolvedValue([claimOf(EMAIL)]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await readNewEmails(CLAUDE_ENV, openDatabase, () => claude);
    expect(errors).toHaveBeenCalledWith(
      'Email not read, reading paused until the next run: status=429',
    );
    expect(JSON.stringify(errors.mock.calls)).not.toContain('must not be logged');
    expect(db.releaseEmailReading).toHaveBeenCalledWith(claimOf(EMAIL));
    expect(db.claimEmailReadings).toHaveBeenCalledTimes(1);
  });
});

describe('emailReadingMessage', () => {
  it('names the sender, the company, the time in Alberta and the numbered lines', () => {
    const message = emailReadingMessage(CONTEXT, ['Subject: Re: Canola', 'Hello']);
    expect(message).toContain(
      'Email from Pat Buyer <pat@buyer.example> at Synthetic Prairie Mills to GSS.',
    );
    expect(message).toContain('2026-11-11T10:00 Alberta time');
    expect(message).toContain(`id ${PAT}: Pat Buyer, email pat@buyer.example`);
    expect(message.endsWith('[0] Subject: Re: Canola\n[1] Hello')).toBe(true);
  });
});
