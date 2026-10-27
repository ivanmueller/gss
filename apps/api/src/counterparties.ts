import {
  groupImportRows,
  importRequestSchema,
  inspectPng,
  MAX_LOGO_BYTES,
  parseImportRow,
  type ImportGroup,
  type ImportIssue,
  type ParsedImportRow,
} from '@grain/domain';
import { Hono } from 'hono';

import { LIST_LIMIT } from './db';
import { apiError, isUuid, withDatabase, type ApiEnv, type DatabaseFactory } from './respond';

/** Largest import request body accepted, in bytes. */
export const MAX_IMPORT_BODY_BYTES = 10 * 1024 * 1024;

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
): ImportPlan {
  const parsed: ParsedImportRow[] = [];
  const issues: ImportIssue[] = [];
  let emptyRows = 0;
  for (const row of rows) {
    const result = parseImportRow(row.line, row.values);
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
    const { organizationId, fileName, commit, rows } = request.data;
    const plan = planImport(rows);

    return withDatabase(c, openDatabase, async (db, ctx) => {
      if (!(await db.canEditDirectory(ctx, organizationId))) {
        return apiError(
          c,
          403,
          'FORBIDDEN',
          'Only operations and admin members of this organization can import counterparties.',
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
          plan.groups.map(({ counterparty, contacts, facilities }) => ({
            counterparty,
            contacts,
            facilities,
          })),
        ),
      );
      const importBatchId = await db.importCounterparties(ctx, {
        organizationId,
        fileName,
        contentSha256,
        rowCount: rows.length,
        skippedCount: plan.groups.length - fresh.length,
        counterparties: fresh.map(({ counterparty, contacts, facilities }) => ({
          counterparty,
          contacts,
          facilities,
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
        return apiError(
          c,
          403,
          'FORBIDDEN',
          'Only operations and admin members of this organization can change logos.',
        );
      }
      return c.json({
        sha256: saved.sha256,
        width: check.width,
        height: check.height,
        bytes: check.png.byteLength,
      });
    });
  });

  return routes;
}
