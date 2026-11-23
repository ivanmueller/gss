import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { LandMapAgreement, LandShape } from '../lib/landMap';
import type { LandSaleParcel } from '../lib/landSalesMap';
import {
  landDay,
  LandPanel,
  LandTip,
  landZoom,
  saleBuyers,
  saleDollars,
  saleLands,
  saleResult,
  saleWholeDollars,
} from './LandPanel';

// The box at the pointer and the panel on the right for land on the oil and gas map (F-265).
// Made-up parcels, holders, buyers and prices only.

const SHAPE: LandShape = [
  [
    [
      [-114.1, 52.2],
      [-114, 52.2],
      [-114, 52.3],
      [-114.1, 52.2],
    ],
  ],
];
const parcel = (id: string, extra: Partial<LandSaleParcel> = {}): LandSaleParcel => ({
  id,
  saleDate: '2026-08-19',
  contractNo: 'B0102',
  contractType: 'LICENCE',
  region: 'PLAINS',
  hectares: '1856.0000',
  zone: 'PETROLEUM AND NATURAL GAS FROM SURFACE TO BASEMENT PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE EXAMPLE GRP TO BASEMENT',
  land: '50103806 50103718NE 5010380204',
  inexact: false,
  status: 'ACCEPTED',
  bonus: '67150.00',
  dollarsPerHectare: '36.18',
  buyers: 'EXAMPLE LAND (222) LTD. 100%',
  // The agreement issued from the sale, as the database found it (F-276).
  heldAgreement: '5326080102',
  heldBy: 'SAMPLE RESOURCES INC.',
  shape: SHAPE,
  ...extra,
});
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
  zone: 'PETROLEUM AND NATURAL GAS IN THE EXAMPLE FM',
  areaHa: 256,
  termDate: '2020-02-17',
  continuationDate: null,
  expiryText: 'INDEFINITE',
  shape: SHAPE,
  ...extra,
});
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
        zone: 'PETROLEUM AND NATURAL GAS IN THE EXAMPLE FM',
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
const sales = {
  parcels: new Map([
    ['10', parcel('10')],
    [
      '11',
      parcel('11', {
        contractNo: 'B0028',
        saleDate: '2026-09-02',
        status: 'NO OFFERS',
        bonus: null,
        dollarsPerHectare: null,
        buyers: null,
      }),
    ],
    [
      '12',
      parcel('12', {
        contractNo: 'B0150',
        saleDate: '2099-01-13',
        status: null,
        bonus: null,
        dollarsPerHectare: null,
        buyers: null,
      }),
    ],
  ]),
};

describe('a parcel’s codes and documents (F-265 part 2)', () => {
  const SITE = 'https://content2.energy.alberta.ca/download/?s=png&id=';
  const coded = {
    parcels: new Map([
      [
        '20',
        parcel('20', { restrictions: 'SHA010301 SHA010401', reversionZones: 'D00039 D00004' }),
      ],
      ['21', parcel('21', { saleDate: '2099-01-13', status: null, bonus: null, buyers: null })],
    ]),
    documents: {
      '2026-08-19': { notice: `${SITE}20260819PON&ft=.pdf`, results: `${SITE}20260819PSR&ft=.pdf` },
      '2099-01-13': { notice: `${SITE}20990113PON&ft=.pdf`, results: `${SITE}20990113PSR&ft=.pdf` },
    },
  };

  it('lists the restriction and reversion zone codes, and links the notice and the results', () => {
    render(
      <LandPanel
        pick={{ keys: ['sale:20'], x: 1, y: 1 }}
        land={land}
        sales={coded}
        onClose={vi.fn()}
      />,
    );
    const codes = (name: string) =>
      [...screen.getByRole('region', { name }).querySelectorAll('li')].map((li) => li.textContent);
    expect(codes('Restriction codes')).toEqual(['SHA010301', 'SHA010401']);
    expect(codes('Deeper rights reversion zones')).toEqual(['D00039', 'D00004']);
    const notice = screen.getByRole('link', { name: 'Notice PDF' });
    expect(notice).toHaveAttribute('href', `${SITE}20260819PON&ft=.pdf`);
    // Opens beside the map, not in its place.
    expect(notice).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'Results PDF' })).toHaveAttribute(
      'href',
      `${SITE}20260819PSR&ft=.pdf`,
    );
  });

  it('shows neither codes nor links for a parcel that has none, and no results before the sale', () => {
    const { unmount } = render(
      <LandPanel
        pick={{ keys: ['sale:10'], x: 1, y: 1 }}
        land={land}
        sales={sales}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Restriction codes' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('region', { name: 'Deeper rights reversion zones' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    unmount();
    render(
      <LandPanel
        pick={{ keys: ['sale:21'], x: 1, y: 1 }}
        land={land}
        sales={coded}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: 'Notice PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Results PDF' })).not.toBeInTheDocument();
  });
});

describe('reading a parcel', () => {
  it('writes a date, dollars and land for reading', () => {
    expect(landDay('2026-08-19')).toBe('Aug 19, 2026');
    expect(landDay('2026-09-02')).toBe('Sep 2, 2026');
    expect(landDay('soon')).toBe('soon');
    expect(saleDollars('67150.00')).toBe('$67,150');
    expect(saleDollars('2296.32')).toBe('$2,296.32');
    // To the nearest dollar, on the digits (F-276).
    expect(saleWholeDollars('313712.64')).toBe('$313,713');
    expect(saleWholeDollars('313712.49')).toBe('$313,712');
    expect(saleWholeDollars('67150.00')).toBe('$67,150');
    expect(saleWholeDollars('999999999999.50')).toBe('$1,000,000,000,000');
    expect(saleWholeDollars('12')).toBe('$12');
    expect(saleLands(parcel('1'))).toEqual(['6-38-1-W5', 'NE-18-37-1-W5', 'LSD 4-2-38-1-W5']);
    // A key not in the notices' usual form is shown as published.
    expect(saleLands({ land: 'ODD-KEY' })).toEqual(['ODD-KEY']);
  });

  it('says how a parcel stands', () => {
    const today = '2026-11-22';
    expect(saleResult({ status: 'ACCEPTED', saleDate: '2026-08-19' }, today).label).toBe('Sold');
    expect(saleResult({ status: 'NO OFFERS', saleDate: '2026-08-19' }, today).label).toBe(
      'No offers',
    );
    expect(saleResult({ status: null, saleDate: '2027-01-13' }, today).label).toBe('Upcoming');
    expect(saleResult({ status: null, saleDate: '2026-08-19' }, today).label).toBe(
      'No result published',
    );
    expect(saleResult({ status: 'WITHDRAWN', saleDate: '2026-08-19' }, today).label).toBe(
      'Withdrawn',
    );
  });

  it('lists each buyer, with its share when it is not the whole', () => {
    expect(saleBuyers('EXAMPLE LAND (222) LTD. 100%')).toEqual([
      { name: 'Example Land (222) Ltd.', share: null },
    ]);
    expect(saleBuyers('EXAMPLE LAND LTD. 60%; SAMPLE RESOURCES INC. 40%')).toEqual([
      { name: 'Example Land Ltd.', share: '60%' },
      { name: 'Sample Resources Inc.', share: '40%' },
    ]);
    expect(saleBuyers(null)).toEqual([]);
  });

  it('gives the map a box around a shape, and none for no ground', () => {
    const [west, south, east, north] = landZoom(SHAPE) ?? [];
    expect(west).toBeLessThan(-114.1);
    expect(east).toBeGreaterThan(-114);
    expect(south).toBeLessThan(52.2);
    expect(north).toBeGreaterThan(52.3);
    expect(landZoom([])).toBeNull();
  });
});

describe('LandTip', () => {
  const lines = () =>
    [...screen.getByRole('status').querySelectorAll('p')].map((p) => p.textContent);

  it('gives a sold parcel’s price, bonus, area and buyer', () => {
    render(<LandTip landKey="sale:10" land={land} sales={sales} />);
    expect(lines()).toEqual([
      'B0102Aug 19, 2026',
      'PNG · 6-38-1-W5 +2',
      '$36.18/ha',
      '$67.2K · 1,856 ha',
      'Example Land (222) Ltd.',
    ]);
  });

  it('says No offers or Upcoming for a parcel not sold, with its area and kind', () => {
    const { unmount } = render(<LandTip landKey="sale:11" land={land} sales={sales} />);
    expect(lines()).toEqual([
      'B0028Sep 2, 2026',
      'PNG · 6-38-1-W5 +2',
      'No offers',
      '1,856 ha · Licence',
    ]);
    unmount();
    render(<LandTip landKey="sale:12" land={land} sales={sales} />);
    expect(lines()[2]).toBe('Upcoming');
  });

  it('gives the holder of an agreement, an offset notice’s deadline, and land not the Crown’s', () => {
    const { unmount } = render(<LandTip landKey="png:1" land={land} sales={sales} />);
    expect(lines()).toEqual([
      '002-924tract 00',
      'PNG · Lease · ACTIVE',
      'Example Energy Ltd.',
      '256 ha · expiry indefinite',
    ]);
    unmount();
    const offset = render(<LandTip landKey="offset:3" land={land} sales={sales} />);
    expect(lines()).toContain('Deadline May 8, 2099');
    offset.unmount();
    render(<LandTip landKey="freehold:5" land={land} sales={sales} />);
    expect(screen.getByText('Freehold minerals (not the Crown’s)')).toBeInTheDocument();
  });

  it('shows nothing for no land, or land no longer loaded', () => {
    const { container, rerender } = render(<LandTip landKey={null} land={land} sales={sales} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<LandTip landKey="sale:99" land={land} sales={sales} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('LandPanel', () => {
  it('lays a sold parcel out: result, figures, buyer, holder today, rights and lands', () => {
    const onClose = vi.fn();
    const goTo = vi.fn();
    render(
      <LandPanel
        pick={{ keys: ['sale:10', 'png:1'], x: 100, y: 100 }}
        land={land}
        sales={sales}
        onClose={onClose}
        goTo={goTo}
      />,
    );
    const panel = screen.getByRole('dialog', { name: 'Sale parcel B0102' });
    expect(panel).toHaveTextContent('Petroleum & natural gas Licence · Plains');
    expect(screen.getByText('Aug 19, 2026')).toBeInTheDocument();
    expect(screen.getByText(/Sold/)).toBeInTheDocument();
    expect(screen.getByText('$67,150')).toBeInTheDocument();
    expect(screen.getByText('$36.18/ha')).toBeInTheDocument();
    expect(screen.getByText('1,856 ha')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Buyer' })).getByRole('listitem'),
    ).toHaveTextContent('Example Land (222) Ltd.');
    const held = screen.getByRole('region', { name: 'Held today' });
    expect(held).toHaveTextContent('Sample Resources Inc.');
    expect(held).toHaveTextContent('agreement 5326080102');
    // A clause a line.
    const rights = screen.getByRole('region', { name: 'Rights' });
    expect([...rights.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'PETROLEUM AND NATURAL GAS FROM SURFACE TO BASEMENT',
      'PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE EXAMPLE GRP TO BASEMENT',
    ]);
    const lands = screen.getByRole('list', { name: 'Lands' });
    expect([...lands.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '6-38-1-W5',
      'NE-18-37-1-W5',
      'LSD 4-2-38-1-W5',
    ]);
    // The lowest township among its lands, as the province files it (F-276).
    expect(screen.getByText('MRT 5-01-037 · Sale Aug 19, 2026')).toBeInTheDocument();
    expect(
      screen.getByText(/Alberta Energy and Minerals, Government of Alberta/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Zoom to parcel' }));
    expect(goTo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('lays the rights out tract by tract, the bonus to the dollar, and finds the holder itself (F-276)', () => {
    const tracts = [
      'PETROLEUM AND NATURAL GAS FROM SURFACE; TO THE TOP OF THE EXAMPLE FM; PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE EXAMPLE GRP; TO BASEMENT',
      'PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE EXAMPLE GRP; TO BASEMENT',
    ];
    render(
      <LandPanel
        pick={{ keys: ['sale:20'], x: 1, y: 1 }}
        // No land held is loaded: Land today can be switched off.
        land={{ agreements: new Map(), offsets: new Map(), freehold: new Map() }}
        sales={{
          parcels: new Map([
            [
              '20',
              parcel('20', {
                bonus: '313712.64',
                tractRights: tracts,
                restrictions: 'IRZ003501 SHA006701',
                land: '50904420 50704507 50804501 50704606',
              }),
            ],
          ]),
        }}
        onClose={vi.fn()}
      />,
    );
    // The bonus to the nearest dollar, the figure to the cent on pointing at it.
    expect(screen.getByText('$313,713')).toHaveAttribute('title', '$313,712.64');
    const held = screen.getByRole('region', { name: 'Held today' });
    expect(held).toHaveTextContent('Sample Resources Inc.');
    expect(held).toHaveTextContent('agreement 5326080102');
    // An entry a tract, as the notice writes it, in place of a clause a line.
    const rights = screen.getByRole('region', { name: 'Rights' });
    expect([...rights.querySelectorAll('li')].map((li) => li.textContent)).toEqual(tracts);
    // The lands in the notice's order (read down the columns), and the township filed under.
    const lands = screen.getByRole('list', { name: 'Lands' });
    expect(lands).toHaveClass('columns-2');
    expect([...lands.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '20-44-9-W5',
      '7-45-7-W5',
      '1-45-8-W5',
      '6-46-7-W5',
    ]);
    expect(screen.getByText('MRT 5-07-045 · Sale Aug 19, 2026')).toBeInTheDocument();
    // The codes alone under their heading.
    expect(screen.getByRole('region', { name: 'Restriction codes' })).toHaveTextContent(
      /^Restriction codesIRZ003501SHA006701$/,
    );
  });

  it('shows no holder for a sold parcel whose agreement is not among the land loaded', () => {
    render(
      <LandPanel
        pick={{ keys: ['sale:21'], x: 1, y: 1 }}
        land={land}
        sales={{ parcels: new Map([['21', parcel('21', { heldAgreement: null, heldBy: null })]]) }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Sold/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Held today' })).not.toBeInTheDocument();
  });

  it('shows no buyer, bonus or holder for a parcel not sold', () => {
    render(
      <LandPanel
        pick={{ keys: ['sale:11'], x: 1, y: 1 }}
        land={land}
        sales={sales}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('No offers')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Buyer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Held today' })).not.toBeInTheDocument();
    // No Zoom button without a way to move the map.
    expect(screen.queryByRole('button', { name: 'Zoom to parcel' })).not.toBeInTheDocument();
  });

  it('lists the other land under the click, and shows one of them when it is clicked', () => {
    render(
      <LandPanel
        pick={{ keys: ['sale:10', 'png:1', 'offset:3', 'freehold:5'], x: 1, y: 1 }}
        land={land}
        sales={sales}
        onClose={vi.fn()}
      />,
    );
    const others = screen.getByRole('list', { name: 'Other land here' });
    expect([...others.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Example Energy Ltd.Lease 002-924, tract 00 · 256 ha',
      'Offset notice 2050843E02, tract 00Example Energy Ltd. · deadline 2099-05-08',
      'Freehold minerals (not the Crown’s)ALL MINERALS EXCEPT GOLD,SILVER',
    ]);
    fireEvent.click(within(others).getByRole('button', { name: /Lease 002-924/ }));
    const panel = screen.getByRole('dialog', { name: 'Lease 002-924, tract 00' });
    expect(panel).toHaveTextContent('Petroleum & natural gas lease · held today');
    expect(screen.getByText('ACTIVE · CONTINUED TERM')).toBeInTheDocument();
    expect(screen.getByText('2020-02-17')).toBeInTheDocument();
    expect(
      screen.getByText('Parties: EXAMPLE ENERGY LTD. 60% SAMPLE RESOURCES INC. 40%'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Expires within 12 months.')).not.toBeInTheDocument();
    // The parcel is now among the others.
    expect(
      within(screen.getByRole('list', { name: 'Other land here' })).getByRole('button', {
        name: /Sale parcel B0102/,
      }),
    ).toBeInTheDocument();
  });

  it('leads with an offset notice or land not the Crown’s when that is what was clicked', () => {
    const { unmount } = render(
      <LandPanel
        pick={{ keys: ['offset:3'], x: 1, y: 1 }}
        land={land}
        sales={sales}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Offset notice 2050843E02' })).toBeInTheDocument();
    expect(screen.getByText('Deadline 2099-05-08')).toBeInTheDocument();
    unmount();
    render(
      <LandPanel
        pick={{ keys: ['freehold:5'], x: 1, y: 1 }}
        land={land}
        sales={sales}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('Freehold minerals (not the Crown’s)')).toBeInTheDocument();
    expect(screen.getByText('ALL MINERALS EXCEPT GOLD,SILVER')).toBeInTheDocument();
  });

  it('shows nothing for no click, or land no longer loaded', () => {
    const { container, rerender } = render(
      <LandPanel pick={null} land={land} sales={sales} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <LandPanel
        pick={{ keys: ['png:99'], x: 1, y: 1 }}
        land={land}
        sales={sales}
        onClose={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('lists eight others at most, and says how many more', () => {
    const many = new Map(
      Array.from({ length: 11 }, (_, i) => [
        String(i),
        agreement(String(i), { agreementNumber: String(100 + i) }),
      ]),
    );
    render(
      <LandPanel
        pick={{ keys: [...many.keys()].map((id) => `png:${id}`), x: 1, y: 1 }}
        land={{ ...land, agreements: many }}
        sales={sales}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('list', { name: 'Other land here' }).querySelectorAll('li'),
    ).toHaveLength(8);
    expect(screen.getByText('+2 more here: zoom in and click a smaller spot.')).toBeInTheDocument();
  });
});
