import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      'BidFlaxseedNo. 1 CWSynthetic BuyerSynthetic Mill, Synthetic Town, MNUSD 730.50/MTUp to 84.5 MTDeliveredSynthetic Town, MN2026-11-01 to 2026-11-302026-10-28 14:00 UTC2099-10-30 22:00 UTCIndicative',
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
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Canola' })).toBeInTheDocument();
    });
    await userEvent.selectOptions(screen.getByRole('combobox'), 'canola');
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
});
