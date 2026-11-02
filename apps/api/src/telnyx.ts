import { dialablePhone } from '@grain/domain';

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
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** client_state for Telnyx: base64 of a small JSON object. */
export function encodeClientState(state: ClientState): string {
  return btoa(JSON.stringify({ c: state.call, l: state.leg }));
}

/** The call and leg from a client_state, or null when it is missing or not one of ours. */
export function decodeClientState(value: unknown): ClientState | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return null;
  try {
    const parsed: unknown = JSON.parse(atob(value));
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { c, l } = parsed as Record<string, unknown>;
    if (typeof c !== 'string' || !UUID.test(c) || (l !== 'you' && l !== 'them')) return null;
    return { call: c.toLowerCase(), leg: l };
  } catch {
    return null;
  }
}

/** Telnyx answered with an error; only its status and error codes are ever logged. */
export class TelnyxError extends Error {
  constructor(
    readonly status: number,
    readonly codes: string,
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
}

/** Every leg ends after 4 hours, Telnyx's longest; a connected call blocks a new one until then. */
export const CALL_TIME_LIMIT_SECONDS = 4 * 60 * 60;

export interface TelnyxClient {
  /**
   * Dials a number; returns the new leg's call_control_id, or null when Telnyx answered without
   * one (a dial it had already taken: its leg is then learned from its events).
   */
  dial: (request: DialRequest) => Promise<string | null>;
  /** Asks the person on the leg to press 1. `commandId` makes a repeat harmless. */
  confirm: (callControlId: string, clientState: ClientState, commandId: string) => Promise<void>;
  hangUp: (callControlId: string, commandId?: string) => Promise<void>;
  /** Refuses an incoming call with a busy signal. */
  reject: (callControlId: string) => Promise<void>;
}

export type TelnyxFactory = (env: TelnyxBindings) => TelnyxClient | null;

const API = 'https://api.telnyx.com/v2';

/**
 * Every request to Telnyx gives up after this long, well within a command's claim
 * (CLAIM_LEASE_SECONDS in calls-db.ts), so a claim that has lapsed belongs to a request that is
 * certainly over (Codex's sixth review, finding 1).
 */
export const TELNYX_TIMEOUT_MS = 10_000;

/** The words the caller hears when their cell answers; no counterparty details are sent. */
export const CONFIRM_PROMPT = 'This is your G S S call. Press 1 to connect.';

/** Error codes from a Telnyx error body ({ errors: [{ code }] }), never its text. */
async function errorCodes(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const errors =
      typeof body === 'object' && body !== null ? (body as { errors?: unknown }).errors : null;
    if (!Array.isArray(errors)) return 'none';
    const codes = errors
      .map((error: unknown) =>
        typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : null,
      )
      .filter(
        (code): code is string => typeof code === 'string' && /^[0-9A-Za-z_]{1,20}$/.test(code),
      );
    return codes.length > 0 ? codes.slice(0, 5).join(',') : 'none';
  } catch {
    return 'none';
  }
}

/** The client that talks to api.telnyx.com, or null until calling is set up. */
export const telnyxClient: TelnyxFactory = (env) => {
  const config = telnyxConfig(env);
  if (config === null) return null;

  async function post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config?.apiKey ?? ''}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TELNYX_TIMEOUT_MS),
    });
    if (!response.ok) throw new TelnyxError(response.status, await errorCodes(response));
    return response.json();
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
        command_id: `${request.clientState.call}-${request.clientState.leg}`,
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
    async confirm(callControlId, clientState, commandId) {
      await action(callControlId, 'gather_using_speak', {
        payload: CONFIRM_PROMPT,
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
