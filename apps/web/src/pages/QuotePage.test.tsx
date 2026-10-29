import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { BID, QUOTE_ID, REVISION_1 } from '../test/quotes';
import { QuotePage } from './QuotePage';

const PATH = `/quotes/${QUOTE_ID}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QuotePage', () => {
  it('shows the current terms and every revision, older ones as superseded', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json(BID) });
    render(<QuotePage session={SESSION} id={QUOTE_ID} />);
    expect(await screen.findByRole('heading', { name: /Bid · Flaxseed/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Synthetic Buyer' })).toHaveAttribute(
      'href',
      `/counterparties/${BID.counterparty.id}`,
    );
    const current = screen.getByRole('region', { name: 'Current terms' });
    expect(current).toHaveTextContent(
      'Revision 2, recorded Wed 28 Oct 2026, 10:00 am MT by Adam Admin',
    );
    expect(current).toHaveTextContent('PriceUSD 730.50/MT');
    expect(current).toHaveTextContent('Firm or indicativeIndicative');
    expect(current).toHaveTextContent('Valid untilFri 30 Oct 2099, 4:00 pm MT');
    expect(current).toHaveTextContent('SourcePhone callSynthetic call');

    const history = screen.getByRole('table', { name: 'Revision history' });
    const rows = within(history).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('2USD 730.50/MTIndicative · No. 1 CW');
    expect(rows[1]).toHaveTextContent(
      'IndicativeWed 28 Oct 2026, 10:00 am MTAdam Admin · Phone call',
    );
    expect(rows[2]).toHaveTextContent('1USD 725.00/MTFirm · No. 1 CW21–84.5 MT');
    expect(rows[2]).toHaveTextContent('Superseded');
  });

  it('records new terms on the revision on screen and keeps the earlier ones', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(BID),
      [`POST ${PATH}/revisions`]: () => Response.json(BID, { status: 201 }),
    });
    render(<QuotePage session={SESSION} id={QUOTE_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record new terms' }));
    const form = screen.getByRole('region', { name: 'New terms (revision 3)' });
    const price = within(form).getByLabelText(/^Price/);
    expect(price).toHaveValue('730.50');
    await userEvent.clear(price);
    await userEvent.type(price, '741.25');
    await userEvent.click(within(form).getByRole('button', { name: 'Save new terms' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
        basedOnRevision: 2,
        values: {
          price: '741.25',
          currency: 'USD',
          firmness: 'indicative',
          quantityMax: '84.500',
          validUntil: '2099-10-30T22:00:00.000Z',
          quotedAt: '',
          sourceType: 'phone',
        },
      });
    });
    expect(
      await screen.findByText('New terms saved. The earlier terms are kept below.'),
    ).toBeInTheDocument();
  });

  it('checks the terms before sending them', async () => {
    const calls = mockApi({ [`GET ${PATH}`]: () => Response.json(BID) });
    render(<QuotePage session={SESSION} id={QUOTE_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record new terms' }));
    const price = screen.getByLabelText(/^Price/);
    await userEvent.clear(price);
    await userEvent.type(price, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save new terms' }));
    expect(await screen.findByText('Price must be more than zero.')).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('offers the latest terms when someone recorded newer ones meanwhile', async () => {
    mockApi({
      [`GET ${PATH}`]: () => Response.json(BID),
      [`POST ${PATH}/revisions`]: () =>
        Response.json(
          {
            error: { code: 'QUOTE_CHANGED', message: 'Someone recorded new terms.' },
            currentRevision: 3,
          },
          { status: 409 },
        ),
    });
    render(<QuotePage session={SESSION} id={QUOTE_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record new terms' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save new terms' }));
    expect(await screen.findByText('Someone recorded new terms.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load the latest terms' }));
    expect(await screen.findByRole('region', { name: 'Current terms' })).toBeInTheDocument();
  });

  it('withdraws after a confirmation', async () => {
    let withdrawn = false;
    const calls = mockApi({
      [`GET ${PATH}`]: () =>
        Response.json(
          withdrawn
            ? {
                ...BID,
                status: 'withdrawn',
                withdrawnAt: '2026-10-28T17:00:00.000Z',
                withdrawnByName: 'Adam Admin',
              }
            : BID,
        ),
      [`POST ${PATH}/withdraw`]: () => {
        withdrawn = true;
        return Response.json(BID);
      },
    });
    render(<QuotePage session={SESSION} id={QUOTE_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const confirm = screen.getByRole('group', { name: 'Withdraw this quote' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    expect(
      await screen.findByText(/on Wed 28 Oct 2026, 11:00 am MT by Adam Admin/),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Record new terms' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Last terms' })).toBeInTheDocument();
  });

  it('says when a quote expired, and offers no changes to viewers', async () => {
    mockApi({
      [`GET ${PATH}`]: () =>
        Response.json({
          ...BID,
          status: 'expired',
          current: { ...REVISION_1, validUntil: '2026-10-28T15:00:00.000Z' },
        }),
    });
    render(
      <QuotePage
        session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }}
        id={QUOTE_ID}
      />,
    );
    expect(
      await screen.findByText(/at Wed 28 Oct 2026, 9:00 am MT\. It is not live/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record new terms' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('says when the quote does not exist', async () => {
    mockApi({});
    render(<QuotePage session={SESSION} id={QUOTE_ID} />);
    expect(await screen.findByText('This bid or offer does not exist.')).toBeInTheDocument();
  });
});
