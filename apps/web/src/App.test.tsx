import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { setDemoData } from './lib/demo';
import { setThemePreference } from './lib/theme';

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
  setDemoData(false);
});

function table() {
  return screen.getByRole('table');
}

describe('App shell', () => {
  it('opens on the workspace, empty until demo data is turned on', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Workspace', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Order book' })).toHaveTextContent(
      'No asks or bids yet.',
    );
    expect(table()).toHaveTextContent('No facilities with asks or bids yet.');
    expect(screen.queryByText('Demo')).not.toBeInTheDocument();
    // Tests build without a Mapbox token, so the map explains itself (Workspace.test.tsx covers it).
    expect(screen.getByText('Map not available')).toBeInTheDocument();
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
    // Back to following the device, as for a new visitor.
    setThemePreference('system');
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
    expect(await screen.findByText(/You don’t have access yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(within(screen.getByRole('menu')).getByText('Signed in')).toBeInTheDocument();
    expect(screen.queryByText(/example\.test/)).not.toBeInTheDocument();
    window.history.replaceState(null, '', '/');
  });

  it('warns on the page, not only in the menu, when the API rejects the session', async () => {
    mockMe(Response.json({ error: { code: 'MFA_REQUIRED' } }, { status: 403 }));
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    // Visible without opening anything (Codex review): the workspace stays on screen.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The server could not confirm your session.');
    expect(alert).toBeVisible();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Workspace', level: 1 })).toBeInTheDocument();
    // The profile icon is marked too.
    expect(
      screen.getByRole('button', { name: 'Account: session not confirmed' }),
    ).toBeInTheDocument();
  });

  it('shows no session warning when the API accepts the session', async () => {
    mockMe(Response.json(ALICE));
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    expect(await screen.findByRole('button', { name: 'Account' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('switches between the light and night themes with one switch', async () => {
    mockMe(Response.json(ALICE));
    const user = userEvent.setup();
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Dark mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    // One switch, not a list of theme choices.
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();

    await user.click(toggle);
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem('gss.theme')).toBe('dark');
    // The menu stays open, showing the switch on.
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Dark mode' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('gss.theme')).toBe('light');
  });

  it('turns demo data on and off with a switch above Dark mode, showing Demo beside GSS', async () => {
    mockMe(Response.json(ALICE));
    const user = userEvent.setup();
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );
    expect(screen.queryByText('Demo')).not.toBeInTheDocument();

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual([
      'Demo data',
      'Dark mode',
    ]);
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Demo data' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await user.click(toggle);
    expect(window.localStorage.getItem('gss.demo')).toBe('on');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Demo data' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.keyboard('{Escape}');

    // Beside the GSS name (in the menu and, on small screens, the top bar), outside its link.
    const [tag] = screen.getAllByText('Demo');
    expect(tag).toHaveAttribute('title', expect.stringMatching(/^Demo data is on/));
    expect(tag?.closest('a')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'GSS' }).length).toBeGreaterThan(0);
    expect(within(table()).getAllByRole('row')).toHaveLength(10); // header + 9 facilities

    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Demo data' }));
    await user.keyboard('{Escape}');
    expect(window.localStorage.getItem('gss.demo')).toBeNull();
    expect(screen.queryByText('Demo')).not.toBeInTheDocument();
    expect(table()).toHaveTextContent('No facilities with asks or bids yet.');
  });

  it('shows the switch on when the device is in dark mode and nothing is chosen yet', async () => {
    setViewport(true);
    mockMe(Response.json(ALICE));
    const user = userEvent.setup();
    render(
      <App account={{ email: 'session@example.test', accessToken: 'token-1', signOut: vi.fn() }} />,
    );

    await user.click(await screen.findByRole('button', { name: 'Account' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

describe('narrow screens', () => {
  it('shows the workspace as tabs instead of the table', () => {
    setViewport(false);
    render(<App />);

    expect(screen.getByRole('tablist', { name: 'Workspace view' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('uses the full layout on wide screens', () => {
    setViewport(true);
    render(<App />);

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
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
    expect(screen.getByText('Sign in to see the counterparties.')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();

    // The map is a view of the Counterparties page, not a menu entry of its own.
    expect(within(nav).queryByRole('link', { name: 'Map' })).not.toBeInTheDocument();
  });

  it('keeps the menu entry lit on the pages below it', () => {
    window.history.replaceState(null, '', '/counterparties/coordinates');
    render(<App />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Counterparties' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('sends the old map addresses to the counterparties map', async () => {
    window.history.replaceState(null, '', '/map');
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/counterparties?view=map');
    });
    const nav = screen.getByRole('navigation', { name: 'Main' });
    expect(within(nav).getByRole('link', { name: 'Counterparties' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    window.history.replaceState(null, '', '/map/coordinates');
    render(<App />);
    await waitFor(() => {
      expect(window.location.pathname).toBe('/counterparties/coordinates');
    });
  });

  it('links Bids & offers and Freight in the menu', () => {
    render(<App />);
    expect(screen.getAllByRole('link', { name: 'Bids & offers' })[0]).toHaveAttribute(
      'href',
      '/quotes',
    );
    expect(screen.getAllByRole('link', { name: 'Freight' })[0]).toHaveAttribute('href', '/freight');
  });

  it('shows planned pages as not built, not as links', () => {
    render(<App />);
    const planned = screen.getByRole('list', { name: 'Coming next' });
    expect(
      within(planned)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Scenarios']);
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

  it('keeps the phone menu closed after the window widens and narrows again', async () => {
    // A viewport whose width can change mid-test, telling listeners as a browser would.
    let wide = false;
    const listeners = new Set<() => void>();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({
        get matches() {
          return query === '(min-width: 1024px)' && wide;
        },
        media: query,
        addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
        removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      }),
    });
    const resize = (next: boolean) => {
      wide = next;
      act(() => {
        for (const listener of [...listeners]) listener();
      });
    };
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByRole('dialog', { name: 'Menu' })).toBeInTheDocument();

    resize(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Narrowing again must not bring the panel back by itself (Codex review).
    resize(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says when a page does not exist', () => {
    window.history.replaceState(null, '', '/nowhere');
    render(<App />);
    expect(screen.getByText(/This page does not exist/)).toBeInTheDocument();
  });
});
