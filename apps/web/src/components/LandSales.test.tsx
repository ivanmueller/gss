import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { LandSaleParcel } from '../lib/landSalesMap';
import {
  QuarterBars,
  saleFiltered,
  saleFromZoom,
  saleHectares,
  saleMoney,
  saleSince,
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

  it('draws from far out only when narrowed to a play’s rights and a period', () => {
    expect(saleFromZoom('duvernay', '2024-11-21')).toBe(6);
    expect(saleFromZoom(null, '2024-11-21')).toBe(9);
    expect(saleFromZoom('duvernay', null)).toBe(9);
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
