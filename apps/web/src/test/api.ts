import { vi } from 'vitest';

export interface Call {
  method: string;
  path: string;
  headers: Headers;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response>;

/**
 * Stubs fetch with handlers keyed by "METHOD /path" (path without /api/v1, query included).
 * Unhandled calls answer 404. Returns the recorded calls.
 */
export function mockApi(handlers: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const path = input.replace(/^\/api\/v1/, '');
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : init.body;
      const call = { method, path, headers: new Headers(init.headers), body };
      calls.push(call);
      const handler = handlers[`${method} ${path}`];
      return handler
        ? handler(call)
        : Response.json({ error: { code: 'NOT_FOUND', message: 'Not found.' } }, { status: 404 });
    }),
  );
  return calls;
}

export const ORG = {
  id: '00000000-0000-4000-8000-0000000000aa',
  name: 'Synthetic Org A',
  role: 'org_admin',
};

export const SESSION = { token: 'synthetic-token', organization: ORG };

// A valid 1x1 PNG.
export const PNG = Uint8Array.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082'.match(
    /../g,
  ) ?? [],
  (pair) => parseInt(pair, 16),
);
