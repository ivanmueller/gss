import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LandMapAgreement, LandShape } from '../lib/landMap';
import {
  LAND_FROM,
  LAND_FROM_RIGHTS,
  landAgreementName,
  LandCard,
  landCovers,
  landFiltered,
  landHolders,
  landReadable,
  landRequest,
  landTerm,
  landToday,
  landWanted,
} from './Land';

// Land held today on the oil and gas map (F-241). Made-up land only.

const square = (west: number, south: number): LandShape => [
  [
    [
      [west, south],
      [west + 0.1, south],
      [west + 0.1, south + 0.1],
      [west, south],
    ],
  ],
];
const SHAPE = square(-116.1, 54);
const agreement = (id: string, extra: Partial<LandMapAgreement> = {}): LandMapAgreement => ({
  id,
  rights: 'png',
  agreementType: '002',
  agreementNumber: '924',
  tract: '00',
  group: 'LEASE',
  status: 'ACTIVE',
  vintage: 'CONTINUED TERM',
  holder: 'EXAMPLE ENERGY LTD.',
  parties: 'EXAMPLE ENERGY LTD. 60% SAMPLE RESOURCES INC. 40%',
  zone: 'PNG TO BASE EXAMPLE',
  areaHa: 256,
  termDate: '2020-02-17',
  continuationDate: null,
  expiryText: 'INDEFINITE',
  shape: SHAPE,
  ...extra,
});

describe('landWanted', () => {
  const on = { agreements: true, offsets: true, freehold: true };
  it('asks only for what is switched on and close enough to draw', () => {
    expect(landWanted(on, LAND_FROM.offsets - 0.1)).toEqual([]);
    expect(landWanted(on, LAND_FROM.offsets)).toEqual(['offsets']);
    expect(landWanted(on, LAND_FROM.agreements)).toEqual(['agreements', 'offsets']);
    expect(landWanted(on, 12)).toEqual(['agreements', 'offsets', 'freehold']);
    expect(landWanted({ ...on, agreements: false }, 12)).toEqual(['offsets', 'freehold']);
  });

  it('draws agreements narrowed to a play’s rights from far out', () => {
    expect(landWanted(on, LAND_FROM_RIGHTS, 'duvernay')).toContain('agreements');
    expect(landWanted(on, LAND_FROM_RIGHTS)).not.toContain('agreements');
    expect(landWanted(on, LAND_FROM_RIGHTS - 0.1, 'duvernay')).toEqual([]);
  });
});

describe('landRequest and landCovers', () => {
  const view = { west: -117, south: 54, east: -116.4, north: 54.3 };
  it('asks for the view and a sixth again on each side, within Alberta', () => {
    const box = landRequest(view);
    expect(box?.west).toBeCloseTo(-117.1);
    expect(box?.east).toBeCloseTo(-116.3);
    expect(box?.south).toBeCloseTo(53.95);
    expect(box?.north).toBeCloseTo(54.35);
    expect(landRequest({ west: -80, south: 43, east: -79, north: 44 })).toBeNull();
  });

  const cut = <T,>(items: T[], truncated = false) => ({ truncated, items });
  const answer = {
    source: { name: 'x', loads: [] },
    agreements: cut([agreement('1')]),
    offsets: cut([]),
    freehold: cut([]),
  };
  const settled = {
    asked: { west: -117.1, south: 53.95, east: -116.3, north: 54.35 },
    kinds: ['agreements', 'offsets'] as const,
    rights: 'duvernay',
    answer,
  };

  it('needs nothing new while the view stays inside the box and asks for no other kind', () => {
    expect(landCovers(settled, view, ['agreements'], 'duvernay')).toBe(true);
    expect(landCovers(settled, { ...view, west: -117.3 }, ['agreements'], 'duvernay')).toBe(false);
    expect(landCovers(settled, view, ['agreements', 'freehold'], 'duvernay')).toBe(false);
  });

  it('asks again when the rights asked for change, but not for the other kinds', () => {
    expect(landCovers(settled, view, ['agreements'], null)).toBe(false);
    expect(landCovers(settled, view, ['offsets'], null)).toBe(true);
  });

  it('asks again after an answer that left land out, so zooming in shows all of it', () => {
    const full = { ...settled, answer: { ...answer, agreements: cut([agreement('1')], true) } };
    expect(landCovers(full, view, ['agreements'], 'duvernay')).toBe(false);
    expect(landCovers(full, view, ['offsets'], 'duvernay')).toBe(true);
  });
});

describe('landTerm and landFiltered', () => {
  const today = '2026-11-21';
  const list = [
    agreement('1', { vintage: 'PRIMARY', expiryText: '2027/01/28' }),
    agreement('2', { vintage: 'INTERMEDIATE TERM', expiryText: '2029/01/28' }),
    agreement('3', { vintage: 'CONTINUED TERM', holder: 'SAMPLE RESOURCES INC.' }),
    agreement('4', { vintage: null, holder: null }),
  ];
  const ids = (holder: string, ...terms: ('primary' | 'expiring' | 'continued')[]) =>
    landFiltered(list, { holder, terms: new Set(terms), today }).map((a) => a.id);

  it('reads a term from the province’s vintage', () => {
    expect(list.map((a) => landTerm(a))).toEqual(['primary', 'primary', 'continued', null]);
  });

  it('keeps everything with no filter, and the terms chosen otherwise', () => {
    expect(ids('')).toEqual(['1', '2', '3', '4']);
    expect(ids('', 'primary')).toEqual(['1', '2']);
    expect(ids('', 'expiring')).toEqual(['1']);
    expect(ids('', 'expiring', 'continued')).toEqual(['1', '3']);
  });

  it('keeps the holders whose name holds the text typed, whatever its case', () => {
    expect(ids(' sample ')).toEqual(['3']);
    expect(ids('energy', 'continued')).toEqual([]);
  });
});

describe('landHolders', () => {
  it('lists the holders touching the view, the one with the most land first', () => {
    const list = [
      agreement('1', { areaHa: 100 }),
      agreement('2', { areaHa: 50 }),
      agreement('3', { holder: 'SAMPLE RESOURCES INC.', areaHa: 400 }),
      agreement('4', { holder: 'FAR AWAY LTD.', areaHa: 900, shape: square(-112, 51) }),
      agreement('5', { holder: null }),
    ];
    const view = { west: -117, south: 53.5, east: -115.5, north: 54.5 };
    expect(landHolders(list, view)).toEqual([
      { holder: 'SAMPLE RESOURCES INC.', hectares: 400, tracts: 1 },
      { holder: 'EXAMPLE ENERGY LTD.', hectares: 150, tracts: 2 },
    ]);
    expect(landHolders(list, null)[0]?.holder).toBe('FAR AWAY LTD.');
  });
});

describe('names and dates', () => {
  it('names an agreement as the province numbers it', () => {
    expect(landAgreementName(agreement('1'))).toBe('Lease 002-924, tract 00');
    expect(landAgreementName(agreement('1', { group: 'LICENSE', tract: null }))).toBe(
      'Licence 002-924',
    );
    expect(landAgreementName(agreement('1', { group: 'OTHER' }))).toBe(
      'Agreement 002-924, tract 00',
    );
  });

  it('writes a holder’s name for reading', () => {
    expect(landReadable('EXAMPLE ENERGY LTD.')).toBe('Example Energy Ltd.');
    expect(landReadable("O'EXAMPLE OIL & GAS INC.")).toBe("O'example Oil & Gas Inc.");
  });

  it('takes today as Alberta’s date', () => {
    expect(landToday(new Date('2026-11-22T05:59:00Z'))).toBe('2026-11-21');
    expect(landToday(new Date('2026-11-22T06:00:00Z'))).toBe('2026-11-22');
  });
});

describe('LandCard', () => {
  const land = {
    agreements: new Map([['1', agreement('1')]]),
    offsets: new Map([
      [
        '3',
        {
          id: '3',
          offsetType: 'AAY',
          offsetNumber: '2050843E02',
          tract: '00',
          holder: 'EXAMPLE ENERGY LTD.',
          expiryDate: '2099-05-08',
          zone: 'PNG TO BASE EXAMPLE',
          shape: SHAPE,
        },
      ],
    ]),
    freehold: new Map([
      [
        '5',
        {
          id: '5',
          substances: 'ALL MINERALS EXCEPT GOLD,SILVER',
          nationalPark: null,
          reserveNumber: null,
          reserveName: null,
          shape: SHAPE,
        },
      ],
    ]),
  };

  it('writes out every piece of land under the click, with the source', () => {
    const onClose = vi.fn();
    render(
      <LandCard
        pick={{ keys: ['png:1', 'offset:3', 'freehold:5'], x: 100, y: 100 }}
        land={land}
        onClose={onClose}
      />,
    );
    expect(screen.getAllByText('Example Energy Ltd.')).toHaveLength(2);
    expect(screen.getByText('Lease 002-924, tract 00')).toBeInTheDocument();
    expect(
      screen.getByText('Petroleum and natural gas · ACTIVE · CONTINUED TERM · 256 ha'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Parties: EXAMPLE ENERGY LTD. 60% SAMPLE RESOURCES INC. 40%'),
    ).toBeInTheDocument();
    expect(screen.getByText('Term from 2020-02-17 · expiry: INDEFINITE')).toBeInTheDocument();
    expect(screen.queryByText('Expires within 12 months.')).not.toBeInTheDocument();
    expect(screen.getByText('Offset notice 2050843E02, tract 00')).toBeInTheDocument();
    expect(screen.getByText('Deadline 2099-05-08')).toBeInTheDocument();
    expect(screen.getByText('Freehold minerals (not the Crown’s)')).toBeInTheDocument();
    expect(
      screen.getByText(/Alberta Energy and Minerals, Government of Alberta/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows nothing for no click, or land no longer loaded', () => {
    const { container, rerender } = render(<LandCard pick={null} land={land} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LandCard pick={{ keys: ['png:99'], x: 1, y: 1 }} land={land} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('writes out six at most, and says how many more', () => {
    const many = new Map(
      Array.from({ length: 8 }, (_, i) => [
        String(i),
        agreement(String(i), { agreementNumber: String(100 + i) }),
      ]),
    );
    render(
      <LandCard
        pick={{ keys: [...many.keys()].map((id) => `png:${id}`), x: 1, y: 1 }}
        land={{ ...land, agreements: many }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/^Lease 002-/)).toHaveLength(6);
    expect(screen.getByText('+2 more here: zoom in and click a smaller spot.')).toBeInTheDocument();
  });
});
