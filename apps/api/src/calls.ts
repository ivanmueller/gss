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
  telnyxClient,
} from './telnyx';

// Calling counterparties through Telnyx (the owner's request of 2026-11-02):
// - /api/v1/me/phone: the signed-in person's own cell phone, which their calls ring first;
// - /api/v1/calls: a call placed from a contact's or company's page, and its progress;
// - /api/v1/telnyx/voice: Telnyx's call events, checked by signature, with no signed-in user.

const MAX_BODY_BYTES = 4 * 1024;
/**
 * Telnyx's largest event is a transcript (kept up to 200,000 characters, which JSON may write
 * as up to six bytes each); anything far larger is not one (Codex's review of 9de3e78).
 */
const MAX_WEBHOOK_BYTES = 1024 * 1024;
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

  // A counterparty's call recordings and transcripts, for everyone on the team.
  routes.get('/recordings', (c) => {
    c.header('Cache-Control', 'no-store');
    const counterpartyId = c.req.query('counterparty_id') ?? '';
    if (!isUuid(counterpartyId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'counterparty_id must be a UUID.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) =>
      c.json({ recordings: await db.listRecordings(ctx, counterpartyId) }),
    );
  });

  // A recording's audio, for 24 hours after the call: fetched from Telnyx by the Worker and
  // passed on, never a link to Telnyx.
  routes.get('/recordings/:id/audio', (c) => {
    c.header('Cache-Control', 'private, no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such recording.');
    const client = telnyx(c.env);
    if (client === null) return apiError(c, 503, 'CALLING_NOT_CONFIGURED', NOT_CONFIGURED);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const recordingId = await db.playableRecording(ctx, id);
      if (recordingId === null) {
        return apiError(c, 404, 'NOT_FOUND', 'This recording is no longer kept.');
      }
      let audio: Response | null;
      try {
        audio = await client.recordingAudio(recordingId);
      } catch (error) {
        telnyxFailed(c, error, 'a recording');
        return apiError(c, 502, 'TELNYX_FAILED', 'Telnyx could not give the recording. Try again.');
      }
      if (audio === null) return apiError(c, 404, 'NOT_FOUND', 'This recording is no longer kept.');
      return new Response(audio.body, {
        status: 200,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
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
class RecordingNotListed extends Error {
  constructor() {
    super('Telnyx does not list the recording yet');
    this.name = 'RecordingNotListed';
  }
}

/** Telnyx's events about a recording, kept outside the call's steps. */
const RECORDING_EVENTS = new Set(['call.recording.saved', 'call.recording.transcription.saved']);

/** The longest transcript kept (the database allows as much). */
const TRANSCRIPT_MAX = 200_000;

/**
 * Keeps a call's recording (call.recording.saved, which carries no recording id: the ids of the
 * leg's recordings are asked of Telnyx) or its transcript (call.recording.transcription.saved).
 * Written through the database's own functions, so a suspended caller's call still gets them.
 */
async function keepRecording(
  db: Database,
  client: TelnyxClient,
  callId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  if (type === 'call.recording.transcription.saved') {
    const recordingId = text(payload, 'recording_id');
    const words = typeof payload.transcription_text === 'string' ? payload.transcription_text : '';
    if (recordingId !== null && words.trim() !== '') {
      await db.keepCallTranscript(callId, recordingId, words.slice(0, TRANSCRIPT_MAX));
    }
    return;
  }
  const legId = text(payload, 'call_leg_id');
  if (legId === null) return;
  const instant = (key: string) => {
    const value = text(payload, key, 40);
    return value !== null && !Number.isNaN(Date.parse(value))
      ? new Date(value).toISOString()
      : null;
  };
  const recordings = await client.recordingsOfLeg(legId);
  // Not listed by Telnyx yet: the event is to come again rather than be acknowledged unkept.
  if (recordings.length === 0) throw new RecordingNotListed();
  for (const recordingId of recordings) {
    await db.keepCallRecording(
      callId,
      recordingId,
      instant('recording_started_at'),
      instant('recording_ended_at'),
    );
  }
}

const CALL_EVENTS = new Set([
  'call.initiated',
  'call.answered',
  'call.gather.ended',
  'call.hangup',
]);

/** The caller can no longer see the call (suspended or removed): it is ended at Telnyx. */
class CallerGone extends Error {
  constructor() {
    super('The caller can no longer reach the call');
    this.name = 'CallerGone';
  }
}

/**
 * Ends at Telnyx a call whose caller can no longer reach it (Codex's sixth review, finding 2):
 * every leg it knows of, and the event's own, is hung up. A leg already gone is fine; when
 * Telnyx cannot be reached or refuses for now, the error is thrown, so the event comes again.
 */
async function endAtTelnyx(
  c: ApiContext,
  db: Database,
  client: TelnyxClient,
  callId: string,
  eventLeg: string | null,
) {
  console.warn(
    `Telnyx event in request ${c.get('requestId')} for a call its caller can no longer reach: hanging up its legs`,
  );
  const legs = new Set(await db.callLegs(callId));
  if (eventLeg !== null) legs.add(eventLeg);
  for (const leg of legs) {
    await client.hangUp(leg).catch((error: unknown) => {
      if (!(error instanceof TelnyxError) || temporary(error)) throw error;
    });
  }
}

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
          case 'record':
            await client.record(command.callControlId, { call: callId, leg: 'you' }, command.id);
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
      if (finished.callerGone === true) {
        // Suspended while Telnyx was dialing: the leg it returned is kept to be hung up with the
        // call's others (Codex's seventh review).
        if (outcome.kind === 'done' && outcome.legId !== undefined) {
          await db.keepStrayLeg(command.id, outcome.legId);
        }
        throw new CallerGone();
      }
      if (finished.followUp !== null) queue.push(finished.followUp);
    }
    // Acknowledged only when every command of the call is settled: those not tried yet in this
    // delivery (from another event or another Worker) are sent now; any still unsettled after
    // that (being sent by another delivery) has the event delivered again.
    const unsettled = await db.unsettledCommands(ctx, callId);
    if (unsettled === null) throw new CallerGone();
    const untried = unsettled.filter((command) => !tried.has(command.id));
    if (untried.length === 0) {
      if (unsettled.length > 0) throw new DeliverAgain();
      return;
    }
    queue.push(...untried);
  }
}

/**
 * Deletes at Telnyx the audio of recordings 24 hours after their call (the owner's request of
 * 2026-11-02); run by the Worker's hourly scheduled job. Their transcripts stay. A recording
 * Telnyx no longer has counts as deleted; one that cannot be deleted now is tried next hour.
 */
/**
 * The hourly scheduled job that deletes call audio 24 hours old (wrangler.jsonc, triggers). Kept
 * here, not in the Worker's entry module, whose exports must all be handlers.
 */
export const RECORDINGS_CRON = '7 * * * *';

/** Recordings deleted per batch, and batches per run (a backlog is worked through in one run). */
const DELETE_BATCH = 100;
const DELETE_BATCHES = 20;

export async function deleteExpiredRecordings(
  env: ApiEnv['Bindings'],
  openDatabase: DatabaseFactory,
  telnyx: TelnyxFactory = telnyxClient,
) {
  const client = telnyx(env);
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (client === null || !url) return;
  const db = openDatabase(url, { viaHyperdrive: env.HYPERDRIVE !== undefined });
  try {
    let deleted = 0;
    // Each recording is tried once per run; one Telnyx would not delete now waits for next hour.
    const tried = new Set<string>();
    for (let batch = 0; batch < DELETE_BATCHES; batch += 1) {
      const due = (await db.recordingsToDelete(DELETE_BATCH + tried.size)).filter(
        (recordingId) => !tried.has(recordingId),
      );
      if (due.length === 0) break;
      for (const recordingId of due.slice(0, DELETE_BATCH)) {
        tried.add(recordingId);
        try {
          await client.deleteRecording(recordingId);
          await db.markRecordingDeleted(recordingId);
          deleted += 1;
        } catch (error) {
          console.error(
            `Recording not deleted at Telnyx: ${error instanceof TelnyxError ? `status=${String(error.status)}` : failureSummary(error)}`,
          );
        }
      }
    }
    if (deleted > 0) console.log(`Recordings deleted at Telnyx after 24 hours: ${String(deleted)}`);
  } finally {
    await db.close().catch(() => undefined);
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
    if (event === null) return c.json({ received: true });
    if (RECORDING_EVENTS.has(event.type)) {
      const recordingOf = decodeClientState(event.payload.client_state);
      if (recordingOf === null) return c.json({ received: true });
      const url = c.env.HYPERDRIVE?.connectionString ?? c.env.DATABASE_URL;
      if (!url) return apiError(c, 500, 'MISCONFIGURED', 'The database is not configured.');
      let recordingDb: Database;
      try {
        recordingDb = openDatabase(url, { viaHyperdrive: c.env.HYPERDRIVE !== undefined });
      } catch {
        return apiError(c, 500, 'MISCONFIGURED', 'The database is not configured correctly.');
      }
      try {
        await keepRecording(recordingDb, client, recordingOf.call, event.type, event.payload);
        return c.json({ received: true });
      } catch (error) {
        // Telnyx sends the event again; keeping a recording or transcript twice changes nothing.
        console.error(
          `Telnyx recording event not kept in request ${c.get('requestId')}: ${error instanceof TelnyxError ? `status=${String(error.status)}` : failureSummary(error)}`,
        );
        return apiError(c, 500, 'INTERNAL_ERROR', 'The event could not be kept.');
      } finally {
        closeLater(c, recordingDb);
      }
    }
    if (!CALL_EVENTS.has(event.type)) return c.json({ received: true });

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
      try {
        // The call exists (app.call_placer found it), so not found means its caller can no
        // longer see it.
        if (result.status === 'not_found') throw new CallerGone();
        await sendCommands(c, db, ctx, client, state.call, result.commands);
      } catch (error) {
        if (!(error instanceof CallerGone)) throw error;
        await endAtTelnyx(c, db, client, state.call, callControlId);
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
