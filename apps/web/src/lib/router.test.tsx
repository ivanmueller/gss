import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { Link, matchRoute, usePath } from './router';

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('matchRoute', () => {
  it('knows the app pages', () => {
    expect(matchRoute('/')).toEqual({ page: 'workspace' });
    expect(matchRoute('/counterparties/')).toEqual({ page: 'counterparties' });
    expect(matchRoute('/counterparties/import')).toEqual({ page: 'import' });
    expect(matchRoute('/counterparties/00000000-0000-4000-8000-00000000c001')).toEqual({
      page: 'counterparty',
      id: '00000000-0000-4000-8000-00000000c001',
    });
  });

  it('treats anything else as not found', () => {
    expect(matchRoute('/counterparties/not-an-id')).toEqual({ page: 'not-found' });
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
