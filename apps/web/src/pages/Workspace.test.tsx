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

function setWide(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: wide && query === '(min-width: 1024px)',
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
  setWide(true);
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

  it('shows the flaxseed spread in CAD, negative and indicative, and blocks CAD against USD', async () => {
    await renderReady();
    const flax = section('Flaxseed · No. 1 CW');

    const spreads = within(flax).getByRole('group', { name: 'Spreads' });
    expect(within(spreads).getByText('CAD \u221215.00/MT')).toBeInTheDocument();
    expect(within(spreads).getByText('Indicative')).toBeInTheDocument();
    expect(within(spreads).getByText('No spread: no USD offer')).toBeInTheDocument();
    expect(within(flax).getByText(/needs a CAD\/USD rate/)).toBeInTheDocument();

    // Best first: the cheaper CAD offer leads; the USD bid sits in its own ladder.
    const cad = within(flax).getByRole('list', { name: 'CAD bids and offers' });
    const [first, second] = within(cad).getAllByRole('listitem');
    expect(first).toHaveTextContent('Demo Seller F');
    expect(first).toHaveTextContent('Demo Buyer G');
    expect(second).toHaveTextContent('Demo Seller A');
    expect(second).toHaveTextContent('No bid');
    expect(within(flax).getByRole('list', { name: 'USD bids and offers' })).toHaveTextContent(
      'Demo Buyer C',
    );
  });

  it('shows a positive canola spread and no spread for durum across currencies', async () => {
    await renderReady();
    const canola = section('Canola · No. 1 Canada');
    expect(within(canola).getByText('CAD +22.00/MT')).toBeInTheDocument();
    expect(within(canola).queryByText(/needs a CAD\/USD rate/)).not.toBeInTheDocument();

    const durum = section('Durum wheat · No. 1 CWAD');
    expect(within(durum).getByText('No spread: no CAD bid')).toBeInTheDocument();
    expect(within(durum).getByText('No spread: no USD offer')).toBeInTheDocument();
    expect(within(durum).queryByText(/Gross spread/)).not.toBeInTheDocument();
  });

  it('keeps an expired bid out of the book and says so', async () => {
    await renderReady();
    const peas = section('Yellow peas · No. 2 CAN');
    const cad = within(peas).getByRole('list', { name: 'CAD bids and offers' });
    expect(cad).not.toHaveTextContent('CAD 430.00/MT');
    const notInBook = within(peas).getByText('Not in the book').parentElement;
    expect(notInBook).toHaveTextContent('Demo Buyer I');
    expect(notInBook).toHaveTextContent('CAD 430.00/MT');
    expect(notInBook).toHaveTextContent('Expired');
  });

  it('shows quoted and valid-until times next to every price', async () => {
    await renderReady();
    const prices = within(book()).getAllByText(/^[A-Z]{3} \d+\.\d{2}\/MT$/);
    for (const price of prices) {
      expect(price.parentElement).toHaveTextContent(/Quoted .* UTC · valid until .* UTC/);
    }
    expect(prices.length).toBeGreaterThan(10);
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
    expect(within(flax).queryByRole('list', { name: 'USD bids and offers' })).toBeNull();
  });

  it('re-checks quotes every minute while the page stays open', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-11-09T23:58:30Z'));
    render(<Workspace mapbox={{ status: 'missing' }} />);
    const flax = () => section('Flaxseed · No. 1 CW');
    expect(within(flax()).getByRole('list', { name: 'USD bids and offers' })).toBeInTheDocument();

    // Demo Buyer C's bid is valid until 23:59; a minute later it has left the book.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(within(flax()).queryByRole('list', { name: 'USD bids and offers' })).toBeNull();
    expect(within(flax()).getByText('Not in the book').parentElement).toHaveTextContent(
      'Demo Buyer C',
    );
  });

  it('uses tabs for the map, order book and facilities on narrow screens', async () => {
    setWide(false);
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
