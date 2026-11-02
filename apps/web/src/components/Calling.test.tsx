import type { CallView } from '@grain/domain';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, SESSION } from '../test/api';
import { CallButton, CallingProvider, CellPhoneDialog } from './Calling';

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
      <CallButton contactId={CONTACT} name="Pat Buyer" phone="(403) 555-0100" />
      <CallButton contactId={null} name="Synthetic Buyer" phone="(403) 555-0110 x12" />
    </CallingProvider>,
  );
  return onLogged;
}

describe('CallButton', () => {
  it('appears once the API says calling is set up', async () => {
    mockApi({
      'GET /me/phone': () => Response.json({ phone: '(403) 555-0142', callingAvailable: true }),
    });
    page();
    expect(await screen.findByRole('button', { name: /Call Pat Buyer/ })).toBeEnabled();
    // A number with an extension is dialed by hand.
    expect(screen.queryByRole('button', { name: /Call Synthetic Buyer/ })).not.toBeInTheDocument();
  });

  it('stays hidden until calling is set up, and for those who may not log contacts', async () => {
    const calls = mockApi({
      'GET /me/phone': () => Response.json({ phone: null, callingAvailable: false }),
    });
    page();
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(screen.queryByRole('button', { name: /Call/ })).not.toBeInTheDocument();

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
    await user.click(await screen.findByRole('button', { name: /Call Pat Buyer/ }));

    expect(await screen.findByText('Pat Buyer: Calling your cell…')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
      counterpartyId: COUNTERPARTY,
      contactId: CONTACT,
    });
    expect(screen.getByRole('button', { name: /Call Pat Buyer/ })).toBeDisabled();

    expect(await screen.findByText('Pat Buyer: Connected', {}, { timeout: 4000 })).toBeVisible();
    expect(
      await screen.findByText(
        'Pat Buyer: call ended after 6 min 12 s. It is in the contact history.',
        {},
        { timeout: 4000 },
      ),
    ).toBeVisible();
    expect(onLogged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Call Pat Buyer/ })).toBeEnabled();
  }, 12_000);

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
    await userEvent.click(await screen.findByRole('button', { name: /Call Pat Buyer/ }));
    expect(
      await screen.findByText('Pat Buyer: 1 was not pressed, so they were not called.'),
    ).toBeVisible();
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
    await userEvent.click(await screen.findByRole('button', { name: /Call Pat Buyer/ }));
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
