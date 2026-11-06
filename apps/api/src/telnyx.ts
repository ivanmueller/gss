import {
  dialablePhone,
  transcriptLines,
  VOICEMAIL_MAX_SECONDS,
  voicemailLines,
  type TranscriptLine,
} from '@grain/domain';

// Telnyx, called only from the Worker (the owner's decisions of 2026-11-02, docs/DECISIONS.md).
// The API key and the other settings are Worker secrets the owner adds in Cloudflare; none of
// them reaches the browser or Git. Request and response shapes follow Telnyx's API v2 as
// published in its official Node library (telnyx 7.29.0: POST /v2/calls, the call actions
// gather_using_speak and hangup, and its webhook signature check).

export interface TelnyxBindings {
  /** Telnyx API key (Worker secret). */
  TELNYX_API_KEY?: string;
  /** Telnyx's public key for webhook signatures, base64 (Account Settings → Keys & Credentials). */
  TELNYX_PUBLIC_KEY?: string;
  /** The Voice API application's id (GSS-app → Details → Application ID). */
  TELNYX_CONNECTION_ID?: string;
  /** GSS's Telnyx number, the caller id of every call. */
  TELNYX_PHONE_NUMBER?: string;
}

export interface TelnyxConfig {
  apiKey: string;
  connectionId: string;
  /** GSS's Telnyx number in E.164 form. */
  fromNumber: string;
}

/** The settings for placing calls, or null when any is missing or unusable. */
export function telnyxConfig(env: TelnyxBindings): TelnyxConfig | null {
  const apiKey = env.TELNYX_API_KEY?.trim() ?? '';
  const connectionId = env.TELNYX_CONNECTION_ID?.trim() ?? '';
  const fromNumber = dialablePhone(env.TELNYX_PHONE_NUMBER ?? '');
  if (apiKey === '' || connectionId === '' || fromNumber === null) return null;
  return { apiKey, connectionId, fromNumber };
}

/** Which call and leg an event is about, carried by Telnyx as the call's client_state. */
export interface ClientState {
  call: string;
  leg: 'you' | 'them';
  /** A call to GSS's number (a callback), whose events are applied without a stand-in caller. */
  callback?: true;
  /** For a callback, the attempt a leg to a team member's cell belongs to. */
  attempt?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** client_state for Telnyx: base64 of a small JSON object. */
export function encodeClientState(state: ClientState): string {
  return btoa(
    JSON.stringify({
      c: state.call,
      l: state.leg,
      ...(state.callback === true ? { k: 'cb' } : {}),
      ...(state.attempt === undefined ? {} : { a: state.attempt }),
    }),
  );
}

/** The call and leg from a client_state, or null when it is missing or not one of ours. */
export function decodeClientState(value: unknown): ClientState | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { c, l, k, a } = parsed as Record<string, unknown>;
    if (typeof c !== 'string' || !UUID.test(c) || (l !== 'you' && l !== 'them')) return null;
    if (k === undefined && a === undefined) return { call: c.toLowerCase(), leg: l };
    if (k !== 'cb' || (a !== undefined && (typeof a !== 'string' || !UUID.test(a)))) return null;
    return {
      call: c.toLowerCase(),
      leg: l,
      callback: true,
      ...(a === undefined ? {} : { attempt: a.toLowerCase() }),
    };
  } catch {
    return null;
  }
}

/** Telnyx answered with an error; only its status and error codes are ever logged. */
export class TelnyxError extends Error {
  constructor(
    readonly status: number,
    readonly codes: string,
    /** What a refusal was about, one of a fixed set of words (reasonCategory); empty when none. */
    readonly reason = '',
  ) {
    super(`Telnyx answered ${String(status)}`);
    this.name = 'TelnyxError';
  }
}

export interface DialRequest {
  to: string;
  clientState: ClientState;
  /** Seconds to ring before giving up. */
  timeoutSecs: number;
  /** Join the answered call to this leg (the counterparty's leg to the caller's). */
  bridgeTo?: string;
  /** Telnyx ignores a second dial with the same id; by default the call and leg. */
  commandId?: string;
}

/** Every leg ends after 4 hours, Telnyx's longest; a connected call blocks a new one until then. */
export const CALL_TIME_LIMIT_SECONDS = 4 * 60 * 60;

export interface TelnyxClient {
  /**
   * Dials a number; returns the new leg's call_control_id, or null when Telnyx answered without
   * one (a dial it had already taken: its leg is then learned from its events).
   */
  dial: (request: DialRequest) => Promise<string | null>;
  /**
   * Asks the person on the leg to press 1 (with the given words, for a callback). `commandId`
   * makes a repeat harmless.
   */
  confirm: (
    callControlId: string,
    clientState: ClientState,
    commandId: string,
    prompt?: string,
  ) => Promise<void>;
  /** Answers an incoming call (a callback), so it can be joined or hear the voicemail message. */
  answer: (callControlId: string, clientState: ClientState, commandId: string) => Promise<void>;
  /** Joins the leg to another (who answered a callback to its caller). */
  bridge: (
    callControlId: string,
    other: string,
    clientState: ClientState,
    commandId: string,
  ) => Promise<void>;
  /** Says the words on the leg (the voicemail message). */
  speak: (
    callControlId: string,
    words: string,
    clientState: ClientState,
    commandId: string,
  ) => Promise<void>;
  /** Records the caller's voicemail on their own leg, after a beep, one channel. */
  recordVoicemail: (
    callControlId: string,
    clientState: ClientState,
    commandId: string,
  ) => Promise<void>;
  hangUp: (callControlId: string, commandId?: string) => Promise<void>;
  /** Refuses an incoming call with a busy signal. */
  reject: (callControlId: string) => Promise<void>;
  /** Records both sides of the call on this leg, with Telnyx's transcription afterwards. */
  record: (callControlId: string, clientState: ClientState, commandId: string) => Promise<void>;
  /** The ids of the recordings made on a call leg (Telnyx's call_leg_id). */
  recordingsOfLeg: (callLegId: string) => Promise<string[]>;
  /** A recording's audio (MP3), or null when Telnyx no longer has it. */
  recordingAudio: (recordingId: string) => Promise<Response | null>;
  /** Deletes a recording at Telnyx; one already gone is fine. */
  deleteRecording: (recordingId: string) => Promise<void>;
  /**
   * Transcribes a recording's two channels separately with Telnyx's speech-to-text (Deepgram
   * Nova-3): the transcript's lines by side, or null when Telnyx no longer has the recording. A
   * voicemail is one channel, every line the caller's.
   */
  transcribeRecording: (
    recordingId: string,
    options?: { voicemail?: boolean },
  ) => Promise<TranscriptLine[] | null>;
}

export type TelnyxFactory = (env: TelnyxBindings) => TelnyxClient | null;

const API = 'https://api.telnyx.com/v2';

/**
 * Every request to Telnyx gives up after this long, well within a command's claim
 * (CLAIM_LEASE_SECONDS in calls-db.ts), so a claim that has lapsed belongs to a request that is
 * certainly over (Codex's sixth review, finding 1).
 */
export const TELNYX_TIMEOUT_MS = 10_000;

/**
 * A recording's audio streams to the person playing it for longer than a command takes, so its
 * download has a timeout of its own (Codex's review of 9de3e78).
 */
export const AUDIO_TIMEOUT_MS = 5 * 60_000;
/**
 * Limit on transcribing one recording (Codex's review of 3571e62, findings 1 and 2): well within
 * the 10-minute claim of a recording, and Cloudflare's 15 minutes for a scheduled run.
 */
export const TRANSCRIBE_TIMEOUT_MS = 3 * 60_000;
/**
 * The largest recording uploaded for transcription (Telnyx takes up to 100 MB; this leaves room
 * in the Worker's memory). A dual-channel MP3 this size is several hours of call.
 */
export const TRANSCRIBE_MAX_BYTES = 80 * 1024 * 1024;

/** The words the caller hears when their cell answers; no counterparty details are sent. */
export const CONFIRM_PROMPT = 'This is your G S S call. Press 1 to connect.';

/** Error codes from a Telnyx error body ({ errors: [{ code }] }), never its text. */
async function errorCodes(response: Response): Promise<string> {
  return (await errorDetails(response)).codes;
}

/**
 * What a refusal was about, as one of a fixed set of words (Codex's review of 5c72810, finding
 * 2): Telnyx's own text is never logged, as it might echo something private; only the first
 * category its words match.
 */
const REASON_CATEGORIES: readonly (readonly [RegExp, string])[] = [
  [/model_config|multichannel|smart_format|punctuate/i, 'model_config'],
  [/response_format|verbose/i, 'response_format'],
  [/unsupported|format|codec|file type|mime|extension|decode/i, 'file_format'],
  [/too large|too big|size|exceed/i, 'file_size'],
  [/file_url|\burl\b|download|fetch|remote/i, 'file_url'],
  [/\bfile\b|upload|multipart/i, 'file'],
  [/language/i, 'language'],
  [/\bmodel\b/i, 'model'],
  [/required|missing/i, 'missing_field'],
  [/unauthori[sz]ed|forbidden|permission|api key|not allowed|not enabled/i, 'permission'],
  [/balance|credit|payment|billing/i, 'balance'],
  [/rate limit|too many/i, 'rate_limit'],
];

export function reasonCategory(text: string): string {
  if (text.trim() === '') return '';
  return REASON_CATEGORIES.find(([pattern]) => pattern.test(text))?.[1] ?? 'other';
}

/**
 * A multipart/form-data body whose file part streams from `file.body` (Codex's review of
 * 5c72810, finding 1): nothing is buffered, and the file must be exactly `file.size` bytes, so
 * the upload's own length is known (FixedLengthStream in the Worker sets Content-Length).
 */
export function multipartUpload(
  fields: readonly (readonly [string, string])[],
  file: {
    name: string;
    filename: string;
    type: string;
    size: number;
    body: ReadableStream<Uint8Array>;
  },
): { body: ReadableStream<Uint8Array>; contentType: string; length: number } {
  const boundary = `gss-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    fields
      .map(
        ([name, value]) =>
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      )
      .join('') +
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.type}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  let sent = 0;
  const counted = file.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        sent += chunk.byteLength;
        if (sent > file.size) controller.error(new TelnyxError(413, 'audio_too_large'));
        else controller.enqueue(chunk);
      },
      flush(controller) {
        if (sent !== file.size) controller.error(new TelnyxError(502, 'audio_length'));
      },
    }),
  );
  const reader = counted.getReader();
  let stage: 'head' | 'file' | 'tail' | 'done' = 'head';
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (stage === 'head') {
        stage = 'file';
        controller.enqueue(head);
      } else if (stage === 'file') {
        const { done, value } = await reader.read();
        if (!done) {
          controller.enqueue(value);
          return;
        }
        stage = 'tail';
        controller.enqueue(tail);
      } else {
        stage = 'done';
        controller.close();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  const length = head.byteLength + file.size + tail.byteLength;
  const Fixed = (
    globalThis as {
      FixedLengthStream?: new (length: number) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).FixedLengthStream;
  return {
    body: Fixed === undefined ? body : body.pipeThrough(new Fixed(length)),
    contentType: `multipart/form-data; boundary=${boundary}`,
    length,
  };
}

/** The codes of a Telnyx error body, and its first explanation (made safe to log). */
async function errorDetails(response: Response): Promise<{ codes: string; reason: string }> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { codes: 'none', reason: '' };
  }
  if (typeof body !== 'object' || body === null) return { codes: 'none', reason: '' };
  const { errors, error, detail, message } = body as Record<string, unknown>;
  const list: unknown[] = Array.isArray(errors) ? errors : [];
  const codes = list
    .map((item) =>
      typeof item === 'object' && item !== null ? (item as { code?: unknown }).code : null,
    )
    .map((code) => (typeof code === 'number' ? String(code) : code))
    .filter(
      (code): code is string => typeof code === 'string' && /^[0-9A-Za-z_]{1,20}$/.test(code),
    );
  // Telnyx's { errors: [{ title, detail }] }, or the OpenAI-like { error: { message } },
  // { detail }, { detail: [{ msg }] } or { message } of its AI endpoints.
  const first = list[0] as { detail?: unknown; title?: unknown } | undefined;
  const nested =
    typeof error === 'object' && error !== null ? (error as { message?: unknown }) : {};
  const detailItem = Array.isArray(detail)
    ? (detail[0] as { msg?: unknown } | undefined)
    : undefined;
  const reason = [
    first?.detail,
    first?.title,
    nested.message,
    error,
    detail,
    detailItem?.msg,
    message,
  ].find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return {
    codes: codes.length > 0 ? codes.slice(0, 5).join(',') : 'none',
    reason: reason === undefined ? '' : reasonCategory(reason),
  };
}

/** The client that talks to api.telnyx.com, or null until calling is set up. */
export const telnyxClient: TelnyxFactory = (env) => {
  const config = telnyxConfig(env);
  if (config === null) return null;

  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Response> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config?.apiKey ?? ''}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(TELNYX_TIMEOUT_MS),
    });
    if (!response.ok) throw new TelnyxError(response.status, await errorCodes(response));
    return response;
  }

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    return (await request('POST', path, body)).json();
  }

  /** A recording's short-lived MP3 link from Telnyx, or null when Telnyx no longer has it. */
  async function recordingUrl(recordingId: string): Promise<string | null> {
    let response: Response;
    try {
      response = await request('GET', `/recordings/${encodeURIComponent(recordingId)}`);
    } catch (error) {
      if (error instanceof TelnyxError && error.status === 404) return null;
      throw error;
    }
    const body: unknown = await response.json();
    const url =
      typeof body === 'object' && body !== null
        ? (body as { data?: { download_urls?: { mp3?: unknown } } }).data?.download_urls?.mp3
        : undefined;
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
  }

  const action = (callControlId: string, name: string, body: Record<string, unknown>) =>
    post(`/calls/${encodeURIComponent(callControlId)}/actions/${name}`, body);

  return {
    async dial(request) {
      const result = await post('/calls', {
        connection_id: config.connectionId,
        to: request.to,
        from: config.fromNumber,
        timeout_secs: request.timeoutSecs,
        time_limit_secs: CALL_TIME_LIMIT_SECONDS,
        client_state: encodeClientState(request.clientState),
        // Telnyx ignores a second Dial with the same command_id.
        command_id: request.commandId ?? `${request.clientState.call}-${request.clientState.leg}`,
        ...(request.bridgeTo === undefined
          ? {}
          : { link_to: request.bridgeTo, bridge_on_answer: true }),
      });
      const id =
        typeof result === 'object' && result !== null
          ? (result as { data?: { call_control_id?: unknown } }).data?.call_control_id
          : undefined;
      return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null;
    },
    async confirm(callControlId, clientState, commandId, prompt) {
      await action(callControlId, 'gather_using_speak', {
        payload: prompt ?? CONFIRM_PROMPT,
        voice: 'AWS.Polly.Joanna-Neural',
        language: 'en-US',
        valid_digits: '1',
        minimum_digits: 1,
        maximum_digits: 1,
        maximum_tries: 3,
        timeout_millis: 6000,
        client_state: encodeClientState(clientState),
        command_id: commandId,
      });
    },
    async hangUp(callControlId, commandId) {
      await action(
        callControlId,
        'hangup',
        commandId === undefined ? {} : { command_id: commandId },
      );
    },
    async reject(callControlId) {
      await action(callControlId, 'reject', { cause: 'USER_BUSY' });
    },
    async answer(callControlId, clientState, commandId) {
      await action(callControlId, 'answer', {
        client_state: encodeClientState(clientState),
        command_id: commandId,
      });
    },
    async bridge(callControlId, other, clientState, commandId) {
      await action(callControlId, 'bridge', {
        call_control_id: other,
        client_state: encodeClientState(clientState),
        command_id: commandId,
      });
    },
    async speak(callControlId, words, clientState, commandId) {
      await action(callControlId, 'speak', {
        payload: words,
        voice: 'AWS.Polly.Joanna-Neural',
        language: 'en-US',
        client_state: encodeClientState(clientState),
        command_id: commandId,
      });
    },
    async recordVoicemail(callControlId, clientState, commandId) {
      await action(callControlId, 'record_start', {
        format: 'mp3',
        channels: 'single',
        play_beep: true,
        max_length: VOICEMAIL_MAX_SECONDS,
        // Stops after 10 seconds of silence.
        timeout_secs: 10,
        client_state: encodeClientState(clientState),
        command_id: commandId,
      });
    },
    async record(callControlId, clientState, commandId) {
      await action(callControlId, 'record_start', {
        format: 'mp3',
        channels: 'dual',
        play_beep: false,
        // Transcribed afterwards by side (transcribeRecording), not by Telnyx's recording
        // transcription, which would be paid twice and gives one block of text.
        client_state: encodeClientState(clientState),
        command_id: commandId,
      });
    },
    async recordingsOfLeg(callLegId) {
      const response = await request(
        'GET',
        `/recordings?filter[call_leg_id]=${encodeURIComponent(callLegId)}`,
      );
      const body: unknown = await response.json();
      const data =
        typeof body === 'object' && body !== null ? (body as { data?: unknown }).data : null;
      if (!Array.isArray(data)) return [];
      return data.flatMap((item: unknown) => {
        const id = typeof item === 'object' && item !== null ? (item as { id?: unknown }).id : null;
        return typeof id === 'string' && id.length > 0 && id.length <= 200 ? [id] : [];
      });
    },
    async recordingAudio(recordingId) {
      const url = await recordingUrl(recordingId);
      if (url === null) return null;
      // A short-lived link Telnyx gives for the file; fetched here, never sent to the browser.
      const audio = await fetch(url, { signal: AbortSignal.timeout(AUDIO_TIMEOUT_MS) });
      if (!audio.ok) throw new TelnyxError(audio.status, 'audio_download');
      return audio;
    },
    async transcribeRecording(recordingId, options = {}) {
      const voicemail = options.voicemail === true;
      const url = await recordingUrl(recordingId);
      if (url === null) return null;
      // One limit for the download and the transcription together (the job's time budget).
      const signal = AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS);
      // The audio is uploaded, not passed as a link (staging, 2026-11-03: Telnyx answered 400
      // to the recording's link, whose signed query string follows ".mp3").
      const audio = await fetch(url, { signal });
      if (!audio.ok || audio.body === null) {
        await audio.body?.cancel().catch(() => undefined);
        throw new TelnyxError(audio.status, 'audio_download');
      }
      // Streamed through, never held whole in the Worker's memory (Codex's review of 5c72810,
      // finding 1), so its length must be known and within the limit before it starts.
      const size = Number(audio.headers.get('Content-Length'));
      if (!Number.isSafeInteger(size) || size <= 0 || size > TRANSCRIBE_MAX_BYTES) {
        await audio.body.cancel().catch(() => undefined);
        throw new TelnyxError(
          413,
          size > TRANSCRIBE_MAX_BYTES ? 'audio_too_large' : 'audio_length',
        );
      }
      const upload = multipartUpload(
        [
          ['model', 'deepgram/nova-3'],
          ['language', 'en'],
          ['response_format', 'verbose_json'],
          // Each channel on its own (billed for both), punctuated, numbers and prices written
          // out.
          [
            'model_config',
            JSON.stringify({ multichannel: !voicemail, punctuate: true, smart_format: true }),
          ],
        ],
        {
          name: 'file',
          filename: 'recording.mp3',
          type: 'audio/mpeg',
          size,
          body: audio.body as ReadableStream<Uint8Array>,
        },
      );
      const response = await fetch(`${API}/ai/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: 'application/json',
          'Content-Type': upload.contentType,
        },
        body: upload.body,
        signal,
      });
      if (!response.ok) {
        const { codes, reason } = await errorDetails(response);
        throw new TelnyxError(response.status, codes, reason);
      }
      const body: unknown = await response.json();
      const { segments, text } =
        typeof body === 'object' && body !== null
          ? (body as { segments?: unknown; text?: unknown })
          : {};
      const toLines = voicemail ? voicemailLines : transcriptLines;
      const lines = Array.isArray(segments)
        ? toLines(
            segments.flatMap((segment: unknown) => {
              if (typeof segment !== 'object' || segment === null) return [];
              const { start, text: said, channel } = segment as Record<string, unknown>;
              return typeof start === 'number' && typeof said === 'string'
                ? [{ start, text: said, channel: typeof channel === 'number' ? channel : null }]
                : [];
            }),
          )
        : [];
      if (lines.length > 0) return lines;
      // No usable segment, but text (Codex's review of 3571e62, finding 4): kept as one line
      // whose side is unknown, rather than lost as a call where nothing was said.
      return typeof text === 'string' && text.trim() !== ''
        ? [{ side: voicemail ? 'counterparty' : null, start: 0, text: text.trim() }]
        : [];
    },
    async deleteRecording(recordingId) {
      try {
        await request('DELETE', `/recordings/${encodeURIComponent(recordingId)}`);
      } catch (error) {
        if (error instanceof TelnyxError && error.status === 404) return;
        throw error;
      }
    },
  };
};

/** Five minutes either way, as Telnyx's own library allows. */
const SIGNATURE_TOLERANCE_SECONDS = 300;

function decodeBase64(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    return null;
  }
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * Whether a webhook came from Telnyx: its telnyx-signature-ed25519 header is Telnyx's Ed25519
 * signature of "<telnyx-timestamp>|<raw body>", checked with the public key from the Telnyx
 * portal, and the timestamp is within five minutes of now.
 */
export async function verifyTelnyxSignature(
  publicKey: string,
  body: string,
  signatureHeader: string | undefined,
  timestampHeader: string | undefined,
  nowSeconds: number,
): Promise<boolean> {
  if (signatureHeader === undefined || timestampHeader === undefined) return false;
  if (!/^\d{1,12}$/.test(timestampHeader)) return false;
  if (Math.abs(nowSeconds - Number(timestampHeader)) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const key = decodeBase64(publicKey.trim());
  const signature = decodeBase64(signatureHeader.trim());
  if (key?.length !== 32 || signature?.length !== 64) return false;
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, [
      'verify',
    ]);
    return await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      signature,
      new TextEncoder().encode(`${timestampHeader}|${body}`),
    );
  } catch {
    return false;
  }
}
