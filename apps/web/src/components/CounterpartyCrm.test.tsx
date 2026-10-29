import type { ContactLogEntry, FollowUp } from '@grain/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { CounterpartyCrm } from './CounterpartyCrm';

// Synthetic values only. The clock is fixed at 10 am Central daylight time, 30 October 2026.
const ID = '00000000-0000-4000-8000-00000000c001';
const ME = '00000000-0000-4000-8000-0000000044aa';
const ADAM = '00000000-0000-4000-8000-0000000022aa';
const ENTRY_ID = '00000000-0000-4000-8000-00000000e101';
const TEAM = {
  members: [
    { userId: ADAM, name: 'Adam Admin' },
    { userId: ME, name: 'Tess Trader' },
  ],
};

const ENTRY: ContactLogEntry = {
  id: ENTRY_ID,
  counterpartyId: ID,
  createdAt: '2026-10-29T14:00:00.000Z',
  current: {
    id: 'r2',
    revisionNumber: 2,
    occurredAt: '2026-10-29T13:30:00.000Z',
    channel: 'call',
    contactName: 'Pat Q. Buyer',
    notes: 'Wants November delivery.',
    recordedByName: 'Adam Admin',
    recordedAt: '2026-10-29T15:00:00.000Z',
  },
  revisions: [],
};
ENTRY.revisions = [
  ENTRY.current,
  {
    ...ENTRY.current,
    id: 'r1',
    revisionNumber: 1,
    contactName: 'Pat Buyer',
    notes: 'Wants delivery.',
    recordedByName: 'Tess Trader',
    recordedAt: '2026-10-29T14:00:00.000Z',
  },
];

const FOLLOW_UP: FollowUp = {
  id: '00000000-0000-4000-8000-00000000f101',
  counterparty: {
    id: ID,
    legalName: 'Synthetic Prairie Mills',
    tradingName: null,
    archived: false,
  },
  contactLogEntryId: ENTRY_ID,
  task: 'Send the bid sheet',
  dueAt: '2026-10-30T14:00:00.000Z',
  assignedTo: { userId: ME, name: 'Tess Trader' },
  createdByName: 'Adam Admin',
  createdAt: '2026-10-29T14:00:00.000Z',
  doneAt: null,
  doneByName: null,
  version: '2026-10-29T14:00:00.000000Z',
};

const DONE: FollowUp = {
  ...FOLLOW_UP,
  id: '00000000-0000-4000-8000-00000000f102',
  task: 'Call about October',
  doneAt: '2026-10-29T16:00:00.000Z',
  doneByName: 'Tess Trader',
};

function api(handlers: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    [`GET /contact-log?counterparty_id=${ID}`]: () =>
      Response.json({ entries: [ENTRY], truncated: false }),
    [`GET /follow-ups?counterparty_id=${ID}&status=all`]: () =>
      Response.json({ followUps: [FOLLOW_UP, DONE], truncated: false }),
    [`GET /follow-ups/team?organization_id=${ORG.id}`]: () => Response.json(TEAM),
    ...handlers,
  });
}

function show(role: string, userId: string | undefined = ME, archived = false) {
  render(
    <CounterpartyCrm
      session={{ ...SESSION, organization: { ...ORG, role }, ...(userId && { userId }) }}
      counterparty={{ id: ID, archived, contactNames: ['Pat Buyer', 'Sam Seller'] }}
    />,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T15:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('CounterpartyCrm', () => {
  it('shows open follow-ups with when they are due in Central time, and done ones on request', async () => {
    api();
    show('trader');
    const section = await screen.findByRole('region', { name: 'Follow-ups (1 open)' });
    const open = within(section).getByRole('list', { name: 'Open follow-ups' });
    expect(open).toHaveTextContent('OverdueSend the bid sheet');
    expect(open).toHaveTextContent('Due Fri 30 Oct 2026, 9:00 am CT · Tess Trader');
    expect(open).toHaveTextContent('Planned by Adam Admin after a contact');
    expect(within(section).queryByText('Call about October')).not.toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Show done (1)' }));
    expect(within(section).getByRole('list', { name: 'Done follow-ups' })).toHaveTextContent(
      'DoneCall about October',
    );
  });

  it('shows the contact history with earlier versions on request', async () => {
    api();
    show('viewer');
    const history = await screen.findByRole('region', { name: 'Contact history (1)' });
    expect(history).toHaveTextContent('Call with Pat Q. Buyer · Thu 29 Oct 2026, 8:30 am CT');
    expect(history).toHaveTextContent('Wants November delivery.');
    expect(history).toHaveTextContent(
      'Logged by Tess Trader · corrected by Adam Admin, Thu 29 Oct 2026, 10:00 am CT',
    );
    await userEvent.click(
      within(history).getByRole('button', { name: 'Show earlier versions (1)' }),
    );
    expect(within(history).getByRole('list', { name: 'Earlier versions' })).toHaveTextContent(
      'Call with Pat Buyer',
    );
  });

  it('logs a contact with a follow-up, its times typed in Central time and sent in UTC', async () => {
    const calls = api({
      'POST /contact-log': () =>
        Response.json({ entry: ENTRY, followUpId: FOLLOW_UP.id }, { status: 201 }),
    });
    const user = userEvent.setup();
    show('trader');
    const history = await screen.findByRole('region', { name: 'Contact history (1)' });
    await user.click(within(history).getByRole('button', { name: 'Log contact' }));
    fireEvent.change(within(history).getByLabelText('When'), {
      target: { value: '2026-10-29T08:30' },
    });
    await user.type(within(history).getByLabelText(/Who you spoke to/), 'Pat Buyer');
    await user.type(within(history).getByLabelText('Notes'), 'Wants November delivery.');
    await user.click(within(history).getByLabelText('Plan a follow-up'));
    // A follow-up starts as the person's own, due at 9 am Central tomorrow.
    expect(within(history).getByLabelText(/Due/)).toHaveValue('2026-10-31T09:00');
    expect(within(history).getByLabelText(/Who is responsible/)).toHaveTextContent('Tess Trader');
    await user.type(within(history).getByLabelText(/What to do/), 'Send the bid sheet');
    fireEvent.change(within(history).getByLabelText(/Due/), {
      target: { value: '2026-10-30T14:00' },
    });
    await user.click(within(history).getByRole('button', { name: 'Save contact' }));
    expect(await screen.findByText('Contact logged and follow-up planned.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      counterpartyId: ID,
      values: {
        occurredAt: '2026-10-29T13:30:00.000Z',
        channel: 'call',
        contactName: 'Pat Buyer',
        notes: 'Wants November delivery.',
      },
      followUp: { task: 'Send the bid sheet', dueAt: '2026-10-30T19:00:00.000Z', assignedTo: ME },
    });
  });

  it('says which fields need fixing before sending anything', async () => {
    const calls = api();
    const user = userEvent.setup();
    show('operations');
    const history = await screen.findByRole('region', { name: 'Contact history (1)' });
    await user.click(within(history).getByRole('button', { name: 'Log contact' }));
    await user.click(within(history).getByRole('button', { name: 'Save contact' }));
    expect(within(history).getByText('Who you spoke to is required.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('corrects an entry as a new version of the one shown', async () => {
    const calls = api({
      [`POST /contact-log/${ENTRY_ID}/revisions`]: () => Response.json(ENTRY, { status: 201 }),
    });
    const user = userEvent.setup();
    show('trader');
    const history = await screen.findByRole('region', { name: 'Contact history (1)' });
    await user.click(
      within(history).getByRole('button', { name: 'Correct: Call with Pat Q. Buyer' }),
    );
    expect(within(history).getByLabelText('When')).toHaveValue('2026-10-29T08:30');
    const notes = within(history).getByLabelText('Notes');
    await user.clear(notes);
    await user.type(notes, 'Wants November and December.');
    await user.click(within(history).getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByText('Correction saved.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      basedOnRevision: 2,
      values: {
        occurredAt: '2026-10-29T13:30:00.000Z',
        channel: 'call',
        contactName: 'Pat Q. Buyer',
        notes: 'Wants November and December.',
      },
    });
  });

  it('plans a follow-up on its own and changes one', async () => {
    const calls = api({
      'POST /follow-ups': () => Response.json(FOLLOW_UP, { status: 201 }),
      [`PATCH /follow-ups/${FOLLOW_UP.id}`]: () => Response.json(FOLLOW_UP),
    });
    const user = userEvent.setup();
    show('org_admin', ADAM);
    const section = await screen.findByRole('region', { name: 'Follow-ups (1 open)' });
    await user.click(within(section).getByRole('button', { name: 'Plan follow-up' }));
    await user.type(within(section).getByLabelText(/What to do/), 'Call back');
    await user.click(within(section).getByRole('button', { name: 'Save follow-up' }));
    expect(await screen.findByText('Follow-up planned.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      counterpartyId: ID,
      values: { task: 'Call back', dueAt: '2026-10-31T14:00:00.000Z', assignedTo: ADAM },
    });

    await user.click(
      within(section).getByRole('button', { name: 'Edit follow-up: Send the bid sheet' }),
    );
    expect(within(section).getByLabelText(/Due/)).toHaveValue('2026-10-30T09:00');
    await user.click(within(section).getByRole('button', { name: 'Save follow-up' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        version: FOLLOW_UP.version,
        values: { task: 'Send the bid sheet', dueAt: '2026-10-30T14:00:00.000Z', assignedTo: ME },
      });
    });
  });

  it('lets a viewer only read, but mark done what they are responsible for', async () => {
    const calls = api({
      [`POST /follow-ups/${FOLLOW_UP.id}/done`]: () => Response.json({ ...FOLLOW_UP, doneAt: 'x' }),
    });
    show('viewer', ME);
    const section = await screen.findByRole('region', { name: 'Follow-ups (1 open)' });
    expect(screen.queryByRole('button', { name: 'Log contact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Correct/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit follow-up/ })).not.toBeInTheDocument();
    await userEvent.click(
      within(section).getByRole('button', { name: 'Mark done: Send the bid sheet' }),
    );
    expect(await screen.findByText('Follow-up marked done.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST' && call.path.endsWith('/done'))).toBe(true);
  });

  it('gives a viewer who is not responsible no Mark done', async () => {
    api();
    show('viewer', ADAM);
    await screen.findByRole('region', { name: 'Follow-ups (1 open)' });
    expect(screen.queryByRole('button', { name: /^Mark done/ })).not.toBeInTheDocument();
  });

  it('offers nothing new for an archived counterparty, but its follow-ups can be finished', async () => {
    api();
    show('trader', ME, true);
    await screen.findByRole('region', { name: 'Contact history (1)' });
    expect(screen.queryByRole('button', { name: 'Log contact' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan follow-up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Correct/ })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Mark done: Send the bid sheet' }),
    ).toBeInTheDocument();
  });
});
