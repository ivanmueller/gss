import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GRAINS } from '../data/grains';
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
    expect(oats).toHaveAttribute('href', '/grains?grain=oats');
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
      '/grains?q=CS+Camden&grain=oats',
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

describe('a grain’s window', () => {
  it('opens from its tile, and closes back to the table', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/grains');
    render(<GrainsPage />);
    await user.click(screen.getByRole('link', { name: /Oats/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Oats' });
    expect(dialog).toHaveClass('animate-dialog-in');
    expect(window.location.search).toBe('?grain=oats');
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('shows only what is on spec for the class chosen', () => {
    window.history.replaceState(null, '', '/grains?grain=oats');
    render(<GrainsPage />);
    const dialog = screen.getByRole('dialog', { name: 'Oats' });
    expect(within(dialog).getByRole('row', { name: /No\. 1 CW 56/ })).toBeInTheDocument();
    expect(within(dialog).getByText('less than 13.6%')).toBeInTheDocument();
    expect(within(dialog).getByText(/Most grown:/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/Tough|Damp|Sample|damage/i)).toBeNull();
    // Eastern classes are not shown (the Prairies' acres only).
    expect(within(dialog).queryByRole('button', { name: 'Eastern' })).toBeNull();
  });

  it('lists wheat’s most grown classes first, CWRS chosen', async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, '', '/grains?grain=wheat');
    render(<GrainsPage />);
    const dialog = screen.getByRole('dialog', { name: 'Wheat' });
    const classes = within(within(dialog).getByRole('group', { name: 'Classes' })).getAllByRole(
      'button',
    );
    expect(classes[0]).toHaveAccessibleName('CWRS Red Spring');
    expect(classes[0]).toHaveAttribute('aria-pressed', 'true');
    expect(classes[1]).toHaveAccessibleName('CWAD Amber Durum');
    expect(within(dialog).getByRole('row', { name: /No\. 1 CWRS 75 10\.0/ })).toBeInTheDocument();
    expect(within(dialog).getByText(/AAC Brandon/)).toBeInTheDocument();
    const [, durum] = classes;
    if (!durum) throw new Error('no second class');
    await user.click(durum);
    expect(window.location.search).toContain('class=cwad-western-amber-durum');
    expect(within(dialog).getByRole('row', { name: /No\. 1 CWAD 79 9\.5/ })).toBeInTheDocument();
  });
});
