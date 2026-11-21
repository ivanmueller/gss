import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { st37Features, st37Legs, type St37MapWell } from '../lib/st37Map';
import { St37Card, st37Covers, st37Place, st37Plan, st37Request } from './St37Wells';

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
  licenceDate: null,
  plannedOperation: null,
  plannedFormation: null,
  plannedDepthM: null,
  plannedBottom: null,
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
      well('00/01-27-030-27W4/0', { path: null, licenceNumber: '0509396' }),
    ]);
    expect(features.map((f): unknown => f.properties?.part)).toEqual([
      // One dot a well first, for when the main legs are off (F-257).
      'well',
      'well',
      'path',
      'bottom',
      'surface',
      'bottom',
      'surface',
    ]);
    expect(features[2]?.properties).toMatchObject({
      uwi: '00/09-07-030-26W4/0',
      licence: '0509395',
      status: 'producing',
      leg: 'main',
    });
  });

  it("marks a well's main leg and its other legs, and gives the well one dot (F-257)", () => {
    const first = well('00/09-07-030-26W4/0', { statusClass: 'abandoned', poolCode: null });
    const second = well('00/09-07-030-26W4/2', { poolCode: 728001 });
    const legs = st37Legs([first, second]);
    // The producing leg is the main one, whatever the order they came in.
    expect(legs.get('0509395')?.map((w) => w.uwi)).toEqual([second.uwi, first.uwi]);
    const { features } = st37Features([first, second]);
    expect(features.filter((f) => f.properties?.part === 'well')).toEqual([
      {
        type: 'Feature',
        properties: {
          uwi: second.uwi,
          licence: '0509395',
          status: 'producing',
          leg: 'main',
          part: 'well',
        },
        geometry: { type: 'Point', coordinates: [-113.6, 53.3] },
      },
    ]);
    expect(
      features
        .filter((f) => f.properties?.part === 'path')
        .map((f): unknown => [f.properties?.uwi, f.properties?.leg]),
    ).toEqual([
      [first.uwi, 'other'],
      [second.uwi, 'main'],
    ]);
  });

  it('ranks equal legs: the one in a pool, then the one with a path, then the latest', () => {
    const uwis = (list: St37MapWell[]) =>
      st37Legs(list)
        .get('0509395')
        ?.map((w) => w.uwi.slice(-1));
    const a = (event: string, extra: Partial<St37MapWell>) =>
      well(`00/09-07-030-26W4/${event}`, { statusClass: 'abandoned', ...extra });
    expect(uwis([a('0', {}), a('2', { poolCode: 728001, path: null })])).toEqual(['2', '0']);
    expect(uwis([a('0', { path: null }), a('2', {})])).toEqual(['2', '0']);
    expect(uwis([a('0', {}), a('3', {}), a('2', {})])).toEqual(['3', '2', '0']);
  });
});

const LICENSED: Partial<St37MapWell> = {
  statusClass: 'licensed',
  statusFluid: null,
  spudDate: null,
  totalDepthM: null,
  trueVerticalDepthM: null,
  bottom: [-113.6, 53.3],
  path: null,
  licenceDate: '2026-11-19',
  plannedOperation: 'Horizontal',
  plannedFormation: 'Duvernay Fm',
  plannedDepthM: 5300,
  plannedBottom: [-113.63, 53.32],
};

describe('a well not drilled yet', () => {
  it('is drawn as a planned line to its planned bottom hole, with its dot there', () => {
    const { features } = st37Features([well('00/01-29-049-26W4/0', LICENSED)]);
    expect(features.map((f): unknown => [f.properties?.part, f.properties?.at])).toEqual([
      ['well', undefined],
      ['planned', undefined],
      // Where it starts, drawn when planned lines are off (F-257); then the planned bottom hole.
      ['bottom', 'start'],
      ['bottom', 'plan'],
      ['surface', undefined],
    ]);
    features.shift();
    features.splice(1, 1);
    expect(features[0]?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [-113.6, 53.3],
        [-113.63, 53.32],
      ],
    });
    expect(features[1]?.geometry).toEqual({ type: 'Point', coordinates: [-113.63, 53.32] });
  });

  it('says what its licence planned', () => {
    expect(st37Plan(well('00/01-29-049-26W4/0', LICENSED))).toBe(
      'Planned horizontal in the Duvernay Fm, 5,300 m measured depth · Licensed 2026-11-19',
    );
    expect(st37Plan(well('00/01-29-049-26W4/0'))).toBeNull();
  });

  it('shows the plan on its card, and that the line is not the drilled path', () => {
    const uwi = '00/01-29-049-26W4/0';
    render(
      <St37Card
        hover={{ uwis: [uwi], x: 10, y: 10 }}
        byUwi={new Map([[uwi, well(uwi, LICENSED)]])}
      />,
    );
    expect(screen.getByText('Licensed, not drilled')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Planned horizontal in the Duvernay Fm, 5,300 m measured depth · Licensed 2026-11-19',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/The dashed line is the plan/)).toBeInTheDocument();
  });
});

describe('St37Card', () => {
  const byUwi = new Map([
    ['00/09-07-030-26W4/0', well('00/09-07-030-26W4/0')],
    ['02/09-07-030-26W4/0', well('02/09-07-030-26W4/0', { licenceNumber: '0509396' })],
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

  it('shows the well whole: its main leg in full and every leg under its licence (F-257)', () => {
    const first = well('00/09-07-030-26W4/0', {
      statusClass: 'abandoned',
      statusFluid: null,
      totalDepthM: 3100,
    });
    const second = well('00/09-07-030-26W4/2');
    const wells = [first, second];
    render(
      <St37Card
        // The pointer is on the abandoned leg: the card is still the well's.
        hover={{ uwis: [first.uwi, second.uwi], x: 10, y: 10 }}
        byUwi={new Map(wells.map((w) => [w.uwi, w]))}
        legsOf={st37Legs(wells)}
      />,
    );
    expect(screen.getByText('Producing or injecting · Crude oil')).toBeInTheDocument();
    expect(screen.getByText('2 legs')).toBeInTheDocument();
    const legs = screen.getByRole('list', { name: 'Legs of this well' });
    expect([...legs.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '00/09-07-030-26W4/2main leg · Producing or injecting · TD 5,846 m',
      '00/09-07-030-26W4/0Abandoned · TD 3,100 m',
    ]);
    // Its own legs are not counted as other wells.
    expect(screen.queryByText(/more well/)).not.toBeInTheDocument();
  });

  it("names the well's field and pool, and a pool the list does not name by its code", () => {
    const uwi = '00/09-07-030-26W4/0';
    const named = well(uwi, {
      fieldName: 'EXAMPLE SOUTH',
      poolCode: 728001,
      poolName: 'EXAMPLE A',
    });
    expect(st37Place(named)).toBe('Example South field · Example A pool');
    expect(st37Place(well(uwi, { fieldName: "O'EXAMPLE-WEST", poolCode: 728098 }))).toBe(
      "O'Example-West field · pool 728098",
    );
    expect(st37Place(well(uwi))).toBeNull();
    render(<St37Card hover={{ uwis: [uwi], x: 10, y: 10 }} byUwi={new Map([[uwi, named]])} />);
    expect(screen.getByText('Example South field · Example A pool')).toBeInTheDocument();
  });

  it('shows nothing when no well is under the pointer', () => {
    const { container } = render(<St37Card hover={null} byUwi={byUwi} />);
    expect(container).toBeEmptyDOMElement();
  });
});
