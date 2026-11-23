import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import { monthsBetween, periodStart, pricePath, usePrices, type PricesAnswer } from './Prices';

// The Prices section (F-285 part 2): Alberta's royalty prices, one small chart a series, a product
// at a time. Made-up prices only.

const ORG = '00000000-0000-4000-8000-000000000001';
const GAS = 'https://www.alberta.ca/alberta-natural-gas-reference-price';
const LETTER = 'https://inform.energy.gov.ab.ca/Documents/Published/IL-2030-43.pdf';

const ANSWER: PricesAnswer = {
  load: {
    loadedAt: '2031-02-01T15:30:00.000Z',
    prices: 6,
    firstMonth: '2030-10',
    lastMonth: '2031-01',
    unread: 0,
  },
  sources: [GAS, LETTER],
  series: [
    {
      key: 'gas_reference',
      name: 'Gas reference price',
      unit: '$/GJ',
      points: [
        ['2030-10', '1.1100', 0],
        // November not published.
        ['2030-12', '3.3300', 0],
        ['2031-01', '4.4400', 0],
      ],
    },
    {
      key: 'oil_light_par',
      name: 'Light oil par price',
      unit: '$/m3',
      points: [
        ['2030-12', '0.0000', 1],
        ['2031-01', '111.1100', 1],
      ],
    },
  ],
};

function Harness() {
  const prices = usePrices(ORG, 'token');
  return (
    <div>
      {prices.section({ open: true, onToggle: () => undefined })}
      {prices.about()}
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the months of a period', () => {
  it('counts every month, across a year', () => {
    expect(monthsBetween('2030-11', '2031-02')).toEqual([
      '2030-11',
      '2030-12',
      '2031-01',
      '2031-02',
    ]);
    expect(monthsBetween('2031-02', '2031-01')).toEqual([]);
  });

  it('starts a period of years the month after the same month that many years before', () => {
    expect(periodStart('2031-01', 5)).toBe('2026-02');
    expect(periodStart('2030-12', 1)).toBe('2030-01');
    expect(periodStart('2031-01', null)).toBeNull();
  });

  it('breaks the line where a month has no price', () => {
    const path = pricePath([1, null, 3, 4], 0, 4);
    expect(path.match(/M/g)).toHaveLength(2);
    // A price of nothing is drawn on the baseline, not left out.
    expect(pricePath([0, 2], 0, 2)).toBe('M0 39L260 2');
  });
});

describe('usePrices', () => {
  it('is off at first and asks for nothing until switched on', async () => {
    const calls = mockApi({
      [`GET /petroleum/prices?organization_id=${ORG}`]: () => Response.json(ANSWER),
    });
    render(<Harness />);
    const toggle = screen.getByRole('switch', { name: 'Prices' });
    expect(toggle).not.toBeChecked();
    expect(calls.some((c) => c.path.startsWith('/petroleum/prices'))).toBe(false);

    await userEvent.click(toggle);
    const gas = await screen.findByRole('img', { name: /^Gas reference price/ });
    // The months the province did not publish are said, and the latest price is shown as written.
    expect(gas.getAttribute('aria-label')).toMatch(/1 months not published/);
    expect(screen.getByText('$4.4400')).toBeInTheDocument();
    expect(
      screen.getByText(/Source: Government of Alberta; not the official version/),
    ).toBeInTheDocument();
    expect(calls.filter((c) => c.path.startsWith('/petroleum/prices'))).toHaveLength(1);

    // Another product: its own charts; a product with nothing published says so.
    await userEvent.click(screen.getByRole('button', { name: 'Oil' }));
    expect(screen.getByRole('img', { name: /^Light oil par price/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Gas reference price/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sulphur' }));
    expect(screen.getByText('No prices published for this product.')).toBeInTheDocument();

    // The table of the latest months, a month with no price as a dash.
    await userEvent.click(screen.getByRole('button', { name: 'Gas' }));
    await userEvent.click(screen.getByText('The last 12 months as a table'));
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'MonthGas reference',
      'Jan 20314.4400',
      'Dec 20303.3300',
      'Nov 2030–',
      'Oct 20301.1100',
    ]);
  });

  it('says when the prices are not loaded yet, or the database is being updated', async () => {
    mockApi({
      [`GET /petroleum/prices?organization_id=${ORG}`]: () =>
        Response.json({ load: null, sources: [], series: [] }),
    });
    render(<Harness />);
    await userEvent.click(screen.getByRole('switch', { name: 'Prices' }));
    expect(
      await screen.findByText('Not loaded yet: an admin runs Load prices (GitHub → Actions).'),
    ).toBeInTheDocument();
  });
});
