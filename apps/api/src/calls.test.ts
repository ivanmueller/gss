import type { CallView } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import { createApp } from './index';
import { deleteExpiredRecordings } from './calls';
import { CLAIM_LEASE_SECONDS } from './calls-db';
import {
  AUDIO_TIMEOUT_MS,
  TELNYX_TIMEOUT_MS,
  decodeClientState,
  encodeClientState,
  telnyxClient,
  telnyxConfig,
  TelnyxError,
  verifyTelnyxSignature,
  type TelnyxClient,
} from './telnyx';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Synthetic values only: 555 numbers, made-up ids and keys generated in the test.
const CALL = '00000000-0000-4000-8000-0000000ca11a';
const COUNTERPARTY = '00000000-0000-4000-8000-00000000c1aa';
const CONTACT = '00000000-0000-4000-8000-00000000d1aa';
const ORG = '00000000-0000-4000-8000-0000000000aa';
const PLACER = '00000000-0000-4000-8000-0000000044aa';
const AUTH = { Authorization: `Bearer ${VALID_TOKEN}`, 'Content-Type': 'application/json' };

const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
  'sign',
  'verify',
])) as CryptoKeyPair;
const PUBLIC_KEY = btoa(
  String.fromCharCode(
    ...new Uint8Array((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer),
  ),
);

const TELNYX_ENV = {
  ...ENV,
  TELNYX_API_KEY: 'KEY_synthetic_test_only',
  TELNYX_PUBLIC_KEY: PUBLIC_KEY,
  TELNYX_CONNECTION_ID: '1234567890',
  TELNYX_PHONE_NUMBER: '+1 (825) 555-0199',
};

const CALL_VIEW: CallView = {
  id: CALL,
  counterpartyId: COUNTERPARTY,
  contactName: 'Pat Buyer',
  status: 'calling_you',
  outcome: null,
  createdAt: '2026-11-02T16:00:00.000Z',
  connectedAt: null,
  endedAt: null,
  contactLogEntryId: null,
};

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let telnyx: { [K in keyof TelnyxClient]: ReturnType<typeof vi.fn<TelnyxClient[K]>> };
const app = createApp(openDatabase, { telnyx: (env) => (telnyxConfig(env) ? telnyx : null) });

async function sign(body: string, timestamp: number): Promise<string> {
  const signature = await crypto.subtle.sign(
    'Ed25519',
    keys.privateKey,
    new TextEncoder().encode(`${String(timestamp)}|${body}`),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function webhook(body: unknown, options: { timestamp?: number; tamper?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = await sign(raw, timestamp);
  return app.request(
    '/api/v1/telnyx/voice',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'telnyx-signature-ed25519': signature,
        'telnyx-timestamp': String(timestamp),
      },
      body: options.tamper ? raw.replace('call.answered', 'call.hangup') : raw,
    },
    TELNYX_ENV,
  );
}

function telnyxEvent(
  type: string,
  payload: Record<string, unknown>,
  id = '00000000-0000-4000-8000-0000000e7e01',
) {
  return {
    data: {
      record_type: 'event',
      id,
      event_type: type,
      occurred_at: '2026-11-02T16:00:05Z',
      payload,
    },
  };
}

beforeEach(() => {
  db = fakeDatabase();
  db.memberships.mockResolvedValue([
    { organizationId: ORG, organizationName: 'Synthetic Org A', role: 'trader' },
  ]);
  telnyx = {
    dial: vi.fn<TelnyxClient['dial']>(() => Promise.resolve('v3:new-leg')),
    confirm: vi.fn<TelnyxClient['confirm']>(() => Promise.resolve()),
    hangUp: vi.fn<TelnyxClient['hangUp']>(() => Promise.resolve()),
    reject: vi.fn<TelnyxClient['reject']>(() => Promise.resolve()),
    record: vi.fn<TelnyxClient['record']>(() => Promise.resolve()),
    recordingsOfLeg: vi.fn<TelnyxClient['recordingsOfLeg']>(() => Promise.resolve([])),
    recordingAudio: vi.fn<TelnyxClient['recordingAudio']>(() => Promise.resolve(null)),
    deleteRecording: vi.fn<TelnyxClient['deleteRecording']>(() => Promise.resolve()),
  };
  mockAuthServer(
    new Response(JSON.stringify({ id: USER_ID, email: 'tess@example.test' }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Telnyx settings and client state', () => {
  it('needs the API key, the application id and a number it can dial', () => {
    expect(telnyxConfig(TELNYX_ENV)).toEqual({
      apiKey: 'KEY_synthetic_test_only',
      connectionId: '1234567890',
      fromNumber: '+18255550199',
    });
    expect(telnyxConfig({ ...TELNYX_ENV, TELNYX_API_KEY: ' ' })).toBeNull();
    expect(telnyxConfig({ ...TELNYX_ENV, TELNYX_CONNECTION_ID: '' })).toBeNull();
    expect(telnyxConfig({ ...TELNYX_ENV, TELNYX_PHONE_NUMBER: '555-0199' })).toBeNull();
  });

  it('round-trips the call and leg, and refuses anything else', () => {
    const state = encodeClientState({ call: CALL, leg: 'them' });
    expect(decodeClientState(state)).toEqual({ call: CALL, leg: 'them' });
    expect(decodeClientState(btoa(JSON.stringify({ c: 'not-a-uuid', l: 'you' })))).toBeNull();
    expect(decodeClientState(btoa(JSON.stringify({ c: CALL, l: 'boss' })))).toBeNull();
    expect(decodeClientState('%%%')).toBeNull();
    expect(decodeClientState(undefined)).toBeNull();
  });
});

describe('verifyTelnyxSignature', () => {
  const now = 1_793_000_000;

  it('accepts the signature Telnyx makes of the timestamp, a bar and the body', async () => {
    const body = '{"data":{}}';
    expect(
      await verifyTelnyxSignature(PUBLIC_KEY, body, await sign(body, now), String(now), now + 10),
    ).toBe(true);
  });

  it('refuses a changed body, an old timestamp, a missing header or a bad key', async () => {
    const body = '{"data":{}}';
    const signature = await sign(body, now);
    expect(await verifyTelnyxSignature(PUBLIC_KEY, `${body} `, signature, String(now), now)).toBe(
      false,
    );
    expect(await verifyTelnyxSignature(PUBLIC_KEY, body, signature, String(now), now + 301)).toBe(
      false,
    );
    expect(await verifyTelnyxSignature(PUBLIC_KEY, body, signature, String(now + 1), now)).toBe(
      false,
    );
    expect(await verifyTelnyxSignature(PUBLIC_KEY, body, undefined, String(now), now)).toBe(false);
    expect(await verifyTelnyxSignature(PUBLIC_KEY, body, signature, undefined, now)).toBe(false);
    expect(await verifyTelnyxSignature('not-a-key', body, signature, String(now), now)).toBe(false);
    expect(await verifyTelnyxSignature(PUBLIC_KEY, body, 'AAAA', String(now), now)).toBe(false);
  });
});

describe('the Telnyx client', () => {
  it("dials from GSS's number with the call in client_state, and joins a leg when asked", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { call_control_id: 'v3:their-leg' } }), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = telnyxClient(TELNYX_ENV);
    const id = await client?.dial({
      to: '+14035550100',
      clientState: { call: CALL, leg: 'them' },
      timeoutSecs: 45,
      bridgeTo: 'v3:staff-leg',
    });
    expect(id).toBe('v3:their-leg');
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://api.telnyx.com/v2/calls');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer KEY_synthetic_test_only');
    // Every request gives up within its time limit (Codex's sixth review, finding 1).
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({
      connection_id: '1234567890',
      to: '+14035550100',
      from: '+18255550199',
      timeout_secs: 45,
      client_state: encodeClientState({ call: CALL, leg: 'them' }),
      command_id: `${CALL}-them`,
      time_limit_secs: 14400,
      link_to: 'v3:staff-leg',
      bridge_on_answer: true,
    });
  });

  it('asks for 1 and hangs up through the call actions; refusals carry codes only', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{"data":{"result":"ok"}}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = telnyxClient(TELNYX_ENV);
    await client?.confirm('v3:staff/leg', { call: CALL, leg: 'you' }, 'cmd-1');
    await client?.hangUp('v3:staff-leg', 'cmd-2');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.telnyx.com/v2/calls/v3%3Astaff%2Fleg/actions/gather_using_speak',
      'https://api.telnyx.com/v2/calls/v3%3Astaff-leg/actions/hangup',
    ]);
    const confirm = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as Record<
      string,
      unknown
    >;
    expect(confirm).toMatchObject({
      valid_digits: '1',
      maximum_digits: 1,
      language: 'en-US',
      command_id: 'cmd-1',
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      command_id: 'cmd-2',
    });
    expect(JSON.stringify(confirm)).not.toContain('Pat');

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ errors: [{ code: '90018', detail: 'Pat Buyer is gone' }] }), {
        status: 422,
      }),
    );
    const refused = await client?.hangUp('v3:staff-leg').catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(TelnyxError);
    expect(refused).toMatchObject({ status: 422, codes: '90018' });
    expect(String(refused)).not.toContain('Pat');
  });

  it('is not made without the settings', () => {
    expect(telnyxClient({ TELNYX_API_KEY: 'KEY_synthetic_test_only' })).toBeNull();
  });
});

describe('/api/v1/me/phone', () => {
  it("reads the person's own cell and whether calling is set up", async () => {
    db.getMemberPhone.mockResolvedValue('+14035550142');
    const response = await app.request('/api/v1/me/phone', { headers: AUTH }, TELNYX_ENV);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ phone: '(403) 555-0142', callingAvailable: true });
    expect(db.getMemberPhone).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
    );
    const unset = await app.request('/api/v1/me/phone', { headers: AUTH }, ENV);
    expect(await unset.json()).toMatchObject({ callingAvailable: false });
  });

  it('saves a cell typed any usual way, as E.164', async () => {
    const response = await app.request(
      '/api/v1/me/phone',
      { method: 'PUT', headers: AUTH, body: JSON.stringify({ phone: '403.555.0142' }) },
      TELNYX_ENV,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ phone: '(403) 555-0142' });
    expect(db.saveMemberPhone).toHaveBeenCalledWith(expect.anything(), ORG, '+14035550142');
  });

  it('refuses a number it cannot dial and someone who is not a member', async () => {
    const bad = await app.request(
      '/api/v1/me/phone',
      { method: 'PUT', headers: AUTH, body: JSON.stringify({ phone: '555-0142 x3' }) },
      TELNYX_ENV,
    );
    expect(bad.status).toBe(422);
    db.memberships.mockResolvedValue([]);
    const outsider = await app.request('/api/v1/me/phone', { headers: AUTH }, TELNYX_ENV);
    expect(outsider.status).toBe(403);
    expect(db.saveMemberPhone).not.toHaveBeenCalled();
  });

  it('needs sign-in', async () => {
    const response = await app.request('/api/v1/me/phone', {}, TELNYX_ENV);
    expect(response.status).toBe(401);
  });

  it('removes the cell', async () => {
    const response = await app.request(
      '/api/v1/me/phone',
      { method: 'DELETE', headers: AUTH },
      TELNYX_ENV,
    );
    expect(response.status).toBe(200);
    expect(db.saveMemberPhone).toHaveBeenCalledWith(expect.anything(), ORG, null);
  });
});

describe('POST /api/v1/calls', () => {
  const place = (
    env: typeof ENV = TELNYX_ENV,
    body: unknown = { counterpartyId: COUNTERPARTY, contactId: CONTACT },
  ) =>
    app.request(
      '/api/v1/calls',
      { method: 'POST', headers: AUTH, body: JSON.stringify(body) },
      env,
    );

  it("records the call, rings the caller's cell and returns its progress", async () => {
    db.getCall.mockResolvedValue(CALL_VIEW);
    const response = await place();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ call: CALL_VIEW });
    expect(db.placeCall).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      COUNTERPARTY,
      CONTACT,
      '+18255550199',
    );
    expect(telnyx.dial).toHaveBeenCalledWith({
      to: '+14035550142',
      clientState: { call: CALL, leg: 'you' },
      timeoutSecs: 30,
    });
    expect(db.recordLeg).toHaveBeenCalledWith(expect.anything(), CALL, 'you', 'v3:new-leg');
  });

  it('is refused until calling is set up', async () => {
    const response = await place(ENV);
    expect(response.status).toBe(503);
    expect(db.placeCall).not.toHaveBeenCalled();
  });

  it('says what stands in the way', async () => {
    const cases = [
      ['not_found', 404, 'NOT_FOUND'],
      ['forbidden', 403, 'FORBIDDEN'],
      ['archived', 409, 'ARCHIVED'],
      ['no_number', 422, 'NO_NUMBER'],
      ['not_dialable', 422, 'NOT_DIALABLE'],
      ['no_cell', 409, 'NO_CELL_PHONE'],
      ['in_progress', 409, 'CALL_IN_PROGRESS'],
    ] as const;
    for (const [status, code, error] of cases) {
      db.placeCall.mockResolvedValueOnce({ status });
      const response = await place();
      expect(response.status).toBe(code);
      expect(await response.json()).toMatchObject({ error: { code: error } });
    }
    expect(telnyx.dial).not.toHaveBeenCalled();
  });

  it('ends the call as failed when Telnyx refuses to dial', async () => {
    telnyx.dial.mockRejectedValueOnce(new TelnyxError(403, '10010'));
    const response = await place();
    expect(response.status).toBe(502);
    expect(db.failCall).toHaveBeenCalledWith(expect.anything(), CALL, 'failed');
  });

  it('refuses a malformed request', async () => {
    const response = await place(TELNYX_ENV, { counterpartyId: COUNTERPARTY, phone: '+1555' });
    expect(response.status).toBe(422);
  });

  it('shows a call to the members who can see it', async () => {
    db.getCall.mockResolvedValue(CALL_VIEW);
    const response = await app.request(`/api/v1/calls/${CALL}`, { headers: AUTH }, TELNYX_ENV);
    expect(await response.json()).toEqual({ call: CALL_VIEW });
    db.getCall.mockResolvedValue(null);
    const hidden = await app.request(`/api/v1/calls/${CALL}`, { headers: AUTH }, TELNYX_ENV);
    expect(hidden.status).toBe(404);
  });
});

describe('POST /api/v1/telnyx/voice', () => {
  const answered = telnyxEvent('call.answered', {
    call_control_id: 'v3:staff-leg',
    client_state: encodeClientState({ call: CALL, leg: 'you' }),
  });

  beforeEach(() => {
    db.callPlacer.mockResolvedValue({ organizationId: ORG, placedBy: PLACER });
  });

  it('refuses an event whose signature does not match, before reading it', async () => {
    const tampered = await webhook(answered, { tamper: true });
    expect(tampered.status).toBe(401);
    const stale = await webhook(answered, { timestamp: Math.floor(Date.now() / 1000) - 600 });
    expect(stale.status).toBe(401);
    const unsigned = await app.request(
      '/api/v1/telnyx/voice',
      { method: 'POST', body: JSON.stringify(answered) },
      TELNYX_ENV,
    );
    expect(unsigned.status).toBe(401);
    expect(db.callPlacer).not.toHaveBeenCalled();
    expect(db.applyCallEvent).not.toHaveBeenCalled();
  });

  it('is refused until calling is set up', async () => {
    const response = await app.request(
      '/api/v1/telnyx/voice',
      { method: 'POST', body: '{}' },
      { ...TELNYX_ENV, TELNYX_PUBLIC_KEY: '' },
    );
    expect(response.status).toBe(503);
  });

  const CONFIRM = {
    id: '00000000-0000-4000-8000-0000000c0d01',
    kind: 'confirm' as const,
    callControlId: 'v3:staff-leg',
  };
  const DIAL = {
    id: '00000000-0000-4000-8000-0000000c0d02',
    kind: 'dial_them' as const,
    callControlId: 'v3:staff-leg',
  };
  const HANG_UP = {
    id: '00000000-0000-4000-8000-0000000c0d03',
    kind: 'hang_up' as const,
    callControlId: 'v3:their-leg',
  };
  const claimed = <
    T extends { id: string; kind: 'confirm' | 'dial_them' | 'hang_up'; callControlId: string },
  >(
    command: T,
    attempt = 1,
  ) => ({
    status: 'claimed' as const,
    command: { ...command, counterpartyPhone: '+14035550100', attempt },
  });

  it('applies an event as the person who placed the call, then sends what follows', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [CONFIRM] });
    db.claimCommand.mockResolvedValue(claimed(CONFIRM));
    const response = await webhook(answered);
    expect(response.status).toBe(200);
    expect(db.callPlacer).toHaveBeenCalledWith(CALL);
    expect(db.applyCallEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: PLACER }),
      CALL,
      '00000000-0000-4000-8000-0000000e7e01',
      {
        type: 'call.answered',
        leg: 'you',
        occurredAt: '2026-11-02T16:00:05.000Z',
        callControlId: 'v3:staff-leg',
        digits: null,
        gatherStatus: null,
        hangupCause: null,
      },
    );
    expect(db.claimCommand).toHaveBeenCalledWith(expect.anything(), CALL, CONFIRM.id);
    expect(telnyx.confirm).toHaveBeenCalledWith(
      'v3:staff-leg',
      { call: CALL, leg: 'you' },
      CONFIRM.id,
    );
    expect(db.finishCommand).toHaveBeenCalledWith(expect.anything(), CALL, CONFIRM.id, 1, {
      kind: 'done',
    });
  });

  it("sends a command again when Telnyx could not be reached, on the event's next delivery", async () => {
    // Codex's review of ivanmueller/gss#107, finding 1: the first attempt fails with a network
    // error after the event was kept; Telnyx sends the event again and the command goes out.
    db.applyCallEvent
      .mockResolvedValueOnce({ status: 'applied', commands: [CONFIRM] })
      .mockResolvedValueOnce({ status: 'duplicate', commands: [CONFIRM] });
    db.claimCommand
      .mockResolvedValueOnce(claimed(CONFIRM, 1))
      .mockResolvedValueOnce(claimed(CONFIRM, 2));
    telnyx.confirm.mockRejectedValueOnce(new TypeError('fetch failed'));
    const first = await webhook(answered);
    expect(first.status).toBe(500);
    expect(db.finishCommand).toHaveBeenCalledWith(expect.anything(), CALL, CONFIRM.id, 1, {
      kind: 'retry',
    });
    const again = await webhook(answered);
    expect(again.status).toBe(200);
    expect(telnyx.confirm).toHaveBeenCalledTimes(2);
    expect(db.finishCommand).toHaveBeenLastCalledWith(expect.anything(), CALL, CONFIRM.id, 2, {
      kind: 'done',
    });
  });

  it('sends nothing for a repeated event whose commands went out', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'duplicate', commands: [] });
    const response = await webhook(answered);
    expect(response.status).toBe(200);
    expect(telnyx.confirm).not.toHaveBeenCalled();
  });

  it('sends nothing the call no longer wants (the claim is refused)', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [DIAL] });
    db.claimCommand.mockResolvedValue({ status: 'skipped' });
    const response = await webhook(answered);
    expect(response.status).toBe(200);
    expect(telnyx.dial).not.toHaveBeenCalled();
    expect(db.finishCommand).not.toHaveBeenCalled();
  });

  it("dials them joined to the caller's leg once 1 is pressed", async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [DIAL] });
    db.claimCommand.mockResolvedValue(claimed(DIAL));
    await webhook(
      telnyxEvent('call.gather.ended', {
        call_control_id: 'v3:staff-leg',
        client_state: encodeClientState({ call: CALL, leg: 'you' }),
        digits: '1',
        status: 'valid',
      }),
    );
    expect(telnyx.dial).toHaveBeenCalledWith({
      to: '+14035550100',
      clientState: { call: CALL, leg: 'them' },
      timeoutSecs: 45,
      bridgeTo: 'v3:staff-leg',
    });
    expect(db.finishCommand).toHaveBeenCalledWith(expect.anything(), CALL, DIAL.id, 1, {
      kind: 'done',
      legId: 'v3:new-leg',
    });
  });

  it('hangs up the new leg of a dial whose call ended meanwhile', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [DIAL] });
    db.claimCommand.mockResolvedValue(claimed(DIAL));
    const ORPHAN = {
      id: '00000000-0000-4000-8000-0000000c0d04',
      kind: 'hang_up' as const,
      callControlId: 'v3:new-leg',
    };
    db.claimCommand.mockResolvedValueOnce(claimed(DIAL)).mockResolvedValueOnce(claimed(ORPHAN));
    db.finishCommand.mockResolvedValueOnce({ followUp: ORPHAN });
    const response = await webhook(answered);
    expect(response.status).toBe(200);
    expect(db.claimCommand).toHaveBeenLastCalledWith(expect.anything(), CALL, ORPHAN.id);
    expect(telnyx.hangUp).toHaveBeenCalledWith('v3:new-leg', ORPHAN.id);
  });

  it('records a refusal and hangs up the leg the database names', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [DIAL] });
    db.claimCommand.mockResolvedValue(claimed(DIAL));
    const STAFF_HANG_UP = {
      id: '00000000-0000-4000-8000-0000000c0d05',
      kind: 'hang_up' as const,
      callControlId: 'v3:staff-leg',
    };
    db.claimCommand
      .mockResolvedValueOnce(claimed(DIAL))
      .mockResolvedValueOnce(claimed(STAFF_HANG_UP));
    db.finishCommand.mockResolvedValueOnce({ followUp: STAFF_HANG_UP });
    telnyx.dial.mockRejectedValueOnce(new TelnyxError(422, '90046'));
    const response = await webhook(answered);
    expect(response.status).toBe(200);
    expect(db.finishCommand).toHaveBeenCalledWith(expect.anything(), CALL, DIAL.id, 1, {
      kind: 'failed',
    });
    expect(telnyx.hangUp).toHaveBeenCalledWith('v3:staff-leg', STAFF_HANG_UP.id);
  });

  it("answers 503 when a lapsed claim's failure leaves a renewed claim unresolved (fourth review)", async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'duplicate', commands: [DIAL] });
    db.claimCommand.mockResolvedValue(claimed(DIAL));
    db.finishCommand.mockResolvedValue({ followUp: null, unresolved: true });
    // The renewed claim still holds the dial.
    db.unsettledCommands.mockResolvedValue([DIAL]);
    telnyx.dial.mockRejectedValueOnce(new TelnyxError(422, '90046'));
    const response = await webhook(answered);
    expect(response.status).toBe(503);
  });

  it('asks for the event again while another delivery holds a claim (re-review, finding 2)', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'duplicate', commands: [DIAL] });
    db.claimCommand.mockResolvedValue({ status: 'busy' });
    db.unsettledCommands.mockResolvedValue([DIAL]);
    const response = await webhook(answered);
    expect(response.status).toBe(503);
    expect(telnyx.dial).not.toHaveBeenCalled();
  });

  it('is acknowledged only when every command of the call is settled (fifth review, 1 and 2)', async () => {
    // This event's own commands are done, but a cleanup hang-up of the call, made by another
    // delivery, is still being sent by it: the event comes again.
    const CLEANUP = {
      id: '00000000-0000-4000-8000-0000000c0d07',
      kind: 'hang_up' as const,
      callControlId: 'v3:stray',
    };
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [] });
    db.unsettledCommands.mockResolvedValue([CLEANUP]);
    db.claimCommand.mockResolvedValue({ status: 'busy' });
    const busy = await webhook(answered);
    expect(busy.status).toBe(503);
    expect(db.claimCommand).toHaveBeenCalledWith(expect.anything(), CALL, CLEANUP.id);

    // Once that delivery's claim has lapsed, this delivery sends it and is acknowledged.
    db.unsettledCommands.mockReset();
    db.unsettledCommands.mockResolvedValueOnce([CLEANUP]).mockResolvedValueOnce([]);
    db.claimCommand.mockResolvedValue(claimed(CLEANUP, 2));
    const sent = await webhook(answered);
    expect(sent.status).toBe(200);
    expect(telnyx.hangUp).toHaveBeenCalledWith('v3:stray', CLEANUP.id);
  });

  it('gives an audio download more time than a command (Codex, finding 2)', () => {
    expect(AUDIO_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('gives every Telnyx request less time than a claim lasts (sixth review, 1)', () => {
    // A lapsed claim's request is certainly over, with room for the database round trips.
    expect(CLAIM_LEASE_SECONDS * 1000).toBeGreaterThanOrEqual(2 * TELNYX_TIMEOUT_MS + 5000);
  });

  it('keeps a dial pending when its request to Telnyx timed out (sixth review, 1)', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [DIAL] });
    db.claimCommand.mockResolvedValue(claimed(DIAL));
    telnyx.dial.mockRejectedValueOnce(new DOMException('The operation timed out.', 'TimeoutError'));
    const response = await webhook(answered);
    expect(response.status).toBe(500);
    expect(db.finishCommand).toHaveBeenLastCalledWith(expect.anything(), CALL, DIAL.id, 1, {
      kind: 'retry',
    });
  });

  it('ends at Telnyx a call whose caller can no longer reach it (sixth review, 2)', async () => {
    // Suspended before the event: the call is hidden from them.
    db.applyCallEvent.mockResolvedValue({ status: 'not_found' });
    db.callLegs.mockResolvedValue(['v3:staff-leg', 'v3:their-leg']);
    const before = await webhook(answered);
    expect(before.status).toBe(200);
    expect(db.callLegs).toHaveBeenCalledWith(CALL);
    expect(telnyx.hangUp.mock.calls.map(([leg]) => leg).sort()).toEqual([
      'v3:staff-leg',
      'v3:their-leg',
    ]);

    // Suspended while its commands were being sent: the drain finds the call hidden.
    telnyx.hangUp.mockClear();
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [] });
    db.unsettledCommands.mockResolvedValue(null);
    db.callLegs.mockResolvedValue(['v3:stray-leg']);
    const during = await webhook(answered);
    expect(during.status).toBe(200);
    expect(telnyx.hangUp.mock.calls.map(([leg]) => leg).sort()).toEqual([
      'v3:staff-leg',
      'v3:stray-leg',
    ]);

    // A hang-up that cannot reach Telnyx has the event come again; a leg already gone is fine.
    telnyx.hangUp.mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await webhook(answered)).status).toBe(500);
    telnyx.hangUp.mockRejectedValue(new TelnyxError(422, '90018'));
    expect((await webhook(answered)).status).toBe(200);
  });

  it('keeps and hangs up the leg of a dial whose caller was suspended meanwhile (seventh review)', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [DIAL] });
    db.claimCommand.mockResolvedValue(claimed(DIAL));
    // Suspended while Telnyx dialed: the call is hidden when the dial comes back.
    db.finishCommand.mockResolvedValue({ followUp: null, callerGone: true });
    db.callLegs.mockResolvedValue(['v3:staff-leg', 'v3:new-leg']);
    const response = await webhook(answered);
    expect(response.status).toBe(200);
    expect(db.keepStrayLeg).toHaveBeenCalledWith(DIAL.id, 'v3:new-leg');
    expect(telnyx.hangUp.mock.calls.map(([leg]) => leg).sort()).toEqual([
      'v3:new-leg',
      'v3:staff-leg',
    ]);
  });

  it('keeps a hang-up pending when Telnyx refuses it for now (fifth review, 3)', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [HANG_UP] });
    db.claimCommand.mockResolvedValue(claimed(HANG_UP));
    for (const status of [503, 429, 500, 408]) {
      telnyx.hangUp.mockRejectedValueOnce(new TelnyxError(status, 'none'));
      const response = await webhook(answered);
      expect(response.status).toBe(500);
      expect(db.finishCommand).toHaveBeenLastCalledWith(expect.anything(), CALL, HANG_UP.id, 1, {
        kind: 'retry',
      });
    }
    // A leg already gone (422) is a final answer.
    telnyx.hangUp.mockRejectedValueOnce(new TelnyxError(422, '90018'));
    const gone = await webhook(answered);
    expect(gone.status).toBe(200);
    expect(db.finishCommand).toHaveBeenLastCalledWith(expect.anything(), CALL, HANG_UP.id, 1, {
      kind: 'failed',
    });
  });

  it('keeps a cleanup hang-up that could not reach Telnyx for the next delivery (re-review, finding 3)', async () => {
    const ORPHAN = {
      id: '00000000-0000-4000-8000-0000000c0d06',
      kind: 'hang_up' as const,
      callControlId: 'v3:new-leg',
    };
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [DIAL] });
    db.claimCommand.mockResolvedValueOnce(claimed(DIAL)).mockResolvedValueOnce(claimed(ORPHAN));
    db.finishCommand.mockResolvedValueOnce({ followUp: ORPHAN });
    telnyx.hangUp.mockRejectedValueOnce(new TypeError('fetch failed'));
    const response = await webhook(answered);
    expect(response.status).toBe(500);
    expect(db.finishCommand).toHaveBeenLastCalledWith(expect.anything(), CALL, ORPHAN.id, 1, {
      kind: 'retry',
    });
  });

  it('keeps going when a leg to hang up is already gone', async () => {
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [HANG_UP] });
    db.claimCommand.mockResolvedValue(claimed(HANG_UP));
    telnyx.hangUp.mockRejectedValueOnce(new TelnyxError(422, '90018'));
    const response = await webhook(answered);
    expect(response.status).toBe(200);
    expect(telnyx.hangUp).toHaveBeenCalledWith('v3:their-leg', HANG_UP.id);
    expect(db.finishCommand).toHaveBeenCalledWith(expect.anything(), CALL, HANG_UP.id, 1, {
      kind: 'failed',
    });
  });

  it('gives an incoming call a busy signal, as callbacks are not routed yet', async () => {
    const response = await webhook(
      telnyxEvent('call.initiated', { call_control_id: 'v3:incoming', direction: 'incoming' }),
    );
    expect(response.status).toBe(200);
    expect(telnyx.reject).toHaveBeenCalledWith('v3:incoming');
    expect(db.callPlacer).not.toHaveBeenCalled();
  });

  it('acknowledges events it does not use and calls it does not know', async () => {
    const other = await webhook(telnyxEvent('call.bridged', { client_state: 'x' }));
    expect(other.status).toBe(200);
    db.callPlacer.mockResolvedValue(null);
    const unknown = await webhook(answered);
    expect(unknown.status).toBe(200);
    expect(db.applyCallEvent).not.toHaveBeenCalled();
  });

  it('asks Telnyx to send again when the database fails', async () => {
    db.applyCallEvent.mockRejectedValue(Object.assign(new Error('boom'), { code: '08006' }));
    const response = await webhook(answered);
    expect(response.status).toBe(500);
    expect(telnyx.confirm).not.toHaveBeenCalled();
  });
});

describe("call recordings and transcripts (owner's request, 2026-11-02)", () => {
  const RECORD = {
    id: '00000000-0000-4000-8000-0000000c0d08',
    kind: 'record' as const,
    callControlId: 'v3:staff-leg',
  };
  const RECORDING = '00000000-0000-4000-8000-0000000eec01';
  const recordingState = encodeClientState({ call: CALL, leg: 'you' });

  it('starts recording once they are connected', async () => {
    db.callPlacer.mockResolvedValue({ organizationId: ORG, placedBy: PLACER });
    db.applyCallEvent.mockResolvedValue({ status: 'applied', commands: [RECORD] });
    db.claimCommand.mockResolvedValue({
      status: 'claimed',
      command: { ...RECORD, counterpartyPhone: '+14035550100', attempt: 1 },
    });
    const response = await webhook(
      telnyxEvent('call.answered', {
        call_control_id: 'v3:their-leg',
        client_state: encodeClientState({ call: CALL, leg: 'them' }),
      }),
    );
    expect(response.status).toBe(200);
    expect(telnyx.record).toHaveBeenCalledWith(
      'v3:staff-leg',
      { call: CALL, leg: 'you' },
      RECORD.id,
    );
  });

  it("keeps a call's recording, asking Telnyx for the leg's recording ids", async () => {
    telnyx.recordingsOfLeg.mockResolvedValue(['synthetic-rec-1']);
    const response = await webhook(
      telnyxEvent('call.recording.saved', {
        call_leg_id: 'leg-1',
        client_state: recordingState,
        recording_started_at: '2026-11-02T16:01:00Z',
        recording_ended_at: '2026-11-02T16:07:12Z',
      }),
    );
    expect(response.status).toBe(200);
    expect(telnyx.recordingsOfLeg).toHaveBeenCalledWith('leg-1');
    expect(db.keepCallRecording).toHaveBeenCalledWith(
      CALL,
      'synthetic-rec-1',
      '2026-11-02T16:01:00.000Z',
      '2026-11-02T16:07:12.000Z',
    );
  });

  it('keeps its transcript, and asks for the event again when it cannot', async () => {
    const transcribed = telnyxEvent('call.recording.transcription.saved', {
      client_state: recordingState,
      recording_id: 'synthetic-rec-1',
      transcription_text: 'We can do November at the posted price.',
      status: 'completed',
    });
    expect((await webhook(transcribed)).status).toBe(200);
    expect(db.keepCallTranscript).toHaveBeenCalledWith(
      CALL,
      'synthetic-rec-1',
      'We can do November at the posted price.',
    );
    db.keepCallTranscript.mockRejectedValueOnce(Object.assign(new Error('x'), { code: '08006' }));
    expect((await webhook(transcribed)).status).toBe(500);
  });

  it('ignores a recording event that is not about one of its calls', async () => {
    const response = await webhook(telnyxEvent('call.recording.saved', { call_leg_id: 'leg-1' }));
    expect(response.status).toBe(200);
    expect(telnyx.recordingsOfLeg).not.toHaveBeenCalled();
  });

  it("lists a counterparty's recordings for everyone on the team", async () => {
    db.listRecordings.mockResolvedValue([
      {
        id: RECORDING,
        callId: CALL,
        contactLogEntryId: null,
        transcript: 'Hello.',
        audioUntil: '2026-11-03T16:07:12.000Z',
      },
    ]);
    const response = await app.request(
      `/api/v1/calls/recordings?counterparty_id=${COUNTERPARTY}`,
      { headers: AUTH },
      TELNYX_ENV,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ recordings: [{ id: RECORDING }] });
    expect(db.listRecordings).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      COUNTERPARTY,
    );
  });

  it('passes on the audio for 24 hours, and nothing after', async () => {
    db.playableRecording.mockResolvedValue('synthetic-rec-1');
    telnyx.recordingAudio.mockResolvedValue(new Response('ID3-synthetic', { status: 200 }));
    const audio = await app.request(
      `/api/v1/calls/recordings/${RECORDING}/audio`,
      { headers: AUTH },
      TELNYX_ENV,
    );
    expect(audio.status).toBe(200);
    expect(audio.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(audio.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await audio.text()).toBe('ID3-synthetic');

    db.playableRecording.mockResolvedValue(null);
    const gone = await app.request(
      `/api/v1/calls/recordings/${RECORDING}/audio`,
      { headers: AUTH },
      TELNYX_ENV,
    );
    expect(gone.status).toBe(404);
    const unsigned = await app.request(
      `/api/v1/calls/recordings/${RECORDING}/audio`,
      {},
      TELNYX_ENV,
    );
    expect(unsigned.status).toBe(401);
  });

  it('keeps a long transcript (Codex, finding 1)', async () => {
    const words = 'November at the posted price. '.repeat(2500);
    expect(words.length).toBeGreaterThan(70_000);
    const response = await webhook(
      telnyxEvent('call.recording.transcription.saved', {
        client_state: recordingState,
        recording_id: 'synthetic-rec-1',
        transcription_text: words,
      }),
    );
    expect(response.status).toBe(200);
    expect(db.keepCallTranscript).toHaveBeenCalledWith(CALL, 'synthetic-rec-1', words);
  });

  it('asks for a recording event again while Telnyx does not list the recording yet', async () => {
    telnyx.recordingsOfLeg.mockResolvedValue([]);
    const response = await webhook(
      telnyxEvent('call.recording.saved', { call_leg_id: 'leg-1', client_state: recordingState }),
    );
    expect(response.status).toBe(500);
    expect(db.keepCallRecording).not.toHaveBeenCalled();
  });

  it('works through a backlog of expired recordings in one run (Codex, finding 3)', async () => {
    const due = Array.from({ length: 101 }, (_, i) => `synthetic-rec-${String(i)}`);
    const deleted = new Set<string>();
    db.recordingsToDelete.mockImplementation((most) =>
      Promise.resolve(due.filter((id) => !deleted.has(id)).slice(0, most)),
    );
    db.markRecordingDeleted.mockImplementation((id) => {
      deleted.add(id);
      return Promise.resolve();
    });
    await deleteExpiredRecordings(TELNYX_ENV, openDatabase, () => telnyx);
    expect(deleted.size).toBe(101);
  });

  it('deletes at Telnyx the audio of recordings 24 hours old, keeping their transcripts', async () => {
    db.recordingsToDelete.mockImplementation(() =>
      Promise.resolve(
        ['synthetic-rec-1', 'synthetic-rec-2'].filter(
          (id) => !db.markRecordingDeleted.mock.calls.some(([deleted]) => deleted === id),
        ),
      ),
    );
    telnyx.deleteRecording
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(new TelnyxError(503, 'none'));
    await deleteExpiredRecordings(TELNYX_ENV, openDatabase, () => telnyx);
    expect(telnyx.deleteRecording).toHaveBeenCalledTimes(2);
    // The one Telnyx could not delete now is tried again next hour.
    expect(db.markRecordingDeleted).toHaveBeenCalledTimes(1);
    expect(db.markRecordingDeleted).toHaveBeenCalledWith('synthetic-rec-1');
  });
});

describe('the Telnyx client for recordings', () => {
  it('records both sides with transcription, and finds, plays and deletes recordings', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/actions/record_start'))
        return Promise.resolve(Response.json({ data: {} }));
      if (url.includes('/recordings?')) {
        return Promise.resolve(Response.json({ data: [{ id: 'synthetic-rec-1' }, { id: 7 }] }));
      }
      if (url.endsWith('/recordings/synthetic-rec-1')) {
        return Promise.resolve(
          Response.json({ data: { download_urls: { mp3: 'https://files.example.test/rec.mp3' } } }),
        );
      }
      if (url === 'https://files.example.test/rec.mp3') return Promise.resolve(new Response('mp3'));
      return Promise.resolve(Response.json({ errors: [{ code: '10005' }] }, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = telnyxClient(TELNYX_ENV);
    await client?.record('v3:staff-leg', { call: CALL, leg: 'you' }, 'cmd-r');
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(JSON.parse(init?.body as string)).toMatchObject({
      format: 'mp3',
      channels: 'dual',
      play_beep: false,
      transcription: true,
      command_id: 'cmd-r',
    });
    expect(await client?.recordingsOfLeg('leg 1')).toEqual(['synthetic-rec-1']);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.telnyx.com/v2/recordings?filter[call_leg_id]=leg%201',
    );
    expect(await (await client?.recordingAudio('synthetic-rec-1'))?.text()).toBe('mp3');
    expect(await client?.recordingAudio('gone')).toBeNull();
    await expect(client?.deleteRecording('gone')).resolves.toBeUndefined();
  });
});
