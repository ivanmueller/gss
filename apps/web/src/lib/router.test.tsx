import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  goBackTo,
  Link,
  matchRoute,
  navigate,
  setSearchParams,
  usePath,
  useRestoredScroll,
  useSearch,
} from './router';
import { BackLink } from '../components/BackLink';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('matchRoute', () => {
  it('knows the app pages', () => {
    expect(matchRoute('/')).toEqual({ page: 'workspace' });
    expect(matchRoute('/counterparties/')).toEqual({ page: 'counterparties' });
    expect(matchRoute('/team')).toEqual({ page: 'team' });
    expect(matchRoute('/grains')).toEqual({ page: 'grains' });
    expect(matchRoute('/grains/canary-seed')).toEqual({
      page: 'redirect',
      to: '/grains?grain=canary-seed',
    });
    expect(matchRoute('/grains/Oats')).toEqual({ page: 'not-found' });
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

// The owner's request of 2026-11-04: Back from a counterparty returns to the list as it was.
describe('going back', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('remembers where a page was scrolled and where the next one was opened from', () => {
    window.history.replaceState(null, '', '/counterparties?type=seller&q=oat');
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(1234);
    const replace = vi.spyOn(window.history, 'replaceState');
    navigate('/counterparties/00000000-0000-4000-8000-00000000c001');
    expect(replace).toHaveBeenCalledWith(
      { scrollY: 1234 },
      '',
      '/counterparties?type=seller&q=oat',
    );
    expect(window.history.state).toEqual({ from: '/counterparties?type=seller&q=oat' });
  });

  it('uses the browser’s Back when the page was opened from the one asked for', () => {
    window.history.replaceState({ from: '/counterparties?type=seller' }, '', '/counterparties/x');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    goBackTo('/counterparties');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('opens the page afresh when it was not opened from it', () => {
    window.history.replaceState({ from: '/follow-ups' }, '', '/counterparties/x');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    goBackTo('/counterparties');
    expect(back).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/counterparties');
  });

  it('is what the back arrow does', async () => {
    window.history.replaceState({ from: '/counterparties?tier=A' }, '', '/counterparties/x');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    render(<BackLink href="/counterparties">All counterparties</BackLink>);
    await userEvent.click(screen.getByRole('link', { name: 'All counterparties' }));
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('scrolls back once the content shows, and only when returning', () => {
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    function Page({ ready }: { ready: boolean }) {
      useRestoredScroll(ready);
      return null;
    }
    window.history.replaceState({ scrollY: 900 }, '', '/counterparties');
    const { rerender, unmount } = render(<Page ready={false} />);
    expect(scroll).not.toHaveBeenCalled();
    rerender(<Page ready />);
    expect(scroll).toHaveBeenCalledWith(0, 900);
    unmount();
    scroll.mockClear();
    window.history.replaceState(null, '', '/counterparties');
    render(<Page ready />);
    expect(scroll).not.toHaveBeenCalled();
  });
});
