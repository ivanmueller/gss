import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import { clearApiCache, useApiResource } from './useApiResource';

function Show({ path }: { path: string }) {
  const [resource] = useApiResource<{ name: string }>(path, 'synthetic-token');
  return <p>{resource.status === 'ok' ? resource.data.name : resource.status}</p>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useApiResource', () => {
  it('shows the last answer at once when a page opens again, then the fresh one', async () => {
    let name = 'Synthetic First';
    const calls = mockApi({ 'GET /thing': () => Response.json({ name }) });
    const first = render(<Show path="/thing" />);
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('Synthetic First')).toBeInTheDocument();
    first.unmount();

    // Opened again: no "loading", the kept answer straight away, checked again behind it.
    name = 'Synthetic Second';
    render(<Show path="/thing" />);
    expect(screen.getByText('Synthetic First')).toBeInTheDocument();
    expect(await screen.findByText('Synthetic Second')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });

  it('forgets every answer on sign-out', async () => {
    mockApi({ 'GET /thing': () => Response.json({ name: 'Synthetic Kept' }) });
    const first = render(<Show path="/thing" />);
    await screen.findByText('Synthetic Kept');
    first.unmount();
    act(() => {
      clearApiCache();
    });
    render(<Show path="/thing" />);
    expect(screen.getByText('loading')).toBeInTheDocument();
  });
});
