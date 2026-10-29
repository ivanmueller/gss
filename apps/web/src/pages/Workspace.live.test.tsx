import type { QuoteSummary } from '@grain/domain';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FacilityMapProps } from '../components/FacilityMap';
import { setDemoData } from '../lib/demo';
import { mockApi, ORG, SESSION } from '../test/api';
import { BID } from '../test/quotes';
import { Workspace } from './Workspace';

// The workspace on GSS's real bids and offers (demo data off). Synthetic records only; no
// market prices.

vi.mock('../components/FacilityMap', () => ({
  default: (props: FacilityMapProps) => (
    <ul aria-label="Pins">
      {props.pins.map((pin) => (
        <li key={pin.id}>{`${pin.id} ${pin.tone}${pin.hollow ? ' hollow' : ''}`}</li>
      ))}
    </ul>
  ),
}));

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;
const LIVE = `GET /quotes?organization_id=${ORG.id}`;
const NO_RATES = { 'GET /fx-quotes': () => Response.json({ rates: [] }) };

function bankRate(rate: string, rateDate: string) {
  return {
    'GET /fx-quotes': () =>
      Response.json({
        rates: [
          {
            base: 'USD',
            quote: 'CAD',
            rate,
            rateDate,
            source: 'bank_of_canada',
            series: 'FXUSDCAD',
            fetchedAt: `${rateDate}T22:15:03.000Z`,
          },
        ],
      }),
  };
}

const COMMODITIES = {
  'GET /commodities': () =>
    Response.json({
      commodities: [
        { code: 'canola', name: 'Canola' },
        { code: 'flaxseed', name: 'Flaxseed' },
      ],
    }),
};

function quote(
  id: string,
  side: 'bid' | 'offer',
  counterparty: string,
  terms: Partial<QuoteSummary['current']>,
  extra: Partial<QuoteSummary> = {},
): QuoteSummary {
  return {
    ...BID,
    id,
    side,
    status: 'firm',
    counterparty: { id: `cp-${id}`, legalName: counterparty, tradingName: null, archived: false },
    facility: null,
    current: { ...BID.current, firmness: 'firm', grade: 'No. 1 CW', ...terms },
    ...extra,
  };
}

const SELLER = quote(
  'q-offer',
  'offer',
  'Synthetic Seller',
  { price: '820.00', currency: 'CAD', quantityMinMt: null, quantityMaxMt: '42.000' },
  {
    facility: {
      id: 'f-seller',
      name: null,
      city: 'Synthetic City',
      region: 'SK',
      country: 'CA',
      latitude: '52.133214',
      longitude: '-106.670046',
      locationPrecision: 'exact',
    },
  },
);
const CAD_BUYER = quote('q-bid', 'bid', 'Synthetic Buyer', {
  price: '905.50',
  currency: 'CAD',
  basisLocation: 'Synthetic Port, BC',
});
const USD_BUYER = quote(
  'q-usd',
  'bid',
  'Synthetic US Buyer',
  { price: '725.00', currency: 'USD' },
  { facility: BID.facility },
);
const BUSHEL = quote(
  'q-bu',
  'offer',
  'Synthetic Bushel Seller',
  { price: '15.25', currency: 'CAD', priceUnit: 'BU', grade: null },
  { commodity: { code: 'canola', name: 'Canola' } },
);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  setDemoData(false);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const book = () => screen.getByRole('complementary', { name: 'Order book' });
const pins = () =>
  within(screen.getByRole('list', { name: 'Pins' }))
    .queryAllByRole('listitem')
    .map((item) => item.textContent);

describe('Workspace on live bids and offers', () => {
  it('puts CAD prices per tonne in the book, and says why USD and per-bushel ones are not', async () => {
    mockApi({
      [LIVE]: () =>
        Response.json({ quotes: [SELLER, CAD_BUYER, USD_BUYER, BUSHEL], truncated: false }),
      ...COMMODITIES,
      ...NO_RATES,
    });
    render(<Workspace mapbox={MAPBOX} session={SESSION} />);

    const flax = await within(book()).findByText('Flaxseed');
    const section = flax.closest('details');
    if (!section) throw new Error('no flaxseed section');
    const ladder = within(section).getByRole('list', { name: 'Asks and bids' });
    expect(
      within(ladder).getByRole('button', { name: /^Ask: Synthetic Seller, CAD 820\.00\/MT/ }),
    ).toHaveTextContent('SK · Delivered820.00/MT≤42 MT');
    expect(
      within(ladder).getByRole('button', { name: /^Bid: Synthetic Buyer, CAD 905\.50\/MT/ }),
    ).toHaveTextContent('Synthetic Port, BC · Delivered');
    expect(section).toHaveTextContent('Spread+85.50');
    // Without a Bank of Canada rate, a USD bid is never converted at a made-up one.
    await waitFor(() => {
      expect(section).toHaveTextContent(
        'USD quotes are left out of the book: there is no Bank of Canada CAD/USD rate yet.',
      );
    });
    expect(within(ladder).queryByText(/Synthetic US Buyer/)).toBeNull();

    const canola = within(book()).getByText('Canola').closest('details');
    expect(canola).toHaveTextContent('Prices per bushel, short ton or hundredweight are left out');

    // Pins only where a location has coordinates; approximate ones hollow.
    expect(pins()).toEqual(['f-seller offer', '00000000-0000-4000-8000-000000000f01 bid hollow']);
    // The table still lists every one, the USD price as quoted.
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('Synthetic US Buyer');
    expect(table).toHaveTextContent('USD 725.00/MTno CAD/USD rate');
    expect(screen.getByRole('button', { name: 'Commodities: All' })).toBeInTheDocument();
  });

  it("converts USD prices at the Bank of Canada's latest rate and names it", async () => {
    mockApi({
      [LIVE]: () => Response.json({ quotes: [SELLER, CAD_BUYER, USD_BUYER], truncated: false }),
      ...COMMODITIES,
      // Monday's rate, read on Tuesday 27 October.
      ...bankRate('1.3912', '2026-10-26'),
    });
    render(<Workspace mapbox={MAPBOX} session={SESSION} />);

    // USD 725.00 × 1.3912 = CAD 1,008.62 exactly: the best bid now, ahead of CAD 905.50.
    const usd = await within(book()).findByRole('button', {
      name: /^Bid: Synthetic US Buyer, CAD 1008\.62\/MT, converted from USD 725\.00\/MT at 1\.3912 CAD per USD, Bank of Canada, 26 Oct 2026/,
    });
    const section = usd.closest('details');
    if (!section) throw new Error('no flaxseed section');
    expect(
      within(section)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')?.split(',')[0]),
    ).toEqual(['Ask: Synthetic Seller', 'Bid: Synthetic US Buyer', 'Bid: Synthetic Buyer']);
    expect(section).toHaveTextContent('Spread+188.62');
    expect(section).not.toHaveTextContent('left out of the book');
    expect(book()).toHaveTextContent(
      'Converted from USD at 1.3912 CAD per USD, Bank of Canada, 26 Oct 2026',
    );
    expect(screen.getByRole('table')).toHaveTextContent(
      'CAD 1008.62/MTFX: converted from USD 725.00/MT at 1.3912 CAD per USD, Bank of Canada, 26 Oct 2026',
    );
  });

  it('leaves USD prices out when the latest rate is more than four days old', async () => {
    mockApi({
      [LIVE]: () => Response.json({ quotes: [SELLER, USD_BUYER], truncated: false }),
      ...COMMODITIES,
      // Thursday 22 October's rate on Tuesday 27 October (08:00 in Ottawa): five days old.
      ...bankRate('1.3912', '2026-10-22'),
    });
    render(<Workspace mapbox={MAPBOX} session={SESSION} />);

    expect(
      await within(book()).findByText(
        /USD quotes are left out of the book: the latest CAD\/USD rate \(Bank of Canada, 22 Oct 2026\) is out of date\./,
      ),
    ).toBeInTheDocument();
    expect(within(book()).queryByRole('button', { name: /Synthetic US Buyer/ })).toBeNull();
    expect(screen.getByRole('table')).toHaveTextContent('USD 725.00/MTCAD/USD rate out of date');
  });

  it('picks up new bids and offers when the page is shown again', async () => {
    let quotes: QuoteSummary[] = [SELLER];
    const calls = mockApi({
      [LIVE]: () => Response.json({ quotes, truncated: false }),
      ...COMMODITIES,
    });
    render(<Workspace mapbox={MAPBOX} session={SESSION} />);
    expect(await within(book()).findByText('No bid yet')).toBeInTheDocument();

    quotes = [SELLER, CAD_BUYER];
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(within(book()).getByText('+85.50')).toBeInTheDocument();
    });
    expect(calls.filter((call) => call.path.startsWith('/quotes'))).toHaveLength(2);
  });

  it('says when there are no bids or offers, and asks nothing of the API with demo data on', async () => {
    const calls = mockApi({
      [LIVE]: () => Response.json({ quotes: [], truncated: false }),
      ...COMMODITIES,
    });
    const { unmount } = render(<Workspace mapbox={MAPBOX} session={SESSION} />);
    expect(await within(book()).findByText('No asks or bids yet.')).toBeInTheDocument();
    expect(book()).toHaveTextContent('Enter them under Bids & offers.');
    unmount();

    calls.length = 0;
    setDemoData(true);
    render(<Workspace mapbox={MAPBOX} session={SESSION} />);
    expect(within(book()).getAllByRole('list', { name: 'Asks and bids' })).toHaveLength(4);
    expect(calls.filter((call) => call.path.startsWith('/quotes'))).toEqual([]);
  });

  it('says when the bids and offers could not be loaded', async () => {
    mockApi({
      [LIVE]: () =>
        Response.json(
          { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' } },
          { status: 503 },
        ),
      ...COMMODITIES,
    });
    render(<Workspace mapbox={MAPBOX} session={SESSION} />);
    expect(
      await within(book()).findByText(
        /Could not load bids and offers: The database is unavailable\./,
      ),
    ).toBeInTheDocument();
  });
});
