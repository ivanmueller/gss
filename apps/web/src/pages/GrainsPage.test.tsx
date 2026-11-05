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
    expect(screen.getByRole('heading', { level: 1, name: 'Grains' })).toHaveClass('sr-only');
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
  it('shows the first class’s on-spec limits, the rest folded away', async () => {
    const user = userEvent.setup();
    render(<GrainPage id="oats" />);
    expect(screen.getByRole('heading', { level: 1, name: /Oats/ })).toBeInTheDocument();
    const western = screen.getByRole('region', { name: 'Oats, Canada Western' });
    expect(within(western).getByRole('heading', { name: 'On spec' })).toBeInTheDocument();
    expect(within(western).getByRole('row', { name: /No\. 1 CW 56/ })).toBeInTheDocument();
    expect(within(western).getByText(/Moisture: less than 13\.6%/)).toBeInTheDocument();
    expect(
      within(western).getByText(
        /wetter is graded Tough \(13\.6-17\.0%\), then Damp \(over 17\.0%\)/,
      ),
    ).toBeInTheDocument();
    expect(within(western).queryByRole('heading', { name: 'Damage, maximum' })).toBeNull();
    await user.click(within(western).getByRole('button', { name: 'More details' }));
    expect(within(western).getByRole('heading', { name: 'Damage, maximum' })).toBeInTheDocument();
  });

  it('shows only the class chosen, kept in the address', async () => {
    const user = userEvent.setup();
    render(<GrainPage id="oats" />);
    await user.click(screen.getByRole('button', { name: 'Eastern' }));
    expect(window.location.search).toBe('?class=ce-eastern');
    expect(screen.getByRole('button', { name: 'Eastern' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('region', { name: 'Oats, Canada Eastern' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Oats, Canada Western' })).toBeNull();
  });

  it('groups wheat’s classes and shows a protein minimum', () => {
    window.history.replaceState(null, '', '/grains/wheat?class=cwrs-western-red-spring');
    render(<GrainPage id="wheat" />);
    const classes = screen.getByRole('navigation', { name: 'Classes' });
    expect(within(classes).getByRole('heading', { name: 'Western' })).toBeInTheDocument();
    expect(within(classes).getByRole('heading', { name: 'Eastern' })).toBeInTheDocument();
    const red = screen.getByRole('region', { name: 'Wheat, Canada Western Red Spring' });
    expect(within(red).getByRole('row', { name: /No\. 1 CWRS 75 10\.0/ })).toBeInTheDocument();
  });

  it('keeps the grain’s other tables and sources under More about', async () => {
    const user = userEvent.setup();
    render(<GrainPage id="oats" />);
    const more = screen.getByRole('region', { name: 'More about oats' });
    expect(within(more).queryByRole('heading', { name: 'Sources' })).toBeNull();
    await user.click(within(more).getByRole('button', { name: 'Show' }));
    expect(
      within(more).getByRole('heading', { name: 'Milling varieties in Alberta trials' }),
    ).toBeInTheDocument();
    const sources = within(more).getByRole('heading', { name: 'Sources' }).parentElement;
    if (!sources) throw new Error('no Sources');
    expect(
      within(sources).getByRole('link', { name: /Official Grain Grading Guide/ }),
    ).toHaveAttribute('target', '_blank');
    expect(within(more).getAllByText(/checked November 5, 2026/).length).toBeGreaterThan(0);
  });

  it('shows the first 40 varieties of a long list, then all of them', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/grains/wheat?class=cwrs-western-red-spring');
    render(<GrainPage id="wheat" />);
    const red = screen.getByRole('region', { name: 'Wheat, Canada Western Red Spring' });
    await user.click(within(red).getByRole('button', { name: 'More details' }));
    const list = within(red).getByRole('list', {
      name: 'Varieties of Wheat, Canada Western Red Spring',
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(40);
    const [showAll] = within(red).getAllByRole('button', { name: /^Show all \d+$/ });
    if (!showAll) throw new Error('no Show all button');
    await user.click(showAll);
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(40);
  });

  it('says when there is no grain at the address', () => {
    render(<GrainPage id="nothing" />);
    expect(screen.getByText(/There is no grain at this address/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all grains' })).toHaveAttribute('href', '/grains');
  });
});
