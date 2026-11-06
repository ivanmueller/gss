import type { CallbackReturnView, CallbackSettingsView, CallView } from '@grain/domain';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { CallbackReturns } from './CallbackReturns';
import { CallbackSettings } from './CallbackSettings';
import { CallBox } from './Calling';
import { IncomingCalls, WATCH_MS } from './IncomingCalls';

// Callbacks to GSS's number (F-132). Synthetic names, ids and 555 numbers only.
const CALL = '00000000-0000-4000-8000-0000000cb11a';
const COMPANY = '00000000-0000-4000-8000-00000000c1aa';
const CONTACT = '00000000-0000-4000-8000-00000000d1aa';
const OLIVIA = '00000000-0000-4000-8000-0000000011aa';
const ME = '00000000-0000-4000-8000-0000000022aa';

const RUNG = { companyName: 'Synthetic A Buyer', callerPhone: '(403) 555-0100' };

const CALLBACK: CallView = {
  id: CALL,
  counterpartyId: COMPANY,
  contactName: 'Pat Buyer',
  status: 'calling_you',
  outcome: null,
  createdAt: '2026-11-06T20:00:00.000Z',
  connectedAt: null,
  endedAt: null,
  contactLogEntryId: null,
  direction: 'incoming',
  callback: { ...RUNG, you: 'ringing' },
};

function box(call: CallView) {
  render(
    <CallBox
      notice={{ kind: 'call', call, name: 'Pat Buyer · Synthetic A Buyer' }}
      onDismiss={vi.fn()}
      onAddCell={vi.fn()}
    />,
  );
  return screen.getByRole('status', { name: 'Call with Pat Buyer · Synthetic A Buyer' });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the call box for a callback', () => {
  it('says the cell is ringing, then asks for 1', () => {
    const ringing = box(CALLBACK);
    expect(within(ringing).getByText('Your cell is ringing…')).toBeVisible();
    expect(within(ringing).getByText('Answer your cell phone.')).toBeVisible();
    expect(within(ringing).getByRole('listitem', { current: 'step' })).toHaveTextContent(
      'Calling your cell…',
    );
  });

  it('asks the person to press 1 to take it', () => {
    const confirming = box({
      ...CALLBACK,
      status: 'confirming',
      callback: { ...RUNG, you: 'confirming' },
    });
    expect(within(confirming).getByText('Press 1 on your phone to take the call')).toBeVisible();
  });

  it('runs a clock once they are joined', () => {
    const connected = box({
      ...CALLBACK,
      status: 'connected',
      connectedAt: new Date(Date.now() - 65_000).toISOString(),
      callback: { ...RUNG, you: 'answered' },
    });
    // The headline, and the step's name for screen readers.
    expect(within(connected).getAllByText('Connected')[0]).toBeVisible();
    expect(within(connected).getByText(/^1:0[5-6]$/)).toBeInTheDocument();
  });

  it('says so when it moved on to someone else', () => {
    const passed = box({
      ...CALLBACK,
      status: 'calling_you',
      callback: { ...RUNG, you: 'passed' },
    });
    expect(within(passed).getByText('You did not take this call.')).toBeVisible();
    expect(within(passed).getByRole('button', { name: 'Dismiss' })).toBeVisible();
  });

  it('sends an unknown number’s call to the Follow-ups page when it ends', () => {
    const ended = box({
      ...CALLBACK,
      counterpartyId: null,
      status: 'ended',
      outcome: 'talked',
      connectedAt: '2026-11-06T20:00:10.000Z',
      endedAt: '2026-11-06T20:01:10.000Z',
      callback: { companyName: null, callerPhone: '(780) 555-0123', you: 'answered' },
    });
    expect(
      within(ended).getByText(
        'Call ended after 1 min 0 s. It is on the Follow-ups page, to link to a company.',
      ),
    ).toBeVisible();
  });
});

describe('IncomingCalls', () => {
  it('shows the box when a callback rings the person’s cell, and follows it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let mine: CallView | null = null;
    let current = CALLBACK;
    const calls = mockApi({
      [`GET /callbacks/mine?organization_id=${ORG.id}`]: () => Response.json({ call: mine }),
      [`GET /calls/${CALL}`]: () => Response.json({ call: current }),
    });
    render(<IncomingCalls token={SESSION.token} organizationId={ORG.id} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(screen.queryByRole('status')).toBeNull();

    mine = CALLBACK;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCH_MS);
    });
    expect(
      await screen.findByRole('status', { name: 'Call with Pat Buyer · Synthetic A Buyer' }),
    ).toBeVisible();

    current = {
      ...CALLBACK,
      status: 'confirming',
      callback: { ...RUNG, you: 'confirming' },
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText('Press 1 on your phone to take the call')).toBeVisible();
    expect(calls.some((call) => call.path === `/calls/${CALL}`)).toBe(true);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer synthetic-token');
  });

  it('follows a callback the person took past 15 minutes, to its end (Codex, finding 3)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let current: CallView = {
      ...CALLBACK,
      status: 'connected',
      connectedAt: new Date().toISOString(),
      callback: { ...RUNG, you: 'answered' },
    };
    mockApi({
      [`GET /callbacks/mine?organization_id=${ORG.id}`]: () => Response.json({ call: current }),
      [`GET /calls/${CALL}`]: () => Response.json({ call: current }),
    });
    render(<IncomingCalls token={SESSION.token} organizationId={ORG.id} />);
    expect((await screen.findAllByText('Connected'))[0]).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000);
    });
    current = {
      ...current,
      status: 'ended',
      outcome: 'talked',
      endedAt: new Date().toISOString(),
      contactLogEntryId: '00000000-0000-4000-8000-0000000e11aa',
    };
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText(/^Call ended after .*It is in the contact history\.$/)).toBeVisible();
  });

  it('does not ask while the page is hidden', async () => {
    const calls = mockApi({});
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<IncomingCalls token={SESSION.token} organizationId={ORG.id} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls).toEqual([]);
  });
});

const UNKNOWN: CallbackReturnView = {
  callId: CALL,
  receivedAt: '2026-11-06T20:00:00.000Z',
  callerPhone: '(780) 555-0123',
  counterpartyId: null,
  counterpartyName: null,
  contactName: '(780) 555-0123',
  outcome: 'voicemail',
  talkedSeconds: null,
  answeredByName: null,
  meantForName: null,
  ownerId: OLIVIA,
  ownerName: 'Olivia',
  recording: {
    id: '00000000-0000-4000-8000-0000000eec01',
    voicemail: true,
    lines: [{ side: 'counterparty', start: 0, text: 'Please call me back about oats.' }],
    transcript: 'Counterparty: Please call me back about oats.',
    transcriptFailed: false,
    audioUntil: null,
  },
};

describe('CallbackReturns', () => {
  it('shows nothing when no call waits', async () => {
    mockApi({ [`GET /callbacks?organization_id=${ORG.id}`]: () => Response.json({ returns: [] }) });
    const { container } = render(<CallbackReturns session={{ ...SESSION, userId: ME }} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('lists a voicemail from an unknown number with its transcript, and takes it', async () => {
    const calls = mockApi({
      [`GET /callbacks?organization_id=${ORG.id}`]: () => Response.json({ returns: [UNKNOWN] }),
      [`POST /callbacks/${CALL}/settle`]: () => Response.json({ settled: true }),
    });
    render(<CallbackReturns session={{ ...SESSION, userId: ME }} />);
    const section = await screen.findByRole('region', { name: 'Calls to GSS’s number (1)' });
    expect(within(section).getAllByText('(780) 555-0123')[0]).toBeVisible();
    expect(within(section).getByText(/They left a voicemail/)).toBeVisible();
    expect(within(section).getByText('Olivia’s')).toBeVisible();
    expect(within(section).getByText('Unknown number')).toBeVisible();
    await userEvent.click(within(section).getByText('Transcript'));
    expect(within(section).getByText('Please call me back about oats.')).toBeVisible();
    await userEvent.click(within(section).getByRole('button', { name: 'Take it' }));
    await vi.waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ action: 'take' });
    });
    // Taken, it stays listed (now theirs) with its other actions (Codex's review, finding 4).
    await vi.waitFor(() => {
      expect(within(section).getByRole('button', { name: 'Link to a company' })).toBeEnabled();
    });
    expect(within(section).getByRole('button', { name: 'Dismiss' })).toBeEnabled();
  });

  it('links an unknown number to a company and one of its contacts', async () => {
    const calls = mockApi({
      [`GET /callbacks?organization_id=${ORG.id}`]: () => Response.json({ returns: [UNKNOWN] }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () =>
        Response.json({
          counterparties: [
            {
              id: COMPANY,
              legalName: 'Synthetic A Buyer',
              tradingName: null,
              regions: ['AB'],
              primaryCountry: 'CA',
              archivedAt: null,
              types: ['buyer'],
            },
          ],
          truncated: false,
        }),
      [`GET /counterparties/${COMPANY}`]: () =>
        Response.json({
          id: COMPANY,
          legalName: 'Synthetic A Buyer',
          contacts: [{ id: CONTACT, name: 'Pat Buyer' }],
        }),
      [`POST /callbacks/${CALL}/settle`]: () => Response.json({ settled: true }),
    });
    render(<CallbackReturns session={{ ...SESSION, userId: ME }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Link to a company' }));
    await choose(await screen.findByRole('button', { name: 'Company' }), 'Synthetic A Buyer');
    await vi.waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Contact' })).toBeEnabled();
    });
    await choose(screen.getByRole('combobox', { name: 'Contact' }), 'Pat Buyer');
    await userEvent.click(screen.getByRole('button', { name: 'Link to this company' }));
    await vi.waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        action: 'link',
        counterpartyId: COMPANY,
        contactId: CONTACT,
      });
    });
  });

  it('dismisses a wrong number, and says why when that fails', async () => {
    mockApi({
      [`GET /callbacks?organization_id=${ORG.id}`]: () => Response.json({ returns: [UNKNOWN] }),
      [`POST /callbacks/${CALL}/settle`]: () =>
        Response.json(
          { error: { code: 'CLOSED', message: 'Someone already dealt with this call.' } },
          { status: 409 },
        ),
    });
    render(<CallbackReturns session={{ ...SESSION, userId: ME }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone already dealt with this call.',
    );
  });
});

const SETTINGS: CallbackSettingsView = {
  phone: null,
  configuredPhone: '(825) 555-0199',
  callbacksPerson: null,
  updatedByName: null,
  updatedAt: null,
  candidates: [
    { id: OLIVIA, name: 'Olivia' },
    { id: ME, name: 'Adam' },
  ],
};

describe('CallbackSettings', () => {
  it('turns callbacks on with the person chosen', async () => {
    let saved: CallbackSettingsView = SETTINGS;
    const calls = mockApi({
      [`GET /callbacks/settings?organization_id=${ORG.id}`]: () =>
        Response.json({ settings: saved }),
      [`PUT /callbacks/settings?organization_id=${ORG.id}`]: () => {
        saved = {
          ...SETTINGS,
          phone: '(825) 555-0199',
          callbacksPerson: { id: OLIVIA, name: 'Olivia' },
          updatedByName: 'Adam',
          updatedAt: '2026-11-06T20:00:00.000Z',
        };
        return Response.json({ settings: saved });
      },
    });
    render(<CallbackSettings session={SESSION} />);
    expect(
      await screen.findByText(/Callbacks are off: a call to \(825\) 555-0199 hears a busy signal/),
    ).toBeVisible();
    await choose(screen.getByRole('combobox', { name: 'Callbacks go to' }), 'Olivia');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on callbacks' }));
    await vi.waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        callbacksPerson: OLIVIA,
      });
    });
    expect(
      await screen.findByText(/ring whoever on the team last called that number/),
    ).toBeVisible();
    expect(screen.getByText(/^Last set by Adam, .* 2026, 2:00 pm MT\.$/)).toBeVisible();
  });

  it('says calling is not set up when the Worker has no Telnyx settings', async () => {
    mockApi({
      [`GET /callbacks/settings?organization_id=${ORG.id}`]: () =>
        Response.json({ settings: { ...SETTINGS, configuredPhone: null } }),
    });
    render(<CallbackSettings session={SESSION} />);
    expect(await screen.findByText(/Calling is not set up yet/)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
