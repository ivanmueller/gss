import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { GRAINS } from '../data/grains';
import { GrainPage } from './GrainPage';
import { GrainsPage } from './GrainsPage';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('GrainsPage', () => {
  it('shows every grain as a tile, with its family in words', () => {
    render(<GrainsPage />);
    const tiles = within(screen.getByRole('list', { name: 'The grains' })).getAllByRole('link');
    expect(tiles).toHaveLength(GRAINS.length);
    const oats = screen.getByRole('link', { name: /Oats/ });
    expect(oats).toHaveAttribute('href', '/grains/oats');
    expect(within(oats).getByText('Coarse grains')).toBeInTheDocument();
  });

  it('finds a variety and keeps the search in the address', async () => {
    const user = userEvent.setup();
    render(<GrainsPage />);
    await user.type(screen.getByRole('searchbox'), 'CS Camden');
    expect(window.location.search).toBe('?q=CS+Camden');
    const results = screen.getByRole('list', { name: 'Search results' });
    expect(within(results).getByRole('link', { name: /CS Camden.*Oats/ })).toHaveAttribute(
      'href',
      '/grains/oats',
    );
  });

  it('says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<GrainsPage />);
    await user.type(screen.getByRole('searchbox'), 'zzqx');
    expect(screen.getByText('Nothing matches “zzqx”.')).toBeInTheDocument();
  });

  it('explains the Canadian and U.S. bushels, with the source', () => {
    render(<GrainsPage />);
    expect(screen.getByText(/Winchester bushel, 35\.24 L/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Test weight for Canadian grains/ })).toHaveAttribute(
      'href',
      expect.stringContaining('grainscanada.gc.ca'),
    );
  });
});

describe('GrainPage', () => {
  it('shows a grain’s classes, grades, tables and sources', () => {
    render(<GrainPage id="oats" />);
    expect(screen.getByRole('heading', { level: 1, name: /Oats/ })).toBeInTheDocument();
    const western = screen.getByRole('region', { name: 'Oats, Canada Western' });
    expect(
      within(within(western).getByRole('list', { name: /Grades of/ })).getAllByRole('listitem'),
    ).toHaveLength(4);
    expect(
      screen.getByRole('heading', { name: 'Milling varieties in Alberta trials' }),
    ).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Sources' });
    expect(
      within(sources).getByRole('link', { name: /Official Grain Grading Guide/ }),
    ).toHaveAttribute('target', '_blank');
    expect(within(sources).getAllByText(/checked November 5, 2026/).length).toBeGreaterThan(0);
  });

  it('shows the first 40 varieties of a long list, then all of them', async () => {
    const user = userEvent.setup();
    const grain = GRAINS.find((candidate) =>
      candidate.classes.some((grainClass) => (grainClass.varieties?.length ?? 0) > 40),
    );
    if (!grain) return;
    const grainClass = grain.classes.find((candidate) => (candidate.varieties?.length ?? 0) > 40);
    const count = grainClass?.varieties?.length ?? 0;
    render(<GrainPage id={grain.id} />);
    const list = screen.getByRole('list', { name: `Varieties of ${grainClass?.name ?? ''}` });
    expect(within(list).getAllByRole('listitem')).toHaveLength(40);
    const [showAll] = screen.getAllByRole('button', { name: `Show all ${String(count)}` });
    if (!showAll) throw new Error('no Show all button');
    await user.click(showAll);
    expect(within(list).getAllByRole('listitem')).toHaveLength(count);
  });

  it('says when there is no grain at the address', () => {
    render(<GrainPage id="nothing" />);
    expect(screen.getByText(/There is no grain at this address/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all grains' })).toHaveAttribute('href', '/grains');
  });
});
