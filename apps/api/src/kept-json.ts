import type { Context } from 'hono';

/**
 * A JSON answer the browser may keep and use again (F-263): the oil and gas map's data sets are
 * megabytes that change only when a load runs, so each answer carries a tag made from its own
 * bytes, and a browser that already holds those bytes is told so (304) instead of being sent
 * them again.
 *
 * `private, no-cache`: only the member's own browser keeps it, never a shared cache, and it
 * asks again before every use, so the sign-in and the membership are checked each time; a
 * person who is no longer a member gets the refusal, not the copy.
 */
export async function keptJson(c: Context, value: unknown): Promise<Response> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const byte of digest.subarray(0, 16)) hex += byte.toString(16).padStart(2, '0');
  const tag = `"${hex}"`;
  c.header('Cache-Control', 'private, no-cache');
  c.header('ETag', tag);
  // A tag comes back weak (W/"...") when the answer was compressed on its way out.
  const held = (c.req.header('If-None-Match') ?? '')
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''));
  if (held.includes(tag)) return c.body(null, 304);
  c.header('Content-Type', 'application/json; charset=UTF-8');
  // A TextEncoder's bytes are always in a plain ArrayBuffer of exactly their length.
  return c.body(bytes.buffer as ArrayBuffer);
}
