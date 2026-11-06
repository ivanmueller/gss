import {
  CALLBACK_RING_SECONDS,
  callbackPrompt,
  dialablePhone,
  saveCallbackSettingsSchema,
  settleCallbackSchema,
  VOICEMAIL_MESSAGE,
} from '@grain/domain';
import { Hono } from 'hono';

import type { CallbackCommand, CallbackEvent } from './callbacks-db';
import type { Database } from './db';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';
import {
  telnyxConfig,
  TelnyxError,
  type ClientState,
  type TelnyxClient,
  type TelnyxConfig,
  type TelnyxFactory,
} from './telnyx';

// Callbacks to GSS's number (the owner's request and answers of 2026-11-06, docs/DECISIONS.md,
// F-132): a counterparty calling GSS's Telnyx number back reaches whoever last called that
// number, then the callbacks person, then voicemail. The steps are the database's
// (20261107020000_callbacks.sql); the Worker passes Telnyx's checked events on and sends the
// commands that follow, each claimed first, as for calls placed from the platform.

const MAX_BODY_BYTES = 4 * 1024;

/** Telnyx's events a callback follows; every other event is acknowledged and ignored. */
export const CALLBACK_EVENTS = new Set([
  'call.initiated',
  'call.answered',
  'call.gather.ended',
  'call.speak.ended',
  'call.hangup',
]);

/** Some command is not resolved yet: Telnyx must deliver the event again. */
export class CallbackDeliverAgain extends Error {
  constructor() {
    super('A command of this callback is still being sent');
    this.name = 'CallbackDeliverAgain';
  }
}

/** A refusal Telnyx may not repeat: a timeout, too many requests, or a server error. */
function temporary(error: TelnyxError): boolean {
  return error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500;
}

function logRefusal(c: ApiContext, error: TelnyxError, what: string) {
  console.error(
    `Telnyx refused ${what} in request ${c.get('requestId')}: status=${String(error.status)} codes=${error.codes}`,
  );
}

function text(payload: Record<string, unknown>, key: string, max = 200): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

/**
 * Whether an event is about a leg calling GSS's own number through GSS's own Voice API
 * application (Codex's review of the design, finding 1): the number dialed and the application
 * must both be the Worker's.
 */
export function toOurNumber(payload: Record<string, unknown>, config: TelnyxConfig): boolean {
  const to = text(payload, 'to', 40);
  const connection = payload.connection_id;
  return (
    to !== null &&
    dialablePhone(to) === config.fromNumber &&
    (typeof connection === 'string' || typeof connection === 'number') &&
    String(connection) === config.connectionId
  );
}

/** Sends one claimed command; the leg a dial returned, if any. */
async function send(
  client: TelnyxClient,
  callId: string,
  command: CallbackCommand & {
    cell: string | null;
    bridgeWith: string | null;
    companyName: string | null;
  },
): Promise<string | undefined> {
  const member: ClientState = {
    call: callId,
    leg: 'you',
    callback: true,
    ...(command.attemptId === null ? {} : { attempt: command.attemptId }),
  };
  const caller: ClientState = { call: callId, leg: 'them', callback: true };
  switch (command.kind) {
    case 'dial_member': {
      if (command.cell === null || command.attemptId === null) {
        throw new TelnyxError(422, 'no_cell');
      }
      const leg = await client.dial({
        to: command.cell,
        clientState: member,
        timeoutSecs: CALLBACK_RING_SECONDS,
        commandId: `${callId}-a-${command.attemptId}`,
      });
      return leg ?? undefined;
    }
    case 'confirm':
      await client.confirm(
        command.callControlId,
        member,
        command.id,
        callbackPrompt(command.companyName),
      );
      return undefined;
    case 'answer':
      await client.answer(command.callControlId, caller, command.id);
      return undefined;
    case 'bridge':
      if (command.bridgeWith === null) throw new TelnyxError(422, 'no_leg');
      await client.bridge(command.callControlId, command.bridgeWith, member, command.id);
      return undefined;
    case 'record':
      await client.record(command.callControlId, member, command.id);
      return undefined;
    case 'greet':
      await client.speak(command.callControlId, VOICEMAIL_MESSAGE, caller, command.id);
      return undefined;
    case 'record_voicemail':
      await client.recordVoicemail(command.callControlId, caller, command.id);
      return undefined;
    case 'hang_up':
      await client.hangUp(command.callControlId, command.id);
      return undefined;
  }
}

/**
 * Sends the commands of a callback, each claimed first so that only one the call still wants is
 * sent. A temporary failure (Telnyx unreachable, too many requests, a server error) leaves the
 * command pending and asks for the event again; a final refusal moves the call on (the next
 * person, or the end). Acknowledged only once every command of the call is settled.
 */
export async function sendCallbackCommands(
  c: ApiContext,
  db: Database,
  client: TelnyxClient,
  callId: string,
  commands: CallbackCommand[],
) {
  const queue = [...commands];
  const tried = new Set<string>();
  for (;;) {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      if (tried.has(next.id)) continue;
      tried.add(next.id);
      const claim = await db.claimCallbackCommand(callId, next.id);
      if (claim.status !== 'claimed') continue;
      const command = claim.command;
      let outcome: 'done' | 'failed' = 'done';
      let leg: string | null = null;
      try {
        leg = (await send(client, callId, command)) ?? null;
      } catch (error) {
        if (!(error instanceof TelnyxError) || temporary(error)) {
          await db.finishCallbackCommand(callId, command.id, command.claim, 'retry', null);
          throw error;
        }
        // A leg already gone cannot be hung up; that is not a problem.
        if (command.kind !== 'hang_up')
          logRefusal(c, error, `the callback's ${command.kind} command`);
        outcome = 'failed';
      }
      const finished = await db.finishCallbackCommand(
        callId,
        command.id,
        command.claim,
        outcome,
        leg,
      );
      queue.push(...finished.commands);
    }
    const open = await db.callbackOpenCommands(callId);
    const untried = open.filter((command) => !tried.has(command.id));
    if (untried.length === 0) {
      if (open.length > 0) throw new CallbackDeliverAgain();
      return;
    }
    queue.push(...untried);
  }
}

/**
 * Applies a Telnyx event of a callback, or of a leg calling GSS's number the platform has not
 * seen, then sends what follows. `state` is the event's client_state when it was a callback's;
 * without one, the leg is looked up (the caller's leg before it is answered; Codex's review,
 * finding 5). Answers whether the event was a callback's (otherwise the caller deals with it).
 */
export async function handleCallbackEvent(
  c: ApiContext,
  db: Database,
  client: TelnyxClient,
  event: { id: string; type: string; occurredAt: string; payload: Record<string, unknown> },
  state: ClientState | null,
): Promise<boolean> {
  const config = telnyxConfig(c.env);
  const leg = text(event.payload, 'call_control_id');
  let target: { callId: string; side: 'you' | 'them'; attemptId: string | null } | null = null;
  if (state?.callback === true) {
    target = { callId: state.call, side: state.leg, attemptId: state.attempt ?? null };
  } else if (state === null && leg !== null) {
    target = await db.callbackByLeg(leg);
  }
  if (target === null) {
    // A leg to GSS's own number, not seen yet: a new callback.
    if (state !== null || leg === null || config === null || !toOurNumber(event.payload, config)) {
      return false;
    }
    const received = await db.receiveCallback({
      eventId: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      leg,
      from: text(event.payload, 'from', 40) ?? '',
      to: text(event.payload, 'to', 40) ?? '',
    });
    if (received.status === 'created' || received.status === 'duplicate') {
      await sendCallbackCommands(c, db, client, received.callId, received.commands);
      return true;
    }
    if (received.status === 'not_ours' && event.type === 'call.initiated') {
      // Callbacks are off (no admin has saved them), or the caller's number is withheld: a busy
      // signal, as before callbacks, rather than ringing with nobody to answer.
      console.warn(
        `Telnyx event in request ${c.get('requestId')}: a call to GSS's number refused (callbacks off or number withheld)`,
      );
      await client.reject(leg).catch((error: unknown) => {
        if (!(error instanceof TelnyxError)) throw error;
        logRefusal(c, error, 'rejecting an incoming call');
      });
    }
    return true;
  }
  const callbackEvent: CallbackEvent = {
    type: event.type,
    side: target.side,
    attemptId: target.attemptId,
    occurredAt: event.occurredAt,
    leg,
    digits: text(event.payload, 'digits', 20),
    gatherStatus: text(event.payload, 'status', 40),
    cause: text(event.payload, 'hangup_cause', 40),
  };
  const applied = await db.applyCallbackEvent(target.callId, event.id, callbackEvent);
  if (applied.status === 'not_found') return true;
  await sendCallbackCommands(c, db, client, target.callId, applied.commands);
  return true;
}

/**
 * Keeps a callback's recording (call.recording.saved): the conversation, recorded on the leg of
 * who answered, or a voicemail, recorded on the caller's own leg. A voicemail that stopped by
 * itself (3 minutes, or 10 seconds of silence) leaves the caller on the line: they are hung up.
 * Answers false when Telnyx does not list the recording yet (the event is to come again).
 */
export async function keepCallbackRecording(
  db: Database,
  client: TelnyxClient,
  callId: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const legId = text(payload, 'call_leg_id');
  if (legId === null) return true;
  const instant = (key: string) => {
    const value = text(payload, key, 40);
    return value !== null && !Number.isNaN(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
  };
  const recordings = await client.recordingsOfLeg(legId);
  if (recordings.length === 0) return false;
  const leg = text(payload, 'call_control_id');
  let voicemail = false;
  for (const recordingId of recordings) {
    const kept = await db.keepCallbackRecording(
      callId,
      recordingId,
      instant('recording_started_at'),
      instant('recording_ended_at'),
      leg,
    );
    voicemail ||= kept;
  }
  if (voicemail && leg !== null) {
    await client.hangUp(leg).catch((error: unknown) => {
      if (!(error instanceof TelnyxError) || temporary(error)) throw error;
    });
  }
  return true;
}

const NOT_MEMBER = 'You are not an active member.';

/** The person's organization: the one they belong to, or the one named when they have several. */
async function organizationOf(c: ApiContext, db: Database): Promise<string | null> {
  const memberships = await db.memberships(c.get('user').id);
  const named = c.req.query('organization_id');
  if (named !== undefined) {
    return memberships.some((m) => m.organizationId === named) ? named : null;
  }
  return memberships.length === 1 ? (memberships[0]?.organizationId ?? null) : null;
}

/**
 * /api/v1/callbacks: the settings (Team page), the calls nobody could be given a follow-up for
 * (Follow-ups page), and the callback ringing the signed-in person's cell (the call box).
 */
export function callbackRoutes(openDatabase: DatabaseFactory, telnyx: TelnyxFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/settings', (c) => {
    c.header('Cache-Control', 'no-store');
    const config = telnyxConfig(c.env);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const settings = await db.getCallbackSettings(ctx, org, config?.fromNumber ?? null);
      return settings === null ? apiError(c, 403, 'FORBIDDEN', NOT_MEMBER) : c.json({ settings });
    });
  });

  routes.put('/settings', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = saveCallbackSettingsSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const config = telnyxConfig(c.env);
    if (config === null || telnyx(c.env) === null) {
      return apiError(
        c,
        503,
        'CALLING_NOT_CONFIGURED',
        'Calling is not set up yet. An admin adds the Telnyx settings in Cloudflare.',
      );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const saved = await db.saveCallbackSettings(
        ctx,
        org,
        config.fromNumber,
        parsed.data.callbacksPerson,
      );
      switch (saved) {
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', 'Only admins choose who gets callbacks.');
        case 'not_a_member':
          return apiError(
            c,
            422,
            'NOT_A_MEMBER',
            'Choose an active trader, operations or admin member.',
          );
        case 'phone_taken':
          return apiError(
            c,
            409,
            'PHONE_TAKEN',
            "Another organization's callbacks already arrive on this number.",
          );
        case 'saved':
          break;
      }
      const settings = await db.getCallbackSettings(ctx, org, config.fromNumber);
      return c.json({ settings });
    });
  });

  routes.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      return c.json({ returns: await db.listCallbackReturns(ctx, org) });
    });
  });

  // For the menu: the open returns that are the signed-in person's to deal with.
  routes.get('/count', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      return c.json({ open: await db.countCallbackReturns(ctx, org) });
    });
  });

  // For the call box: the callback ringing the person's cell, or that they are on.
  routes.get('/mine', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const callId = await db.myCallback(ctx, org);
      return c.json({ call: callId === null ? null : await db.getCall(ctx, callId) });
    });
  });

  routes.post('/:id/settle', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such call.');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = settleCallbackSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.settleCallbackReturn(ctx, id, parsed.data);
      switch (result) {
        case 'done':
          return c.json({ settled: true });
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', 'No such call.');
        case 'forbidden':
          return apiError(
            c,
            403,
            'FORBIDDEN',
            'Only traders, operations and admins deal with calls.',
          );
        case 'closed':
          return apiError(
            c,
            409,
            'CLOSED',
            'Someone already dealt with this call. Reload to see it.',
          );
        case 'not_unknown':
          return apiError(c, 409, 'NOT_UNKNOWN', 'This call is already in a company’s history.');
        case 'company_not_found':
          return apiError(c, 422, 'COMPANY_NOT_FOUND', 'Choose a company that is not archived.');
      }
    });
  });

  return routes;
}
