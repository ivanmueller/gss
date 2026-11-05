import type { CounterpartySummaryView } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { CounterpartySummary } from './CounterpartySummary';

// Synthetic values only.
const ID = '00000000-0000-4000-8000-00000000c001';
const PATH = `/counterparties/${ID}/summary`;
const WRITTEN: CounterpartySummaryView = {
  summary: 'Bids flaxseed at CAD 725 per MT.\nFollow-up overdue: Send the bid sheet.',
  writtenAt: '2026-11-05T16:00:00.000Z',
  model: 'synthetic-model',
  requested: false,
  writing: false,
  failed: false,
};
const NONE: CounterpartySummaryView = {
  summary: null,
  writtenAt: null,
  model: null,
  requested: false,
  writing: false,
  failed: false,
};

function show(canAsk = true) {
  render(
    <CounterpartySummary
      session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }}
      counterpartyId={ID}
      canAsk={canAsk}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CounterpartySummary', () => {
  it("shows Claude's lines, when they were written in Alberta time, and to check the records", async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json(WRITTEN) });
    show();
    const lines = await screen.findByRole('list', { name: 'Summary of the company' });
    expect(
      within(lines)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['·Bids flaxseed at CAD 725 per MT.', '·Follow-up overdue: Send the bid sheet.']);
    expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    expect(screen.getByText('Drafted by Claude')).toBeInTheDocument();
    expect(
      screen.getByText(/Written 5 Nov 2026, 10:00 am MT from the records on this page/),
    ).toHaveTextContent('Check them before acting on it.');
  });

  it('asks for a new summary with Refresh, then says it is being written', async () => {
    let asked = false;
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(asked ? { ...WRITTEN, requested: true } : WRITTEN),
      [`POST ${PATH}/request`]: () => {
        asked = true;
        return Response.json({ requested: true }, { status: 202 });
      },
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Claude is writing a new summary. It appears here within a few minutes.',
    );
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('says when there is none yet, and offers to write one now', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(NONE),
      [`POST ${PATH}/request`]: () => Response.json({ requested: true }, { status: 202 }),
    });
    show();
    expect(
      await screen.findByText(
        'No summary yet. Claude writes one after the next call, note, bid or offer, or follow-up.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Write one now' }));
    await vi.waitFor(() => {
      expect(calls.some((call) => call.path === `${PATH}/request`)).toBe(true);
    });
  });

  it('says why a request was refused', async () => {
    mockApi({
      [`GET ${PATH}`]: () => Response.json(WRITTEN),
      [`POST ${PATH}/request`]: () =>
        Response.json(
          {
            error: {
              code: 'TOO_SOON',
              message: 'A summary was written in the last 10 minutes. Try again later.',
            },
          },
          { status: 409 },
        ),
    });
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Refresh' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A summary was written in the last 10 minutes. Try again later.',
    );
  });

  it('says when Claude could not write one, and offers to try again', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json({ ...NONE, failed: true }) });
    show();
    expect(await screen.findByText(/Claude could not write a summary/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('offers no buttons to a viewer', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json(NONE) });
    show(false);
    await screen.findByText(/No summary yet/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
