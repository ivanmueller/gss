import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { st37Legs, type St37MapWell } from '../lib/st37Map';
import { st37Bounds, St37Panel, St37Tip } from './St37Panel';

// A well's box at the pointer and its panel on the right of the map (F-265). Made-up wells only.

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

const LICENSED: Partial<St37MapWell> = {
  statusClass: 'licensed',
  statusFluid: null,
  spudDate: null,
  totalDepthM: null,
  trueVerticalDepthM: null,
  path: null,
  licenceDate: '2026-11-19',
  plannedOperation: 'HORIZONTAL',
  plannedFormation: 'Duvernay Fm',
  plannedDepthM: 5300,
  plannedBottom: [-113.63, 53.31],
};

describe('St37Tip', () => {
  const first = well('00/09-07-030-26W4/0', {
    statusClass: 'abandoned',
    statusFluid: null,
    totalDepthM: 3100,
    fieldName: 'EXAMPLE SOUTH',
    poolName: 'EXAMPLE A',
  });
  const second = well('00/09-07-030-26W4/2');
  const other = well('02/09-07-030-26W4/0', { licenceNumber: '0509396' });
  const wells = [first, second, other];
  const byUwi = new Map(wells.map((w) => [w.uwi, w]));

  it('gives the simple lines of the leg pointed at, and no more', () => {
    render(<St37Tip hover={{ uwis: [other.uwi], x: 10, y: 10 }} byUwi={byUwi} />);
    const tip = screen.getByRole('status');
    expect([...tip.querySelectorAll('p')].map((p) => p.textContent)).toEqual([
      '02/09-07-030-26W4/0',
      'Licence 0509396 · Example Energy Ltd.',
      'Producing or injecting · Crude oil',
      'Spud 2023-09-03 · TD 5,846 m (TVD 2,233 m)',
    ]);
    // Nothing on it to click, and no charts: those are on the panel.
    expect(tip.querySelector('button')).toBeNull();
    expect(tip.querySelector('svg')).toBeNull();
  });

  it('is about the leg under the pointer, not the well’s main leg, and says what else is there', () => {
    render(
      <St37Tip
        hover={{ uwis: [first.uwi, second.uwi, other.uwi], x: 10, y: 10 }}
        byUwi={byUwi}
        legsOf={st37Legs(wells)}
      />,
    );
    expect(screen.getByText('00/09-07-030-26W4/0')).toBeInTheDocument();
    expect(screen.getByText('Abandoned')).toBeInTheDocument();
    expect(screen.getByText('Example South field · Example A pool')).toBeInTheDocument();
    expect(screen.getByText('One of 2 legs of this well · +1 more well here')).toBeInTheDocument();
  });

  it('says what a licence planned for a well not drilled yet', () => {
    const uwi = '00/01-29-049-26W4/0';
    render(
      <St37Tip
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
  });

  it('shows nothing when no well is under the pointer', () => {
    const { container } = render(<St37Tip hover={null} byUwi={byUwi} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('St37Panel', () => {
  const byUwi = new Map([
    ['00/09-07-030-26W4/0', well('00/09-07-030-26W4/0')],
    ['02/09-07-030-26W4/0', well('02/09-07-030-26W4/0', { licenceNumber: '0509396' })],
  ]);

  it('shows the well clicked in a panel, and how many more share the place', () => {
    const onClose = vi.fn();
    render(
      <St37Panel
        pick={{ uwis: ['00/09-07-030-26W4/0', '02/09-07-030-26W4/0'], x: 10, y: 10 }}
        byUwi={byUwi}
        onClose={onClose}
      />,
    );
    const panel = screen.getByRole('dialog', { name: 'Well 00/09-07-030-26W4/0' });
    expect(panel).toHaveTextContent('Well · EXAMPLE HZ');
    expect(screen.getByText('Producing or injecting · Crude oil')).toBeInTheDocument();
    expect(screen.getByText('2023-09-03')).toBeInTheDocument();
    expect(screen.getByText('5,846 m')).toBeInTheDocument();
    expect(screen.getByText('2,233 m')).toBeInTheDocument();
    expect(screen.getByText('Example Energy Ltd.')).toBeInTheDocument();
    expect(screen.getByText('Licence 0509395')).toBeInTheDocument();
    expect(screen.getByText('+1 more well here')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
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
      <St37Panel
        // The click is on the abandoned leg: the panel is still the well's.
        pick={{ uwis: [first.uwi, second.uwi], x: 10, y: 10 }}
        byUwi={new Map(wells.map((w) => [w.uwi, w]))}
        legsOf={st37Legs(wells)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog', { name: 'Well 00/09-07-030-26W4/2' })).toBeInTheDocument();
    expect(screen.getByText('Producing or injecting · Crude oil')).toBeInTheDocument();
    const legs = screen.getByRole('list', { name: 'Legs of this well' });
    expect([...legs.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      '00/09-07-030-26W4/2main leg · Producing or injecting · TD 5,846 m',
      '00/09-07-030-26W4/0Abandoned · TD 3,100 m',
    ]);
    // Its own legs are not counted as other wells.
    expect(screen.queryByText(/more well/)).not.toBeInTheDocument();
  });

  it('lets a leg be chosen and let go (F-258)', () => {
    const first = well('00/09-07-030-26W4/0', { statusClass: 'abandoned' });
    const second = well('00/09-07-030-26W4/2');
    const wells = [first, second];
    render(
      <St37Panel
        pick={{ uwis: [second.uwi], x: 10, y: 10 }}
        byUwi={new Map(wells.map((w) => [w.uwi, w]))}
        legsOf={st37Legs(wells)}
        onClose={vi.fn()}
      />,
    );
    const leg = screen.getByRole('button', { name: /26W4\/0/ });
    expect(leg).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(leg);
    expect(leg).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(leg);
    expect(leg).toHaveAttribute('aria-pressed', 'false');
  });

  it('starts on the leg clicked on the map, unless it is the main one (F-258)', () => {
    const first = well('00/09-07-030-26W4/0', { statusClass: 'abandoned' });
    const second = well('00/09-07-030-26W4/2');
    const wells = [first, second];
    const panel = (clicked: string) => (
      <St37Panel
        pick={{ uwis: [clicked], x: 10, y: 10 }}
        byUwi={new Map(wells.map((w) => [w.uwi, w]))}
        legsOf={st37Legs(wells)}
        member={{ organizationId: 'org-a', token: 'token' }}
        onClose={vi.fn()}
      />
    );
    const other = render(panel(first.uwi));
    expect(screen.getByRole('button', { name: /26W4\/0/ })).toHaveAttribute('aria-pressed', 'true');
    // Its own production comes under the well's, which stays.
    expect(screen.getByText(/Production of all legs together/)).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Production of leg 00/09-07-030-26W4/0' }),
    ).toBeInTheDocument();
    other.unmount();
    render(panel(second.uwi));
    expect(screen.getByRole('button', { name: /26W4\/0/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('group', { name: /Production of leg/ })).not.toBeInTheDocument();
  });

  it('shows the plan of a well not drilled yet, and that the line is not the drilled path', () => {
    const uwi = '00/01-29-049-26W4/0';
    render(
      <St37Panel
        pick={{ uwis: [uwi], x: 10, y: 10 }}
        byUwi={new Map([[uwi, well(uwi, LICENSED)]])}
        onClose={vi.fn()}
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

  it('moves the map to the well, every leg of it', () => {
    const first = well('00/09-07-030-26W4/0');
    const second = well('00/09-07-030-26W4/2', { bottom: [-113.6, 53.34], path: null });
    const goTo = vi.fn();
    render(
      <St37Panel
        pick={{ uwis: [first.uwi], x: 10, y: 10 }}
        byUwi={new Map([first, second].map((w) => [w.uwi, w]))}
        legsOf={st37Legs([first, second])}
        onClose={vi.fn()}
        goTo={goTo}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Zoom to well' }));
    const [west, south, east, north] = goTo.mock.calls[0]?.[0] as number[];
    expect(west).toBeLessThan(-113.62);
    expect(east).toBeGreaterThan(-113.6);
    expect(south).toBeLessThan(53.3);
    expect(north).toBeGreaterThan(53.34);
    // A vertical well, one point, still gets ground around it.
    const [w, , e] = st37Bounds([well('x', { bottom: [-113.6, 53.3], path: null })]) ?? [];
    expect((e ?? 0) - (w ?? 0)).toBeGreaterThan(0.009);
  });

  it('shows nothing when no well is clicked, or it is no longer loaded', () => {
    const { container, rerender } = render(
      <St37Panel pick={null} byUwi={byUwi} onClose={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(<St37Panel pick={{ uwis: ['gone'], x: 1, y: 1 }} byUwi={byUwi} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
