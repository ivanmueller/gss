import type { CallDraftView, CallRecordingView, ContactLogEntry } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION, type Call } from '../test/api';
import { CounterpartyCrm } from './CounterpartyCrm';

// Synthetic values only. The clock is fixed at 10 am in Alberta (UTC−6), 5 November 2026.
const ID = '00000000-0000-4000-8000-00000000c001';
const ME = '00000000-0000-4000-8000-0000000044aa';
const ENTRY_ID = '00000000-0000-4000-8000-00000000e101';
const RECORDING_ID = '00000000-0000-4000-8000-0000000eec01';
const QUOTE_DRAFT = '00000000-0000-4000-8000-0000000dd001';
const FOLLOW_UP_DRAFT = '00000000-0000-4000-8000-0000000dd002';
const DONE_DRAFT = '00000000-0000-4000-8000-0000000dd003';

function entry(notes: string | null): ContactLogEntry {
  const current = {
    id: 'r1',
    revisionNumber: 1,
    occurredAt: '2026-11-05T15:00:00.000Z',
    channel: 'call' as const,
    contactName: 'Pat Buyer',
    notes,
    recordedByName: 'Tess Trader',
    recordedAt: '2026-11-05T15:10:00.000Z',
  };
  return {
    id: ENTRY_ID,
    counterpartyId: ID,
    createdAt: current.recordedAt,
    current,
    revisions: [current],
    pinned: null,
  };
}

const QUOTE: CallDraftView = {
  id: QUOTE_DRAFT,
  kind: 'quote',
  status: 'open',
  fields: {
    side: 'bid',
    commodity: 'flaxseed',
    values: { price: '725.00', currency: 'CAD', priceUnit: 'MT', quantityMax: '84' },
    checks: {
      price: { said: '725', line: 1, doubt: null },
      quantityMax: { said: '84', line: 2, doubt: 'The line also says “minus freight”.' },
    },
  },
  lines: [1, 2],
  contactId: null,
  decidedByName: null,
  decidedAt: null,
  resultId: null,
};

const FOLLOW_UP: CallDraftView = {
  id: FOLLOW_UP_DRAFT,
  kind: 'follow_up',
  status: 'open',
  fields: { values: { task: 'Call Pat back about flax', dueAt: '2026-11-06T16:00:00.000Z' } },
  lines: [3],
  contactId: null,
  decidedByName: null,
  decidedAt: null,
  resultId: null,
};

const DISMISSED: CallDraftView = {
  ...FOLLOW_UP,
  id: DONE_DRAFT,
  status: 'dismissed',
  fields: { values: { task: 'Send the bid sheet' } },
  decidedByName: 'Adam Admin',
  decidedAt: '2026-11-05T15:30:00.000Z',
};

function recording(
  reading: Partial<NonNullable<CallRecordingView['reading']>> | null,
): CallRecordingView {
  return {
    id: RECORDING_ID,
    callId: '00000000-0000-4000-8000-0000000ca111',
    contactLogEntryId: ENTRY_ID,
    transcript: 'Synthetic transcript.',
    lines: [
      { side: 'caller', start: 0, text: 'Hi Pat, any flax?' },
      { side: 'counterparty', start: 2, text: 'I can pay 725 a tonne.' },
      { side: 'counterparty', start: 5, text: 'Up to 84 tonnes, minus freight.' },
      { side: 'caller', start: 9, text: 'I will call you back tomorrow.' },
    ],
    callerName: 'Tess Trader',
    contactName: 'Pat Buyer',
    voicemail: false,
    transcriptFailed: false,
    audioUntil: '2026-11-06T15:00:00.000Z',
    reading:
      reading === null
        ? null
        : {
            readAt: '2026-11-05T15:05:00.000Z',
            model: 'synthetic-model',
            voicemail: false,
            claudeVoicemail: false,
            voicemailCorrectedByName: null,
            voicemailCorrectedAt: null,
            summary: 'Pat bids flax at 725 a tonne.\nCall back tomorrow.',
            drafts: [QUOTE, FOLLOW_UP, DISMISSED],
            ...reading,
          },
    readingFailed: false,
  };
}

function api(
  notes: string | null,
  reading: Partial<NonNullable<CallRecordingView['reading']>> | null,
  handlers: Parameters<typeof mockApi>[0] = {},
): Call[] {
  return mockApi({
    [`GET /contact-log?counterparty_id=${ID}`]: () =>
      Response.json({ entries: [entry(notes)], truncated: false }),
    [`GET /follow-ups?counterparty_id=${ID}&status=all`]: () =>
      Response.json({ followUps: [], truncated: false }),
    [`GET /follow-ups/team?organization_id=${ORG.id}`]: () =>
      Response.json({ members: [{ userId: ME, name: 'Tess Trader' }] }),
    [`GET /calls/recordings?counterparty_id=${ID}`]: () =>
      Response.json({ recordings: [recording(reading)] }),
    ...handlers,
  });
}

function show(role = 'trader') {
  render(
    <CounterpartyCrm
      session={{ ...SESSION, userId: ME, organization: { ...ORG, role } }}
      counterparty={{ id: ID, archived: false, contactNames: ['Pat Buyer'], contacts: [] }}
    />,
  );
}

async function openEntry() {
  const history = await screen.findByRole('region', { name: 'Contact history (1)' });
  const row = await within(history).findByRole('button', { expanded: false, name: /^Call with/ });
  return { history, row };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T16:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Claude’s reading of a call', () => {
  it('shows Claude’s notes on the entry’s line, before it is opened, and no drafts', async () => {
    api(null, {});
    show();
    const { row } = await openEntry();
    expect(await within(row).findByText(/Pat bids flax/)).toBeInTheDocument();
    expect(within(row).queryByText(/to review/)).not.toBeInTheDocument();
    expect(row).toHaveTextContent('Pat bids flax at 725 a tonne.');
    expect(within(row).queryByText('Voicemail')).not.toBeInTheDocument();
  });

  it('marks a voicemail on the line, and a person can say it was not one', async () => {
    const calls = api('Left a message.', { voicemail: true, claudeVoicemail: true, drafts: [] });
    show();
    const { row } = await openEntry();
    expect(await within(row).findByText('Voicemail')).toBeInTheDocument();
    await userEvent.click(row);
    const panel = screen.getByRole('region', { name: "Claude's reading of the call" });
    await userEvent.click(within(panel).getByRole('button', { name: 'Not a voicemail' }));
    await vi.waitFor(() => {
      expect(
        calls.find((call) => call.path === `/calls/recordings/${RECORDING_ID}/voicemail`)?.body,
      ).toEqual({ voicemail: false });
    });
  });

  it('saves Claude’s notes as the entry’s own when it has none', async () => {
    const calls = api(
      null,
      {},
      {
        [`POST /contact-log/${ENTRY_ID}/revisions`]: () => Response.json({}, { status: 201 }),
      },
    );
    show();
    const { row } = await openEntry();
    await userEvent.click(row);
    await userEvent.click(screen.getByRole('button', { name: 'Use as notes' }));
    await vi.waitFor(() => {
      expect(
        calls.find((call) => call.path === `/contact-log/${ENTRY_ID}/revisions`)?.body,
      ).toEqual({
        basedOnRevision: 1,
        values: {
          occurredAt: '2026-11-05T15:00:00.000Z',
          channel: 'call',
          contactName: 'Pat Buyer',
          notes: 'Pat bids flax at 725 a tonne.\nCall back tomorrow.',
        },
      });
    });
  });

  it('offers no Use as notes when the entry has notes, and lists no drafts under the call', async () => {
    api('Our own notes.', {});
    show('viewer');
    const { row } = await openEntry();
    expect(row).toHaveTextContent('Our own notes.');
    await userEvent.click(row);
    expect(screen.queryByRole('button', { name: 'Use as notes' })).not.toBeInTheDocument();
    const panel = screen.getByRole('region', { name: "Claude's reading of the call" });
    expect(within(panel).queryByText('Bid · Flaxseed')).not.toBeInTheDocument();
    expect(panel).toHaveTextContent('waits in Contacts, Bids and offers and Follow-ups');
  });

  it('says when Claude is still reading the call', async () => {
    api(null, null);
    show();
    const { row } = await openEntry();
    await userEvent.click(row);
    expect(screen.getByText('Claude is reading this call…')).toBeInTheDocument();
  });
});
