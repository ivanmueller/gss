import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

function mockHealth(response: Response | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setViewport(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  mockHealth(Response.json({ status: 'ok', service: 'api' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'matchMedia');
});

function table() {
  return screen.getByRole('table');
}

function inspector() {
  return screen.getByRole('complementary');
}

describe('App shell', () => {
  it('labels the data as synthetic and lists the four demo facilities', () => {
    render(<App />);

    expect(screen.getByRole('note')).toHaveTextContent('Synthetic demo data');
    const rows = within(table()).getAllByRole('row');
    expect(rows).toHaveLength(5); // header + 4 facilities
    expect(within(table()).getByText('CAD 820.00/MT')).toBeInTheDocument();
    expect(within(table()).getByText('USD 725.00/MT')).toBeInTheDocument();
    expect(within(table()).getAllByText('Seller')).toHaveLength(2);
    expect(within(table()).getAllByText('Buyer')).toHaveLength(2);
  });

  it('shows validity next to every price in the table', () => {
    render(<App />);

    const cells = within(table()).getAllByText(/^Quoted .* valid until .* UTC$/);
    expect(cells).toHaveLength(2);
  });

  it('opens the first seller in the inspector', () => {
    render(<App />);

    expect(within(inspector()).getByRole('heading', { name: 'Demo Seller A' })).toBeInTheDocument();
    expect(within(inspector()).getByText('CAD 820.00/MT')).toBeInTheDocument();
    expect(within(inspector()).getByText(/Not executable/)).toBeInTheDocument();
  });

  it('shows a buyer bid with its terms when the buyer is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    const button = screen.getByRole('button', { name: 'Demo Buyer C' });
    await user.click(button);

    expect(button).toHaveAttribute('aria-pressed', 'true');
    const bid = within(inspector()).getByRole('region', { name: 'Buyer bid' });
    expect(within(bid).getByText('USD 725.00/MT')).toBeInTheDocument();
    expect(
      within(bid).getByText('Quoted 2026-10-26 16:30 UTC · valid until 2026-11-09 23:59 UTC'),
    ).toBeInTheDocument();
    expect(within(bid).getByText('Delivered')).toBeInTheDocument();
    expect(within(bid).getByText('21.000–84.000 MT')).toBeInTheDocument();
  });

  it('shows a known buyer without a bid as not pairable', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Demo Buyer D' }));

    expect(within(inspector()).getByText('No active bid')).toBeInTheDocument();
    expect(within(inspector()).getByText(/cannot be paired/)).toBeInTheDocument();
    expect(within(inspector()).queryByText(/\/MT$/)).not.toBeInTheDocument();
  });

  it('filters the table by role', async () => {
    const user = userEvent.setup();
    render(<App />);

    const buyers = screen.getByRole('button', { name: 'Buyers' });
    await user.click(buyers);

    expect(buyers).toHaveAttribute('aria-pressed', 'true');
    expect(within(table()).queryByText('Demo Seller A')).not.toBeInTheDocument();
    expect(within(table()).getByText('Demo Buyer C')).toBeInTheDocument();
    expect(within(table()).getByText('Demo Buyer D')).toBeInTheDocument();
  });
});

describe('API status', () => {
  it('reports a healthy API', async () => {
    const fetchMock = mockHealth(Response.json({ status: 'ok', service: 'api' }));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('API reachable');
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.anything());
  });

  it('reports an unreachable API', async () => {
    mockHealth(new TypeError('Failed to fetch'));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('API unreachable');
    });
  });

  it('treats an error response as unreachable', async () => {
    mockHealth(Response.json({ error: 'nope' }, { status: 500 }));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('API unreachable');
    });
  });
});

describe('signed-in user', () => {
  it('shows the name confirmed by the API, never the email, and signs out', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        url === '/api/v1/me'
          ? Response.json({
              id: 'user-1',
              email: 'alice@example.test',
              firstName: 'Alice',
              lastName: 'synthetic',
              organizations: [{ id: 'org-a', name: 'Synthetic Org A', role: 'trader' }],
            })
          : Response.json({ status: 'ok', service: 'api' }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const signOut = vi.fn();
    const user = userEvent.setup();
    render(<App account={{ email: 'session@example.test', accessToken: 'token-1', signOut }} />);

    expect(await screen.findByText('Alice S.')).toBeInTheDocument();
    // One organization only: the header names the person, not the company.
    expect(screen.getByText(/^Signed in as/)).toHaveTextContent(/^Signed in as Alice S\.$/);
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/me', {
      headers: { Authorization: 'Bearer token-1' },
      signal: expect.any(AbortSignal) as AbortSignal,
    });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('says "Signed in" when the user has no name set', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/api/v1/me'
            ? Response.json({ id: 'user-1', email: 'alice@example.test', organizations: [] })
            : Response.json({ status: 'ok', service: 'api' }),
        ),
      ),
    );
    render(
      <App account={{ email: 'alice@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
  });

  it('warns when the API rejects the session', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url === '/api/v1/me'
            ? Response.json({ error: { code: 'MFA_REQUIRED' } }, { status: 403 })
            : Response.json({ status: 'ok', service: 'api' }),
        ),
      ),
    );
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    expect(await screen.findByText(/server could not confirm your session/)).toBeInTheDocument();
  });
});

describe('narrow screens', () => {
  it('shows a facility list instead of the table', async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getByText('USD 725.00/MT')).toBeInTheDocument();
    expect(within(list).getByText('No active bid')).toBeInTheDocument();

    const buyerC = within(list).getByRole('button', { name: /^Demo Buyer C/ });
    await user.click(buyerC);

    expect(buyerC).toHaveAttribute('aria-pressed', 'true');
    expect(within(inspector()).getByRole('heading', { name: 'Demo Buyer C' })).toBeInTheDocument();
  });

  it('switches between list and map with tabs', async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('tablist', { name: 'Workspace view' })).toBeInTheDocument();
    expect(screen.queryByText('Map placeholder')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Map' }));

    expect(screen.getByText('Map placeholder')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(inspector()).toBeInTheDocument();
  });

  it('uses the two-column layout on wide screens', () => {
    setViewport(true);
    render(<App />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText('Map placeholder')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('marks the current page and moves between pages', async () => {
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Workspace' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    await userEvent.click(within(nav).getByRole('link', { name: 'Counterparties' }));
    expect(within(nav).getByRole('link', { name: 'Counterparties' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(
      screen.getByText('Sign in to see your organization’s counterparties.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says when a page does not exist', () => {
    window.history.replaceState(null, '', '/nowhere');
    render(<App />);
    expect(screen.getByText(/This page does not exist/)).toBeInTheDocument();
  });
});
