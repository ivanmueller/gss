import { callbackPrompt, VOICEMAIL_MESSAGE, voicemailLines } from '@grain/domain';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toOurNumber } from './callbacks';
import type { CallbackCommand, ClaimedCallbackCommand } from './callbacks-db';
import { callbackTurn } from './calls-db';
import { transcribeNewRecordings } from './calls';
import type { Database } from './db';
import { createApp } from './index';
import { callHeadline } from './readings';
import type { ReadingContextRow } from './readings-db';
import {
  decodeClientState,
  encodeClientState,
  telnyxClient,
  telnyxConfig,
  TelnyxError,
  type TelnyxClient,
} from './telnyx';
import { ENV, fakeDatabase, mockAuthServer, USER_ID, VALID_TOKEN } from './testing/helpers';

// Callbacks to GSS's number (F-132). Synthetic values only: 555 numbers, made-up ids and keys
// generated in the test.
const CALL = '00000000-0000-4000-8000-0000000cb11a';
const ATTEMPT = '00000000-0000-4000-8000-0000000a7701';
const ORG = '00000000-0000-4000-8000-0000000000aa';
const COMPANY = '00000000-0000-4000-8000-00000000c1aa';
const CONTACT = '00000000-0000-4000-8000-00000000d1aa';
const PERSON = '00000000-0000-4000-8000-0000000011aa';
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

let db = fakeDatabase();
const openDatabase = vi.fn<(url: string) => Database>(() => db);
let telnyx: { [K in keyof TelnyxClient]: ReturnType<typeof vi.fn<TelnyxClient[K]>> };
const app = createApp(openDatabase, { telnyx: (env) => (telnyxConfig(env) ? telnyx : null) });

async function webhook(body: unknown) {
  const raw = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await crypto.subtle.sign(
    'Ed25519',
    keys.privateKey,
    new TextEncoder().encode(`${String(timestamp)}|${raw}`),
  );
  return app.request(
    '/api/v1/telnyx/voice',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'telnyx-signature-ed25519': btoa(String.fromCharCode(...new Uint8Array(signature))),
        'telnyx-timestamp': String(timestamp),
      },
      body: raw,
    },
    TELNYX_ENV,
  );
}

function telnyxEvent(type: string, payload: Record<string, unknown>, id = 'ev-cb-1') {
  return {
    data: {
      record_type: 'event',
      id,
      event_type: type,
      occurred_at: '2026-11-06T20:00:05Z',
      payload,
    },
  };
}

/** An incoming leg calling GSS's number through GSS's application. */
const INCOMING = {
  call_control_id: 'v3:incoming',
  direction: 'incoming',
  from: '+14035550100',
  to: '+18255550199',
  connection_id: '1234567890',
};

const memberState = encodeClientState({ call: CALL, leg: 'you', callback: true, attempt: ATTEMPT });
const callerState = encodeClientState({ call: CALL, leg: 'them', callback: true });

function command(kind: CallbackCommand['kind'], id: string, leg = 'v3:incoming'): CallbackCommand {
  return {
    id,
    kind,
    callControlId: leg,
    attemptId: kind === 'answer' || kind === 'greet' ? null : ATTEMPT,
  };
}

function claimed(c: CallbackCommand, extra: Partial<ClaimedCallbackCommand> = {}) {
  return {
    status: 'claimed' as const,
    command: {
      ...c,
      claim: 1,
      cell: null,
      bridgeWith: null,
      companyName: 'Synthetic A Buyer',
      ...extra,
    },
  };
}

beforeEach(() => {
  db = fakeDatabase();
  db.memberships.mockResolvedValue([
    { organizationId: ORG, organizationName: 'Synthetic Org A', role: 'org_admin' },
  ]);
  telnyx = {
    dial: vi.fn<TelnyxClient['dial']>(() => Promise.resolve('v3:cell-leg')),
    confirm: vi.fn<TelnyxClient['confirm']>(() => Promise.resolve()),
    hangUp: vi.fn<TelnyxClient['hangUp']>(() => Promise.resolve()),
    reject: vi.fn<TelnyxClient['reject']>(() => Promise.resolve()),
    answer: vi.fn<TelnyxClient['answer']>(() => Promise.resolve()),
    bridge: vi.fn<TelnyxClient['bridge']>(() => Promise.resolve()),
    speak: vi.fn<TelnyxClient['speak']>(() => Promise.resolve()),
    recordVoicemail: vi.fn<TelnyxClient['recordVoicemail']>(() => Promise.resolve()),
    record: vi.fn<TelnyxClient['record']>(() => Promise.resolve()),
    recordingsOfLeg: vi.fn<TelnyxClient['recordingsOfLeg']>(() => Promise.resolve([])),
    recordingAudio: vi.fn<TelnyxClient['recordingAudio']>(() => Promise.resolve(null)),
    deleteRecording: vi.fn<TelnyxClient['deleteRecording']>(() => Promise.resolve()),
    transcribeRecording: vi.fn<TelnyxClient['transcribeRecording']>(() => Promise.resolve(null)),
  };
  mockAuthServer(
    new Response(JSON.stringify({ id: USER_ID, email: 'adam@example.test' }), { status: 200 }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('client state and the words on the cell', () => {
  it('marks a callback and its attempt, and refuses a forged marker', () => {
    expect(decodeClientState(memberState)).toEqual({
      call: CALL,
      leg: 'you',
      callback: true,
      attempt: ATTEMPT,
    });
    expect(decodeClientState(callerState)).toEqual({ call: CALL, leg: 'them', callback: true });
    expect(decodeClientState(btoa(JSON.stringify({ c: CALL, l: 'you', k: 'other' })))).toBeNull();
    expect(
      decodeClientState(btoa(JSON.stringify({ c: CALL, l: 'you', k: 'cb', a: 'x' }))),
    ).toBeNull();
    // A call placed from the platform keeps its state as before.
    expect(decodeClientState(encodeClientState({ call: CALL, leg: 'you' }))).toEqual({
      call: CALL,
      leg: 'you',
    });
  });

  it('names the company, or an unknown number, without anything that is not a name', () => {
    expect(callbackPrompt('Synthetic A Buyer')).toBe(
      'Callback from Synthetic A Buyer. Press 1 to take it.',
    );
    expect(callbackPrompt(null)).toBe('Callback from an unknown number. Press 1 to take it.');
    expect(callbackPrompt('<speak>x</speak>')).toBe(
      'Callback from speak x speak. Press 1 to take it.',
    );
  });

  it("takes a leg as a callback only to GSS's number through its own application (Codex, P1)", () => {
    const config = telnyxConfig(TELNYX_ENV);
    if (config === null) throw new Error('no config');
    expect(toOurNumber(INCOMING, config)).toBe(true);
    expect(toOurNumber({ ...INCOMING, to: '(825) 555-0199' }, config)).toBe(true);
    expect(toOurNumber({ ...INCOMING, to: '+18255550100' }, config)).toBe(false);
    expect(toOurNumber({ ...INCOMING, connection_id: '999' }, config)).toBe(false);
    expect(toOurNumber({ ...INCOMING, connection_id: undefined }, config)).toBe(false);
  });

  it('tells the person rung where the call stands for them', () => {
    expect(callbackTurn('ringing')).toBe('ringing');
    expect(callbackTurn('accepted')).toBe('answered');
    expect(callbackTurn('no_answer')).toBe('passed');
    expect(callbackTurn(null)).toBeNull();
  });
});

describe('a call to GSS’s number', () => {
  it('is kept and rings the first person’s cell for 20 seconds', async () => {
    const dial = command('dial_member', 'cmd-dial');
    db.receiveCallback.mockResolvedValue({ status: 'created', callId: CALL, commands: [dial] });
    db.claimCallbackCommand.mockResolvedValue(claimed(dial, { cell: '+15875550111' }));
    const response = await webhook(telnyxEvent('call.initiated', INCOMING));
    expect(response.status).toBe(200);
    expect(db.receiveCallback).toHaveBeenCalledWith({
      eventId: 'ev-cb-1',
      type: 'call.initiated',
      occurredAt: '2026-11-06T20:00:05.000Z',
      leg: 'v3:incoming',
      from: '+14035550100',
      to: '+18255550199',
    });
    expect(telnyx.dial).toHaveBeenCalledWith({
      to: '+15875550111',
      clientState: { call: CALL, leg: 'you', callback: true, attempt: ATTEMPT },
      timeoutSecs: 20,
      commandId: `${CALL}-a-${ATTEMPT}`,
    });
    expect(db.finishCallbackCommand).toHaveBeenCalledWith(
      CALL,
      'cmd-dial',
      1,
      'done',
      'v3:cell-leg',
    );
    expect(telnyx.reject).not.toHaveBeenCalled();
    expect(db.callPlacer).not.toHaveBeenCalled();
  });

  it('gets a busy signal while callbacks are off, or from a withheld number', async () => {
    db.receiveCallback.mockResolvedValue({ status: 'not_ours' });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await webhook(telnyxEvent('call.initiated', INCOMING));
    expect(response.status).toBe(200);
    expect(telnyx.reject).toHaveBeenCalledWith('v3:incoming');
  });

  it('is not taken as a callback when it is not to GSS’s number through its application', async () => {
    const response = await webhook(
      telnyxEvent('call.initiated', { ...INCOMING, connection_id: 'another-app' }),
    );
    expect(response.status).toBe(200);
    expect(db.receiveCallback).not.toHaveBeenCalled();
    expect(telnyx.reject).toHaveBeenCalledWith('v3:incoming');
  });

  it("follows the caller's hang-up before it was answered, found by its leg (Codex, 5)", async () => {
    db.callbackByLeg.mockResolvedValue({ callId: CALL, side: 'them', attemptId: null });
    const hangUp = command('hang_up', 'cmd-hang', 'v3:cell-leg');
    db.applyCallbackEvent.mockResolvedValue({ status: 'applied', commands: [hangUp] });
    db.claimCallbackCommand.mockResolvedValue(claimed(hangUp));
    const response = await webhook(
      telnyxEvent('call.hangup', { ...INCOMING, hangup_cause: 'originator_cancel' }, 'ev-cb-2'),
    );
    expect(response.status).toBe(200);
    expect(db.callbackByLeg).toHaveBeenCalledWith('v3:incoming');
    expect(db.receiveCallback).not.toHaveBeenCalled();
    expect(db.applyCallbackEvent).toHaveBeenCalledWith(CALL, 'ev-cb-2', {
      type: 'call.hangup',
      side: 'them',
      attemptId: null,
      occurredAt: '2026-11-06T20:00:05.000Z',
      leg: 'v3:incoming',
      digits: null,
      gatherStatus: null,
      cause: 'originator_cancel',
    });
    expect(telnyx.hangUp).toHaveBeenCalledWith('v3:cell-leg', 'cmd-hang');
  });

  it("passes Telnyx's call.bridged on, so a join that worked is known (Codex, finding 2)", async () => {
    const response = await webhook(
      telnyxEvent('call.bridged', { call_control_id: 'v3:cell-leg', client_state: memberState }),
    );
    expect(response.status).toBe(200);
    expect(db.applyCallbackEvent).toHaveBeenCalledWith(
      CALL,
      'ev-cb-1',
      expect.objectContaining({ type: 'call.bridged', side: 'you', attemptId: ATTEMPT }),
    );
  });

  it('asks the person rung to press 1, naming the company', async () => {
    const confirm = command('confirm', 'cmd-confirm', 'v3:cell-leg');
    db.applyCallbackEvent.mockResolvedValue({ status: 'applied', commands: [confirm] });
    db.claimCallbackCommand.mockResolvedValue(claimed(confirm));
    const response = await webhook(
      telnyxEvent('call.answered', { call_control_id: 'v3:cell-leg', client_state: memberState }),
    );
    expect(response.status).toBe(200);
    expect(db.applyCallbackEvent).toHaveBeenCalledWith(
      CALL,
      'ev-cb-1',
      expect.objectContaining({ side: 'you', attemptId: ATTEMPT, leg: 'v3:cell-leg' }),
    );
    expect(telnyx.confirm).toHaveBeenCalledWith(
      'v3:cell-leg',
      { call: CALL, leg: 'you', callback: true, attempt: ATTEMPT },
      'cmd-confirm',
      'Callback from Synthetic A Buyer. Press 1 to take it.',
    );
    expect(db.callPlacer).not.toHaveBeenCalled();
  });

  it('answers the caller, then joins and records, as the database says', async () => {
    const answer = { ...command('answer', 'cmd-answer'), attemptId: ATTEMPT };
    const bridge = command('bridge', 'cmd-bridge', 'v3:cell-leg');
    const record = command('record', 'cmd-record', 'v3:cell-leg');
    db.applyCallbackEvent.mockResolvedValue({ status: 'applied', commands: [answer, bridge] });
    db.claimCallbackCommand.mockImplementation((_call, id) =>
      Promise.resolve(
        id === 'cmd-answer'
          ? claimed(answer)
          : id === 'cmd-bridge'
            ? claimed(bridge, { bridgeWith: 'v3:incoming' })
            : claimed(record),
      ),
    );
    db.finishCallbackCommand.mockImplementation((_call, id) =>
      Promise.resolve({ commands: id === 'cmd-bridge' ? [record] : [], unresolved: false }),
    );
    const response = await webhook(
      telnyxEvent('call.gather.ended', {
        call_control_id: 'v3:cell-leg',
        client_state: memberState,
        digits: '1',
        status: 'valid',
      }),
    );
    expect(response.status).toBe(200);
    expect(telnyx.answer).toHaveBeenCalledWith(
      'v3:incoming',
      { call: CALL, leg: 'them', callback: true },
      'cmd-answer',
    );
    expect(telnyx.bridge).toHaveBeenCalledWith(
      'v3:cell-leg',
      'v3:incoming',
      { call: CALL, leg: 'you', callback: true, attempt: ATTEMPT },
      'cmd-bridge',
    );
    expect(telnyx.record).toHaveBeenCalledWith(
      'v3:cell-leg',
      { call: CALL, leg: 'you', callback: true, attempt: ATTEMPT },
      'cmd-record',
    );
  });

  it('plays the voicemail message, then records after the tone', async () => {
    const greet = command('greet', 'cmd-greet');
    const recordVm = { ...command('record_voicemail', 'cmd-vm'), attemptId: null };
    db.applyCallbackEvent
      .mockResolvedValueOnce({ status: 'applied', commands: [greet] })
      .mockResolvedValueOnce({ status: 'applied', commands: [recordVm] });
    db.claimCallbackCommand.mockImplementation((_call, id) =>
      Promise.resolve(id === 'cmd-greet' ? claimed(greet) : claimed(recordVm)),
    );
    await webhook(
      telnyxEvent('call.answered', { call_control_id: 'v3:incoming', client_state: callerState }),
    );
    expect(telnyx.speak).toHaveBeenCalledWith(
      'v3:incoming',
      VOICEMAIL_MESSAGE,
      { call: CALL, leg: 'them', callback: true },
      'cmd-greet',
    );
    await webhook(
      telnyxEvent(
        'call.speak.ended',
        { call_control_id: 'v3:incoming', client_state: callerState },
        'ev-cb-3',
      ),
    );
    expect(telnyx.recordVoicemail).toHaveBeenCalledWith(
      'v3:incoming',
      { call: CALL, leg: 'them', callback: true },
      'cmd-vm',
    );
  });

  it('keeps a command pending and asks again when Telnyx cannot be reached', async () => {
    const dial = command('dial_member', 'cmd-dial');
    db.applyCallbackEvent.mockResolvedValue({ status: 'applied', commands: [dial] });
    db.claimCallbackCommand.mockResolvedValue(claimed(dial, { cell: '+15875550111' }));
    telnyx.dial.mockRejectedValue(new TelnyxError(503, '90001'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await webhook(
      telnyxEvent('call.hangup', { call_control_id: 'v3:cell-leg', client_state: memberState }),
    );
    expect(response.status).toBe(500);
    expect(db.finishCallbackCommand).toHaveBeenCalledWith(CALL, 'cmd-dial', 1, 'retry', null);
  });

  it('moves on when Telnyx refuses a command for good, sending what follows', async () => {
    const dial = command('dial_member', 'cmd-dial');
    const answerVm = { ...command('answer', 'cmd-answer'), attemptId: null };
    db.applyCallbackEvent.mockResolvedValue({ status: 'applied', commands: [dial] });
    db.claimCallbackCommand.mockImplementation((_call, id) =>
      Promise.resolve(
        id === 'cmd-dial' ? claimed(dial, { cell: '+15875550111' }) : claimed(answerVm),
      ),
    );
    db.finishCallbackCommand.mockImplementation((_call, id) =>
      Promise.resolve({ commands: id === 'cmd-dial' ? [answerVm] : [], unresolved: false }),
    );
    telnyx.dial.mockRejectedValue(new TelnyxError(422, '10010'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await webhook(
      telnyxEvent('call.hangup', { call_control_id: 'v3:cell-leg', client_state: memberState }),
    );
    expect(response.status).toBe(200);
    expect(db.finishCallbackCommand).toHaveBeenCalledWith(CALL, 'cmd-dial', 1, 'failed', null);
    expect(telnyx.answer).toHaveBeenCalledWith(
      'v3:incoming',
      { call: CALL, leg: 'them', callback: true },
      'cmd-answer',
    );
  });

  it('asks for the event again while another delivery is sending a command', async () => {
    const dial = command('dial_member', 'cmd-dial');
    db.applyCallbackEvent.mockResolvedValue({ status: 'duplicate', commands: [dial] });
    db.claimCallbackCommand.mockResolvedValue({ status: 'busy' });
    db.callbackOpenCommands.mockResolvedValue([dial]);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const response = await webhook(
      telnyxEvent('call.answered', { call_control_id: 'v3:cell-leg', client_state: memberState }),
    );
    expect(response.status).toBe(503);
    expect(telnyx.dial).not.toHaveBeenCalled();
  });

  it('keeps a voicemail recording and hangs up a caller still on the line', async () => {
    telnyx.recordingsOfLeg.mockResolvedValue(['synthetic-rec-vm']);
    db.keepCallbackRecording.mockResolvedValue(true);
    const response = await webhook(
      telnyxEvent('call.recording.saved', {
        call_control_id: 'v3:incoming',
        call_leg_id: 'leg-incoming',
        client_state: callerState,
        recording_started_at: '2026-11-06T20:01:00Z',
        recording_ended_at: '2026-11-06T20:02:30Z',
      }),
    );
    expect(response.status).toBe(200);
    expect(db.keepCallbackRecording).toHaveBeenCalledWith(
      CALL,
      'synthetic-rec-vm',
      '2026-11-06T20:01:00.000Z',
      '2026-11-06T20:02:30.000Z',
      'v3:incoming',
    );
    expect(telnyx.hangUp).toHaveBeenCalledWith('v3:incoming');
    expect(db.keepCallRecording).not.toHaveBeenCalled();
  });

  it('asks again for a recording Telnyx does not list yet', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const response = await webhook(
      telnyxEvent('call.recording.saved', {
        call_control_id: 'v3:cell-leg',
        call_leg_id: 'leg-cell',
        client_state: memberState,
      }),
    );
    expect(response.status).toBe(500);
    expect(telnyx.hangUp).not.toHaveBeenCalled();
  });
});

describe('voicemail transcripts', () => {
  it('has every line of a voicemail said by the caller', () => {
    expect(voicemailLines([{ start: 0.5, text: 'Hi, Pat here.', channel: 0 }])).toEqual([
      { side: 'counterparty', start: 0.5, text: 'Hi, Pat here.' },
    ]);
  });

  it('is transcribed as one channel', async () => {
    db.claimRecordingsToTranscribe
      .mockResolvedValueOnce([{ recordingId: 'synthetic-rec-vm', voicemail: true }])
      .mockResolvedValue([]);
    telnyx.transcribeRecording.mockResolvedValue([
      { side: 'counterparty', start: 0, text: 'Call me back.' },
    ]);
    await transcribeNewRecordings(TELNYX_ENV, openDatabase, () => telnyx);
    expect(telnyx.transcribeRecording).toHaveBeenCalledWith('synthetic-rec-vm', {
      voicemail: true,
    });
    expect(db.keepTranscriptLines).toHaveBeenCalledWith(
      'synthetic-rec-vm',
      [{ side: 'counterparty', start: 0, text: 'Call me back.' }],
      'Counterparty: Call me back.',
    );
  });

  it('asks Telnyx for one channel and keeps each line as the caller’s', async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/recordings/synthetic-rec-vm')) {
        return Promise.resolve(
          Response.json({ data: { download_urls: { mp3: 'https://files.example.test/vm.mp3' } } }),
        );
      }
      if (url === 'https://files.example.test/vm.mp3') {
        return Promise.resolve(new Response('ID3-vm', { headers: { 'Content-Length': '6' } }));
      }
      return Promise.resolve(
        Response.json({ segments: [{ start: 0.2, text: 'Call me back.', channel: 0 }] }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const lines = await telnyxClient(TELNYX_ENV)?.transcribeRecording('synthetic-rec-vm', {
      voicemail: true,
    });
    expect(lines).toEqual([{ side: 'counterparty', start: 0.2, text: 'Call me back.' }]);
    const [, init] = fetchMock.mock.calls[2] ?? [];
    const form = await new Response(init?.body as ReadableStream<Uint8Array>, {
      headers: { 'Content-Type': new Headers(init?.headers).get('Content-Type') ?? '' },
    }).formData();
    expect(JSON.parse(form.get('model_config') as string)).toMatchObject({ multichannel: false });
  });
});

describe('the Telnyx client for callbacks', () => {
  it('answers, joins, speaks and records a voicemail through the call actions', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(new Response('{"data":{"result":"ok"}}', { status: 200 })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = telnyxClient(TELNYX_ENV);
    const caller = { call: CALL, leg: 'them' as const, callback: true as const };
    await client?.answer('v3:incoming', caller, 'cmd-1');
    await client?.bridge('v3:cell-leg', 'v3:incoming', caller, 'cmd-2');
    await client?.speak('v3:incoming', VOICEMAIL_MESSAGE, caller, 'cmd-3');
    await client?.recordVoicemail('v3:incoming', caller, 'cmd-4');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'https://api.telnyx.com/v2/calls/v3%3Aincoming/actions/answer',
      'https://api.telnyx.com/v2/calls/v3%3Acell-leg/actions/bridge',
      'https://api.telnyx.com/v2/calls/v3%3Aincoming/actions/speak',
      'https://api.telnyx.com/v2/calls/v3%3Aincoming/actions/record_start',
    ]);
    const bodies = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init?.body as string) as Record<string, unknown>,
    );
    expect(bodies[0]).toEqual({ client_state: encodeClientState(caller), command_id: 'cmd-1' });
    expect(bodies[1]).toMatchObject({ call_control_id: 'v3:incoming', command_id: 'cmd-2' });
    expect(bodies[2]).toMatchObject({ payload: VOICEMAIL_MESSAGE, command_id: 'cmd-3' });
    expect(bodies[3]).toMatchObject({
      channels: 'single',
      format: 'mp3',
      play_beep: true,
      max_length: 180,
      command_id: 'cmd-4',
    });
  });

  it('dials a cell with the command id given, and asks for 1 in the words given', async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ data: { call_control_id: 'v3:cell-leg' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = telnyxClient(TELNYX_ENV);
    const member = { call: CALL, leg: 'you' as const, callback: true as const, attempt: ATTEMPT };
    await client?.dial({
      to: '+15875550111',
      clientState: member,
      timeoutSecs: 20,
      commandId: 'cmd-dial',
    });
    await client?.confirm(
      'v3:cell-leg',
      member,
      'cmd-confirm',
      callbackPrompt('Synthetic A Buyer'),
    );
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      to: '+15875550111',
      from: '+18255550199',
      timeout_secs: 20,
      command_id: 'cmd-dial',
      client_state: encodeClientState(member),
    });
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toMatchObject({
      payload: 'Callback from Synthetic A Buyer. Press 1 to take it.',
      valid_digits: '1',
    });
  });
});

describe('/api/v1/callbacks', () => {
  const SETTINGS = {
    phone: '(825) 555-0199',
    configuredPhone: '(825) 555-0199',
    callbacksPerson: { id: PERSON, name: 'Olivia' },
    updatedByName: 'Adam',
    updatedAt: '2026-11-06T20:00:00.000Z',
    candidates: [{ id: PERSON, name: 'Olivia' }],
  };

  it('reads the settings with the number the Worker is set up with', async () => {
    db.getCallbackSettings.mockResolvedValue(SETTINGS);
    const response = await app.request('/api/v1/callbacks/settings', { headers: AUTH }, TELNYX_ENV);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ settings: SETTINGS });
    expect(db.getCallbackSettings).toHaveBeenCalledWith(expect.anything(), ORG, '+18255550199');
  });

  it("saves the callbacks person on the Worker's own number, never one sent by the browser", async () => {
    db.getCallbackSettings.mockResolvedValue(SETTINGS);
    const response = await app.request(
      '/api/v1/callbacks/settings',
      { method: 'PUT', headers: AUTH, body: JSON.stringify({ callbacksPerson: PERSON }) },
      TELNYX_ENV,
    );
    expect(response.status).toBe(200);
    expect(db.saveCallbackSettings).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      ORG,
      '+18255550199',
      PERSON,
    );
    const forged = await app.request(
      '/api/v1/callbacks/settings',
      {
        method: 'PUT',
        headers: AUTH,
        body: JSON.stringify({ callbacksPerson: null, phone: '+18005550100' }),
      },
      TELNYX_ENV,
    );
    expect(forged.status).toBe(422);
  });

  it('says why the settings were not saved', async () => {
    const put = () =>
      app.request(
        '/api/v1/callbacks/settings',
        { method: 'PUT', headers: AUTH, body: JSON.stringify({ callbacksPerson: null }) },
        TELNYX_ENV,
      );
    db.saveCallbackSettings.mockResolvedValueOnce('forbidden');
    expect((await put()).status).toBe(403);
    db.saveCallbackSettings.mockResolvedValueOnce('not_a_member');
    expect((await put()).status).toBe(422);
    db.saveCallbackSettings.mockResolvedValueOnce('phone_taken');
    expect((await put()).status).toBe(409);
    const off = await app.request(
      '/api/v1/callbacks/settings',
      { method: 'PUT', headers: AUTH, body: JSON.stringify({ callbacksPerson: null }) },
      ENV,
    );
    expect(off.status).toBe(503);
  });

  it('lists the open returns and counts those that are the person’s', async () => {
    db.countCallbackReturns.mockResolvedValue(2);
    const count = await app.request('/api/v1/callbacks/count', { headers: AUTH }, TELNYX_ENV);
    expect(await count.json()).toEqual({ open: 2 });
    const list = await app.request('/api/v1/callbacks', { headers: AUTH }, TELNYX_ENV);
    expect(await list.json()).toEqual({ returns: [] });
    expect(db.listCallbackReturns).toHaveBeenCalledWith(expect.anything(), ORG);
  });

  it('gives the call box the callback ringing the person’s cell', async () => {
    db.myCallback.mockResolvedValue(CALL);
    db.getCall.mockResolvedValue({
      id: CALL,
      counterpartyId: COMPANY,
      contactName: 'Pat Buyer',
      status: 'calling_you',
      outcome: null,
      createdAt: '2026-11-06T20:00:00.000Z',
      connectedAt: null,
      endedAt: null,
      contactLogEntryId: null,
      direction: 'incoming',
      callback: { companyName: 'Synthetic A Buyer', callerPhone: '(403) 555-0100', you: 'ringing' },
    });
    const response = await app.request('/api/v1/callbacks/mine', { headers: AUTH }, TELNYX_ENV);
    expect(await response.json()).toMatchObject({
      call: { id: CALL, callback: { you: 'ringing' } },
    });
    db.myCallback.mockResolvedValue(null);
    const none = await app.request('/api/v1/callbacks/mine', { headers: AUTH }, TELNYX_ENV);
    expect(await none.json()).toEqual({ call: null });
  });

  it('takes, links and dismisses a return, saying why not', async () => {
    const settle = (body: unknown, id = CALL) =>
      app.request(
        `/api/v1/callbacks/${id}/settle`,
        { method: 'POST', headers: AUTH, body: JSON.stringify(body) },
        TELNYX_ENV,
      );
    expect((await settle({ action: 'take' })).status).toBe(200);
    expect(
      (await settle({ action: 'link', counterpartyId: COMPANY, contactId: CONTACT })).status,
    ).toBe(200);
    expect(db.settleCallbackReturn).toHaveBeenLastCalledWith(expect.anything(), CALL, {
      action: 'link',
      counterpartyId: COMPANY,
      contactId: CONTACT,
    });
    expect((await settle({ action: 'link', counterpartyId: COMPANY })).status).toBe(422);
    expect((await settle({ action: 'delete' })).status).toBe(422);
    expect((await settle({ action: 'take' }, 'not-a-uuid')).status).toBe(404);
    db.settleCallbackReturn.mockResolvedValueOnce('closed');
    expect((await settle({ action: 'dismiss' })).status).toBe(409);
    db.settleCallbackReturn.mockResolvedValueOnce('forbidden');
    expect((await settle({ action: 'dismiss' })).status).toBe(403);
    db.settleCallbackReturn.mockResolvedValueOnce('company_not_found');
    expect(
      (await settle({ action: 'link', counterpartyId: COMPANY, contactId: null })).status,
    ).toBe(422);
  });
});

describe("Claude's reading of a callback", () => {
  const context: ReadingContextRow = {
    recordingId: 'r',
    callId: CALL,
    counterpartyId: COMPANY,
    counterpartyName: 'Synthetic A Buyer',
    counterpartyTypes: ['buyer'],
    contactName: 'Pat Buyer',
    callerId: PERSON,
    callerName: 'Olivia',
    calledAt: '2026-11-06T20:00:00.000Z',
    lines: null,
    transcript: '',
    contacts: [],
  };

  it('says which way the call went', () => {
    expect(callHeadline(context)).toBe(
      'Call placed by Olivia (GSS) to Pat Buyer at Synthetic A Buyer.',
    );
    expect(callHeadline({ ...context, direction: 'incoming' })).toBe(
      "Call from Pat Buyer at Synthetic A Buyer to GSS's number, answered by Olivia (GSS).",
    );
    expect(callHeadline({ ...context, direction: 'incoming', voicemail: true })).toBe(
      "Voicemail left on GSS's number by Pat Buyer at Synthetic A Buyer, for Olivia (GSS) to return.",
    );
  });
});
