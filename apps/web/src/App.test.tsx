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

/** The connection indicator in the top bar. */
function connection() {
  return within(screen.getByRole('banner')).getByRole('status');
}

describe('API status', () => {
  it('shows a quiet dot while the API answers', async () => {
    const fetchMock = mockHealth(Response.json({ status: 'ok', service: 'api' }));
    render(<App />);

    await waitFor(() => {
      expect(connection()).toHaveTextContent('Connected to the server');
    });
    // Only the dot is visible; the words are for screen readers.
    expect(within(connection()).queryByText('Server unreachable')).not.toBeInTheDocument();
    expect(screen.queryByText('API reachable')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/health', expect.anything());
  });

  it('turns red and says so when the API is unreachable', async () => {
    mockHealth(new TypeError('Failed to fetch'));
    render(<App />);

    await waitFor(() => {
      expect(within(connection()).getByText('Server unreachable')).toBeVisible();
    });
    expect(connection()).toHaveTextContent('the app cannot load or save data');
  });

  it('treats an error response as unreachable', async () => {
    mockHealth(Response.json({ error: 'nope' }, { status: 500 }));
    render(<App />);

    await waitFor(() => {
      expect(within(connection()).getByText('Server unreachable')).toBeInTheDocument();
    });
  });
});

function mockMe(me: Response) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(url === '/api/v1/me' ? me : Response.json({ status: 'ok', service: 'api' })),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ALICE = {
  id: 'user-1',
  email: 'alice@example.test',
  firstName: 'Alice',
  lastName: 'synthetic',
  organizations: [{ id: 'org-a', name: 'Synthetic Org A', role: 'trader' }],
};

describe('signed-in user', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
  });

  it('shows only a profile icon until it is opened', async () => {
    const fetchMock = mockMe(Response.json(ALICE));
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    expect(await screen.findByRole('button', { name: 'Account' })).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/me', {
        headers: { Authorization: 'Bearer token-1' },
        signal: expect.any(AbortSignal) as AbortSignal,
      });
    });
    expect(screen.queryByText(/Signed in/)).not.toBeInTheDocument();
    expect(screen.queryByText('Alice S.')).not.toBeInTheDocument();
  });

  it('opens to the name confirmed by the API, never the email, and signs out', async () => {
    mockMe(Response.json(ALICE));
    const signOut = vi.fn();
    const user = userEvent.setup();
    render(<App account={{ email: 'session@example.test', accessToken: 'token-1', signOut }} />);

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    const menu = await screen.findByRole('menu');
    expect(await within(menu).findByText('Alice S.')).toBeInTheDocument();
    // One organization only: the menu names the person, not the company.
    expect(within(menu).getByText(/^Signed in as/).parentElement).toHaveTextContent(
      /^Signed in as Alice S\.$/,
    );
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
    expect(screen.queryByText('Synthetic Org A')).not.toBeInTheDocument();

    await user.click(within(menu).getByRole('menuitem', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('says "Signed in" when the user has no name set', async () => {
    mockMe(Response.json({ id: 'user-1', email: 'alice@example.test', organizations: [] }));
    window.history.replaceState(null, '', '/counterparties');
    const user = userEvent.setup();
    render(
      <App account={{ email: 'alice@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    // The directory's notice appears once the API has answered /me.
    expect(await screen.findByText(/not a member of an organization yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(within(screen.getByRole('menu')).getByText('Signed in')).toBeInTheDocument();
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });

  it('marks the profile icon and explains when the API rejects the session', async () => {
    mockMe(Response.json({ error: { code: 'MFA_REQUIRED' } }, { status: 403 }));
    const user = userEvent.setup();
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    const trigger = await screen.findByRole('button', {
      name: 'Account: session not confirmed',
    });
    await user.click(trigger);
    expect(
      within(screen.getByRole('menu')).getByText(/server could not confirm your session/),
    ).toBeInTheDocument();
  });

  it('switches between the light and night themes, and back to the device setting', async () => {
    mockMe(Response.json(ALICE));
    const user = userEvent.setup();
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('gss.theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'Light' }));
    expect(document.documentElement).not.toHaveClass('dark');

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'System' }));
    expect(window.localStorage.getItem('gss.theme')).toBeNull();
  });
});

describe('narrow screens', () => {
  it('shows a facility list instead of the table', async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const list = within(screen.getByRole('region', { name: 'Facilities' })).getByRole('list');
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
    expect(screen.queryByRole('region', { name: 'Facilities' })).not.toBeInTheDocument();
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
    expect(within(nav).getByRole('link', { name: 'Workspace' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(
      screen.getByText('Sign in to see your organization’s counterparties.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    await userEvent.click(within(nav).getByRole('link', { name: 'Map' }));
    expect(window.location.pathname).toBe('/map');
    expect(within(nav).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
    expect(
      screen.getByText('Sign in to see your organization’s counterparties.'),
    ).toBeInTheDocument();
  });

  it('keeps the menu entry lit on the pages below it', () => {
    window.history.replaceState(null, '', '/map/coordinates');
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows planned pages as not built, not as links', () => {
    render(<App />);
    const planned = screen.getByRole('list', { name: 'Coming next' });
    expect(
      within(planned)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Bids & offers', 'Scenarios', 'Team']);
    expect(within(planned).queryByRole('link')).not.toBeInTheDocument();
  });

  it('names the platform and links home from the logo', () => {
    window.history.replaceState(null, '', '/counterparties');
    render(<App />);
    expect(screen.getAllByRole('link', { name: 'GSS' })[0]).toHaveAttribute('href', '/');
  });

  it('opens the menu as a panel on narrow screens and closes it after choosing', async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    const panel = screen.getByRole('dialog', { name: 'Menu' });
    await user.click(within(panel).getByRole('link', { name: 'Counterparties' }));

    expect(window.location.pathname).toBe('/counterparties');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says when a page does not exist', () => {
    window.history.replaceState(null, '', '/nowhere');
    render(<App />);
    expect(screen.getByText(/This page does not exist/)).toBeInTheDocument();
  });
});
