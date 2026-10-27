import { describe, expect, it } from 'vitest';

import { SYNTHETIC_COMMODITIES, SYNTHETIC_FACILITIES } from '../data/synthetic';
import type { Facility, Quote } from '../data/types';
import { buildOrderBooks, isLive, largestQuantity, type CommodityBook } from './orderBook';

const NOW = new Date('2026-10-27T12:00:00Z');

function book(commodity: string, now = NOW): CommodityBook {
  const [found] = buildOrderBooks(SYNTHETIC_FACILITIES, [commodity], now);
  if (!found) throw new Error(`no book for ${commodity}`);
  return found;
}

/** "Demo Seller F 805.00" for each quote, best first. */
function ladder(entries: { facility: Facility; quote: Quote }[]): string[] {
  return entries.map(({ facility, quote }) => `${facility.name} ${quote.price.amount}`);
}

describe('order book', () => {
  it('compares flaxseed only within a currency, and blocks CAD against USD', () => {
    const flax = book('Flaxseed');
    expect(flax.grade).toBe('No. 1 CW');
    const [cad, usd] = flax.currencies;

    expect(cad?.currency).toBe('CAD');
    expect(ladder(cad?.offers ?? [])).toEqual(['Demo Seller F 805.00', 'Demo Seller A 820.00']);
    expect(ladder(cad?.bids ?? [])).toEqual(['Demo Buyer G 790.00']);
    // A negative spread is shown plainly, and is indicative because the best bid is.
    expect(cad?.spread).toEqual({ status: 'ok', amount: '-15.00', currency: 'CAD', unit: 'MT' });
    expect(cad?.indicative).toBe(true);

    // The golden fixture's USD bid has no USD offer to compare with: no spread, never zero.
    expect(usd?.currency).toBe('USD');
    expect(ladder(usd?.bids ?? [])).toEqual(['Demo Buyer C 725.00']);
    expect(usd?.spread).toEqual({ status: 'missing', side: 'offer' });
    expect(flax.needsFx).toBe(true);
  });

  it('computes a firm canola spread exactly', () => {
    const [cad] = book('Canola').currencies;
    expect(ladder(cad?.offers ?? [])).toEqual(['Demo Seller A 690.00', 'Demo Seller E 702.50']);
    expect(cad?.spread).toEqual({ status: 'ok', amount: '22.00', currency: 'CAD', unit: 'MT' });
    expect(cad?.indicative).toBe(false);
    expect(book('Canola').needsFx).toBe(false);
  });

  it('leaves expired quotes out of the book and lists them separately', () => {
    const peas = book('Yellow peas');
    const [cad] = peas.currencies;
    expect(ladder(cad?.bids ?? [])).toEqual(['Demo Buyer I 420.00']);
    expect(cad?.spread).toEqual({ status: 'ok', amount: '25.00', currency: 'CAD', unit: 'MT' });
    expect(ladder(peas.stale)).toEqual(['Demo Buyer I 430.00']);
  });

  it('has no spread for durum when the offer and bid are in different currencies', () => {
    const durum = book('Durum wheat');
    expect(durum.currencies.map((c) => [c.currency, c.spread])).toEqual([
      ['CAD', { status: 'missing', side: 'bid' }],
      ['USD', { status: 'missing', side: 'offer' }],
    ]);
    expect(durum.needsFx).toBe(true);
  });

  it('drops quotes once their valid-until time has passed', () => {
    const later = new Date('2026-11-10T00:00:00Z');
    const flax = book('Flaxseed', later);
    expect(flax.currencies.map((c) => c.currency)).toEqual(['CAD']);
    expect(ladder(flax.currencies[0]?.offers ?? [])).toEqual(['Demo Seller F 805.00']);
    expect(ladder(flax.stale)).toEqual(['Demo Seller A 820.00', 'Demo Buyer C 725.00']);
  });

  it('builds books only for the chosen commodities, in the order given', () => {
    expect(
      buildOrderBooks(SYNTHETIC_FACILITIES, ['Durum wheat', 'Canola'], NOW).map((b) => b.commodity),
    ).toEqual(['Durum wheat', 'Canola']);
    expect(buildOrderBooks(SYNTHETIC_FACILITIES, [], NOW)).toEqual([]);
    expect(
      buildOrderBooks(SYNTHETIC_FACILITIES, [...SYNTHETIC_COMMODITIES], NOW).map(
        (b) => b.commodity,
      ),
    ).toEqual([...SYNTHETIC_COMMODITIES]);
  });

  it('keeps an empty book for a commodity nobody quotes', () => {
    expect(buildOrderBooks(SYNTHETIC_FACILITIES, ['Oats'], NOW)).toEqual([
      { commodity: 'Oats', grade: '', currencies: [], needsFx: false, stale: [] },
    ]);
  });

  it('ranks equal prices by time quoted', () => {
    const base = SYNTHETIC_FACILITIES[0];
    const offer = base?.quotes[0];
    if (!base || !offer) throw new Error('fixture changed');
    const late = { ...base, id: 'late', name: 'Late', quotes: [{ ...offer, id: 'q-late' }] };
    const early = {
      ...base,
      id: 'early',
      name: 'Early',
      quotes: [{ ...offer, id: 'q-early', quotedAt: '2026-10-20T00:00:00Z' }],
    };
    const [flax] = buildOrderBooks([late, early], ['Flaxseed'], NOW);
    expect(ladder(flax?.currencies[0]?.offers ?? [])).toEqual(['Early 820.00', 'Late 820.00']);
  });

  it('treats only firm and indicative quotes before valid-until as live', () => {
    const offer = SYNTHETIC_FACILITIES[0]?.quotes[0];
    if (!offer) throw new Error('fixture changed');
    expect(isLive(offer, NOW)).toBe(true);
    expect(isLive({ ...offer, status: 'withdrawn' }, NOW)).toBe(false);
    expect(isLive({ ...offer, status: 'superseded' }, NOW)).toBe(false);
    expect(isLive(offer, new Date(offer.validUntil))).toBe(false);
  });

  it('finds the largest quantity for the bars', () => {
    expect(largestQuantity([book('Flaxseed')])).toBe('84.000');
    expect(largestQuantity([])).toBeNull();
  });
});
