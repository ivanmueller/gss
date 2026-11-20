import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { st37Features, type St37MapWell } from '../lib/st37Map';
import { St37Card, st37Covers, st37Request } from './St37Wells';

// The AER's ST37 wells on the oil and gas map (F-243 part 4). Made-up wells only.

const well = (uwi: string, extra: Partial<St37MapWell> = {}): St37MapWell => ({
  uwi,
  licenceNumber: '0509395',
  wellName: 'EXAMPLE HZ',
  licensee: 'Example Energy Ltd.',
  statusClass: 'producing',
  statusFluid: 'Crude oil',
  statusType: null,
  spudDate: '2023-09-03',
  totalDepthM: 5846,
  trueVerticalDepthM: 2233,
  surface: [-113.6, 53.3],
  bottom: [-113.62, 53.3],
  path: [
    [-113.6, 53.3],
    [-113.62, 53.3],
  ],
  ...extra,
});

describe('st37Request', () => {
  it('asks for the view and half again on each side', () => {
    expect(st37Request({ west: -114, south: 53, east: -113, north: 54 })).toEqual({
      west: -114.5,
      south: 52.5,
      east: -112.5,
      north: 54.5,
    });
  });

  it('stays within Alberta, and asks nothing for a view outside it', () => {
    expect(st37Request({ west: -141, south: 41.7, east: -52.6, north: 70 })).toEqual({
      west: -120.1,
      south: 48.9,
      east: -109.9,
      north: 60.1,
    });
    expect(st37Request({ west: -80, south: 43, east: -79, north: 44 })).toBeNull();
  });
});

describe('st37Covers', () => {
  const asked = { west: -114.5, south: 52.5, east: -112.5, north: 54.5 };
  it('needs nothing new while the view stays inside the box asked for', () => {
    expect(st37Covers(asked, { west: -114, south: 53, east: -113, north: 54 })).toBe(true);
    expect(st37Covers(asked, { west: -115, south: 53, east: -114, north: 54 })).toBe(false);
  });

  it('needs nothing for a view outside Alberta', () => {
    expect(st37Covers(asked, { west: -80, south: 43, east: -79, north: 44 })).toBe(true);
  });
});

describe('st37Features', () => {
  it('draws a path, a bottom-hole dot and a surface hole per well, and no path for a vertical one', () => {
    const { features } = st37Features([
      well('00/09-07-030-26W4/0'),
      well('00/01-27-030-27W4/0', { path: null }),
    ]);
    expect(features.map((f): unknown => f.properties?.part)).toEqual([
      'path',
      'bottom',
      'surface',
      'bottom',
      'surface',
    ]);
    expect(features[0]?.properties).toMatchObject({
      uwi: '00/09-07-030-26W4/0',
      status: 'producing',
    });
  });
});

describe('St37Card', () => {
  const byUwi = new Map([
    ['00/09-07-030-26W4/0', well('00/09-07-030-26W4/0')],
    ['02/09-07-030-26W4/0', well('02/09-07-030-26W4/0')],
  ]);

  it('shows the well under the pointer and how many more share the place', () => {
    render(
      <St37Card
        hover={{ uwis: ['00/09-07-030-26W4/0', '02/09-07-030-26W4/0'], x: 10, y: 10 }}
        byUwi={byUwi}
      />,
    );
    expect(screen.getByText('00/09-07-030-26W4/0')).toBeInTheDocument();
    expect(screen.getByText('Licence 0509395 · Example Energy Ltd.')).toBeInTheDocument();
    expect(screen.getByText('Producing or injecting · Crude oil')).toBeInTheDocument();
    expect(screen.getByText('Spud 2023-09-03 · TD 5,846 m (TVD 2,233 m)')).toBeInTheDocument();
    expect(screen.getByText('+1 more well here')).toBeInTheDocument();
  });

  it('shows nothing when no well is under the pointer', () => {
    const { container } = render(<St37Card hover={null} byUwi={byUwi} />);
    expect(container).toBeEmptyDOMElement();
  });
});
