import type { DatabaseFactory } from './respond';
import type { EmailsDatabase } from './emails-db';
import {
  envelopeOnDomain,
  inboundConfig,
  MAX_RAW_BYTES,
  readInbound,
  sha256Hex,
  type InboundBindings,
  type InboundConfig,
} from './inbound-email';

// The Worker's email handler and its replay job (F-114 step 4a; register
// docs/reviews/F-114-4a.md). Once Cloudflare hands a message over and the handler returns without
// rejecting it, the sender is told it was delivered, so an accepted message is never thrown away:
// - its raw bytes go to the private R2 bucket first (the durable record; attachments are read
//   from it later, never stored apart), with a pending marker beside it;
// - then the database keeps the email and its attachment list, and the marker is removed;
// - when the database cannot be reached, the marker stays and the 2-minute job finishes it.
// Flood limits, duplicates and GSS's own copies are decided before anything is stored (Codex's
// design reviews D1-03, D2-01, D2-02); the stored raw objects are never deleted.
// Nothing here sends, forwards or answers mail (AGENTS.md rule 8).

/** The parts of an R2 bucket the Worker uses. */
export interface MailBucket {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | string,
    options?: { customMetadata?: Record<string, string>; httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    customMetadata?: Record<string, string>;
  } | null>;
  head(key: string): Promise<{ customMetadata?: Record<string, string> } | null>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit: number }): Promise<{
    objects: { key: string; customMetadata?: Record<string, string> }[];
  }>;
}

export interface MailBindings extends InboundBindings {
  /** Private R2 bucket for received mail (wrangler.jsonc, `r2_buckets`). */
  EMAIL_FILES?: MailBucket | undefined;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
}

/** The message as Cloudflare Email Routing hands it to the Worker (only what is used). */
export interface IncomingMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;
  setReject(reason: string): void;
}

/** While the database is unreachable, at most this many messages wait; then mail is refused. */
export const SPOOL_CAP = 500;
/** Markers finished per run of the 2-minute job. */
export const REPLAY_PER_RUN = 25;
/** Processing errors (the database answered with an error) before a marker is set aside. */
export const REPLAY_ATTEMPTS = 10;

export const REJECT_NOT_SET_UP = 'This address does not receive mail.';
export const REJECT_TOO_LARGE = 'The message is larger than 25 MB.';
export const REJECT_TOO_MANY = 'Too many messages from this sender. Try again later.';
export const REJECT_UNAVAILABLE = 'The message could not be received. Try again later.';

/** The database answered with an error (SQLSTATE), as opposed to not being reachable. */
export function databaseAnswered(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = error.code;
  return (
    typeof code === 'string' &&
    /^[0-9A-Z]{5}$/.test(code) &&
    // 08 connection, 53 resources, 57 operator intervention (shutdown): not reachable.
    !/^(08|53|57)/.test(code)
  );
}

function rawKey(config: InboundConfig, sha: string): string {
  return `raw/${config.organizationId}/${sha}.eml`;
}

function markerKey(config: InboundConfig, receivedAt: string, sha: string): string {
  return `pending/${config.organizationId}/${receivedAt}-${sha}`;
}

function openDb(env: MailBindings, openDatabase: DatabaseFactory) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) return null;
  return openDatabase(url, { viaHyperdrive: env.HYPERDRIVE !== undefined });
}

async function keep(
  db: EmailsDatabase,
  config: InboundConfig,
  raw: Uint8Array,
  sha: string,
  envelope: { from: string; to: string },
  receivedAt: Date,
): Promise<string> {
  const email = await readInbound(raw, sha, envelope);
  const result = await db.receiveEmail({
    organizationId: config.organizationId,
    email,
    rawKey: rawKey(config, sha),
    rawSize: raw.byteLength,
    receivedAt,
  });
  if (result.status === 'unknown_organization') throw new Error('Unknown organization');
  return result.status === 'received'
    ? `${result.duplicate ? 'duplicate' : 'kept'} matched=${result.counterpartyId === null ? 'no' : 'yes'} dmarc=${email.dmarc} automatic=${String(email.automatic)} attachments=${String(email.attachments.length)}`
    : result.status;
}

/**
 * One delivery. Returns a short secret-free outcome for the log (no addresses, no subject).
 */
export async function receiveMessage(
  message: IncomingMessage,
  env: MailBindings,
  openDatabase: DatabaseFactory,
  { now = () => new Date() }: { now?: () => Date } = {},
): Promise<string> {
  const config = inboundConfig(env);
  const bucket = env.EMAIL_FILES;
  if (config === null || bucket === undefined) {
    message.setReject(REJECT_NOT_SET_UP);
    return 'rejected not_set_up';
  }
  const envelopeTo = envelopeOnDomain(message.to, config);
  if (envelopeTo === null) {
    message.setReject(REJECT_NOT_SET_UP);
    return 'rejected other_domain';
  }
  if (message.rawSize > MAX_RAW_BYTES) {
    message.setReject(REJECT_TOO_LARGE);
    return 'rejected too_large';
  }
  const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
  if (raw.byteLength > MAX_RAW_BYTES) {
    message.setReject(REJECT_TOO_LARGE);
    return 'rejected too_large';
  }
  const sha = await sha256Hex(raw);
  const envelope = { from: message.from, to: envelopeTo };
  const email = await readInbound(raw, sha, envelope);

  const db = openDb(env, openDatabase);
  try {
    // 1. Admission, before anything is stored.
    let reachable = db !== null;
    if (db !== null) {
      try {
        const admission = await db.admitEmail(
          config.organizationId,
          email.fromAddress,
          email.messageId,
        );
        if (admission === 'duplicate' || admission === 'own_copy') return admission;
        if (admission === 'too_many') {
          message.setReject(REJECT_TOO_MANY);
          return 'rejected too_many';
        }
        if (admission === 'unknown_organization') {
          message.setReject(REJECT_NOT_SET_UP);
          return 'rejected unknown_organization';
        }
      } catch (error) {
        if (databaseAnswered(error)) throw error;
        reachable = false;
      }
    }
    if (!reachable) {
      const waiting = await bucket.list({ prefix: 'pending/', limit: SPOOL_CAP });
      if (waiting.objects.length >= SPOOL_CAP) {
        message.setReject(REJECT_UNAVAILABLE);
        return 'rejected spool_full';
      }
    }

    // 2. The raw message, then its marker: from here on the message is never lost.
    const receivedAt = now();
    const marker = markerKey(config, receivedAt.toISOString(), sha);
    try {
      await bucket.put(rawKey(config, sha), raw, {
        httpMetadata: { contentType: 'message/rfc822' },
      });
      await bucket.put(marker, '', {
        customMetadata: { from: envelope.from, to: envelope.to, attempts: '0' },
      });
    } catch {
      message.setReject(REJECT_UNAVAILABLE);
      return 'rejected storage_failed';
    }
    if (!reachable || db === null) return 'spooled database_unreachable';

    // 3. Kept in the database; the marker removed. On any failure the marker stays for the job.
    try {
      const outcome = await keep(db, config, raw, sha, envelope, receivedAt);
      await bucket.delete(marker);
      return outcome;
    } catch (error) {
      return `spooled ${databaseAnswered(error) ? 'database_error' : 'database_unreachable'}`;
    }
  } finally {
    if (db !== null) await db.close().catch(() => undefined);
  }
}

/**
 * The email handler: every failure the handler does not decide itself rejects the message (a
 * sender is told), and one secret-free log line is written.
 */
export async function handleEmail(
  message: IncomingMessage,
  env: MailBindings,
  openDatabase: DatabaseFactory,
): Promise<void> {
  let outcome: string;
  try {
    outcome = await receiveMessage(message, env, openDatabase);
  } catch (error) {
    message.setReject(REJECT_UNAVAILABLE);
    outcome = `rejected error=${error instanceof Error ? error.name : 'unknown'}`;
  }
  console.log(`Email received: ${outcome} size=${String(message.rawSize)}`);
}

/**
 * The 2-minute job: messages accepted while the database could not be reached, oldest first.
 * An unreachable database stops the run without counting an attempt (D2-03); a processing error
 * counts one, and after REPLAY_ATTEMPTS the marker moves to failed/ so later ones are reached.
 */
export async function replayPendingMail(
  env: MailBindings,
  openDatabase: DatabaseFactory,
): Promise<void> {
  const config = inboundConfig(env);
  const bucket = env.EMAIL_FILES;
  if (config === null || bucket === undefined) return;
  const prefix = `pending/${config.organizationId}/`;
  const pending = await bucket.list({ prefix, limit: REPLAY_PER_RUN });
  if (pending.objects.length === 0) return;
  const db = openDb(env, openDatabase);
  if (db === null) return;
  let kept = 0;
  let failed = 0;
  try {
    for (const object of pending.objects) {
      const sha = object.key.slice(object.key.lastIndexOf('-') + 1);
      const head = await bucket.head(object.key);
      const meta = head?.customMetadata ?? object.customMetadata ?? {};
      const stored = /^[0-9a-f]{64}$/.test(sha) ? await bucket.get(rawKey(config, sha)) : null;
      if (stored === null) {
        await setAside(bucket, object.key, meta);
        failed += 1;
        continue;
      }
      const raw = new Uint8Array(await stored.arrayBuffer());
      try {
        await keep(
          db,
          config,
          raw,
          sha,
          { from: meta.from ?? '', to: meta.to ?? '' },
          receivedAtOf(object.key, prefix),
        );
        await bucket.delete(object.key);
        kept += 1;
      } catch (error) {
        if (!databaseAnswered(error)) break;
        const attempts = Number.parseInt(meta.attempts ?? '0', 10) + 1;
        if (attempts >= REPLAY_ATTEMPTS) {
          await setAside(bucket, object.key, { ...meta, attempts: String(attempts) });
          failed += 1;
        } else {
          await bucket.put(object.key, '', {
            customMetadata: { ...meta, attempts: String(attempts) },
          });
        }
      }
    }
  } finally {
    await db.close().catch(() => undefined);
  }
  console.log(
    `Email replay: kept=${String(kept)} set_aside=${String(failed)} listed=${String(pending.objects.length)}`,
  );
}

/** When a waiting message was accepted, from its marker's key (`<ISO time>-<sha>`). */
export function receivedAtOf(key: string, prefix: string): Date {
  const stamp = key.slice(prefix.length, key.lastIndexOf('-'));
  const time = new Date(stamp);
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(stamp) &&
    !Number.isNaN(time.getTime())
    ? time
    : new Date();
}

async function setAside(bucket: MailBucket, key: string, meta: Record<string, string>) {
  await bucket.put(`failed/${key.slice('pending/'.length)}`, '', { customMetadata: meta });
  await bucket.delete(key);
}
