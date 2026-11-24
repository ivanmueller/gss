import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LandSaleParcel } from '../lib/landSalesMap';
import {
  QuarterBars,
  saleFiltered,
  saleDay,
  saleFromZoom,
  saleHectares,
  saleMoney,
  saleNextDay,
  saleRangeTitle,
  saleRangeYear,
  saleSince,
  saleWindow,
  saleYear,
} from './LandSales';

// Crown land sales on the oil and gas map (F-242). Made-up parcels, buyers and prices only.

const parcel = (id: string, extra: Partial<LandSaleParcel> = {}): LandSaleParcel => ({
  id,
  saleDate: '2026-11-04',
  contractNo: 'A0001',
  contractType: 'LEASE',
  region: 'PLAINS',
  hectares: '256.0000',
  zone: null,
  land: '51806024',
  inexact: false,
  status: 'ACCEPTED',
  bonus: '56888.32',
  dollarsPerHectare: '222.22',
  buyers: 'EXAMPLE LAND LTD. 100%',
  shape: [],
  ...extra,
});

describe('saleSince and saleFromZoom', () => {
  it('starts a period that many years before today, or nowhere', () => {
    expect(saleSince('2', '2026-11-21')).toBe('2024-11-21');
    expect(saleSince('1', '2026-11-21')).toBe('2025-11-21');
    expect(saleSince('all', '2026-11-21')).toBeNull();
  });

  it('holds a play’s parcels at every zoom, and asks by view close in without one (F-263)', () => {
    expect(saleFromZoom('duvernay')).toBe(0);
    expect(saleFromZoom(null)).toBe(9);
  });
});

describe('saleFiltered', () => {
  const list = [
    parcel('1'),
    parcel('2', { status: 'NO OFFERS', buyers: null }),
    parcel('3', { status: null, buyers: null, saleDate: '2026-12-02' }),
    parcel('4', { buyers: 'SAMPLE RESOURCES INC. 100%' }),
  ];
  const ids = (buyer: string, ...states: ('sold' | 'no_offers' | 'upcoming')[]) =>
    saleFiltered(list, { buyer, states: new Set(states), today: '2026-11-01' }).map((p) => p.id);

  it('keeps the statuses switched on', () => {
    expect(ids('', 'sold', 'no_offers', 'upcoming')).toEqual(['1', '2', '3', '4']);
    expect(ids('', 'sold')).toEqual(['1', '4']);
    expect(ids('', 'upcoming', 'no_offers')).toEqual(['2', '3']);
    expect(ids('')).toEqual([]);
  });

  it('keeps the buyers whose name holds the text typed', () => {
    expect(ids(' sample ', 'sold', 'no_offers', 'upcoming')).toEqual(['4']);
    // Whatever the case or punctuation, as the Operator box fills it (F-302 part 3).
    expect(ids('Sample Resources Inc', 'sold', 'no_offers', 'upcoming')).toEqual(['4']);
  });

  it('keeps the sales of the period, when every year is held (F-263)', () => {
    const all = new Set(['sold', 'no_offers', 'upcoming'] as const);
    const kept = (since: string | null) =>
      saleFiltered(list, { buyer: '', states: all, today: '2026-11-01', since }).map((p) => p.id);
    expect(kept('2026-11-05')).toEqual(['3']);
    expect(kept('2026-11-04')).toEqual(['1', '2', '3', '4']);
    expect(kept(null)).toEqual(['1', '2', '3', '4']);
  });

  it('keeps one sale alone: from its day to the day after (F-267)', () => {
    const all = new Set(['sold', 'no_offers', 'upcoming'] as const);
    const one = (date: string) =>
      saleFiltered(list, {
        buyer: '',
        states: all,
        today: '2026-11-01',
        since: date,
        until: saleNextDay(date),
      }).map((p) => p.id);
    expect(one('2026-12-02')).toEqual(['3']);
    expect(one('2026-11-04')).toEqual(['1', '2', '4']);
    expect(one('2026-11-05')).toEqual([]);
  });
});

describe('a year or dates chosen (F-303)', () => {
  const all = new Set(['sold', 'no_offers', 'upcoming'] as const);
  const list = [
    parcel('a', { saleDate: '2022-12-31' }),
    parcel('b', { saleDate: '2023-01-01' }),
    parcel('c', { saleDate: '2023-12-31' }),
    parcel('d', { saleDate: '2024-01-01' }),
  ];
  const kept = (when: Parameters<typeof saleWindow>[0]) =>
    saleFiltered(list, {
      buyer: '',
      states: all,
      today: '2026-11-01',
      ...saleWindow(when, '2026-11-01'),
    }).map((p) => p.id);

  it('keeps a whole year, its first and last days included', () => {
    expect(kept(saleYear(2023))).toEqual(['b', 'c']);
  });

  it('keeps the dates chosen, both included, either side open', () => {
    expect(kept({ from: '2022-12-31', to: '2023-01-01' })).toEqual(['a', 'b']);
    expect(kept({ from: '2023-12-31', to: null })).toEqual(['c', 'd']);
    expect(kept({ from: null, to: '2022-12-31' })).toEqual(['a']);
  });

  it('still reads a period and one sale as before', () => {
    expect(saleWindow('2', '2026-11-01')).toEqual({ since: '2024-11-01', until: null });
    expect(saleWindow({ sale: '2026-11-04' }, '2026-11-01')).toEqual({
      since: '2026-11-04',
      until: '2026-11-05',
    });
  });

  it('names a year as a year, and dates as dates', () => {
    expect(saleRangeYear(saleYear(2023))).toBe(2023);
    expect(saleRangeYear({ from: '2023-01-01', to: '2023-12-30' })).toBeNull();
    expect(saleRangeTitle(saleYear(2023))).toBe('2023');
    expect(saleRangeTitle({ from: '2023-03-01', to: '2024-06-30' })).toBe(
      'Mar 1, 2023 to Jun 30, 2024',
    );
    expect(saleRangeTitle({ from: '2023-03-01', to: null })).toBe('from Mar 1, 2023');
    expect(saleRangeTitle({ from: null, to: '2024-06-30' })).toBe('up to Jun 30, 2024');
  });
});

describe('saleMoney and saleHectares', () => {
  it('shortens money for reading', () => {
    expect(saleMoney('366012345.67')).toBe('$366.0M');
    expect(saleMoney('1250000000')).toBe('$1.25B');
    expect(saleMoney('56888.32')).toBe('$56.9K');
    expect(saleMoney('569.10')).toBe('$569');
    expect(saleMoney(null)).toBe('—');
  });

  it('shortens hectares for reading', () => {
    expect(saleHectares('643210.5')).toBe('643K ha');
    expect(saleHectares('256.0000')).toBe('256 ha');
    expect(saleHectares(null)).toBe('—');
  });
});

describe('QuarterBars', () => {
  it('draws a bar a quarter and names the years and the highest quarter', () => {
    const { container } = render(
      <QuarterBars
        since="2026-01-01"
        quarters={[
          { quarter: '2025-Q4', bonus: '1000000.00', sold: 3 },
          { quarter: '2026-Q2', bonus: '2500000.00', sold: 5 },
        ]}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: 'Bonus paid by quarter, 2025 to 2026; the highest quarter $2.5M',
      }),
    ).toBeInTheDocument();
    const bars = [...container.querySelectorAll('rect')];
    expect(bars).toHaveLength(2);
    // The quarter before the period is lighter than the one in it.
    expect(bars.map((bar) => bar.getAttribute('fill'))).toEqual(['#bcd5f4', '#2c68bd']);
    expect(bars[1]?.querySelector('title')?.textContent).toBe('2026-Q2: $2.5M, 5 sold');
  });
});

describe('saleNextDay and saleDay', () => {
  it('gives the day after, over a month and a year', () => {
    expect(saleNextDay('2026-11-18')).toBe('2026-11-19');
    expect(saleNextDay('2026-11-30')).toBe('2026-12-01');
    expect(saleNextDay('2026-12-31')).toBe('2027-01-01');
  });

  it('writes a sale date for reading', () => {
    expect(saleDay('2026-12-02')).toBe('Dec 2');
    expect(saleDay('2026-11-18', true)).toBe('Nov 18, 2026');
  });
});
