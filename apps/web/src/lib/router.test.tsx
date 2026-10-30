import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Link, matchRoute, setSearchParams, usePath, useSearch } from './router';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('matchRoute', () => {
  it('knows the app pages', () => {
    expect(matchRoute('/')).toEqual({ page: 'workspace' });
    expect(matchRoute('/counterparties/')).toEqual({ page: 'counterparties' });
    expect(matchRoute('/team')).toEqual({ page: 'team' });
    expect(matchRoute('/quotes/')).toEqual({ page: 'quotes' });
    expect(matchRoute('/quotes/new')).toEqual({ page: 'new-quote' });
    expect(matchRoute('/quotes/00000000-0000-4000-8000-00000000a001')).toEqual({
      page: 'quote',
      id: '00000000-0000-4000-8000-00000000a001',
    });
    expect(matchRoute('/freight/')).toEqual({ page: 'freight' });
    expect(matchRoute('/freight/new')).toEqual({ page: 'new-freight' });
    expect(matchRoute('/freight/00000000-0000-4000-8000-00000000e001')).toEqual({
      page: 'freight-rate',
      id: '00000000-0000-4000-8000-00000000e001',
    });
    expect(matchRoute('/counterparties/00000000-0000-4000-8000-00000000c001')).toEqual({
      page: 'counterparty',
      id: '00000000-0000-4000-8000-00000000c001',
    });
  });

  it('sends the old map addresses to the counterparties page', () => {
    expect(matchRoute('/map')).toEqual({ page: 'redirect', to: '/counterparties?view=map' });
    expect(matchRoute('/map/coordinates/')).toEqual({ page: 'redirect', to: '/counterparties' });
  });

  it('sends the old adding pages to the + button’s window (2026-10-30)', () => {
    expect(matchRoute('/counterparties/new')).toEqual({
      page: 'redirect',
      to: '/counterparties?add=one',
    });
    expect(matchRoute('/counterparties/import')).toEqual({
      page: 'redirect',
      to: '/counterparties?add=import',
    });
    // Coordinates are found when adding and on a counterparty's page now.
    expect(matchRoute('/counterparties/coordinates')).toEqual({
      page: 'redirect',
      to: '/counterparties',
    });
  });

  it('treats anything else as not found', () => {
    expect(matchRoute('/counterparties/not-an-id')).toEqual({ page: 'not-found' });
    expect(matchRoute('/quotes/not-an-id')).toEqual({ page: 'not-found' });
    expect(matchRoute('/freight/not-an-id')).toEqual({ page: 'not-found' });
    expect(matchRoute('/admin')).toEqual({ page: 'not-found' });
  });
});

function Where() {
  return <p>at {usePath()}</p>;
}

describe('Link', () => {
  it('changes the page without reloading', async () => {
    render(
      <>
        <Link href="/counterparties">Counterparties</Link>
        <Where />
      </>,
    );
    await userEvent.click(screen.getByRole('link', { name: 'Counterparties' }));
    expect(screen.getByText('at /counterparties')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/counterparties');
  });
});

function Query() {
  return <p>query {useSearch() || '(none)'}</p>;
}

describe('setSearchParams', () => {
  it('changes the query in place, without a new history entry', () => {
    window.history.replaceState(null, '', '/counterparties?view=table&q=a');
    const entries = window.history.length;
    render(<Query />);
    act(() => {
      setSearchParams({ view: 'map', q: null, type: 'seller' });
    });
    expect(screen.getByText('query ?view=map&type=seller')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/counterparties');
    expect(window.history.length).toBe(entries);
  });
});
