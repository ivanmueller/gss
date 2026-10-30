import { crc32 } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LIST_LIMIT,
  type CounterpartySummary,
  type Database,
  type ExistingCounterparty,
} from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const COUNTERPARTY = '00000000-0000-4000-8000-00000000c0aa';
const CONTACT = '00000000-0000-4000-8000-0000000c01aa';
const FACILITY = '00000000-0000-4000-8000-000000000f1a';
const VERSION = '2026-10-28T14:05:09.123456Z';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}` };
// A valid 1x1 PNG.
const PNG = Uint8Array.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63d0ab35fa0f00039701ddcce659270000000049454e44ae426082'.match(
    /../g,
  ) ?? [],
  (pair) => parseInt(pair, 16),
);

function summary(name: string): CounterpartySummary {
  return {
    id: COUNTERPARTY,
    organizationId: ORG,
    legalName: name,
    tradingName: null,
    types: ['buyer'],
    primaryCountry: 'US',
    verificationStatus: 'unverified',
    source: 'file_import',
    createdAt: '2026-10-27T00:00:00.000Z',
    contactCount: 0,
    facilityCount: 1,
    regions: ['ND'],
    logoSha256: null,
    archivedAt: null,
    buys: [],
    sells: [],
    markets: [],
    tier: null,
  };
}

function request(path: string, init: RequestInit = {}) {
  return app.request(`/api/v1/counterparties${path}`, init, ENV);
}

function postImport(body: unknown, headers: Record<string, string> = {}) {
  return request('/import', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuthServer(Response.json({ id: USER_ID, email: 'olivia@example.test' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  db = fakeDatabase();
  openDatabase.mockClear();
});

describe('authentication', () => {
  it.each([
    ['GET', ''],
    ['GET', `/${COUNTERPARTY}`],
    ['GET', `/${COUNTERPARTY}/logo`],
    ['PUT', `/${COUNTERPARTY}/logo`],
    ['POST', '/import'],
    ['POST', ''],
    ['PATCH', `/${COUNTERPARTY}`],
    ['POST', `/${COUNTERPARTY}/archive`],
    ['POST', `/${COUNTERPARTY}/restore`],
    ['POST', `/${COUNTERPARTY}/contacts`],
    ['PATCH', `/${COUNTERPARTY}/contacts/${CONTACT}`],
    ['DELETE', `/${COUNTERPARTY}/contacts/${CONTACT}`],
    ['POST', `/${COUNTERPARTY}/facilities`],
    ['PATCH', `/${COUNTERPARTY}/facilities/${FACILITY}`],
    ['DELETE', `/${COUNTERPARTY}/facilities/${FACILITY}`],
  ])('%s %s requires sign-in', async (method, path) => {
    const res = await request(path, { method });
    expect(res.status).toBe(401);
    expect(openDatabase).not.toHaveBeenCalled();
  });
});

describe('GET /api/v1/counterparties', () => {
  it("lists what the database returns for the verified user, tagged with the request's id", async () => {
    db.listCounterparties.mockResolvedValueOnce([summary('Synthetic Buyer LLC')]);
    const res = await request('', { headers: AUTH });

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      counterparties: [summary('Synthetic Buyer LLC')],
      truncated: false,
    });
    const requestId = res.headers.get('x-request-id');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(db.listCounterparties).toHaveBeenCalledWith({ userId: USER_ID, requestId }, null);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('filters by organization and refuses a malformed organization id', async () => {
    await request(`?organization_id=${ORG}`, { headers: AUTH });
    expect(db.listCounterparties).toHaveBeenCalledWith(expect.anything(), ORG);

    openDatabase.mockClear();
    const res = await request('?organization_id=org-a', { headers: AUTH });
    expect(res.status).toBe(422);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('says when the list was cut at the limit', async () => {
    db.listCounterparties.mockResolvedValueOnce(
      Array.from({ length: LIST_LIMIT + 1 }, (_, index) => summary(`Synthetic ${String(index)}`)),
    );
    const body: { counterparties: unknown[]; truncated: boolean } = await (
      await request('', { headers: AUTH })
    ).json();
    expect(body.counterparties).toHaveLength(LIST_LIMIT);
    expect(body.truncated).toBe(true);
  });

  it('fails closed and disconnects when the database errors', async () => {
    db.listCounterparties.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request('', { headers: AUTH });
    expect(res.status).toBe(503);
    expect(db.close).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/v1/counterparties/:id', () => {
  it('returns 404 for an id that is not a UUID without asking the database', async () => {
    const res = await request('/not-a-uuid', { headers: AUTH });
    expect(res.status).toBe(404);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('returns 404 when the counterparty is not visible to the user', async () => {
    const res = await request(`/${COUNTERPARTY}`, { headers: AUTH });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns the counterparty with its contacts and facilities', async () => {
    const detail = {
      ...summary('Synthetic Buyer LLC'),
      website: null,
      phone: null,
      notes: null,
      version: VERSION,
      contacts: [],
      facilities: [],
      commodities: [],
    };
    db.getCounterparty.mockResolvedValueOnce(detail);
    const res = await request(`/${COUNTERPARTY}`, { headers: AUTH });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(detail);
    expect(db.getCounterparty).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      COUNTERPARTY,
    );
  });
});

describe('GET /api/v1/counterparties/:id/logo', () => {
  it('returns 404 when there is no logo', async () => {
    expect((await request(`/${COUNTERPARTY}/logo`, { headers: AUTH })).status).toBe(404);
  });

  it('serves the PNG so that it cannot be sniffed or run as a page', async () => {
    db.getLogo.mockResolvedValueOnce({ data: PNG, sha256: 'a'.repeat(64) });
    const res = await request(`/${COUNTERPARTY}/logo`, { headers: AUTH });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
    expect(res.headers.get('etag')).toBe(`"${'a'.repeat(64)}"`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('answers 304 when the browser already has this logo', async () => {
    db.getLogo.mockResolvedValueOnce({ data: PNG, sha256: 'a'.repeat(64) });
    const res = await request(`/${COUNTERPARTY}/logo`, {
      headers: { ...AUTH, 'If-None-Match': `"${'a'.repeat(64)}"` },
    });
    expect(res.status).toBe(304);
  });

  it('lets the browser keep a logo asked for by its checksum, and only that one', async () => {
    db.getLogo.mockResolvedValue({ data: PNG, sha256: 'a'.repeat(64) });
    const current = await request(`/${COUNTERPARTY}/logo?v=${'a'.repeat(64)}`, { headers: AUTH });
    expect(current.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    // Kept per sign-in, never handed to another login on the same browser.
    expect(current.headers.get('vary')).toBe('Authorization');
    // An old checksum (the logo was replaced since) is not kept.
    const old = await request(`/${COUNTERPARTY}/logo?v=${'b'.repeat(64)}`, { headers: AUTH });
    expect(old.headers.get('cache-control')).toBe('private, no-cache');
  });
});

describe('PUT /api/v1/counterparties/:id/logo', () => {
  function put(body: Uint8Array | string, headers: Record<string, string> = {}) {
    return request(`/${COUNTERPARTY}/logo`, {
      method: 'PUT',
      headers: { ...AUTH, 'Content-Type': 'image/png', ...headers },
      body: body as BodyInit,
    });
  }

  it('saves a PNG as the verified user', async () => {
    const res = await put(PNG);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sha256: 'f'.repeat(64), width: 1, height: 1, bytes: 70 });
    expect(db.putLogo).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      COUNTERPARTY,
      PNG,
    );
  });

  it('refuses other content types', async () => {
    const res = await put('<svg/>', { 'Content-Type': 'image/svg+xml' });
    expect(res.status).toBe(415);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('refuses a file that is not really a PNG', async () => {
    const res = await put(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_PNG' } });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('refuses a logo over 512 KB', async () => {
    const res = await put(new Uint8Array(512 * 1024 + 1));
    expect(res.status).toBe(413);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('stores the cleaned copy, without text chunks hidden in the upload', async () => {
    // The 1x1 PNG with a tEXt chunk carrying HTML inserted after IHDR (at byte 33).
    const data = Uint8Array.from('Comment\u0000<b>hi</b>', (char) => char.charCodeAt(0));
    const text = new Uint8Array(12 + data.byteLength);
    const view = new DataView(text.buffer);
    view.setUint32(0, data.byteLength);
    text.set([0x74, 0x45, 0x58, 0x74], 4); // "tEXt"
    text.set(data, 8);
    view.setUint32(8 + data.byteLength, crc32(text.subarray(4, 8 + data.byteLength)));
    const withText = new Uint8Array([...PNG.subarray(0, 33), ...text, ...PNG.subarray(33)]);

    const res = await put(withText);
    expect(res.status).toBe(200);
    expect(db.putLogo.mock.calls[0]?.[2]).toEqual(PNG);
  });

  it('refuses a PNG with no image data or with bytes slipped between its chunks', async () => {
    const headerOnly = new Uint8Array([...PNG.subarray(0, 33), ...PNG.subarray(PNG.length - 12)]);
    expect((await put(headerOnly)).status).toBe(422);
    const html = Uint8Array.from('<html>x</html>', (char) => char.charCodeAt(0));
    const slipped = new Uint8Array([
      ...PNG.subarray(0, 33),
      ...html,
      ...PNG.subarray(PNG.length - 12),
    ]);
    expect((await put(slipped)).status).toBe(422);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('does not retry an upload when the connection is lost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.putLogo.mockRejectedValueOnce(
      Object.assign(new Error('write CONNECTION_CLOSED db.example.test:5432'), {
        code: 'CONNECTION_CLOSED',
      }),
    );
    const res = await put(PNG);
    vi.restoreAllMocks();

    expect(res.status).toBe(503);
    expect(db.putLogo).toHaveBeenCalledTimes(1);
  });

  it('returns 404 for a counterparty the user cannot see and 403 for one they cannot edit', async () => {
    db.putLogo.mockResolvedValueOnce({ status: 'not_found' });
    expect((await put(PNG)).status).toBe(404);
    db.putLogo.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await put(PNG)).status).toBe(403);
  });
});

/** A company already in the list, with nothing under it unless given. */
function existing(
  legalName: string,
  primaryCountry: string,
  overrides: Partial<ExistingCounterparty> = {},
): ExistingCounterparty {
  return {
    id: `00000000-0000-4000-8000-${String(legalName.length).padStart(12, '0')}`,
    primaryCountry,
    legalName,
    archived: false,
    facilities: [],
    contacts: [],
    commodities: [],
    ...overrides,
  };
}

describe('POST /api/v1/counterparties/import', () => {
  const rows = [
    {
      line: 2,
      values: { legalName: 'Synthetic Mills', country: 'CA', city: 'Alpha', region: 'SK' },
    },
    { line: 3, values: { legalName: 'Synthetic Mills', country: 'CA', contactName: 'Ana' } },
    { line: 4, values: { legalName: 'Synthetic Existing Co', country: 'US' } },
    { line: 5, values: { legalName: '', country: '' } },
  ];
  const body = { organizationId: ORG, fileName: 'buyers.csv', commit: false, rows };

  it('previews an import without writing anything', async () => {
    db.existingCounterparties.mockResolvedValueOnce([existing('Synthetic Existing Co', 'US')]);
    const res = await postImport(body);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      committed: false,
      importBatchId: null,
      summary: {
        rows: 4,
        emptyRows: 1,
        invalidRows: 0,
        counterparties: 2,
        newCounterparties: 1,
        existingCounterparties: 1,
        contacts: 1,
        facilities: 1,
        existingWithAdditions: 0,
        addedContacts: 0,
        addedFacilities: 0,
        addedCommodities: 0,
      },
      counterparties: [
        {
          legalName: 'Synthetic Mills',
          country: 'CA',
          lines: [2, 3],
          contacts: 1,
          facilities: 1,
          status: 'new',
        },
        {
          legalName: 'Synthetic Existing Co',
          country: 'US',
          lines: [4],
          contacts: 0,
          facilities: 0,
          status: 'existing',
        },
      ],
      issues: [],
      warnings: [],
    });
    expect(db.canEditDirectory).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
    );
    expect(db.importCounterparties).not.toHaveBeenCalled();
  });

  it('reports row problems in the preview', async () => {
    const res = await postImport({
      ...body,
      rows: [{ line: 9, values: { legalName: 'A', country: 'Mexico' } }],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      summary: { invalidRows: 1 },
      issues: [
        { line: 9, field: 'country', message: '"Mexico" is not Canada or the United States' },
      ],
    });
  });

  it('imports the new companies only, in one call, as the verified user', async () => {
    db.existingCounterparties.mockResolvedValueOnce([existing('Synthetic Existing Co', 'US')]);
    const res = await postImport({ ...body, commit: true });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      committed: true,
      importBatchId: '00000000-0000-4000-8000-0000000ba7c4',
    });
    expect(db.importCounterparties).toHaveBeenCalledTimes(1);
    const [ctx, batch] = db.importCounterparties.mock.calls[0] ?? [];
    expect(ctx).toEqual({ userId: USER_ID, requestId: res.headers.get('x-request-id') });
    expect(batch).toMatchObject({
      organizationId: ORG,
      fileName: 'buyers.csv',
      rowCount: 4,
      skippedCount: 1,
      counterparties: [
        {
          counterparty: { legalName: 'Synthetic Mills', primaryCountry: 'CA', types: ['buyer'] },
          contacts: [{ name: 'Ana' }],
          facilities: [{ city: 'Alpha', region: 'SK', country: 'CA' }],
        },
      ],
    });
    expect(batch?.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('imports a Commodities column as what the companies buy', async () => {
    const res = await postImport({
      organizationId: ORG,
      fileName: 'buyers.csv',
      commit: true,
      defaultTypes: ['buyer'],
      rows: [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Peas Inc',
            country: 'CA',
            commodities: 'Yellow peas; Flax',
          },
        },
        {
          line: 3,
          values: { legalName: 'Synthetic Peas Inc', country: 'CA', commodities: 'Green peas' },
        },
      ],
    });
    expect(res.status).toBe(201);
    const [, batch] = db.importCounterparties.mock.calls[0] ?? [];
    expect(batch?.counterparties[0]?.commodities).toEqual([
      { commodity: 'flaxseed', direction: 'buys' },
      { commodity: 'yellow_peas', direction: 'buys' },
      { commodity: 'green_peas', direction: 'buys' },
    ]);
  });

  it('refuses a row whose commodities are not on the list', async () => {
    const res = await postImport({
      organizationId: ORG,
      fileName: 'buyers.csv',
      commit: true,
      rows: [
        { line: 4, values: { legalName: 'Synthetic Co', country: 'CA', commodities: 'Wheat' } },
      ],
    });
    expect(await res.json()).toMatchObject({
      issues: [{ line: 4, field: 'commodities' }],
    });
    expect(db.importCounterparties).not.toHaveBeenCalled();
  });

  it('gives the same content the same checksum, so a repeat import is refused', async () => {
    await postImport({ ...body, commit: true });
    await postImport({ ...body, commit: true, fileName: 'renamed.csv' });
    const [first, second] = db.importCounterparties.mock.calls.map(
      ([, batch]) => batch.contentSha256,
    );
    expect(first).toBe(second);

    db.importCounterparties.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint_name: 'import_batches_organization_id_kind_content_sha256_key',
      }),
    );
    const res = await postImport({ ...body, commit: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'ALREADY_IMPORTED' } });
  });

  it('refuses to commit while any row has a problem', async () => {
    const res = await postImport({
      ...body,
      commit: true,
      rows: [...rows, { line: 6, values: { legalName: 'B', country: 'US', region: 'Alberta' } }],
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
      issues: [{ line: 6, field: 'region' }],
    });
    expect(db.importCounterparties).not.toHaveBeenCalled();
  });

  it('adds new locations, contacts and grains to a company already in the list, matched loosely', async () => {
    db.existingCounterparties.mockResolvedValueOnce([
      existing('Synthetic Mills Limited', 'CA', {
        facilities: [
          {
            name: null,
            addressLine: null,
            city: 'Alpha',
            region: 'SK',
            postalCode: null,
            country: 'CA',
            // Found since: a file row without coordinates is still the same place.
            latitude: '50.450000',
            longitude: '-104.600000',
          },
        ],
        contacts: [{ name: 'Ana', email: null, phone: null }],
        commodities: [{ commodity: 'canola', direction: 'buys' }],
      }),
      existing('Synthetic Closed Co', 'US', { archived: true }),
    ]);
    const res = await postImport({
      ...body,
      commit: true,
      rows: [
        // "Synthetic Mills Ltd." is the "Synthetic Mills Limited" already in the list.
        {
          line: 2,
          values: {
            legalName: 'Synthetic Mills Ltd.',
            country: 'CA',
            city: 'Alpha',
            region: 'SK',
            commodities: 'Canola; Oats',
          },
        },
        {
          line: 3,
          values: { legalName: 'SYNTHETIC MILLS LTD', country: 'CA', city: 'Beta', region: 'MB' },
        },
        {
          line: 4,
          values: { legalName: 'Synthetic Mills Ltd.', country: 'CA', contactName: 'Ana' },
        },
        {
          line: 5,
          values: { legalName: 'Synthetic Mills Ltd.', country: 'CA', contactName: 'Ben' },
        },
        {
          line: 6,
          values: { legalName: 'Synthetic Closed Co', country: 'US', city: 'Gamma', region: 'ND' },
        },
      ],
    });
    expect(res.status).toBe(201);
    const answer = await res.json<{
      summary: Record<string, number>;
      counterparties: { legalName: string; status: string; facilities: number; contacts: number }[];
      warnings: { line: number; field: string }[];
    }>();
    expect(answer.summary).toMatchObject({
      newCounterparties: 0,
      existingCounterparties: 2,
      existingWithAdditions: 1,
      addedFacilities: 1,
      addedContacts: 1,
      addedCommodities: 1,
    });
    expect(answer.counterparties).toMatchObject([
      { legalName: 'Synthetic Mills Ltd.', status: 'existing', facilities: 1, contacts: 1 },
      { legalName: 'Synthetic Closed Co', status: 'archived' },
    ]);
    // A spelling that differs from the first row's is said on the check step.
    expect(answer.warnings).toContainEqual(
      expect.objectContaining({ line: 3, field: 'legalName' }),
    );
    expect(db.importCounterparties).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        counterparties: [],
        additions: [
          {
            counterpartyId: existing('Synthetic Mills Limited', 'CA').id,
            facilities: [expect.objectContaining({ city: 'Beta', region: 'MB' }) as unknown],
            contacts: [expect.objectContaining({ name: 'Ben' }) as unknown],
            commodities: [{ commodity: 'oats', direction: 'buys' }],
          },
        ],
      }),
    );
  });

  it('says when there is nothing new to import', async () => {
    db.existingCounterparties.mockResolvedValueOnce([
      existing('Synthetic Mills', 'CA', {
        facilities: [
          {
            name: null,
            addressLine: null,
            city: 'Alpha',
            region: 'SK',
            postalCode: null,
            country: 'CA',
            latitude: null,
            longitude: null,
          },
        ],
        contacts: [{ name: 'Ana', email: null, phone: null }],
      }),
      existing('Synthetic Existing Co', 'US'),
    ]);
    const res = await postImport({ ...body, commit: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'NOTHING_TO_IMPORT' } });
    expect(db.importCounterparties).not.toHaveBeenCalled();
  });

  it('refuses users who cannot edit the directory, before reading it', async () => {
    db.canEditDirectory.mockResolvedValueOnce(false);
    const res = await postImport(body);
    expect(res.status).toBe(403);
    expect(db.existingCounterparties).not.toHaveBeenCalled();
    expect(db.importCounterparties).not.toHaveBeenCalled();
  });

  it('does not retry an import when the connection is lost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.importCounterparties.mockRejectedValueOnce(
      Object.assign(new Error('write CONNECTION_CLOSED db.example.test:5432'), {
        code: 'CONNECTION_CLOSED',
      }),
    );
    const res = await postImport({ ...body, commit: true });
    vi.restoreAllMocks();

    expect(res.status).toBe(503);
    expect(db.importCounterparties).toHaveBeenCalledTimes(1);
  });

  it('maps a row level security refusal to 403', async () => {
    db.importCounterparties.mockRejectedValueOnce(
      Object.assign(new Error('new row violates row-level security policy'), { code: '42501' }),
    );
    expect((await postImport({ ...body, commit: true })).status).toBe(403);
  });

  it.each([
    ['not JSON', '{'],
    ['a missing organization', { ...body, organizationId: undefined }],
    ['an unknown field', { ...body, rows: [{ line: 2, values: { legal_name: 'A' } }] }],
    ['no rows', { ...body, rows: [] }],
  ])('refuses %s without opening the database', async (_, payload) => {
    const res = await postImport(payload);
    expect(res.status).toBe(422);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('refuses a body over 10 MB', async () => {
    const res = await postImport(body, { 'Content-Length': String(10 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(openDatabase).not.toHaveBeenCalled();
  });
});

describe('POST /api/v1/counterparties/import with buyers or sellers', () => {
  it('uses the chosen types for rows without one', async () => {
    const res = await postImport({
      organizationId: ORG,
      fileName: 'sellers.csv',
      commit: true,
      defaultTypes: ['seller'],
      rows: [
        { line: 2, values: { legalName: 'Synthetic Grower', country: 'CA' } },
        { line: 3, values: { legalName: 'Synthetic Mill', country: 'CA', types: 'buyer' } },
      ],
    });
    expect(res.status).toBe(201);
    const batch = db.importCounterparties.mock.calls[0]?.[1];
    expect(batch?.counterparties.map((item) => item.counterparty.types)).toEqual([
      ['seller'],
      ['buyer'],
    ]);
  });
});

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...summary('Synthetic Buyer LLC'),
    website: null,
    phone: null,
    notes: null,
    version: VERSION,
    contacts: [],
    facilities: [],
    commodities: [],
    ...overrides,
  };
}

function send(method: string, path: string, body?: unknown) {
  return request(path, {
    method,
    headers: { ...AUTH, 'Content-Type': 'application/json' },
    ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

describe('POST /api/v1/counterparties (add by hand)', () => {
  const values = {
    legalName: ' Synthetic  Grower ',
    country: 'Canada',
    types: 'seller',
    contactName: 'Synthetic Farmer',
    city: 'Synthetic Town',
    region: 'Saskatchewan',
  };

  it('creates the counterparty with its first contact and location, as the verified user', async () => {
    const res = await send('POST', '', { organizationId: ORG, values });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: '00000000-0000-4000-8000-00000000c0de' });
    expect(db.createCounterparty).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
      {
        counterparty: expect.objectContaining({
          legalName: 'Synthetic Grower',
          primaryCountry: 'CA',
          types: ['seller'],
        }) as unknown,
        contacts: [expect.objectContaining({ name: 'Synthetic Farmer' }) as unknown],
        facilities: [
          expect.objectContaining({
            city: 'Synthetic Town',
            region: 'SK',
            country: 'CA',
          }) as unknown,
        ],
        commodities: [],
      },
    );
  });

  it('saves the company phone, and the location’s rail or truck access given beside it', async () => {
    const res = await send('POST', '', {
      organizationId: ORG,
      values: { ...values, companyPhone: '306 555 0100 ext. 4' },
      transportAccess: 'rail_and_truck',
    });
    expect(res.status).toBe(201);
    expect(db.createCounterparty).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.objectContaining({
        counterparty: expect.objectContaining({ phone: '306 555 0100 x4' }) as unknown,
        facilities: [expect.objectContaining({ transportAccess: 'rail_and_truck' }) as unknown],
      }),
    );
  });

  it('refuses a company phone that is not one, and an unknown access', async () => {
    const phone = await send('POST', '', {
      organizationId: ORG,
      values: { ...values, companyPhone: 'ask for Pat' },
    });
    expect(phone.status).toBe(422);
    expect(await phone.json()).toMatchObject({
      issues: [{ field: 'companyPhone', message: '"ask for Pat" is not a phone number' }],
    });
    const access = await send('POST', '', {
      organizationId: ORG,
      values,
      transportAccess: 'barge',
    });
    expect(access.status).toBe(422);
    expect(db.createCounterparty).not.toHaveBeenCalled();
  });

  it('takes a location with only the country the form filled in as no location', async () => {
    const res = await send('POST', '', {
      organizationId: ORG,
      values: {
        legalName: 'Synthetic Grower',
        country: 'CA',
        types: 'seller',
        facilityCountry: 'CA',
      },
    });
    expect(res.status).toBe(201);
    expect(db.createCounterparty).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      expect.objectContaining({ contacts: [], facilities: [] }),
    );
  });

  it('returns each problem with its field, without opening the database', async () => {
    const res = await send('POST', '', {
      organizationId: ORG,
      values: { legalName: 'Synthetic Grower', country: 'Mexico' },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
      issues: [
        { field: 'country', message: '"Mexico" is not Canada or the United States' },
        { field: 'types', message: 'choose at least one: buyer, seller, broker or carrier' },
      ],
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('refuses a reader who cannot edit', async () => {
    db.createCounterparty.mockResolvedValueOnce({ status: 'forbidden' });
    const res = await send('POST', '', { organizationId: ORG, values });
    expect(res.status).toBe(403);
  });

  it('says when the name is already in the list', async () => {
    db.createCounterparty.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint_name: 'counterparties_name_unique',
      }),
    );
    const res = await send('POST', '', { organizationId: ORG, values });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'DUPLICATE_NAME' } });
  });

  it.each([
    ['not JSON', '{'],
    ['an unknown field', { organizationId: ORG, values: { password: 'x' } }],
    ['a malformed organization', { organizationId: 'org-a', values }],
  ])('refuses %s without opening the database', async (_, payload) => {
    const res = await send('POST', '', payload);
    expect(res.status).toBe(422);
    expect(openDatabase).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/counterparties/:id', () => {
  const values = { legalName: 'Synthetic Renamed', country: 'US', types: 'buyer,seller' };

  it('saves the details for the version the user saw and returns the counterparty', async () => {
    db.getCounterparty.mockResolvedValueOnce(detail({ legalName: 'Synthetic Renamed' }));
    const res = await send('PATCH', `/${COUNTERPARTY}`, { version: VERSION, values });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ legalName: 'Synthetic Renamed' });
    expect(db.updateCounterparty).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      COUNTERPARTY,
      VERSION,
      expect.objectContaining({ legalName: 'Synthetic Renamed', types: ['buyer', 'seller'] }),
    );
  });

  it('saves a website tidied, and refuses one that is not a web address', async () => {
    db.getCounterparty.mockResolvedValueOnce(detail({ website: 'https://example.com' }));
    const saved = await send('PATCH', `/${COUNTERPARTY}`, {
      version: VERSION,
      values: { ...values, website: ' Example.com/ ' },
    });
    expect(saved.status).toBe(200);
    expect(db.updateCounterparty).toHaveBeenCalledWith(
      expect.anything(),
      COUNTERPARTY,
      VERSION,
      expect.objectContaining({ website: 'https://example.com' }),
    );

    openDatabase.mockClear();
    const refused = await send('PATCH', `/${COUNTERPARTY}`, {
      version: VERSION,
      values: { ...values, website: 'javascript:alert(1)' },
    });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({
      issues: [{ field: 'website', message: 'must be a web address such as example.com' }],
    });
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it.each([
    ['not_found', 404, 'NOT_FOUND'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['changed', 409, 'RECORD_CHANGED'],
    ['archived', 409, 'ARCHIVED'],
  ] as const)('answers %s with %i %s', async (status, code, errorCode) => {
    db.updateCounterparty.mockResolvedValueOnce({ status });
    const res = await send('PATCH', `/${COUNTERPARTY}`, { version: VERSION, values });
    expect(res.status).toBe(code);
    expect(await res.json()).toMatchObject({ error: { code: errorCode } });
    expect(db.getCounterparty).not.toHaveBeenCalled();
  });

  it('needs a version and only the counterparty’s own fields', async () => {
    expect((await send('PATCH', `/${COUNTERPARTY}`, { values })).status).toBe(422);
    expect(
      (
        await send('PATCH', `/${COUNTERPARTY}`, {
          version: VERSION,
          values: { ...values, city: 'Elsewhere' },
        })
      ).status,
    ).toBe(422);
    expect((await send('PATCH', '/not-a-uuid', { version: VERSION, values })).status).toBe(404);
    expect(openDatabase).not.toHaveBeenCalled();
  });

  it('does not retry an edit when the connection is lost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    db.updateCounterparty.mockRejectedValueOnce(
      Object.assign(new Error('write CONNECTION_CLOSED'), { code: 'CONNECTION_CLOSED' }),
    );
    const res = await send('PATCH', `/${COUNTERPARTY}`, { version: VERSION, values });
    vi.restoreAllMocks();
    expect(res.status).toBe(503);
    expect(db.updateCounterparty).toHaveBeenCalledTimes(1);
  });
});

describe('archiving', () => {
  it.each([
    ['archive', true],
    ['restore', false],
  ])('POST /:id/%s', async (action, archived) => {
    db.getCounterparty.mockResolvedValueOnce(detail());
    const res = await send('POST', `/${COUNTERPARTY}/${action}`);
    expect(res.status).toBe(200);
    expect(db.setArchived).toHaveBeenCalledWith(expect.anything(), COUNTERPARTY, archived);
  });

  it('refuses a reader who cannot edit', async () => {
    db.setArchived.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await send('POST', `/${COUNTERPARTY}/archive`)).status).toBe(403);
  });
});

describe('contacts', () => {
  it('adds a contact and returns the counterparty', async () => {
    db.getCounterparty.mockResolvedValueOnce(detail());
    const res = await send('POST', `/${COUNTERPARTY}/contacts`, {
      values: { contactName: 'Synthetic Ana', contactEmail: 'ana@example.test' },
    });
    expect(res.status).toBe(201);
    expect(db.addContact).toHaveBeenCalledWith(expect.anything(), COUNTERPARTY, {
      name: 'Synthetic Ana',
      role: null,
      email: 'ana@example.test',
      phone: null,
    });
  });

  it('needs a name', async () => {
    const res = await send('POST', `/${COUNTERPARTY}/contacts`, { values: {} });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      issues: [{ field: 'contactName', message: 'is required' }],
    });
  });

  it('corrects a contact for its version and refuses a stale one', async () => {
    db.getCounterparty.mockResolvedValueOnce(detail());
    const path = `/${COUNTERPARTY}/contacts/${CONTACT}`;
    const body = { version: VERSION, values: { contactName: 'Synthetic Ana' } };
    expect((await send('PATCH', path, body)).status).toBe(200);
    expect(db.updateContact).toHaveBeenCalledWith(
      expect.anything(),
      COUNTERPARTY,
      CONTACT,
      VERSION,
      expect.objectContaining({ name: 'Synthetic Ana' }),
    );
    db.updateContact.mockResolvedValueOnce({ status: 'changed' });
    const stale = await send('PATCH', path, body);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: 'RECORD_CHANGED' } });
  });

  it('removes a contact, or answers 404 for one that is not there', async () => {
    db.getCounterparty.mockResolvedValueOnce(detail());
    expect((await send('DELETE', `/${COUNTERPARTY}/contacts/${CONTACT}`)).status).toBe(200);
    expect(db.removeContact).toHaveBeenCalledWith(expect.anything(), COUNTERPARTY, CONTACT);
    db.removeContact.mockResolvedValueOnce({ status: 'not_found' });
    expect((await send('DELETE', `/${COUNTERPARTY}/contacts/${CONTACT}`)).status).toBe(404);
    expect((await send('DELETE', `/${COUNTERPARTY}/contacts/nope`)).status).toBe(404);
  });

  it('makes a contact the main contact, or none, and returns the counterparty', async () => {
    db.getCounterparty.mockResolvedValue(detail());
    const path = `/${COUNTERPARTY}/main-contact`;
    expect((await send('PUT', path, { contactId: CONTACT })).status).toBe(200);
    expect(db.setMainContact).toHaveBeenCalledWith(expect.anything(), COUNTERPARTY, CONTACT);
    expect((await send('PUT', path, { contactId: null })).status).toBe(200);
    expect(db.setMainContact).toHaveBeenLastCalledWith(expect.anything(), COUNTERPARTY, null);
  });

  it('refuses a malformed main contact, one that is not there and a reader', async () => {
    const path = `/${COUNTERPARTY}/main-contact`;
    expect((await send('PUT', path, { contactId: 'k1' })).status).toBe(422);
    expect((await send('PUT', path, {})).status).toBe(422);
    expect((await send('PUT', '/nope/main-contact', { contactId: null })).status).toBe(404);
    expect(db.setMainContact).not.toHaveBeenCalled();
    db.setMainContact.mockResolvedValueOnce({ status: 'not_found' });
    expect((await send('PUT', path, { contactId: CONTACT })).status).toBe(404);
    db.setMainContact.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await send('PUT', path, { contactId: CONTACT })).status).toBe(403);
    db.setMainContact.mockResolvedValueOnce({ status: 'archived' });
    expect((await send('PUT', path, { contactId: CONTACT })).status).toBe(409);
  });
});

describe('commodities', () => {
  const path = `/${COUNTERPARTY}/commodities`;

  it('adds and removes what a counterparty buys or sells, and returns the counterparty', async () => {
    db.getCounterparty.mockResolvedValueOnce(detail());
    const change = {
      add: [{ commodity: 'canola', direction: 'buys' }],
      remove: [{ commodity: 'oats', direction: 'sells' }],
    };
    const res = await send('PATCH', path, change);
    expect(res.status).toBe(200);
    expect(db.changeCommodities).toHaveBeenCalledWith(expect.anything(), COUNTERPARTY, {
      ...change,
      verify: [],
    });
  });

  it('verifies listed commodities', async () => {
    db.getCounterparty.mockResolvedValueOnce(detail());
    const verify = [{ commodity: 'canola', direction: 'buys' }];
    const res = await send('PATCH', path, { add: [], remove: [], verify });
    expect(res.status).toBe(200);
    expect(db.changeCommodities).toHaveBeenCalledWith(expect.anything(), COUNTERPARTY, {
      add: [],
      remove: [],
      verify,
    });
  });

  it('refuses commodities off the list, other directions and an empty change', async () => {
    for (const body of [
      { add: [{ commodity: 'hemp', direction: 'buys' }], remove: [] },
      { add: [{ commodity: 'canola', direction: 'trades' }], remove: [] },
      { add: [], remove: [] },
      { add: [], remove: [], verify: [] },
      { add: [], remove: [], verify: [{ commodity: 'hemp', direction: 'buys' }] },
      { add: [{ commodity: 'canola', direction: 'buys' }] },
    ]) {
      expect((await send('PATCH', path, body)).status).toBe(422);
    }
    expect(db.changeCommodities).not.toHaveBeenCalled();
  });

  it('answers 404 for a counterparty out of reach and 409 for an archived one', async () => {
    const body = { add: [{ commodity: 'canola', direction: 'buys' }], remove: [] };
    expect((await send('PATCH', '/nope/commodities', body)).status).toBe(404);
    db.changeCommodities.mockResolvedValueOnce({ status: 'not_found' });
    expect((await send('PATCH', path, body)).status).toBe(404);
    db.changeCommodities.mockResolvedValueOnce({ status: 'archived' });
    const archived = await send('PATCH', path, body);
    expect(archived.status).toBe(409);
    expect(await archived.json()).toMatchObject({ error: { code: 'ARCHIVED' } });
    // Archived while the change waited: the database's refusal.
    db.changeCommodities.mockRejectedValueOnce(
      Object.assign(new Error('archived'), { code: 'GS005' }),
    );
    const late = await send('PATCH', path, body);
    expect(late.status).toBe(409);
    expect(await late.json()).toMatchObject({ error: { code: 'ARCHIVED' } });
  });
});

describe('locations', () => {
  it('puts a new location in the counterparty’s country unless it names its own', async () => {
    db.getCounterparty.mockResolvedValue(detail({ primaryCountry: 'US' }));
    const res = await send('POST', `/${COUNTERPARTY}/facilities`, {
      values: { city: 'Synthetic Falls', region: 'ND' },
    });
    expect(res.status).toBe(201);
    expect(db.addFacility).toHaveBeenCalledWith(
      expect.anything(),
      COUNTERPARTY,
      expect.objectContaining({ city: 'Synthetic Falls', region: 'ND', country: 'US' }),
    );
  });

  it('adds a location with its access, and keeps the access when a change leaves it out', async () => {
    db.getCounterparty.mockResolvedValue(detail({ primaryCountry: 'CA' }));
    const added = await send('POST', `/${COUNTERPARTY}/facilities`, {
      values: { city: 'Synthetic Spur' },
      transportAccess: 'rail',
    });
    expect(added.status).toBe(201);
    expect(db.addFacility).toHaveBeenCalledWith(
      expect.anything(),
      COUNTERPARTY,
      expect.objectContaining({ city: 'Synthetic Spur', transportAccess: 'rail' }),
    );
    const path = `/${COUNTERPARTY}/facilities/${FACILITY}`;
    const kept = await send('PATCH', path, {
      version: VERSION,
      values: { city: 'Synthetic Spur' },
    });
    expect(kept.status).toBe(200);
    expect(db.updateFacility).toHaveBeenLastCalledWith(
      expect.anything(),
      COUNTERPARTY,
      FACILITY,
      VERSION,
      expect.objectContaining({ transportAccess: undefined }),
    );
    const cleared = await send('PATCH', path, {
      version: VERSION,
      values: { city: 'Synthetic Spur' },
      transportAccess: null,
    });
    expect(cleared.status).toBe(200);
    expect(db.updateFacility).toHaveBeenLastCalledWith(
      expect.anything(),
      COUNTERPARTY,
      FACILITY,
      VERSION,
      expect.objectContaining({ transportAccess: null }),
    );
  });

  it('answers 404 when the counterparty is not visible, before saving', async () => {
    const res = await send('POST', `/${COUNTERPARTY}/facilities`, {
      values: { city: 'Synthetic Falls' },
    });
    expect(res.status).toBe(404);
    expect(db.addFacility).not.toHaveBeenCalled();
  });

  it('returns problems with their fields', async () => {
    db.getCounterparty.mockResolvedValue(detail({ primaryCountry: 'CA' }));
    const res = await send('PATCH', `/${COUNTERPARTY}/facilities/${FACILITY}`, {
      version: VERSION,
      values: { city: 'Synthetic Town', postalCode: '12345' },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({
      issues: [{ field: 'postalCode', message: '"12345" is not a postal code like S4P 3Y2' }],
    });
    expect(db.updateFacility).not.toHaveBeenCalled();
  });

  it('corrects and removes a location', async () => {
    db.getCounterparty.mockResolvedValue(detail({ primaryCountry: 'CA' }));
    const path = `/${COUNTERPARTY}/facilities/${FACILITY}`;
    const res = await send('PATCH', path, {
      version: VERSION,
      values: { city: 'Synthetic Town', latitude: '52.1', longitude: '-106.6' },
    });
    expect(res.status).toBe(200);
    expect(db.updateFacility).toHaveBeenCalledWith(
      expect.anything(),
      COUNTERPARTY,
      FACILITY,
      VERSION,
      expect.objectContaining({
        latitude: '52.100000',
        longitude: '-106.600000',
        locationPrecision: 'approximate',
      }),
    );
    expect((await send('DELETE', path)).status).toBe(200);
    expect(db.removeFacility).toHaveBeenCalledWith(expect.anything(), COUNTERPARTY, FACILITY);
  });
});
