import { parseWebsite } from '@grain/domain';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The database's website check and the API's parseWebsite must agree (Codex's reviews of
// the website field): every website the API saves is accepted by the database, and every
// value the database accepts is one the API also takes. Several hundred tricky addresses,
// built from schemes, site names and paths, go through both. Nothing is written.
const ADMIN_URL = process.env.API_TEST_ADMIN_DATABASE_URL;
if (!ADMIN_URL) throw new Error('Set API_TEST_ADMIN_DATABASE_URL (table owner).');

const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => undefined });

const SCHEMES = ['https://', 'http://', 'HTTPS://', '', 'ht\ttps://', 'https:', 'ftp://'];
const HOSTS = [
  'example.com',
  'www.example.co.uk',
  'Example.COM',
  'ab--cd.example.com',
  '123.example.com',
  'a.bc',
  'xn--bcher-kva.example.ca',
  'bücher.example.ca',
  'xn--a.com',
  'example.xn--a',
  'example.xn--a-',
  'ex_ample.com',
  '-bad.example.com',
  'bad-.example.com',
  `${'a'.repeat(63)}.com`,
  `${'a'.repeat(64)}.com`,
  'example.c0m',
  'example.com.',
  'localhost',
  'printer.local',
  'grain.internal',
  'synthetic.test',
  'intranet',
  '127.0.0.1',
  '0x7f.1',
  '[::1]',
  'user:secret@example.com',
  'user@example.com',
  'example.com:443',
  'example.com:8443',
  'example.com:',
  'exam\tple.com',
  'ex%61mple.com',
];
const PATHS = [
  '',
  '/',
  '/grain',
  '/grain/',
  '?region=SK',
  '#bids',
  '/a b',
  '/a\\b',
  '/%zz',
  '/"quoted"',
  '/{braces}|^`',
  `/${'é'.repeat(100)}`,
  `/${'a'.repeat(480)}`,
  `/${'a'.repeat(486)}`,
  '/\u0000',
  '/ ',
];

const candidates = [
  ...new Set(
    SCHEMES.flatMap((scheme) =>
      HOSTS.flatMap((host) => PATHS.map((path) => `${scheme}${host}${path}`)),
    ),
  ),
];

let accepted: (text: string) => boolean;

beforeAll(async () => {
  // The constraint itself, evaluated on each value as the database would on an insert.
  const [constraint] = await admin<{ definition: string }[]>`
    select pg_get_constraintdef(oid) as definition from pg_constraint
    where conname = 'counterparties_website_check' and conrelid = 'app.counterparties'::regclass`;
  const expression = constraint?.definition.replace(/^CHECK /, '');
  if (!expression) throw new Error('counterparties_website_check not found');
  // Postgres text cannot hold NUL, so a value with one can never be stored at all.
  const storable = (text: string) => !text.includes('\u0000');
  const values = [...new Set([...candidates, ...candidates.map(saved).filter(isString)])].filter(
    storable,
  );
  const rows = await admin.unsafe<{ website: string; ok: boolean | null }[]>(
    `select website, ${expression} as ok from unnest($1::text[]) as t(website)`,
    [values],
  );
  // A check passes unless it is false (a null result passes, as in Postgres).
  const results = new Map(rows.map((row) => [row.website, row.ok !== false]));
  accepted = (text) => {
    if (!storable(text)) return false;
    const result = results.get(text);
    if (result === undefined) throw new Error(`not checked: ${JSON.stringify(text)}`);
    return result;
  };
});

afterAll(async () => {
  await admin.end();
});

function saved(text: string): string | null {
  const result = parseWebsite(text);
  return result.ok ? result.website : null;
}

function isString(value: string | null): value is string {
  return value !== null;
}

describe('the database website check and parseWebsite', () => {
  it(`agree on ${String(candidates.length)} addresses`, () => {
    expect(candidates.length).toBeGreaterThan(3000);
    // Every website the API would save is accepted by the database.
    const refusedByDatabase = candidates
      .map(saved)
      .filter(isString)
      .filter((website) => !accepted(website));
    expect(refusedByDatabase).toEqual([]);
    // Every value the database accepts is one the API takes too.
    const refusedByApi = candidates.filter((text) => accepted(text) && saved(text) === null);
    expect(refusedByApi).toEqual([]);
  });

  it('refuse what Codex found the database let through', () => {
    for (const text of [
      'https://xn--a.com',
      'https://example.xn--a',
      'https://example.xn--a-',
      `https://example.com/${'é'.repeat(100)}`,
      'https://user:secret@example.com',
      'https://example.com:443',
      'https://127.0.0.1',
      'https://printer.local',
    ]) {
      expect(accepted(text), text).toBe(false);
      expect(saved(text), text).toBeNull();
    }
  });

  it('keep the API’s own output stable', () => {
    for (const text of candidates) {
      const website = saved(text);
      if (website !== null) expect(saved(website), text).toBe(website);
    }
  });
});
