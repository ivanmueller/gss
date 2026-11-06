import type { CallView } from '@grain/domain';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, SESSION } from '../test/api';
import { CallingProvider, CallRecordingDetails, CellPhoneDialog, PhoneNumber } from './Calling';

// Synthetic names, ids and 555 numbers only.
const COUNTERPARTY = '00000000-0000-4000-8000-00000000c1aa';
const CONTACT = '00000000-0000-4000-8000-00000000d1aa';
const CALL = '00000000-0000-4000-8000-0000000ca11a';

const VIEW: CallView = {
  id: CALL,
  counterpartyId: COUNTERPARTY,
  contactName: 'Pat Buyer',
  status: 'calling_you',
  outcome: null,
  createdAt: '2026-11-02T16:00:00.000Z',
  connectedAt: null,
  endedAt: null,
  contactLogEntryId: null,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function page(enabled = true, onLogged = vi.fn()) {
  render(
    <CallingProvider
      token={SESSION.token}
      counterpartyId={COUNTERPARTY}
      enabled={enabled}
      onLogged={onLogged}
    >
      <PhoneNumber
        contactId={CONTACT}
        name="Pat Buyer"
        phone="(403) 555-0100"
        href="tel:+14035550100"
      />
      <PhoneNumber
        contactId={null}
        name="Synthetic Buyer"
        phone="(403) 555-0110 x12"
        href="tel:+14035550110;ext=12"
      />
    </CallingProvider>,
  );
  return onLogged;
}

const PAT_NUMBER = '(403) 555-0100, call or copy';

/** Clicks Pat's number, then Call in its menu (the owner's request of 2026-11-03). */
async function callPat(user = userEvent.setup()) {
  await user.click(await screen.findByRole('button', { name: PAT_NUMBER }));
  await user.click(screen.getByRole('menuitem', { name: 'Call Pat Buyer' }));
}

describe('PhoneNumber', () => {
  it('appears once the API says calling is set up', async () => {
    mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
    });
    page();
    const user = userEvent.setup();
    const number = await screen.findByRole('button', { name: PAT_NUMBER });
    // A number with an extension is dialed by hand: a phone link.
    expect(screen.getByRole('link', { name: '(403) 555-0110 x12' })).toHaveAttribute(
      'href',
      'tel:+14035550110;ext=12',
    );
    // Clicking the number asks first: Call, or Copy number.
    await user.click(number);
    expect(screen.getByRole('menuitem', { name: 'Call Pat Buyer' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: 'Copy number' })).toBeVisible();
  });

  it('copies the number', async () => {
    mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
    });
    page();
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await user.click(await screen.findByRole('button', { name: PAT_NUMBER }));
    await user.click(screen.getByRole('menuitem', { name: 'Copy number' }));
    expect(writeText).toHaveBeenCalledWith('(403) 555-0100');
    expect(await screen.findByText('Number copied.')).toBeVisible();
  });

  it('stays hidden until calling is set up, and for those who may not log contacts', async () => {
    const calls = mockApi({
      'GET /me/phone': () => Response.json({ phone: null, callingAvailable: false }),
    });
    page();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: PAT_NUMBER })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '(403) 555-0100' })).toHaveAttribute(
      'href',
      'tel:+14035550100',
    );

    page(false);
    expect(calls).toHaveLength(1);
  });

  it('places the call, follows it, and reports it logged when it ends', async () => {
    let poll = 0;
    const calls = mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
      'POST /calls': () => Response.json({ call: VIEW }, { status: 201 }),
      [`GET /calls/${CALL}`]: () => {
        poll += 1;
        return Response.json({
          call:
            poll === 1
              ? { ...VIEW, status: 'connected', connectedAt: '2026-11-02T16:00:30.000Z' }
              : {
                  ...VIEW,
                  status: 'ended',
                  outcome: 'talked',
                  connectedAt: '2026-11-02T16:00:30.000Z',
                  endedAt: '2026-11-02T16:06:42.000Z',
                  contactLogEntryId: '00000000-0000-4000-8000-0000000e11aa',
                },
        });
      },
    });
    const onLogged = page();
    const user = userEvent.setup();
    await callPat(user);

    // The live call box in the bottom right corner: whom, the step, what to do now.
    const box = await screen.findByRole('status', { name: 'Call with Pat Buyer' });
    expect(box).toHaveTextContent('Pat BuyerCalling your cell…');
    expect(box).toHaveTextContent('Answer your cell phone.');
    expect(
      within(box).getByRole('list', { name: 'Progress' }).querySelector('[aria-current]'),
    ).toHaveTextContent('Calling your cell…');
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      counterpartyId: COUNTERPARTY,
      contactId: CONTACT,
    });
    // While it is under way, Call is unavailable.
    await user.click(screen.getByRole('button', { name: PAT_NUMBER }));
    expect(screen.getByRole('menuitem', { name: 'Call Pat Buyer' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('{Escape}');

    // Connected: the last step, and a running clock.
    expect(
      await within(box).findByText('Hang up on your phone to end the call.', {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(box).toHaveTextContent('Pat BuyerConnected');
    expect(box).toHaveTextContent(/\d+:\d{2}/);
    expect(
      await within(box).findByText(
        'Call ended after 6 min 12 s. It is in the contact history.',
        {},
        { timeout: 4000 },
      ),
    ).toBeVisible();
    // Ended: no more steps.
    expect(within(box).queryByRole('list', { name: 'Progress' })).not.toBeInTheDocument();
    expect(onLogged).toHaveBeenCalledTimes(1);
    // The box goes by itself a few seconds after the call ended.
    await vi.waitFor(
      () => {
        expect(screen.queryByRole('status', { name: 'Call with Pat Buyer' })).toBeNull();
      },
      { timeout: 7000 },
    );
  }, 20_000);

  it('says why a call did not connect', async () => {
    mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
      'POST /calls': () =>
        Response.json(
          { call: { ...VIEW, status: 'ended', outcome: 'not_confirmed', endedAt: VIEW.createdAt } },
          { status: 201 },
        ),
    });
    page();
    await callPat();
    expect(await screen.findByText('1 was not pressed, so they were not called.')).toBeVisible();
  });

  it('asks for the cell phone when none is saved', async () => {
    mockApi({
      'GET /me/phone': () => Response.json({ phone: null, callingAvailable: true }),
      'POST /calls': () =>
        Response.json(
          { error: { code: 'NO_CELL_PHONE', message: 'Add your cell phone first.' } },
          { status: 409 },
        ),
    });
    page();
    await callPat();
    expect(await screen.findByRole('dialog', { name: 'Your cell phone' })).toBeVisible();
    // The page behind the open dialog is hidden from screen readers meanwhile.
    expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent(
      'Add your cell phone first.',
    );
  });
});

describe('CellPhoneDialog', () => {
  it('shows the saved cell and saves a new one', async () => {
    const calls = mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
      'PUT /me/phone': () => Response.json({ phone: '(306) 555-0143' }),
    });
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <CellPhoneDialog
        token="synthetic-token"
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );
    const input = screen.getByLabelText('Cell phone');
    await vi.waitFor(() => {
      expect(input).toHaveValue('(403) 555-0142');
    });
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '306 555 0143');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await act(() => Promise.resolve());
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({ phone: '306 555 0143' });
    expect(onSaved).toHaveBeenCalledWith('(306) 555-0143');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the API's reason when a number is refused, and removes a saved one", async () => {
    const calls = mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
      'PUT /me/phone': () =>
        Response.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Enter your cell phone with its area code.',
            },
          },
          { status: 422 },
        ),
      'DELETE /me/phone': () => Response.json({ phone: null }),
    });
    render(<CellPhoneDialog token="synthetic-token" open onOpenChange={vi.fn()} />);
    const input = screen.getByLabelText('Cell phone');
    await vi.waitFor(() => {
      expect(input).toHaveValue('(403) 555-0142');
    });
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '555-0142');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter your cell phone with its area code.',
    );
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await vi.waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    });
  });
});

describe('CallRecordingDetails', () => {
  const RECORDING = {
    id: '00000000-0000-4000-8000-0000000eec01',
    callId: CALL,
    contactLogEntryId: '00000000-0000-4000-8000-0000000e11aa',
    transcript: 'We can do November at the posted price.',
    lines: null,
    callerName: 'Tess Trader',
    contactName: 'Pat Buyer',
    voicemail: false,
    transcriptFailed: false,
    audioUntil: '2999-01-01T00:00:00.000Z',
    reading: null,
    readingFailed: false,
  };

  it('shows the transcript and plays the audio through the API', async () => {
    const calls = mockApi({
      [`GET /calls/recordings/${RECORDING.id}/audio`]: () =>
        new Response('mp3', { headers: { 'Content-Type': 'audio/mpeg' } }),
    });
    const createObjectURL = vi.fn(() => 'blob:synthetic');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    render(<CallRecordingDetails token="synthetic-token" recording={RECORDING} />);
    expect(screen.getByText('Transcript')).toBeVisible();
    expect(screen.getByText('We can do November at the posted price.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Play recording' }));
    await vi.waitFor(() => {
      expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:synthetic');
    });
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer synthetic-token');
  });

  it('says a transcript is on its way, and offers no audio once it is gone', () => {
    render(
      <CallRecordingDetails
        token="synthetic-token"
        recording={{ ...RECORDING, transcript: null, audioUntil: null }}
      />,
    );
    expect(screen.getByText('Transcript on its way…')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Play recording' })).not.toBeInTheDocument();
  });

  it('shows the transcript as a conversation, each line with who said it', async () => {
    render(
      <CallRecordingDetails
        token="synthetic-token"
        recording={{
          ...RECORDING,
          transcript: 'Caller: Morning Pat.\nCounterparty: Two loads at the posted price.',
          lines: [
            { side: 'caller', start: 0.4, text: 'Morning Pat.' },
            { side: 'counterparty', start: 72.5, text: 'Two loads at the posted price.' },
            { side: null, start: 80, text: 'Bye.' },
          ],
        }}
      />,
    );
    await userEvent.click(screen.getByText('Transcript'));
    const items = within(screen.getByRole('list', { name: 'Transcript by side' })).getAllByRole(
      'listitem',
    );
    expect(items.map((item) => item.getAttribute('data-side'))).toEqual([
      'caller',
      'counterparty',
      'unknown',
    ]);
    expect(items[0]).toHaveTextContent('Tess Trader · 0:00Morning Pat.');
    expect(items[1]).toHaveTextContent('Pat Buyer · 1:12Two loads at the posted price.');
    expect(items[2]).toHaveTextContent('Unknown speaker · 1:20Bye.');
  });

  it('says when no transcript will come, and when nothing was said', () => {
    const { rerender } = render(
      <CallRecordingDetails
        token="synthetic-token"
        recording={{ ...RECORDING, transcript: null, transcriptFailed: true }}
      />,
    );
    expect(screen.getByText('No transcript for this call.')).toBeVisible();
    rerender(
      <CallRecordingDetails
        token="synthetic-token"
        recording={{ ...RECORDING, transcript: '', lines: [] }}
      />,
    );
    expect(screen.getByText('Nothing was said on this call.')).toBeVisible();
  });
});

describe('the contact history after a call that connected', () => {
  it('is loaded again for the transcript after the line has gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
      'POST /calls': () =>
        Response.json(
          {
            call: {
              ...VIEW,
              status: 'ended',
              outcome: 'talked',
              connectedAt: '2026-11-02T16:00:30.000Z',
              endedAt: '2026-11-02T16:06:42.000Z',
              contactLogEntryId: '00000000-0000-4000-8000-0000000e11aa',
            },
          },
          { status: 201 },
        ),
    });
    const onLogged = page();
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    await callPat(user);
    await screen.findByText(/Call ended after/);
    // The line goes after 5 seconds; the reloads at 30 s, 90 s, 3 and 5 min still happen.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(screen.queryByText(/Call ended after/)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(onLogged).toHaveBeenCalledTimes(4);
  });
});
