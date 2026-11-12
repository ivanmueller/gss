import { EMAIL_DRAFT_JSON_SCHEMA } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Anthropic from '@anthropic-ai/sdk';

import { READING_MODEL, type ClaudeClient } from './anthropic';
import type { Database } from './db';
import type { AutoDraftContext } from './email-auto-drafts-db';
import { AUTO_DRAFT_INSTRUCTIONS, autoDraftMessage, draftWaitingEmails } from './email-auto-drafts';
import { DRAFT_DEADLINE_MS } from './email-drafts';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Email drafts Claude makes by itself (F-114 step 5c). Synthetic values only: made-up names,
// example.test addresses, made-up ids and prices.
const ORG = '00000000-0000-4000-8000-0000000000aa';
const COMPANY = '00000000-0000-4000-8000-00000000c1aa';
const DRAFT = '00000000-0000-4000-8000-0000000a0d01';
const CLAUDE_ENV = { ...ENV, ANTHROPIC_API_KEY: 'sk-ant-synthetic-test-only' };
const CLAIM = { draftId: DRAFT, token: 'token-1' };
const NOW = Date.parse('2026-11-12T18:00:00.000Z');
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

function context(overrides: Partial<AutoDraftContext> = {}): AutoDraftContext {
  return {
    name: 'Synthetic Buyer',
    types: ['buyer'],
    country: 'US',
    notes: null,
    contacts: [
      { id: 'k1', name: 'Pat Buyer', role: null, email: 'pat@buyer.example.test', main: true },
    ],
    commodities: [{ code: 'feed_barley', direction: 'buys' }],
    locations: [],
    quotes: [],
    followUps: [],
    history: [],
    call: {
      at: '2026-11-12T17:00:00+00:00',
      by: 'Tom Trader',
      contactName: 'Pat Buyer',
      transcript: 'Pat Buyer: Send me an email with the barley you have.',
    },
    answer: null,
    thread: [],
    source: 'call',
    about: 'The 777 MT of barley GSS has',
    happenedAt: '2026-11-12T17:00:00.000Z',
    sender: { name: 'Tom Trader', title: 'Trader' },
    shared: false,
    offers: [
      {
        commodity: 'feed_barley',
        grade: 'No. 1 CW',
        firmness: 'firm',
        quantityMinMt: null,
        quantityMaxMt: '500.000',
        deliveryStart: '2026-12-01',
        deliveryEnd: '2026-12-31',
        region: 'SK',
        country: 'CA',
      },
    ],
    ...overrides,
  };
}

const ANSWER = {
  subject: 'Barley for December',
  message:
    'Hi Pat,\n\nWe have 777 MT and 500 MT of feed barley for December at [price].\n\nBest regards',
};

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let claude: { readCall: ReturnType<typeof vi.fn<ClaudeClient['readCall']>> };

beforeEach(() => {
  db = fakeDatabase();
  db.claimEmailAutoDrafts.mockResolvedValueOnce([CLAIM]).mockResolvedValue([]);
  db.emailAutoDraftContext.mockResolvedValue(context());
  claude = {
    readCall: vi.fn<ClaudeClient['readCall']>(() =>
      Promise.resolve({
        status: 'read',
        json: ANSWER,
        model: READING_MODEL,
        inputTokens: 900,
        outputTokens: 120,
      }),
    ),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('autoDraftMessage', () => {
  it('lists what GSS has to a buyer without a price, and gives a fixed reason', () => {
    const { message } = autoDraftMessage(context(), new Date(NOW));
    expect(message).toContain('What GSS has to offer (never give a price or name the seller):');
    expect(message).toContain('- Feed barley No. 1 CW, firm, up to 500 MT');
    expect(message).toContain('from SK, CA');
    expect(message).toContain('Why this email: it follows the call below');
    expect(message).toContain('What it is about: The 777 MT of barley GSS has.');
  });

  it('gives no offers section to a company that is not a buyer', () => {
    const { message } = autoDraftMessage(context({ types: ['seller'] }), new Date(NOW));
    expect(message).not.toContain('What GSS has to offer');
  });

  it("checks the draft against the message without Claude's own about line (D1-02)", () => {
    const { message, checkSource } = autoDraftMessage(context(), new Date(NOW));
    expect(message).toContain('777');
    expect(checkSource).not.toContain('777');
    expect(checkSource).toContain('What it is about: (left out).');
  });
});

describe('draftWaitingEmails', () => {
  it('asks Claude once and keeps the draft, a made-up number listed under Check this (D1-02)', async () => {
    await draftWaitingEmails(CLAUDE_ENV, openDatabase, () => claude, { now: () => NOW });
    expect(claude.readCall).toHaveBeenCalledTimes(1);
    const request = claude.readCall.mock.calls[0]?.[0];
    expect(request?.system).toBe(AUTO_DRAFT_INSTRUCTIONS);
    expect(request?.schema).toBe(EMAIL_DRAFT_JSON_SCHEMA);
    expect(request?.deadlineMs).toBe(DRAFT_DEADLINE_MS);
    expect(db.keepEmailAutoDraft).toHaveBeenCalledWith(CLAIM, {
      model: READING_MODEL,
      subject: ANSWER.subject,
      message: ANSWER.message,
      // 777 was only in Claude's about line; 500 is the offer's.
      checkThis: ['777'],
      placeholders: ['[price]'],
      inputTokens: 900,
      outputTokens: 120,
    });
    expect(db.close).toHaveBeenCalled();
  });

  it('does nothing without the API key', async () => {
    await draftWaitingEmails(ENV, openDatabase, () => null);
    expect(db.claimEmailAutoDrafts).not.toHaveBeenCalled();
  });

  it('skips a draft whose source no longer stands', async () => {
    db.emailAutoDraftContext.mockResolvedValue(null);
    await draftWaitingEmails(CLAUDE_ENV, openDatabase, () => claude, { now: () => NOW });
    expect(claude.readCall).not.toHaveBeenCalled();
    expect(db.keepEmailAutoDraft).not.toHaveBeenCalled();
  });

  it('gives the attempt back when Anthropic did not take the request, and stops the run', async () => {
    db.claimEmailAutoDrafts.mockReset();
    db.claimEmailAutoDrafts.mockResolvedValue([CLAIM]);
    claude.readCall.mockRejectedValue(
      new Anthropic.APIConnectionError({ message: 'synthetic: no connection' }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await draftWaitingEmails(CLAUDE_ENV, openDatabase, () => claude, { now: () => NOW });
    expect(db.releaseEmailAutoDraft).toHaveBeenCalledWith(CLAIM);
    expect(db.claimEmailAutoDrafts).toHaveBeenCalledTimes(1);
    expect(db.keepEmailAutoDraft).not.toHaveBeenCalled();
  });

  it('leaves an answer out of shape pending, logging no text', async () => {
    claude.readCall.mockResolvedValue({
      status: 'read',
      json: { subject: 'Only a subject' },
      model: READING_MODEL,
      inputTokens: 1,
      outputTokens: 1,
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await draftWaitingEmails(CLAUDE_ENV, openDatabase, () => claude, { now: () => NOW });
    expect(db.keepEmailAutoDraft).not.toHaveBeenCalled();
    expect(db.releaseEmailAutoDraft).not.toHaveBeenCalled();
    expect(error.mock.calls.flat().join(' ')).not.toContain('Only a subject');
  });
});

describe('/email-auto-drafts', () => {
  const app = createApp(openDatabase);
  beforeEach(() => {
    mockAuthServer(
      new Response(JSON.stringify({ id: USER_ID, email: 'tom@example.test' }), { status: 200 }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists a company's drafts, the person's own and anyone's", async () => {
    const res = await app.request(
      `/api/v1/email-auto-drafts?organization_id=${ORG}&counterparty_id=${COMPANY}&assigned=me`,
      { headers: AUTH },
      ENV,
    );
    expect(res.status).toBe(200);
    expect(db.listEmailAutoDrafts).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
      { counterpartyId: COMPANY, mine: true },
    );
  });

  it('refuses a list for a non-member and bad parameters', async () => {
    db.listEmailAutoDrafts.mockResolvedValue(null);
    const forbidden = await app.request(
      `/api/v1/email-auto-drafts?organization_id=${ORG}`,
      { headers: AUTH },
      ENV,
    );
    expect(forbidden.status).toBe(403);
    const bad = await app.request(
      `/api/v1/email-auto-drafts?organization_id=${ORG}&assigned=someone`,
      { headers: AUTH },
      ENV,
    );
    expect(bad.status).toBe(422);
  });

  it('counts the drafts waiting for the person', async () => {
    db.countEmailAutoDrafts.mockResolvedValue(3);
    const res = await app.request(
      `/api/v1/email-auto-drafts/count?organization_id=${ORG}`,
      { headers: AUTH },
      ENV,
    );
    expect(await res.json()).toEqual({ waiting: 3 });
  });

  it('dismisses once, and refuses one being sent', async () => {
    const path = `/api/v1/email-auto-drafts/${DRAFT}/dismiss?organization_id=${ORG}`;
    const ok = await app.request(path, { method: 'POST', headers: AUTH }, ENV);
    expect(ok.status).toBe(200);
    expect(db.dismissEmailAutoDraft).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
      DRAFT,
    );
    db.dismissEmailAutoDraft.mockResolvedValue('already');
    expect((await app.request(path, { method: 'POST', headers: AUTH }, ENV)).status).toBe(409);
    db.dismissEmailAutoDraft.mockResolvedValue('taken');
    const taken = await app.request(path, { method: 'POST', headers: AUTH }, ENV);
    const body: { error: { code: string } } = await taken.json();
    expect(body.error.code).toBe('AUTO_DRAFT_USED');
    db.dismissEmailAutoDraft.mockResolvedValue('not_found');
    expect((await app.request(path, { method: 'POST', headers: AUTH }, ENV)).status).toBe(404);
  });
});
