import {
  commodityChangeSchema,
  createContactSchema,
  createCounterpartySchema,
  createFacilitySchema,
  groupImportRows,
  importRequestSchema,
  inspectPng,
  mainContactSchema,
  MAX_LOGO_BYTES,
  normalizeCountry,
  parseContactFields,
  parseCounterpartyFields,
  parseFacilityFields,
  parseImportRow,
  parseNewCounterparty,
  updateContactSchema,
  updateCounterpartySchema,
  updateFacilitySchema,
  type CounterpartyType,
  type FieldIssue,
  type ImportGroup,
  type ImportIssue,
  type ParsedImportRow,
} from '@grain/domain';
import { Hono } from 'hono';

import { LIST_LIMIT, type Database, type RequestContext, type WriteResult } from './db';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

/** Largest import request body accepted, in bytes. */
export const MAX_IMPORT_BODY_BYTES = 10 * 1024 * 1024;
/** Largest body of a form (add, edit) accepted, in bytes. */
const MAX_FORM_BODY_BYTES = 64 * 1024;

const FORBIDDEN_EDIT = 'Only operations and admin members can change counterparties.';

type RecordKind = 'counterparty' | 'contact' | 'location';

/** A schema refusal (zod's error, of which only the paths are used). */
function malformed(c: ApiContext, error: { issues: { path: PropertyKey[] }[] }) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.', {
    fields: error.issues.slice(0, 20).map((issue) => issue.path.map(String).join('.')),
  });
}

/** A form with problems: each one with its field, so the form can show it in place. */
function invalid(c: ApiContext, issues: FieldIssue[]) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'Some fields need fixing.', { issues });
}

function refused(
  c: ApiContext,
  result: Exclude<WriteResult, { status: 'saved' }>,
  what: RecordKind,
) {
  switch (result.status) {
    case 'not_found':
      return apiError(c, 404, 'NOT_FOUND', `No such ${what}.`);
    case 'forbidden':
      return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_EDIT);
    case 'changed':
      return apiError(
        c,
        409,
        'RECORD_CHANGED',
        `Someone changed this ${what} after you opened it. Reload the page to see their change, then make yours again.`,
      );
    case 'archived':
      return apiError(
        c,
        409,
        'ARCHIVED',
        'This counterparty is archived. Restore it before changing it.',
      );
  }
}

/** After a change: the counterparty as it now is, with its contacts and locations. */
async function savedDetail(
  c: ApiContext,
  db: Database,
  ctx: RequestContext,
  id: string,
  result: WriteResult,
  what: RecordKind,
  status: 200 | 201 = 200,
) {
  if (result.status !== 'saved') return refused(c, result, what);
  const counterparty = await db.getCounterparty(ctx, id);
  return counterparty
    ? c.json(counterparty, status)
    : apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function declaredLength(header: string | undefined): number | null {
  if (header === undefined || !/^\d+$/.test(header)) return null;
  return Number(header);
}

interface ImportPlan {
  parsed: ParsedImportRow[];
  emptyRows: number;
  issues: ImportIssue[];
  warnings: ImportIssue[];
  groups: ImportGroup[];
}

function planImport(
  rows: { line: number; values: Record<string, string | undefined> }[],
  defaultTypes: readonly CounterpartyType[] | undefined,
): ImportPlan {
  const parsed: ParsedImportRow[] = [];
  const issues: ImportIssue[] = [];
  let emptyRows = 0;
  for (const row of rows) {
    const result = parseImportRow(row.line, row.values, defaultTypes ? { defaultTypes } : {});
    if (result.status === 'ok') parsed.push(result.row);
    else if (result.status === 'empty') emptyRows += 1;
    else issues.push(...result.issues);
  }
  const { groups, warnings } = groupImportRows(parsed);
  return { parsed, emptyRows, issues, warnings, groups };
}

/** /api/v1/counterparties. Mounted after requireUser, so every route needs a signed-in user. */
export function counterpartyRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? null;
    if (organizationId !== null && !isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const rows = await db.listCounterparties(ctx, organizationId);
      return c.json({
        counterparties: rows.slice(0, LIST_LIMIT),
        truncated: rows.length > LIST_LIMIT,
      });
    });
  });

  routes.post('/import', async (c) => {
    c.header('Cache-Control', 'no-store');
    const declared = declaredLength(c.req.header('content-length'));
    if (declared !== null && declared > MAX_IMPORT_BODY_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'The import is larger than 10 MB.');
    }
    const text = await c.req.text();
    if (text.length > MAX_IMPORT_BODY_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'The import is larger than 10 MB.');
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The request body is not JSON.');
    }
    const request = importRequestSchema.safeParse(body);
    if (!request.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The import request is malformed.', {
        fields: request.error.issues.slice(0, 20).map((issue) => issue.path.join('.')),
      });
    }
    const { organizationId, fileName, commit, rows, defaultTypes } = request.data;
    const plan = planImport(rows, defaultTypes);

    return withDatabase(c, openDatabase, async (db, ctx) => {
      if (!(await db.canEditDirectory(ctx, organizationId))) {
        return apiError(
          c,
          403,
          'FORBIDDEN',
          'Only operations and admin members can import counterparties.',
        );
      }
      const existing = await db.counterpartyKeys(ctx, organizationId);
      const fresh = plan.groups.filter((group) => !existing.has(group.key));
      const result = {
        committed: false,
        importBatchId: null as string | null,
        summary: {
          rows: rows.length,
          emptyRows: plan.emptyRows,
          invalidRows: new Set(plan.issues.map((issue) => issue.line)).size,
          counterparties: plan.groups.length,
          newCounterparties: fresh.length,
          existingCounterparties: plan.groups.length - fresh.length,
          contacts: fresh.reduce((sum, group) => sum + group.contacts.length, 0),
          facilities: fresh.reduce((sum, group) => sum + group.facilities.length, 0),
        },
        counterparties: plan.groups.map((group) => ({
          legalName: group.counterparty.legalName,
          country: group.counterparty.primaryCountry,
          lines: group.lines,
          contacts: group.contacts.length,
          facilities: group.facilities.length,
          status: existing.has(group.key) ? 'existing' : 'new',
        })),
        issues: plan.issues,
        warnings: plan.warnings,
      };
      if (!commit) return c.json(result);

      if (plan.issues.length > 0) {
        return apiError(c, 422, 'VALIDATION_FAILED', 'Fix the rows with problems first.', result);
      }
      if (fresh.length === 0) {
        return apiError(
          c,
          409,
          'NOTHING_TO_IMPORT',
          'Every company in this file is already in the list.',
          result,
        );
      }
      const contentSha256 = await sha256Hex(
        JSON.stringify(
          // Without commodities or a company phone, the same as before they could be imported.
          plan.groups.map(
            ({ counterparty: { phone, ...counterparty }, contacts, facilities, commodities }) => ({
              counterparty: phone === null ? counterparty : { ...counterparty, phone },
              contacts,
              facilities,
              ...(commodities.length > 0 && { commodities }),
            }),
          ),
        ),
      );
      const importBatchId = await db.importCounterparties(ctx, {
        organizationId,
        fileName,
        contentSha256,
        rowCount: rows.length,
        skippedCount: plan.groups.length - fresh.length,
        counterparties: fresh.map(({ counterparty, contacts, facilities, commodities }) => ({
          counterparty,
          contacts,
          facilities,
          commodities,
        })),
      });
      return c.json({ ...result, committed: true, importBatchId }, 201);
    });
  });

  routes.get('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const counterparty = await db.getCounterparty(ctx, id);
      return counterparty
        ? c.json(counterparty)
        : apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    });
  });

  routes.get('/:id/logo', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No logo.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const logo = await db.getLogo(ctx, id);
      if (!logo) return apiError(c, 404, 'NOT_FOUND', 'No logo.');
      const etag = `"${logo.sha256}"`;
      // Served only as a PNG that cannot be sniffed, framed or run as a document.
      c.header('Cache-Control', 'private, no-cache');
      c.header('ETag', etag);
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Content-Security-Policy', "default-src 'none'; sandbox");
      c.header('Cross-Origin-Resource-Policy', 'same-origin');
      if (c.req.header('if-none-match') === etag) return c.body(null, 304);
      c.header('Content-Type', 'image/png');
      return c.body(logo.data as Uint8Array<ArrayBuffer>, 200);
    });
  });

  routes.put('/:id/logo', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const type = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'image/png') {
      return apiError(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Logos must be uploaded as image/png.');
    }
    const declared = declaredLength(c.req.header('content-length'));
    if (declared !== null && declared > MAX_LOGO_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'Logos must be 512 KB or smaller.');
    }
    const data = new Uint8Array(await c.req.arrayBuffer());
    const check = await inspectPng(data);
    if (!check.ok) {
      return check.reason === 'TOO_LARGE'
        ? apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'Logos must be 512 KB or smaller.')
        : apiError(
            c,
            422,
            check.reason,
            check.reason === 'NOT_PNG'
              ? 'The file is not a PNG image.'
              : 'Logos must be between 1 and 4096 pixels wide and high.',
          );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      // Store the rebuilt copy: validated chunks only, no hidden text or trailing data.
      const saved = await db.putLogo(ctx, id, check.png);
      if (saved.status === 'not_found')
        return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
      if (saved.status === 'forbidden') {
        return apiError(c, 403, 'FORBIDDEN', 'Only operations and admin members can change logos.');
      }
      return c.json({
        sha256: saved.sha256,
        width: check.width,
        height: check.height,
        bytes: check.png.byteLength,
      });
    });
  });

  // One counterparty entered by hand, with an optional first contact and location (GT-020).
  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createCounterpartySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseNewCounterparty(request.data.values);
    if (parsed.status === 'empty')
      return invalid(c, [{ field: null, message: 'The form is empty.' }]);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    const { counterparty, contact, facility, commodities } = parsed.record;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const created = await db.createCounterparty(ctx, request.data.organizationId, {
        counterparty,
        contacts: contact ? [contact] : [],
        facilities: facility
          ? [{ ...facility, transportAccess: request.data.transportAccess ?? null }]
          : [],
        commodities,
      });
      if (created.status === 'forbidden') return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_EDIT);
      return c.json({ id: created.id }, 201);
    });
  });

  routes.patch('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateCounterpartySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseCounterpartyFields(request.data.values);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.updateCounterparty(ctx, id, request.data.version, parsed.value);
      return savedDetail(c, db, ctx, id, result, 'counterparty');
    });
  });

  // Archiving hides a counterparty from the list and the map; it is never deleted.
  for (const [action, archived] of [
    ['archive', true],
    ['restore', false],
  ] as const) {
    routes.post(`/:id/${action}`, async (c) => {
      c.header('Cache-Control', 'no-store');
      const id = c.req.param('id');
      if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
      return withDatabase(c, openDatabase, async (db, ctx) => {
        const result = await db.setArchived(ctx, id, archived);
        return savedDetail(c, db, ctx, id, result, 'counterparty');
      });
    });
  }

  routes.post('/:id/contacts', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createContactSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseContactFields(request.data.values);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.addContact(ctx, id, parsed.value);
      return savedDetail(c, db, ctx, id, result, 'counterparty', 201);
    });
  });

  routes.patch('/:id/contacts/:contactId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, contactId } = c.req.param();
    if (!isUuid(id) || !isUuid(contactId)) return apiError(c, 404, 'NOT_FOUND', 'No such contact.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateContactSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseContactFields(request.data.values);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.updateContact(ctx, id, contactId, request.data.version, parsed.value);
      return savedDetail(c, db, ctx, id, result, 'contact');
    });
  });

  routes.delete('/:id/contacts/:contactId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, contactId } = c.req.param();
    if (!isUuid(id) || !isUuid(contactId)) return apiError(c, 404, 'NOT_FOUND', 'No such contact.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.removeContact(ctx, id, contactId);
      return savedDetail(c, db, ctx, id, result, 'contact');
    });
  });

  // What it buys and sells: anyone on the team may change it (owner's answer, 2026-10-30).
  routes.patch('/:id/commodities', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = commodityChangeSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.changeCommodities(ctx, id, request.data);
      return savedDetail(c, db, ctx, id, result, 'counterparty');
    });
  });

  routes.put('/:id/main-contact', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = mainContactSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.setMainContact(ctx, id, request.data.contactId);
      return savedDetail(c, db, ctx, id, result, 'contact');
    });
  });

  // A location's country defaults to its counterparty's, so the counterparty is read first.
  routes.post('/:id/facilities', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createFacilitySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const counterparty = await db.getCounterparty(ctx, id);
      if (!counterparty) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
      const parsed = parseFacilityFields(
        request.data.values,
        normalizeCountry(counterparty.primaryCountry) ?? 'CA',
      );
      if (parsed.status === 'invalid') return invalid(c, parsed.issues);
      const result = await db.addFacility(ctx, id, {
        ...parsed.value,
        transportAccess: request.data.transportAccess ?? null,
      });
      return savedDetail(c, db, ctx, id, result, 'counterparty', 201);
    });
  });

  routes.patch('/:id/facilities/:facilityId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, facilityId } = c.req.param();
    if (!isUuid(id) || !isUuid(facilityId))
      return apiError(c, 404, 'NOT_FOUND', 'No such location.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateFacilitySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const counterparty = await db.getCounterparty(ctx, id);
      if (!counterparty) return apiError(c, 404, 'NOT_FOUND', 'No such location.');
      const parsed = parseFacilityFields(
        request.data.values,
        normalizeCountry(counterparty.primaryCountry) ?? 'CA',
      );
      if (parsed.status === 'invalid') return invalid(c, parsed.issues);
      const result = await db.updateFacility(ctx, id, facilityId, request.data.version, {
        ...parsed.value,
        transportAccess: request.data.transportAccess,
      });
      return savedDetail(c, db, ctx, id, result, 'location');
    });
  });

  routes.delete('/:id/facilities/:facilityId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, facilityId } = c.req.param();
    if (!isUuid(id) || !isUuid(facilityId))
      return apiError(c, 404, 'NOT_FOUND', 'No such location.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.removeFacility(ctx, id, facilityId);
      return savedDetail(c, db, ctx, id, result, 'location');
    });
  });

  return routes;
}
