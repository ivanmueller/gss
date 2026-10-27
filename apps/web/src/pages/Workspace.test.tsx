import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FacilityMapProps } from '../components/FacilityMap';
import { setThemePreference } from '../lib/theme';
import { Workspace } from './Workspace';

// Mapbox GL JS needs WebGL and Mapbox's servers; a stand-in reports the same props and events.
vi.mock('../components/FacilityMap', () => ({
  default: (props: FacilityMapProps) => (
    <div>
      <p>{`Stand-in map: ${props.basemap}, ${props.theme}, controls ${String(props.controls)}`}</p>
      <p>{`Covered on the right: ${String(props.coveredRight ?? 0)} px`}</p>
      <ul aria-label="Pins">
        {props.pins.map((pin) => (
          <li key={pin.id}>
            {`${pin.id} ${pin.tone}${pin.hollow ? ' hollow' : ''}${pin.id === props.selectedId ? ' selected' : ''}`}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => {
          props.onSelect('fac-demo-buyer-g');
        }}
      >
        Click Demo Buyer G’s pin
      </button>
      <button type="button" onClick={props.onTokenRefused}>
        Refuse the token
      </button>
    </div>
  ),
}));

const MAPBOX = { status: 'ok', token: 'pk.synthetic' } as const;

/** A window this many pixels wide, for the page's `(min-width: …px)` queries. */
function setWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: width >= Number(/min-width: (\d+)px/.exec(query)?.[1] ?? Infinity),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  // Quotes are live or expired against the time the page opens; fix it.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T12:00:00Z'));
  // A desktop: the order book sits over the map's right side.
  setWidth(1440);
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'matchMedia');
  setThemePreference('system');
  window.localStorage.clear();
});

/** Renders the workspace and waits for the (lazily loaded) map. */
async function renderReady() {
  const result = render(<Workspace mapbox={MAPBOX} />);
  await screen.findByText(/^Stand-in map:/);
  return result;
}

const book = () => screen.getByRole('complementary', { name: 'Order book' });
const table = () => screen.getByRole('table');
const pins = () => within(screen.getByRole('list', { name: 'Pins' })).getAllByRole('listitem');
/** The prices shown, e.g. "CAD 805.00/MT". */
const PRICE = /^[A-Z]{3} \d+\.\d{2}\/MT$/;

/** The order book's section for one commodity (its <details>). */
function section(title: string): HTMLElement {
  const summary = within(book()).getByText(title).closest('details');
  if (!summary) throw new Error(`no section ${title}`);
  return summary;
}

async function chooseOnly(commodity: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /^Commodities:/ }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'All commodities' }));
  await user.click(screen.getByRole('menuitemcheckbox', { name: commodity }));
  await user.keyboard('{Escape}');
}

describe('Workspace', () => {
  it('labels the demo as synthetic and shows every commodity by default', async () => {
    await renderReady();

    expect(screen.getByRole('note')).toHaveTextContent('Synthetic demo data');
    expect(within(book()).getByText('Synthetic')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Commodities: All/ })).toBeInTheDocument();
    for (const title of [
      'Flaxseed · No. 1 CW',
      'Canola · No. 1 Canada',
      'Yellow peas · No. 2 CAN',
      'Durum wheat · No. 1 CWAD',
    ]) {
      expect(within(book()).getByText(title)).toBeInTheDocument();
    }
    expect(within(table()).getAllByRole('row')).toHaveLength(10); // header + 9 facilities
    expect(pins()).toHaveLength(9);
  });

  it('puts the real map in the middle, themed, with its controls away from the order book', async () => {
    await renderReady();
    expect(screen.getByText('Stand-in map: map, light, controls top-left')).toBeInTheDocument();

    act(() => {
      setThemePreference('dark');
    });
    expect(screen.getByText('Stand-in map: map, dark, controls top-left')).toBeInTheDocument();
  });

  it('colours pins by side and leaves approximate locations hollow', async () => {
    await renderReady();
    const text = pins().map((pin) => pin.textContent);
    expect(text).toContain('fac-demo-seller-a offer hollow');
    expect(text).toContain('fac-demo-buyer-c bid');
  });

  it('puts asks on the left and bids on the right, best first, all in CAD', async () => {
    await renderReady();
    const flax = section('Flaxseed · No. 1 CW');

    // The golden fixture's USD 725.00 bid at 1.360000 is CAD 986.00, the best bid.
    const spread = within(flax).getByRole('group', { name: 'Spread' });
    expect(spread).toHaveTextContent('Gross spread CAD +181.00/MT');
    expect(within(spread).getByText('Indicative')).toBeInTheDocument();

    const ladder = within(flax).getByRole('list', { name: 'Asks and bids' });
    const [first, second] = within(ladder).getAllByRole('listitem');
    if (!first || !second) throw new Error('expected two levels');
    const [bestAsk, bestBid] = within(first).getAllByRole('button');
    if (!bestAsk || !bestBid) throw new Error('expected an ask and a bid on the first level');
    expect(bestAsk).toHaveAccessibleName(/^Ask:\s*Demo Seller F.*CAD 805\.00\/MT/);
    expect(bestBid).toHaveAccessibleName(/^Bid:\s*Demo Buyer C.*CAD 986\.00\/MT/);
    expect(
      within(second)
        .getAllByRole('button')
        .map((cell) => cell.textContent),
    ).toEqual([
      expect.stringMatching(/^Ask:\s*Demo Seller A.*CAD 820\.00\/MT/),
      expect.stringMatching(/^Bid:\s*Demo Buyer G.*CAD 790\.00\/MT/),
    ]);

    // The converted bid says so, with the original price and rate on hover.
    expect(within(bestBid).getByText('FX')).toHaveAttribute(
      'title',
      'Converted from USD 725.00/MT at 1.360000 CAD per USD, synthetic rate (golden fixture)',
    );
    expect(book()).toHaveTextContent(
      'In CAD. USD quotes converted at 1.360000 CAD per USD, synthetic rate (golden fixture).',
    );
    // Every price in the book is in CAD.
    const prices = within(book()).getAllByText(PRICE);
    expect(prices.length).toBeGreaterThan(10);
    expect(prices.filter((price) => !price.textContent.startsWith('CAD '))).toEqual([]);
  });

  it('pairs every commodity in CAD, so no side shows an empty "no offer" box', async () => {
    await renderReady();
    expect(within(section('Canola · No. 1 Canada')).getByText('CAD +22.00/MT')).toBeInTheDocument();
    // Durum: a CAD ask and a USD bid, comparable once the bid is in CAD (USD 300.00 × 1.36).
    const durum = section('Durum wheat · No. 1 CWAD');
    expect(within(durum).getByRole('group', { name: 'Spread' })).toHaveTextContent(
      'Gross spread CAD +53.00/MT',
    );
    expect(within(durum).getByRole('button', { name: /^Bid:\s*Demo Buyer H/ })).toHaveTextContent(
      'CAD 408.00/MT',
    );
    expect(within(book()).queryByText(/^No (offer|ask|bid)$/)).not.toBeInTheDocument();
    expect(within(book()).queryByText(/No spread/)).not.toBeInTheDocument();

    // Peas: one ask and two bids; the second level's ask side is simply empty.
    const peas = section('Yellow peas · No. 2 CAN');
    const [, second] = within(
      within(peas).getByRole('list', { name: 'Asks and bids' }),
    ).getAllByRole('listitem');
    if (!second) throw new Error('expected a second level');
    expect(within(second).getAllByRole('button')).toHaveLength(1);
    expect(second).toHaveTextContent(/^Bid:\s*Demo Buyer I/);
  });

  it('keeps an expired bid out of the book and says so', async () => {
    await renderReady();
    const peas = section('Yellow peas · No. 2 CAN');
    const ladder = within(peas).getByRole('list', { name: 'Asks and bids' });
    expect(ladder).not.toHaveTextContent('CAD 430.00/MT');
    const notInBook = within(peas).getByText('Not in the book').parentElement;
    expect(notInBook).toHaveTextContent('Demo Buyer I');
    expect(notInBook).toHaveTextContent('CAD 430.00/MT');
    expect(notInBook).toHaveTextContent('Expired');
  });

  it('keeps times out of the book, and shows them with the original price on selection', async () => {
    const user = userEvent.setup();
    await renderReady();
    for (const ladder of within(book()).getAllByRole('list', { name: 'Asks and bids' })) {
      expect(ladder).not.toHaveTextContent(/Quoted|valid until/);
    }

    await user.click(within(book()).getByRole('button', { name: /^Bid:\s*Demo Buyer C/ }));
    const selected = within(book()).getByRole('region', { name: 'Demo Buyer C' });
    const bid = within(selected).getByRole('region', { name: 'Buyer bid' });
    expect(within(bid).getByText(PRICE)).toHaveTextContent('CAD 986.00/MT');
    expect(bid).toHaveTextContent(
      'Quoted as USD 725.00/MT at 1.360000 CAD per USD, synthetic rate (golden fixture)',
    );
    expect(bid).toHaveTextContent('Quoted 2026-10-26 16:30 UTC · valid until 2026-11-09 23:59 UTC');

    // The table shows CAD too, with the times.
    const row = within(table()).getByRole('button', { name: 'Demo Buyer H' }).closest('tr');
    expect(row).toHaveTextContent('CAD 408.00/MT');
    expect(row).toHaveTextContent('CAD 448.80/MT');
    expect(row).toHaveTextContent(/Quoted .* UTC · valid until .* UTC/);
  });

  it('tucks the order book away to the right with the arrow tab, and brings it back', async () => {
    const user = userEvent.setup();
    await renderReady();
    expect(screen.getByText('Covered on the right: 432 px')).toBeInTheDocument();

    const hide = screen.getByRole('button', { name: 'Hide order book' });
    expect(hide).toHaveAttribute('aria-expanded', 'true');
    expect(hide).toHaveAttribute('aria-controls', 'order-book');
    expect(book()).toHaveAttribute('id', 'order-book');
    await user.click(hide);

    const show = screen.getByRole('button', { name: 'Show order book' });
    expect(show).toHaveAttribute('aria-expanded', 'false');
    // Out of reach of the keyboard and screen readers while tucked away.
    expect(book()).toHaveAttribute('inert');
    expect(screen.getByText('Covered on the right: 0 px')).toBeInTheDocument();

    await user.click(show);
    expect(book()).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Hide order book' })).toBeInTheDocument();
  });

  it('stacks the order book under the map on a narrower desktop, without the tab', async () => {
    setWidth(1100);
    await renderReady();
    expect(book()).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /order book$/ })).not.toBeInTheDocument();
    expect(screen.getByText('Covered on the right: 0 px')).toBeInTheDocument();
    expect(table()).toBeInTheDocument();
  });

  it('narrows the map, order book and table to the chosen commodities', async () => {
    await renderReady();
    await chooseOnly('Canola');

    expect(screen.getByRole('button', { name: 'Commodities: Canola' })).toBeInTheDocument();
    expect(within(book()).getByText('Canola · No. 1 Canada')).toBeInTheDocument();
    expect(within(book()).queryByText(/Flaxseed/)).not.toBeInTheDocument();
    expect(pins().map((pin) => pin.textContent.split(' ')[0])).toEqual([
      'fac-demo-seller-a',
      'fac-demo-seller-e',
      'fac-demo-buyer-g',
    ]);
    expect(within(table()).getAllByRole('row')).toHaveLength(4);
    // Only canola quotes in the table, even for facilities that also trade flaxseed.
    expect(within(table()).queryByText('CAD 820.00/MT')).not.toBeInTheDocument();
  });

  it('chooses several commodities, and none', async () => {
    const user = userEvent.setup();
    await renderReady();
    await chooseOnly('Durum wheat');
    await user.click(screen.getByRole('button', { name: /^Commodities:/ }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Yellow peas' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'All commodities' })).toHaveAttribute(
      'aria-checked',
      'mixed',
    );
    await user.keyboard('{Escape}');
    expect(
      screen.getByRole('button', { name: 'Commodities: Yellow peas, Durum wheat' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Commodities:/ }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Yellow peas' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Durum wheat' }));
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Commodities: None' })).toBeInTheDocument();
    expect(within(book()).getByText(/Choose a commodity/)).toBeInTheDocument();
    expect(screen.getByText('No facilities match these filters.')).toBeInTheDocument();
  });

  it('selects a facility from the order book, the map or the table, in step', async () => {
    const user = userEvent.setup();
    await renderReady();

    await user.click(screen.getByRole('button', { name: 'Click Demo Buyer G’s pin' }));
    const selected = within(book()).getByRole('region', { name: 'Demo Buyer G' });
    expect(within(selected).getAllByRole('region', { name: 'Buyer bid' })).toHaveLength(2);
    expect(pins().map((pin) => pin.textContent)).toContain('fac-demo-buyer-g bid selected');
    expect(within(table()).getByRole('button', { name: 'Demo Buyer G' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // From the order book: Demo Seller F's flaxseed offer.
    const flax = section('Flaxseed · No. 1 CW');
    const [sellerF] = within(flax).getAllByRole('button', { name: /Demo Seller F/ });
    if (!sellerF) throw new Error('no offer from Demo Seller F');
    await user.click(sellerF);
    expect(within(book()).getByRole('region', { name: 'Demo Seller F' })).toBeInTheDocument();
    expect(within(flax).getAllByRole('button', { name: /Demo Seller F/ })[0]).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(book()).getByRole('button', { name: 'Clear selection' }));
    expect(within(book()).queryByRole('region', { name: 'Demo Seller F' })).not.toBeInTheDocument();
  });

  it('shows a known facility without a quote as not pairable', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(within(table()).getByRole('button', { name: 'Demo Buyer D' }));
    const selected = within(book()).getByRole('region', { name: 'Demo Buyer D' });
    expect(within(selected).getByText('No active bid')).toBeInTheDocument();
    expect(within(selected).getByText(/cannot be paired/)).toBeInTheDocument();
  });

  it('filters the map and table by side, and drops a selection the filter hides', async () => {
    const user = userEvent.setup();
    await renderReady();
    await user.click(within(table()).getByRole('button', { name: 'Demo Seller A' }));

    const buyers = screen.getByRole('button', { name: 'Buyers' });
    await user.click(buyers);
    expect(buyers).toHaveAttribute('aria-pressed', 'true');
    expect(pins().every((pin) => pin.textContent.includes(' bid'))).toBe(true);
    expect(within(table()).queryByText('Demo Seller A')).not.toBeInTheDocument();
    expect(within(book()).queryByRole('region', { name: 'Demo Seller A' })).not.toBeInTheDocument();
    // The order book still shows both sides of each commodity.
    expect(within(book()).getAllByText('Demo Seller F').length).toBeGreaterThan(0);
  });

  it('says why there is no map without a token, or when Mapbox refuses it', async () => {
    const { unmount } = render(<Workspace mapbox={{ status: 'missing' }} />);
    expect(screen.getByText('Map not available')).toBeInTheDocument();
    expect(screen.getByText(/needs a Mapbox public token/)).toBeInTheDocument();
    // The rest of the workspace still works.
    expect(book()).toBeInTheDocument();
    unmount();

    await renderReady();
    await userEvent.click(screen.getByRole('button', { name: 'Refuse the token' }));
    expect(screen.getByText(/Mapbox refused the token/)).toBeInTheDocument();
  });

  it('moves quotes out of the book once they pass their valid-until time', async () => {
    vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
    await renderReady();
    const flax = section('Flaxseed · No. 1 CW');
    const notInBook = within(flax).getByText('Not in the book').parentElement;
    expect(notInBook).toHaveTextContent('Demo Seller A');
    expect(notInBook).toHaveTextContent('Demo Buyer C');
    expect(within(flax).getByRole('list', { name: 'Asks and bids' })).not.toHaveTextContent(
      'Demo Buyer C',
    );
  });

  it('re-checks quotes every minute while the page stays open', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-09T23:58:30Z'));
    render(<Workspace mapbox={{ status: 'missing' }} />);
    const ladder = () =>
      within(section('Flaxseed · No. 1 CW')).getByRole('list', { name: 'Asks and bids' });
    expect(ladder()).toHaveTextContent('Demo Buyer C');

    // Demo Buyer C's bid is valid until 23:59; a minute later it has left the book.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(ladder()).not.toHaveTextContent('Demo Buyer C');
    const flax = () => section('Flaxseed · No. 1 CW');
    expect(within(flax()).getByText('Not in the book').parentElement).toHaveTextContent(
      'Demo Buyer C',
    );
  });

  it('uses tabs for the map, order book and facilities on narrow screens', async () => {
    setWidth(400);
    const user = userEvent.setup();
    await renderReady();

    expect(screen.getByRole('tablist', { name: 'Workspace view' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Click Demo Buyer G’s pin' }));
    // The selection shows under the map, where the user is looking.
    expect(screen.getByRole('region', { name: 'Demo Buyer G' })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Order book' }));
    expect(book()).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Facilities' }));
    const list = within(screen.getByRole('region', { name: 'Facilities' })).getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(9);
  });
});
