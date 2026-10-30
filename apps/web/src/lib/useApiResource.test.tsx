import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import { clearApiCache, signedInAs, useApiResource } from './useApiResource';

function Show({
  path,
  token = 'synthetic-token',
  keepPrevious = false,
}: {
  path: string;
  token?: string;
  keepPrevious?: boolean;
}) {
  const [resource] = useApiResource<{ name: string }>(path, token, { keepPrevious });
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

  // Codex's review of ivanmueller/gss#85.
  it.each([false, true])(
    'never shows one sign-in’s answer under another (keepPrevious %s)',
    async (keepPrevious) => {
      let release: () => void = () => undefined;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      mockApi({
        'GET /thing': async (call) => {
          if (call.headers.get('Authorization') === 'Bearer token-b') await waiting;
          return Response.json({
            name:
              call.headers.get('Authorization') === 'Bearer token-a'
                ? 'Synthetic A'
                : 'Synthetic B',
          });
        },
      });
      const { rerender } = render(
        <Show path="/thing" token="token-a" keepPrevious={keepPrevious} />,
      );
      expect(await screen.findByText('Synthetic A')).toBeInTheDocument();
      rerender(<Show path="/thing" token="token-b" keepPrevious={keepPrevious} />);
      expect(screen.queryByText('Synthetic A')).not.toBeInTheDocument();
      expect(screen.getByText('loading')).toBeInTheDocument();
      release();
      expect(await screen.findByText('Synthetic B')).toBeInTheDocument();
    },
  );

  it('does not keep an answer that arrives after the cache was emptied', async () => {
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockApi({
      'GET /thing': async () => {
        await waiting;
        return Response.json({ name: 'Synthetic Late' });
      },
    });
    const first = render(<Show path="/thing" />);
    act(() => {
      clearApiCache();
    });
    release();
    expect(await screen.findByText('Synthetic Late')).toBeInTheDocument();
    first.unmount();
    // Opened again: nothing kept, so it loads afresh.
    render(<Show path="/thing" />);
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('tells people apart by the id in their token, so a renewed token is the same person', () => {
    const jwt = (sub: string, iat: number) =>
      `header.${btoa(JSON.stringify({ sub, iat })).replace(/=+$/, '')}.signature`;
    expect(signedInAs(jwt('user-a', 1))).toBe('user:user-a');
    expect(signedInAs(jwt('user-a', 2))).toBe(signedInAs(jwt('user-a', 1)));
    expect(signedInAs(jwt('user-b', 1))).not.toBe(signedInAs(jwt('user-a', 1)));
    // A token that is not a JWT stands for itself.
    expect(signedInAs('synthetic-token')).toBe('token:synthetic-token');
  });
});
