import {
  correctContactLogSchema,
  createContactLogSchema,
  createFollowUpSchema,
  endOfCentralDay,
  parseContactLog,
  parseFollowUp,
  updateFollowUpSchema,
  type CrmIssue,
} from '@grain/domain';
import { Hono } from 'hono';

import { CRM_LIST_LIMIT, type FollowUpStatus, type FollowUpWriteResult } from './crm-db';
import type { Database, RequestContext } from './db';
import { recorderName } from './quotes';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

// The CRM for counterparties: /api/v1/contact-log and /api/v1/follow-ups (the owner's
// request of 2026-10-29). Mounted after requireUser, so every route needs a signed-in user.

const MAX_BODY_BYTES = 32 * 1024;
const FORBIDDEN_LOG = 'Only traders, operations and admins log contacts.';
const FORBIDDEN_PLAN = 'Only traders, operations and admins plan and change follow-ups.';
const FORBIDDEN_DONE =
  'Only traders, operations and admins, or the person responsible, mark a follow-up done.';
const NO_COUNTERPARTY = 'No such counterparty.';
const NO_ENTRY = 'No such contact log entry.';
const NO_FOLLOW_UP = 'No such follow-up.';
const ARCHIVED =
  'This counterparty is archived. Restore it before logging contacts or planning follow-ups.';
const NOT_A_MEMBER = 'Choose the person responsible from the team list.';

function malformed(c: ApiContext, error: { issues: { path: PropertyKey[] }[] }) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.', {
    fields: error.issues.slice(0, 20).map((issue) => issue.path.map(String).join('.')),
  });
}

function invalid(c: ApiContext, issues: CrmIssue[]) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'Some fields need fixing.', { issues });
}

/** /api/v1/contact-log: each contact GSS has with a counterparty, corrected by new versions. */
export function contactLogRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const counterpartyId = c.req.query('counterparty_id') ?? '';
    if (!isUuid(counterpartyId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'counterparty_id must be a UUID.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const entries = await db.listContactLog(ctx, counterpartyId);
      return c.json({ entries, truncated: entries.length >= CRM_LIST_LIMIT });
    });
  });

  routes.get('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_ENTRY);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const entry = await db.getContactLogEntry(ctx, id);
      return entry ? c.json(entry) : apiError(c, 404, 'NOT_FOUND', NO_ENTRY);
    });
  });

  // A contact, and the follow-up planned with it when there is one, in one transaction.
  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createContactLogSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const log = parseContactLog(request.data.values, new Date());
    const plan = request.data.followUp ? parseFollowUp(request.data.followUp) : null;
    const issues = [
      ...(log.status === 'invalid' ? log.issues : []),
      ...(plan?.status === 'invalid' ? plan.issues : []),
    ];
    if (log.status === 'invalid' || plan?.status === 'invalid') return invalid(c, issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const created = await db.createContactLog(ctx, {
        counterpartyId: request.data.counterpartyId,
        log: log.value,
        followUp: plan?.value ?? null,
        recordedByName: recorderName(c.get('user')),
      });
      switch (created.status) {
        case 'created': {
          const entry = await db.getContactLogEntry(ctx, created.id);
          return entry
            ? c.json({ entry, followUpId: created.followUpId }, 201)
            : apiError(c, 404, 'NOT_FOUND', 'The new entry could not be read back.');
        }
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', NO_COUNTERPARTY);
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_LOG);
        case 'archived':
          return apiError(c, 409, 'ARCHIVED', ARCHIVED);
        case 'not_a_member':
          return apiError(c, 422, 'NOT_A_MEMBER', NOT_A_MEMBER);
      }
    });
  });

  // A correction: a new version; the earlier ones stay as they were.
  routes.post('/:id/revisions', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_ENTRY);
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = correctContactLogSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const log = parseContactLog(request.data.values, new Date());
    if (log.status === 'invalid') return invalid(c, log.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.correctContactLog(
        ctx,
        id,
        request.data.basedOnRevision,
        log.value,
        recorderName(c.get('user')),
      );
      switch (result.status) {
        case 'saved': {
          const entry = await db.getContactLogEntry(ctx, id);
          return entry ? c.json(entry, 201) : apiError(c, 404, 'NOT_FOUND', NO_ENTRY);
        }
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', NO_ENTRY);
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_LOG);
        case 'archived':
          return apiError(c, 409, 'ARCHIVED', ARCHIVED);
        case 'changed':
          return apiError(
            c,
            409,
            'ENTRY_CHANGED',
            'Someone corrected this entry after you opened it. Reload to see their version, then make your correction again.',
            { currentRevision: result.currentRevision },
          );
      }
    });
  });

  return routes;
}

/** The answer after a change to a follow-up: the follow-up as it now is. */
async function savedFollowUp(
  c: ApiContext,
  db: Database,
  ctx: RequestContext,
  id: string,
  result: FollowUpWriteResult,
  forbidden: string,
) {
  switch (result.status) {
    case 'saved': {
      const saved = await db.getFollowUp(ctx, id);
      return saved ? c.json(saved) : apiError(c, 404, 'NOT_FOUND', NO_FOLLOW_UP);
    }
    case 'not_found':
      return apiError(c, 404, 'NOT_FOUND', NO_FOLLOW_UP);
    case 'forbidden':
      return apiError(c, 403, 'FORBIDDEN', forbidden);
    case 'archived':
      return apiError(c, 409, 'ARCHIVED', ARCHIVED);
    case 'not_a_member':
      return apiError(c, 422, 'NOT_A_MEMBER', NOT_A_MEMBER);
    case 'changed':
      return apiError(
        c,
        409,
        'RECORD_CHANGED',
        'Someone changed this follow-up after you opened it. Reload to see it, then make your change again.',
      );
    case 'done':
      return apiError(c, 409, 'DONE', 'This follow-up is done and no longer changes.');
  }
}

const STATUSES: readonly FollowUpStatus[] = ['open', 'done', 'all'];

/** /api/v1/follow-ups: what to do next for a counterparty, by when and by whom. */
export function followUpRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const query = c.req.query();
    const organizationId = query.organization_id ?? null;
    const counterpartyId = query.counterparty_id ?? null;
    const assignedTo = query.assigned_to ?? null;
    const status = query.status ?? 'open';
    if (
      (organizationId !== null && !isUuid(organizationId)) ||
      (counterpartyId !== null && !isUuid(counterpartyId)) ||
      (assignedTo !== null && assignedTo !== 'me' && !isUuid(assignedTo)) ||
      !(STATUSES as readonly string[]).includes(status)
    ) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        'organization_id and counterparty_id must be UUIDs, assigned_to me or a UUID, status open, done or all.',
      );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const followUps = await db.listFollowUps(ctx, {
        organizationId,
        counterpartyId,
        assignedTo,
        status: status as FollowUpStatus,
      });
      return c.json({
        followUps: followUps.slice(0, CRM_LIST_LIMIT),
        truncated: followUps.length > CRM_LIST_LIMIT,
      });
    });
  });

  // For the menu: the signed-in person's follow-ups overdue and due later today.
  routes.get('/count', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? '';
    if (!isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    // Today's end in Central time comes from the same code as the web app's, not from the
    // database's time zone rules, which may be of another edition (Manitoba, 2026).
    const endOfDay = endOfCentralDay(new Date());
    return withDatabase(c, openDatabase, async (db, ctx) =>
      c.json(await db.countFollowUps(ctx, organizationId, endOfDay)),
    );
  });

  // Who can be made responsible: the organization's active members.
  routes.get('/team', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? '';
    if (!isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) =>
      c.json({ members: await db.teamNames(ctx, organizationId) }),
    );
  });

  routes.get('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_FOLLOW_UP);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const found = await db.getFollowUp(ctx, id);
      return found ? c.json(found) : apiError(c, 404, 'NOT_FOUND', NO_FOLLOW_UP);
    });
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createFollowUpSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const plan = parseFollowUp(request.data.values);
    if (plan.status === 'invalid') return invalid(c, plan.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const created = await db.createFollowUp(
        ctx,
        request.data.counterpartyId,
        plan.value,
        recorderName(c.get('user')),
      );
      switch (created.status) {
        case 'created': {
          const saved = await db.getFollowUp(ctx, created.id);
          return saved
            ? c.json(saved, 201)
            : apiError(c, 404, 'NOT_FOUND', 'The new follow-up could not be read back.');
        }
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', NO_COUNTERPARTY);
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_PLAN);
        case 'archived':
          return apiError(c, 409, 'ARCHIVED', ARCHIVED);
        case 'not_a_member':
          return apiError(c, 422, 'NOT_A_MEMBER', NOT_A_MEMBER);
      }
    });
  });

  // A new task, due time or person, while it is open.
  routes.patch('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_FOLLOW_UP);
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateFollowUpSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const plan = parseFollowUp(request.data.values);
    if (plan.status === 'invalid') return invalid(c, plan.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.updateFollowUp(ctx, id, request.data.version, plan.value);
      return savedFollowUp(c, db, ctx, id, result, FORBIDDEN_PLAN);
    });
  });

  // Done for good; the follow-up stays readable with who finished it and when.
  routes.post('/:id/done', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_FOLLOW_UP);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.finishFollowUp(ctx, id, recorderName(c.get('user')));
      return savedFollowUp(c, db, ctx, id, result, FORBIDDEN_DONE);
    });
  });

  return routes;
}
