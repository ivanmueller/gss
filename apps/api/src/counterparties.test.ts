import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_LIMIT, type CounterpartySummary, type Database } from './db';
import { createApp } from './index';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
const app = createApp(openDatabase);

const ORG = '00000000-0000-4000-8000-0000000000aa';
const COUNTERPARTY = '00000000-0000-4000-8000-00000000c0aa';
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
    const detail = { ...summary('Synthetic Buyer LLC'), notes: null, contacts: [], facilities: [] };
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

  it('returns 404 for a counterparty the user cannot see and 403 for one they cannot edit', async () => {
    db.putLogo.mockResolvedValueOnce({ status: 'not_found' });
    expect((await put(PNG)).status).toBe(404);
    db.putLogo.mockResolvedValueOnce({ status: 'forbidden' });
    expect((await put(PNG)).status).toBe(403);
  });
});

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
    db.counterpartyKeys.mockResolvedValueOnce(new Set(['US:synthetic existing co']));
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
    db.counterpartyKeys.mockResolvedValueOnce(new Set(['US:synthetic existing co']));
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

  it('says when there is nothing new to import', async () => {
    db.counterpartyKeys.mockResolvedValueOnce(
      new Set(['CA:synthetic mills', 'US:synthetic existing co']),
    );
    const res = await postImport({ ...body, commit: true });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: { code: 'NOTHING_TO_IMPORT' } });
    expect(db.importCounterparties).not.toHaveBeenCalled();
  });

  it('refuses users who cannot edit the directory, before reading it', async () => {
    db.canEditDirectory.mockResolvedValueOnce(false);
    const res = await postImport(body);
    expect(res.status).toBe(403);
    expect(db.counterpartyKeys).not.toHaveBeenCalled();
    expect(db.importCounterparties).not.toHaveBeenCalled();
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
