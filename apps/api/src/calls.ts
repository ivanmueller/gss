import { dialablePhone, displayPhone, placeCallSchema, savePhoneSchema } from '@grain/domain';
import { Hono } from 'hono';

import type { CallEvent } from './call-steps';
import type { CommandOutcome, PendingCommand } from './calls-db';
import type { Database, RequestContext } from './db';
import {
  apiError,
  closeLater,
  failureSummary,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';
import {
  decodeClientState,
  telnyxConfig,
  TelnyxError,
  verifyTelnyxSignature,
  type ClientState,
  type TelnyxClient,
  type TelnyxFactory,
} from './telnyx';

// Calling counterparties through Telnyx (the owner's request of 2026-11-02):
// - /api/v1/me/phone: the signed-in person's own cell phone, which their calls ring first;
// - /api/v1/calls: a call placed from a contact's or company's page, and its progress;
// - /api/v1/telnyx/voice: Telnyx's call events, checked by signature, with no signed-in user.

const MAX_BODY_BYTES = 4 * 1024;
/** Telnyx's events are small; anything far larger is not one. */
const MAX_WEBHOOK_BYTES = 64 * 1024;
/** How long the caller's cell rings, under most voicemail pick-ups. */
const STAFF_RING_SECONDS = 30;
const COUNTERPARTY_RING_SECONDS = 45;

const NOT_CONFIGURED =
  'Calling is not set up yet. An admin adds the Telnyx settings in Cloudflare.';

function telnyxFailed(c: ApiContext, error: unknown, what: string) {
  if (!(error instanceof TelnyxError)) throw error;
  console.error(
    `Telnyx refused ${what} in request ${c.get('requestId')}: status=${String(error.status)} codes=${error.codes}`,
  );
}

/** The person's organization: the one they belong to, or the one named when they have several. */
async function organizationOf(c: ApiContext, db: Database): Promise<string | null> {
  const memberships = await db.memberships(c.get('user').id);
  const named = c.req.query('organization_id');
  if (named !== undefined) {
    return memberships.some((m) => m.organizationId === named) ? named : null;
  }
  return memberships.length === 1 ? (memberships[0]?.organizationId ?? null) : null;
}

/** /api/v1/me/phone: the signed-in person's own cell phone. */
export function memberPhoneRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', 'You are not an active member.');
      const phone = await db.getMemberPhone(ctx, org);
      return c.json({
        phone: phone === null ? null : displayPhone(phone),
        callingAvailable: telnyxConfig(c.env) !== null,
      });
    });
  });

  routes.put('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = savePhoneSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const phone = dialablePhone(parsed.data.phone);
    if (phone === null) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        'Enter your cell phone with its area code, e.g. (403) 555-0100, without an extension.',
      );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', 'You are not an active member.');
      const saved = await db.saveMemberPhone(ctx, org, phone);
      return saved === 'saved'
        ? c.json({ phone: displayPhone(phone) })
        : apiError(c, 403, 'FORBIDDEN', 'You are not an active member.');
    });
  });

  routes.delete('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', 'You are not an active member.');
      await db.saveMemberPhone(ctx, org, null);
      return c.json({ phone: null });
    });
  });

  return routes;
}

/** /api/v1/calls: calls placed from the platform. */
export function callRoutes(openDatabase: DatabaseFactory, telnyx: TelnyxFactory) {
  const routes = new Hono<ApiEnv>();

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = placeCallSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const config = telnyxConfig(c.env);
    const client = telnyx(c.env);
    if (config === null || client === null) {
      return apiError(c, 503, 'CALLING_NOT_CONFIGURED', NOT_CONFIGURED);
    }
    const { counterpartyId, contactId } = parsed.data;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const placed = await db.placeCall(ctx, counterpartyId, contactId, config.fromNumber);
      switch (placed.status) {
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', 'No such counterparty or contact.');
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', 'Only traders, operations and admins place calls.');
        case 'archived':
          return apiError(
            c,
            409,
            'ARCHIVED',
            'This counterparty is archived. Restore it before calling.',
          );
        case 'no_number':
          return apiError(c, 422, 'NO_NUMBER', 'There is no phone number to call.');
        case 'not_dialable':
          return apiError(
            c,
            422,
            'NOT_DIALABLE',
            'This number has an extension or cannot be dialed from the platform. Dial it from your phone.',
          );
        case 'no_cell':
          return apiError(
            c,
            409,
            'NO_CELL_PHONE',
            'Add your cell phone first: your name at the top right → Your cell phone.',
          );
        case 'in_progress':
          return apiError(
            c,
            409,
            'CALL_IN_PROGRESS',
            'You have a call under way. Finish it before placing another.',
          );
        case 'created':
          break;
      }
      try {
        const legId = await client.dial({
          to: placed.staffPhone,
          clientState: { call: placed.callId, leg: 'you' },
          timeoutSecs: STAFF_RING_SECONDS,
        });
        // Without an id in the answer, the leg is learned from its first event.
        if (legId !== null) await db.recordLeg(ctx, placed.callId, 'you', legId);
      } catch (error) {
        telnyxFailed(c, error, 'a call');
        await db.failCall(ctx, placed.callId, 'failed');
        return apiError(c, 502, 'TELNYX_FAILED', 'Telnyx could not place the call. Try again.');
      }
      const call = await db.getCall(ctx, placed.callId);
      return c.json({ call }, 201);
    });
  });

  routes.get('/:id', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such call.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const call = await db.getCall(ctx, id);
      return call === null ? apiError(c, 404, 'NOT_FOUND', 'No such call.') : c.json({ call });
    });
  });

  return routes;
}

/** The parts of a Telnyx event the API reads, or null when the body is not an event. */
function readEvent(body: unknown): {
  id: string;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
} | null {
  if (typeof body !== 'object' || body === null) return null;
  const data = (body as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) return null;
  const {
    id,
    event_type: type,
    occurred_at: occurredAt,
    payload,
  } = data as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return null;
  if (typeof type !== 'string' || !/^[a-z0-9_.]{1,100}$/.test(type)) return null;
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) return null;
  if (typeof payload !== 'object' || payload === null) return null;
  return {
    id,
    type,
    occurredAt: new Date(occurredAt).toISOString(),
    payload: payload as Record<string, unknown>,
  };
}

function text(payload: Record<string, unknown>, key: string, max = 200): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/** The events a call's steps use; every other event is acknowledged and ignored. */
const CALL_EVENTS = new Set([
  'call.initiated',
  'call.answered',
  'call.gather.ended',
  'call.hangup',
]);

/** Some command of the event is not resolved yet: Telnyx must deliver the event again. */
class DeliverAgain extends Error {
  constructor() {
    super('A command of this event is still being sent');
    this.name = 'DeliverAgain';
  }
}

/**
 * Sends the pending commands of an event, each claimed first so that only a command the call
 * still wants is sent (Codex's reviews of ivanmueller/gss#107 and #108). A command Telnyx refuses
 * ends the call as failed. When Telnyx cannot be reached, or another delivery holds a claim not
 * yet resolved, the command stays unfinished and the webhook answers 500, so that Telnyx
 * delivers the event again. A hang-up an outcome calls for is kept as a command and sent here.
 */
async function sendCommands(
  c: ApiContext,
  db: Database,
  ctx: RequestContext,
  client: TelnyxClient,
  callId: string,
  commands: PendingCommand[],
) {
  const queue = [...commands];
  // Each command is tried at most once per delivery.
  const tried = new Set<string>();
  for (;;) {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (tried.has(next.id)) continue;
      tried.add(next.id);
      const claim = await db.claimCommand(ctx, callId, next.id);
      if (claim.status !== 'claimed') continue;
      const command = claim.command;
      let outcome: CommandOutcome;
      try {
        switch (command.kind) {
          case 'confirm':
            await client.confirm(command.callControlId, { call: callId, leg: 'you' }, command.id);
            outcome = { kind: 'done' };
            break;
          case 'dial_them': {
            const legId = await client.dial({
              to: command.counterpartyPhone,
              clientState: { call: callId, leg: 'them' },
              timeoutSecs: COUNTERPARTY_RING_SECONDS,
              bridgeTo: command.callControlId,
            });
            outcome = legId === null ? { kind: 'done' } : { kind: 'done', legId };
            break;
          }
          case 'hang_up':
            await client.hangUp(command.callControlId, command.id);
            outcome = { kind: 'done' };
            break;
        }
      } catch (error) {
        // Telnyx unreachable, or a temporary refusal (too many requests, a server error): the
        // command stays pending and the event is delivered again (Codex's fifth review, 3).
        if (!(error instanceof TelnyxError) || temporary(error)) {
          await db.finishCommand(ctx, callId, command.id, command.attempt, { kind: 'retry' });
          throw error;
        }
        // A leg already gone cannot be hung up; that is not a problem.
        if (command.kind !== 'hang_up') telnyxFailed(c, error, `the ${command.kind} command`);
        outcome = { kind: 'failed' };
      }
      const finished = await db.finishCommand(ctx, callId, command.id, command.attempt, outcome);
      if (finished.followUp !== null) queue.push(finished.followUp);
    }
    // Acknowledged only when every command of the call is settled: those not tried yet in this
    // delivery (from another event or another Worker) are sent now; any still unsettled after
    // that (being sent by another delivery) has the event delivered again.
    const unsettled = await db.unsettledCommands(ctx, callId);
    const untried = unsettled.filter((command) => !tried.has(command.id));
    if (untried.length === 0) {
      if (unsettled.length > 0) throw new DeliverAgain();
      return;
    }
    queue.push(...untried);
  }
}

/** A refusal Telnyx may not repeat: a timeout, too many requests, or a server error. */
function temporary(error: TelnyxError): boolean {
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

/**
 * /api/v1/telnyx/voice: Telnyx's call events. Mounted before sign-in is required: Telnyx signs
 * every event, and an event whose signature does not check out is refused before anything
 * else is read. Each event is kept once, then applied as the person who placed the call.
 */
export function telnyxWebhookRoutes(openDatabase: DatabaseFactory, telnyx: TelnyxFactory) {
  const routes = new Hono<ApiEnv>();

  routes.post('/voice', async (c) => {
    c.header('Cache-Control', 'no-store');
    const publicKey = c.env.TELNYX_PUBLIC_KEY?.trim() ?? '';
    const client = telnyx(c.env);
    if (publicKey === '' || client === null) {
      return apiError(c, 503, 'CALLING_NOT_CONFIGURED', NOT_CONFIGURED);
    }
    const declared = c.req.header('content-length');
    if (declared !== undefined && /^\d+$/.test(declared) && Number(declared) > MAX_WEBHOOK_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
    }
    const raw = await c.req.text();
    if (raw.length > MAX_WEBHOOK_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
    }
    const genuine = await verifyTelnyxSignature(
      publicKey,
      raw,
      c.req.header('telnyx-signature-ed25519'),
      c.req.header('telnyx-timestamp'),
      Math.floor(Date.now() / 1000),
    );
    if (!genuine) {
      console.warn(`Telnyx event refused in request ${c.get('requestId')}: bad signature`);
      return apiError(c, 401, 'BAD_SIGNATURE', 'The signature does not match.');
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return apiError(c, 400, 'MALFORMED', 'The event is not JSON.');
    }
    const event = readEvent(body);
    if (event === null || !CALL_EVENTS.has(event.type)) return c.json({ received: true });

    const callControlId = text(event.payload, 'call_control_id');
    const state: ClientState | null = decodeClientState(event.payload.client_state);
    if (state === null) {
      // A call to GSS's number that the platform did not place: callbacks are not routed yet,
      // so the caller hears a busy signal instead of ringing with nobody to answer.
      if (
        event.type === 'call.initiated' &&
        event.payload.direction === 'incoming' &&
        callControlId !== null
      ) {
        await client.reject(callControlId).catch((error: unknown) => {
          telnyxFailed(c, error, 'rejecting an incoming call');
        });
      }
      return c.json({ received: true });
    }

    const url = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL;
    if (!url) return apiError(c, 500, 'MISCONFIGURED', 'The database is not configured.');
    let db: Database;
    try {
      db = openDatabase(url, { viaHyperdrive: c.env.HYPERDRIVE !== undefined });
    } catch {
      return apiError(c, 500, 'MISCONFIGURED', 'The database is not configured correctly.');
    }
    try {
      const placer = await db.callPlacer(state.call);
      if (placer === null) return c.json({ received: true });
      const ctx: RequestContext = { userId: placer.placedBy, requestId: c.get('requestId') };
      const callEvent: CallEvent = {
        type: event.type,
        leg: state.leg,
        occurredAt: event.occurredAt,
        callControlId,
        digits: text(event.payload, 'digits', 20),
        gatherStatus: text(event.payload, 'status', 40),
        hangupCause: text(event.payload, 'hangup_cause', 40),
      };
      const result = await db.applyCallEvent(ctx, state.call, event.id, callEvent);
      if (result.status !== 'not_found') {
        await sendCommands(c, db, ctx, client, state.call, result.commands);
      }
      return c.json({ received: true });
    } catch (error) {
      if (error instanceof DeliverAgain) {
        console.warn(
          `Telnyx event in request ${c.get('requestId')}: a command is still being sent; asking for it again`,
        );
        return apiError(c, 503, 'COMMAND_IN_FLIGHT', 'Deliver this event again.');
      }
      // Telnyx sends the event again; the event id keeps it from being applied twice.
      console.error(
        `Telnyx event not applied in request ${c.get('requestId')}: ${failureSummary(error)}`,
      );
      return apiError(c, 500, 'INTERNAL_ERROR', 'The event could not be applied.');
    } finally {
      closeLater(c, db);
    }
  });

  return routes;
}
