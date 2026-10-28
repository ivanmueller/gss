import { describe, expect, it } from 'vitest';

import { SYNTHETIC_COMMODITIES, SYNTHETIC_FACILITIES, SYNTHETIC_FX } from '../data/synthetic';
import type { Facility, FxRate, Quote } from '../data/types';
import {
  buildOrderBooks,
  isLive,
  type BookQuote,
  type CommodityBook,
  type OutOfBook,
} from './orderBook';

const NOW = new Date('2026-10-27T12:00:00Z');

function book(commodity: string, fx: FxRate | null = SYNTHETIC_FX, now = NOW): CommodityBook {
  const [found] = buildOrderBooks(SYNTHETIC_FACILITIES, [commodity], fx, now);
  if (!found) throw new Error(`no book for ${commodity}`);
  return found;
}

/** "Demo Seller F 805.00" for each quote, best first, in CAD. */
function ladder(entries: BookQuote[]): string[] {
  return entries.map(({ facility, cadDisplay }) => `${facility.name} ${cadDisplay}`);
}

function left(entries: OutOfBook[]): string[] {
  return entries.map(({ facility, reason, cadDisplay }) =>
    [facility.name, reason, cadDisplay ?? 'no CAD price'].join(' '),
  );
}

/** One facility with one quote, for cases the synthetic data does not cover. */
function facilityWith(name: string, quote: Partial<Quote> & Pick<Quote, 'side' | 'price'>) {
  const base = SYNTHETIC_FACILITIES[0];
  const template = base?.quotes[0];
  if (!base || !template) throw new Error('fixture changed');
  return {
    ...base,
    id: name,
    name,
    quotes: [{ ...template, status: 'firm', id: `q-${name}`, ...quote }],
  } satisfies Facility;
}

describe('order book', () => {
  it('leaves prices not per tonne out of the per-tonne book, never comparing units', () => {
    const books = buildOrderBooks(
      [
        facilityWith('Per bushel', {
          side: 'OFFER',
          price: { amount: '15.25', currency: 'CAD', unit: 'BU' },
        }),
        facilityWith('Per short ton', {
          side: 'BID',
          price: { amount: '700.00', currency: 'USD', unit: 'ST' },
        }),
        facilityWith('Per tonne', {
          side: 'BID',
          price: { amount: '850.00', currency: 'CAD', unit: 'MT' },
        }),
      ],
      ['Flaxseed'],
      null,
      NOW,
    );
    const [flax] = books;
    expect(ladder(flax?.bids ?? [])).toEqual(['Per tonne 850.00']);
    expect(flax?.asks).toEqual([]);
    expect(left(flax?.outOfBook ?? [])).toEqual([
      'Per bushel UNIT_NOT_MT 15.25',
      'Per short ton UNIT_NOT_MT no CAD price',
    ]);
    expect(flax?.spread).toEqual({ status: 'missing', side: 'ask' });
  });

  it('puts the golden fixture USD bid in CAD at 1.36, beside the CAD asks', () => {
    const flax = book('Flaxseed');
    expect(flax.grade).toBe('No. 1 CW');
    expect(ladder(flax.asks)).toEqual(['Demo Seller F 805.00', 'Demo Seller A 820.00']);
    // docs/TRADING_RULES.md §5.4: USD 725.00 × 1.360000 = CAD 986.00.
    expect(ladder(flax.bids)).toEqual(['Demo Buyer C 986.00', 'Demo Buyer G 790.00']);
    const [converted, local] = flax.bids;
    expect(converted?.cad).toBe('986.00000000');
    expect(converted?.fx).toEqual(SYNTHETIC_FX);
    expect(converted?.quote.price).toEqual({ amount: '725.00', currency: 'USD', unit: 'MT' });
    expect(local?.fx).toBeNull();
    // Best bid CAD 986.00 minus best ask CAD 805.00, indicative because the best bid is.
    expect(flax.spread).toEqual({ status: 'ok', amount: '181.00', currency: 'CAD', unit: 'MT' });
    expect(flax.indicative).toBe(true);
    expect(flax.outOfBook).toEqual([]);
  });

  it('computes a firm canola spread exactly, as quoted', () => {
    const canola = book('Canola');
    expect(ladder(canola.asks)).toEqual(['Demo Seller A 690.00', 'Demo Seller E 702.50']);
    expect(ladder(canola.bids)).toEqual(['Demo Buyer G 712.00']);
    expect(canola.spread).toEqual({ status: 'ok', amount: '22.00', currency: 'CAD', unit: 'MT' });
    expect(canola.indicative).toBe(false);
  });

  it('ranks a converted bid among CAD bids, and lists expired quotes apart', () => {
    const peas = book('Yellow peas');
    expect(ladder(peas.asks)).toEqual(['Demo Seller E 395.00']);
    // USD 330.00 × 1.36 = CAD 448.80, above the CAD 420.00 bid.
    expect(ladder(peas.bids)).toEqual(['Demo Buyer H 448.80', 'Demo Buyer I 420.00']);
    expect(peas.spread).toEqual({ status: 'ok', amount: '53.80', currency: 'CAD', unit: 'MT' });
    expect(left(peas.outOfBook)).toEqual(['Demo Buyer I NOT_LIVE 430.00']);
  });

  it('pairs a USD durum bid with a CAD ask once converted', () => {
    const durum = book('Durum wheat');
    expect(ladder(durum.asks)).toEqual(['Demo Seller F 355.00']);
    expect(ladder(durum.bids)).toEqual(['Demo Buyer H 408.00']);
    expect(durum.spread).toEqual({ status: 'ok', amount: '53.00', currency: 'CAD', unit: 'MT' });
  });

  it('without a rate, lists USD quotes apart instead of pricing them, never at zero', () => {
    const flax = book('Flaxseed', null);
    expect(ladder(flax.bids)).toEqual(['Demo Buyer G 790.00']);
    expect(left(flax.outOfBook)).toEqual(['Demo Buyer C FX_MISSING no CAD price']);
    // Only CAD quotes left: a negative spread, shown plainly.
    expect(flax.spread).toEqual({ status: 'ok', amount: '-15.00', currency: 'CAD', unit: 'MT' });

    const durum = book('Durum wheat', null);
    expect(durum.bids).toEqual([]);
    expect(durum.spread).toEqual({ status: 'missing', side: 'bid' });
    expect(left(durum.outOfBook)).toEqual(['Demo Buyer H FX_MISSING no CAD price']);
  });

  it('sorts and spreads on exact CAD amounts, rounding only for display', () => {
    const fx = { cadPerUsd: '1.3612', source: 'test rate' };
    const usdBid = facilityWith('USD bid', {
      side: 'BID',
      price: { amount: '725.13', currency: 'USD', unit: 'MT' },
    });
    const cadBid = facilityWith('CAD bid', {
      side: 'BID',
      price: { amount: '987.05', currency: 'CAD', unit: 'MT' },
    });
    const ask = facilityWith('Ask', {
      side: 'OFFER',
      price: { amount: '805.00', currency: 'CAD', unit: 'MT' },
    });
    const [flax] = buildOrderBooks([usdBid, cadBid, ask], ['Flaxseed'], fx, NOW);
    // 725.13 × 1.3612 = 987.046956: shown as 987.05, but below the CAD 987.05 bid.
    expect(flax?.bids.map((entry) => [entry.facility.name, entry.cad, entry.cadDisplay])).toEqual([
      ['CAD bid', '987.05', '987.05'],
      ['USD bid', '987.046956', '987.05'],
    ]);
    // The best bid here is in CAD, so the spread is exact as quoted.
    expect(flax?.spread).toMatchObject({ amount: '182.05' });

    const [onlyUsd] = buildOrderBooks([usdBid, ask], ['Flaxseed'], fx, NOW);
    // 987.046956 − 805.00 = 182.046956, rounded once: 182.05.
    expect(onlyUsd?.spread).toEqual({
      status: 'ok',
      amount: '182.05',
      currency: 'CAD',
      unit: 'MT',
    });
  });

  it('builds the book from converted prices with many decimal places, or negative ones', () => {
    // USD 725.0000000 × 1.360000 = CAD 986.0000000000000, equal to a CAD 986.00 bid.
    const precise = facilityWith('Precise', {
      side: 'BID',
      price: { amount: '725.0000000', currency: 'USD', unit: 'MT' },
      quotedAt: '2026-10-20T00:00:00Z',
    });
    const cadBid = facilityWith('CAD bid', {
      side: 'BID',
      price: { amount: '986.00', currency: 'CAD', unit: 'MT' },
    });
    // A basis quote: USD −12.50 × 1.360000 = CAD −17.00.
    const basis = facilityWith('Basis', {
      side: 'OFFER',
      price: { amount: '-12.50', currency: 'USD', unit: 'MT' },
    });
    const [flax] = buildOrderBooks([cadBid, precise, basis], ['Flaxseed'], SYNTHETIC_FX, NOW);
    // Equal in CAD, so the earlier quote leads.
    expect(flax?.bids.map((entry) => [entry.facility.name, entry.cad, entry.cadDisplay])).toEqual([
      ['Precise', '986.0000000000000', '986.00'],
      ['CAD bid', '986.00', '986.00'],
    ]);
    expect(flax?.asks.map((entry) => [entry.cad, entry.cadDisplay])).toEqual([
      ['-17.00000000', '-17.00'],
    ]);
    // 986.0000000000000 − (−17.00000000), rounded once.
    expect(flax?.spread).toEqual({ status: 'ok', amount: '1003.00', currency: 'CAD', unit: 'MT' });
  });

  it('drops quotes once their valid-until time has passed', () => {
    const flax = book('Flaxseed', SYNTHETIC_FX, new Date('2026-11-10T00:00:00Z'));
    expect(ladder(flax.asks)).toEqual(['Demo Seller F 805.00']);
    expect(ladder(flax.bids)).toEqual(['Demo Buyer G 790.00']);
    expect(left(flax.outOfBook)).toEqual([
      'Demo Seller A NOT_LIVE 820.00',
      'Demo Buyer C NOT_LIVE 986.00',
    ]);
  });

  it('builds books only for the chosen commodities, in the order given', () => {
    const commodities = (chosen: string[]) =>
      buildOrderBooks(SYNTHETIC_FACILITIES, chosen, SYNTHETIC_FX, NOW).map((b) => b.commodity);
    expect(commodities(['Durum wheat', 'Canola'])).toEqual(['Durum wheat', 'Canola']);
    expect(commodities([])).toEqual([]);
    expect(commodities([...SYNTHETIC_COMMODITIES])).toEqual([...SYNTHETIC_COMMODITIES]);
  });

  it('keeps an empty book for a commodity nobody quotes', () => {
    expect(buildOrderBooks(SYNTHETIC_FACILITIES, ['Oats'], SYNTHETIC_FX, NOW)).toEqual([
      {
        commodity: 'Oats',
        grade: '',
        asks: [],
        bids: [],
        spread: { status: 'missing', side: 'ask' },
        indicative: false,
        outOfBook: [],
      },
    ]);
  });

  it('ranks equal prices by time quoted', () => {
    const price = { amount: '820.00', currency: 'CAD', unit: 'MT' } as const;
    const late = facilityWith('Late', { side: 'OFFER', price });
    const early = facilityWith('Early', {
      side: 'OFFER',
      price,
      quotedAt: '2026-10-20T00:00:00Z',
    });
    const [flax] = buildOrderBooks([late, early], ['Flaxseed'], SYNTHETIC_FX, NOW);
    expect(ladder(flax?.asks ?? [])).toEqual(['Early 820.00', 'Late 820.00']);
  });

  it('treats only firm and indicative quotes before valid-until as live', () => {
    const offer = SYNTHETIC_FACILITIES[0]?.quotes[0];
    if (!offer) throw new Error('fixture changed');
    expect(isLive(offer, NOW)).toBe(true);
    expect(isLive({ ...offer, status: 'withdrawn' }, NOW)).toBe(false);
    expect(isLive({ ...offer, status: 'superseded' }, NOW)).toBe(false);
    expect(isLive(offer, new Date(offer.validUntil))).toBe(false);
  });
});
