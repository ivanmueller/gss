import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartyDetail } from '../lib/api';
import { mockApi } from '../test/api';
import {
  commodityChange,
  CounterpartyCommodities,
  shownDirections,
} from './CounterpartyCommodities';

// Synthetic values only.
const ID = '00000000-0000-4000-8000-00000000c001';
type Detail = Pick<CounterpartyDetail, 'id' | 'types' | 'archivedAt' | 'commodities'>;
const BUYER: Detail = {
  id: ID,
  types: ['buyer'],
  archivedAt: null,
  commodities: [
    { code: 'canola', name: 'Canola', direction: 'buys' },
    { code: 'yellow_peas', name: 'Yellow peas', direction: 'buys' },
  ],
};

function show(detail: Detail, onSaved = vi.fn()) {
  render(<CounterpartyCommodities token="synthetic-token" detail={detail} onSaved={onSaved} />);
  return onSaved;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CounterpartyCommodities', () => {
  it('lists what a buyer buys', () => {
    show(BUYER);
    const card = screen.getByRole('region', { name: 'What they buy' });
    expect(
      within(card)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Canola', 'Yellow peas']);
  });

  it('shows both lists for a buyer and seller, and says when one is empty', () => {
    show({ ...BUYER, types: ['buyer', 'seller'] });
    const card = screen.getByRole('region', { name: 'Commodities' });
    expect(within(card).getByRole('list', { name: 'What they buy' })).toHaveTextContent(
      'CanolaYellow peas',
    );
    expect(within(card).getByRole('heading', { name: 'What they sell' })).toBeInTheDocument();
    expect(within(card).getByText('None listed yet.')).toBeInTheDocument();
  });

  it('sends only what changed, and reports the save', async () => {
    const calls = mockApi({
      [`PATCH /counterparties/${ID}/commodities`]: () => Response.json({}),
    });
    const onSaved = show(BUYER);
    await userEvent.click(screen.getByRole('button', { name: 'Edit what they buy' }));
    const form = screen.getByRole('form', { name: 'Edit what they buy' });
    // The 20 commodities, the listed ones ticked.
    expect(within(form).getAllByRole('checkbox')).toHaveLength(20);
    expect(within(form).getByRole('checkbox', { name: 'Canola' })).toBeChecked();
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Canola' }));
    await userEvent.click(within(form).getByRole('checkbox', { name: 'Durum wheat' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save commodities' }));
    expect(onSaved).toHaveBeenCalledWith('Commodities saved.');
    expect(calls.map((call) => call.body)).toEqual([
      {
        add: [{ commodity: 'durum_wheat', direction: 'buys' }],
        remove: [{ commodity: 'canola', direction: 'buys' }],
      },
    ]);
  });

  it('names each box by its way for a buyer and seller', async () => {
    show({ ...BUYER, types: ['buyer', 'seller'] });
    await userEvent.click(screen.getByRole('button', { name: 'Edit commodities' }));
    expect(screen.getByRole('checkbox', { name: 'Buys Canola' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sells Canola' })).not.toBeChecked();
  });

  it('sends nothing when nothing changed, and shows why a save failed', async () => {
    const calls = mockApi({
      [`PATCH /counterparties/${ID}/commodities`]: () =>
        Response.json(
          {
            error: {
              code: 'ARCHIVED',
              message: 'This counterparty is archived. Restore it before changing it.',
            },
          },
          { status: 409 },
        ),
    });
    show(BUYER);
    await userEvent.click(screen.getByRole('button', { name: 'Edit what they buy' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save commodities' }));
    expect(calls).toEqual([]);
    expect(screen.queryByRole('form')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Edit what they buy' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Oats' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save commodities' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('archived');
  });

  it('offers no change for an archived counterparty, and nothing for a carrier', () => {
    const { unmount } = render(
      <CounterpartyCommodities
        token="t"
        detail={{ ...BUYER, archivedAt: '2026-10-28T10:00:00.000Z' }}
        onSaved={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull();
    unmount();
    const { container } = render(
      <CounterpartyCommodities
        token="t"
        detail={{ ...BUYER, types: ['carrier'], commodities: [] }}
        onSaved={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('shownDirections', () => {
  it('follows the types, and keeps a list already there', () => {
    expect(shownDirections(['seller'], [])).toEqual(['sells']);
    expect(shownDirections(['seller'], [{ direction: 'buys' }])).toEqual(['buys', 'sells']);
  });
});

describe('commodityChange', () => {
  it('adds the newly ticked and removes the unticked', () => {
    expect(
      commodityChange(new Set(['buys:canola', 'sells:oats']), new Set(['buys:canola', 'buys:rye'])),
    ).toEqual({
      add: [{ commodity: 'rye', direction: 'buys' }],
      remove: [{ commodity: 'oats', direction: 'sells' }],
    });
  });
});
