import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { choose } from '../test/select';
import { mockApi, ORG, SESSION } from '../test/api';
import { BID, OFFER } from '../test/quotes';
import { QuotesPage } from './QuotesPage';

const LIVE = `GET /quotes?organization_id=${ORG.id}`;
const COMMODITIES = {
  'GET /commodities': () =>
    Response.json({
      commodities: [
        { code: 'canola', name: 'Canola' },
        { code: 'flaxseed', name: 'Flaxseed' },
      ],
    }),
};

beforeEach(() => {
  window.history.replaceState(null, '', '/quotes');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('QuotesPage', () => {
  it('lists live bids and offers with side, price, quantity, basis and times', async () => {
    mockApi({
      [LIVE]: () => Response.json({ quotes: [BID, OFFER], truncated: false }),
      ...COMMODITIES,
    });
    render(<QuotesPage session={SESSION} />);
    const table = await screen.findByRole('table', { name: 'Bids and offers' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent(
      'BidFlaxseedNo. 1 CWSynthetic BuyerSynthetic Mill, Synthetic Town, MNUSD 730.50/MTUp to 84.5 MTDeliveredSynthetic Town, MN2026-11-01 to 2026-11-30Wed 28 Oct 2026, 8:00 am MTFri 30 Oct 2099, 4:00 pm MTIndicative',
    );
    expect(rows[2]).toHaveTextContent('OfferCanolaSynthetic SellerCAD 15.25/bu21–84.5 MT');
    expect(within(table).getByRole('link', { name: 'Flaxseed' })).toHaveAttribute(
      'href',
      `/quotes/${BID.id}`,
    );
    expect(within(table).getByRole('link', { name: 'Synthetic Buyer' })).toHaveAttribute(
      'href',
      `/counterparties/${BID.counterparty.id}`,
    );
    expect(screen.getByText('2 live bids and offers')).toBeInTheDocument();
  });

  it('asks the API for one side, one commodity, or withdrawn and expired too', async () => {
    const calls = mockApi({
      [LIVE]: () => Response.json({ quotes: [], truncated: false }),
      [`${LIVE}&side=offer`]: () => Response.json({ quotes: [OFFER], truncated: false }),
      [`${LIVE}&side=offer&commodity=canola`]: () =>
        Response.json({ quotes: [OFFER], truncated: false }),
      [`${LIVE}&side=offer&commodity=canola&status=all`]: () =>
        Response.json({ quotes: [OFFER], truncated: false }),
      ...COMMODITIES,
    });
    render(<QuotesPage session={SESSION} />);
    expect(await screen.findByText('No live bids or offers here.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Offers' }));
    await screen.findByRole('table', { name: 'Bids and offers' });
    await choose(screen.getByRole('combobox', { name: 'Commodity' }), 'Canola');
    await userEvent.click(screen.getByLabelText('Include withdrawn and expired'));
    await waitFor(() => {
      expect(calls.map((call) => call.path)).toContain(
        `/quotes?organization_id=${ORG.id}&side=offer&commodity=canola&status=all`,
      );
    });
    expect(window.location.search).toBe('?side=offer&commodity=canola&status=all');
  });

  it('offers a new bid or offer to traders and admins only', async () => {
    mockApi({ [LIVE]: () => Response.json({ quotes: [], truncated: false }), ...COMMODITIES });
    const { unmount } = render(<QuotesPage session={SESSION} />);
    expect(await screen.findByRole('link', { name: 'New bid or offer' })).toHaveAttribute(
      'href',
      '/quotes/new',
    );
    unmount();
    render(<QuotesPage session={{ ...SESSION, organization: { ...ORG, role: 'operations' } }} />);
    expect(await screen.findByText('Traders and admins enter them.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New bid or offer' })).toBeNull();
  });

  it("shows Claude's open drafts of bids and offers above the list, under the same filters", async () => {
    const draft = (id: string, side: 'bid' | 'offer', commodity: string) => ({
      id,
      kind: 'quote',
      fields: { side, commodity, values: { price: '725.00' }, checks: {} },
      lines: [0],
      contactId: null,
      counterpartyId: BID.counterparty.id,
      counterpartyName: 'Synthetic Buyer',
      callId: '00000000-0000-4000-8000-0000000ca111',
      calledAt: '2026-11-05T15:00:00.000Z',
      callerId: '00000000-0000-4000-8000-0000000044aa',
      callerName: 'Tess Trader',
      contactName: 'Pat Buyer',
      sourceLines: [],
    });
    mockApi({
      [LIVE]: () => Response.json({ quotes: [], truncated: false }),
      [`${LIVE}&side=offer`]: () => Response.json({ quotes: [], truncated: false }),
      [`GET /calls/drafts?organization_id=${ORG.id}&kind=quote`]: () =>
        Response.json({
          drafts: [
            draft('00000000-0000-4000-8000-0000000dd001', 'bid', 'flaxseed'),
            draft('00000000-0000-4000-8000-0000000dd002', 'offer', 'canola'),
          ],
        }),
      ...COMMODITIES,
    });
    render(<QuotesPage session={SESSION} />);
    const drafts = await screen.findByRole('region', { name: 'Claude’s drafts to verify (2)' });
    expect(within(drafts).getAllByRole('link', { name: 'Synthetic Buyer' })).toHaveLength(2);
    // Drafts are not live bids or offers: the list itself stays empty.
    expect(screen.getByText('No live bids or offers here.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Offers' }));
    expect(
      await screen.findByRole('region', { name: 'Claude’s drafts to verify (1)' }),
    ).toHaveTextContent('Offer · Canola');
  });
});
