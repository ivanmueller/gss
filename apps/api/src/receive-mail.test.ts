import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from './db';
import {
  databaseAnswered,
  handleEmail,
  receiveMessage,
  REJECT_NOT_SET_UP,
  REJECT_TOO_LARGE,
  REJECT_TOO_MANY,
  REJECT_UNAVAILABLE,
  replayPendingMail,
  REPLAY_ATTEMPTS,
  SPOOL_CAP,
  type IncomingMessage,
  type MailBucket,
} from './receive-mail';
import { sha256Hex } from './inbound-email';
import { fakeDatabase } from './testing/helpers';

const ORG = '11111111-1111-4111-8111-111111111111';

class FakeBucket implements MailBucket {
  objects = new Map<string, { data: Uint8Array; meta: Record<string, string> }>();
  failPut = false;
  put = vi.fn(
    (
      key: string,
      value: ArrayBuffer | Uint8Array | string,
      options?: { customMetadata?: Record<string, string> },
    ) => {
      if (this.failPut) return Promise.reject(new Error('R2 down'));
      const data =
        typeof value === 'string'
          ? new TextEncoder().encode(value)
          : value instanceof Uint8Array
            ? value
            : new Uint8Array(value);
      this.objects.set(key, { data, meta: options?.customMetadata ?? {} });
      return Promise.resolve(null);
    },
  );
  get(key: string) {
    const object = this.objects.get(key);
    return Promise.resolve(
      object === undefined
        ? null
        : {
            arrayBuffer: () => Promise.resolve(object.data.slice().buffer),
            customMetadata: object.meta,
          },
    );
  }
  head(key: string) {
    const object = this.objects.get(key);
    return Promise.resolve(object === undefined ? null : { customMetadata: object.meta });
  }
  delete = vi.fn((key: string) => {
    this.objects.delete(key);
    return Promise.resolve();
  });
  list({ prefix, limit }: { prefix: string; limit: number }) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
    return Promise.resolve({ objects: keys.slice(0, limit).map((key) => ({ key })) });
  }
  keys(prefix: string) {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

const RAW = [
  'Authentication-Results: mx.cloudflare.net; spf=pass; dkim=pass; dmarc=pass',
  'From: Pat <pat@farm.example>',
  'To: info@example.com',
  'Subject: Re: Offer',
  'Message-ID: <reply-1@farm.example>',
  '',
  'Yes.',
].join('\r\n');

function message(raw = RAW, to = 'info@example.com', rawSize?: number) {
  const bytes = new TextEncoder().encode(raw);
  return {
    from: 'pat@farm.example',
    to,
    raw: new Response(bytes).body as ReadableStream<Uint8Array>,
    rawSize: rawSize ?? bytes.byteLength,
    setReject: vi.fn<IncomingMessage['setReject']>(),
    forward: vi.fn(),
    reply: vi.fn(),
  };
}

let bucket: FakeBucket;
let db: ReturnType<typeof fakeDatabase>;
let env: {
  EMAIL_DOMAIN: string;
  EMAIL_ORGANIZATION_ID: string;
  EMAIL_FILES?: MailBucket;
  DATABASE_URL: string;
};
const open = () => db as unknown as Database;

const unreachable = Object.assign(new Error('connect'), { code: 'CONNECTION_CLOSED' });
const answeredError = Object.assign(new Error('check'), { code: '23514' });

beforeEach(() => {
  bucket = new FakeBucket();
  db = fakeDatabase();
  env = {
    EMAIL_DOMAIN: 'example.com',
    EMAIL_ORGANIZATION_ID: ORG,
    EMAIL_FILES: bucket,
    DATABASE_URL: 'postgres://test',
  };
});

describe('databaseAnswered', () => {
  it('tells a database error from an unreachable database', () => {
    expect(databaseAnswered(answeredError)).toBe(true);
    expect(databaseAnswered(unreachable)).toBe(false);
    expect(databaseAnswered(Object.assign(new Error(), { code: '08006' }))).toBe(false);
    expect(databaseAnswered(Object.assign(new Error(), { code: '57P01' }))).toBe(false);
    expect(databaseAnswered(new Error('x'))).toBe(false);
  });
});

describe('receiveMessage', () => {
  it('stores the raw message, keeps it, then removes the marker', async () => {
    const m = message();
    const outcome = await receiveMessage(m, env, open);
    const sha = await sha256Hex(new TextEncoder().encode(RAW));
    expect(outcome).toBe('kept matched=no dmarc=pass automatic=false attachments=0');
    expect(m.setReject).not.toHaveBeenCalled();
    expect(bucket.keys('raw/')).toEqual([`raw/${ORG}/${sha}.eml`]);
    expect(bucket.keys('pending/')).toEqual([]);
    expect(db.admitEmail).toHaveBeenCalledWith(ORG, 'pat@farm.example', '<reply-1@farm.example>');
    expect(db.receiveEmail).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG, rawKey: `raw/${ORG}/${sha}.eml` }),
    );
    expect(db.close).toHaveBeenCalled();
  });

  it('never forwards or answers mail', async () => {
    const m = message();
    await receiveMessage(m, env, open);
    expect(m.forward).not.toHaveBeenCalled();
    expect(m.reply).not.toHaveBeenCalled();
  });

  it('refuses mail when receiving is not set up, without storing anything', async () => {
    delete env.EMAIL_FILES;
    const m = message();
    expect(await receiveMessage(m, env, open)).toBe('rejected not_set_up');
    expect(m.setReject).toHaveBeenCalledWith(REJECT_NOT_SET_UP);
  });

  it('refuses mail for another domain', async () => {
    const m = message(RAW, 'info@other.example');
    expect(await receiveMessage(m, env, open)).toBe('rejected other_domain');
    expect(m.setReject).toHaveBeenCalledWith(REJECT_NOT_SET_UP);
    expect(bucket.objects.size).toBe(0);
  });

  it('refuses a message over 25 MB before reading it', async () => {
    const m = message(RAW, 'info@example.com', 26 * 1024 * 1024);
    expect(await receiveMessage(m, env, open)).toBe('rejected too_large');
    expect(m.setReject).toHaveBeenCalledWith(REJECT_TOO_LARGE);
  });

  it('stores nothing for a duplicate or GSS’s own copy', async () => {
    db.admitEmail.mockResolvedValueOnce('duplicate').mockResolvedValueOnce('own_copy');
    expect(await receiveMessage(message(), env, open)).toBe('duplicate');
    expect(await receiveMessage(message(), env, open)).toBe('own_copy');
    expect(bucket.objects.size).toBe(0);
    expect(db.receiveEmail).not.toHaveBeenCalled();
  });

  it('refuses a flood before storing anything', async () => {
    db.admitEmail.mockResolvedValueOnce('too_many');
    const m = message();
    expect(await receiveMessage(m, env, open)).toBe('rejected too_many');
    expect(m.setReject).toHaveBeenCalledWith(REJECT_TOO_MANY);
    expect(bucket.objects.size).toBe(0);
  });

  it('accepts and spools mail while the database cannot be reached', async () => {
    db.admitEmail.mockRejectedValueOnce(unreachable);
    const m = message();
    expect(await receiveMessage(m, env, open)).toBe('spooled database_unreachable');
    expect(m.setReject).not.toHaveBeenCalled();
    expect(bucket.keys('raw/')).toHaveLength(1);
    expect(bucket.keys('pending/')).toHaveLength(1);
    expect(db.receiveEmail).not.toHaveBeenCalled();
  });

  it('keeps the marker when the database fails after storing', async () => {
    db.receiveEmail.mockRejectedValue(answeredError);
    const m = message();
    expect(await receiveMessage(m, env, open)).toBe('spooled database_error');
    expect(m.setReject).not.toHaveBeenCalled();
    expect(bucket.keys('pending/')).toHaveLength(1);
  });

  it('refuses mail when the spool is full', async () => {
    db.admitEmail.mockRejectedValueOnce(unreachable);
    for (let i = 0; i < SPOOL_CAP; i += 1)
      bucket.objects.set(`pending/${ORG}/x-${String(i)}`, { data: new Uint8Array(), meta: {} });
    const m = message();
    expect(await receiveMessage(m, env, open)).toBe('rejected spool_full');
    expect(m.setReject).toHaveBeenCalledWith(REJECT_UNAVAILABLE);
    expect(bucket.keys('raw/')).toEqual([]);
  });

  it('refuses the message when it cannot be stored', async () => {
    bucket.failPut = true;
    const m = message();
    expect(await receiveMessage(m, env, open)).toBe('rejected storage_failed');
    expect(m.setReject).toHaveBeenCalledWith(REJECT_UNAVAILABLE);
    expect(db.receiveEmail).not.toHaveBeenCalled();
  });
});

describe('handleEmail', () => {
  it('rejects on an unexpected error and logs no addresses', async () => {
    db.admitEmail.mockRejectedValueOnce(answeredError);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const m = message();
    await handleEmail(m, env, open);
    expect(m.setReject).toHaveBeenCalledWith(REJECT_UNAVAILABLE);
    const line = String(log.mock.calls[0]?.[0]);
    expect(line).toMatch(/^Email received: rejected error=Error size=\d+$/);
    expect(line).not.toContain('@');
    log.mockRestore();
  });
});

describe('replayPendingMail', () => {
  async function spool(count: number) {
    db.admitEmail.mockRejectedValue(unreachable);
    for (let i = 0; i < count; i += 1) {
      const raw = RAW.replace('reply-1', `reply-${String(i)}`);
      await receiveMessage(message(raw), env, open, {
        now: () => new Date(Date.UTC(2026, 10, 11, 0, 0, i)),
      });
    }
    db.admitEmail.mockReset();
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  it('keeps spooled mail once the database is back, oldest first', async () => {
    await spool(3);
    await replayPendingMail(env, open);
    expect(db.receiveEmail).toHaveBeenCalledTimes(3);
    const ids = db.receiveEmail.mock.calls.map(([r]) => r.email.messageId);
    expect(ids).toEqual([
      '<reply-0@farm.example>',
      '<reply-1@farm.example>',
      '<reply-2@farm.example>',
    ]);
    expect(bucket.keys('pending/')).toEqual([]);
    expect(bucket.keys('raw/')).toHaveLength(3);
  });

  it('keeps a waiting message with the time it was accepted (R1-02)', async () => {
    await spool(1);
    await replayPendingMail(env, open);
    expect(db.receiveEmail.mock.calls[0]?.[0].receivedAt).toEqual(
      new Date(Date.UTC(2026, 10, 11, 0, 0, 0)),
    );
  });

  it('counts no attempt while the database cannot be reached', async () => {
    await spool(2);
    db.receiveEmail.mockRejectedValue(unreachable);
    for (let run = 0; run < REPLAY_ATTEMPTS + 2; run += 1) await replayPendingMail(env, open);
    expect(bucket.keys('pending/')).toHaveLength(2);
    expect(bucket.keys('failed/')).toEqual([]);
    expect(db.receiveEmail).toHaveBeenCalledTimes(REPLAY_ATTEMPTS + 2);
  });

  it('sets a marker aside after repeated errors so later ones are reached', async () => {
    await spool(30);
    // The oldest message always fails; the others are kept.
    db.receiveEmail.mockImplementation((received) =>
      received.receivedAt.getTime() === Date.UTC(2026, 10, 11, 0, 0, 0)
        ? Promise.reject(answeredError)
        : Promise.resolve({ status: 'received', id: 'x', counterpartyId: null, duplicate: false }),
    );
    for (let run = 0; run < REPLAY_ATTEMPTS; run += 1) await replayPendingMail(env, open);
    expect(bucket.keys('pending/')).toEqual([]);
    expect(bucket.keys('failed/')).toHaveLength(1);
    expect(bucket.keys('raw/')).toHaveLength(30);
  });

  it('does nothing when nothing waits', async () => {
    await replayPendingMail(env, open);
    expect(db.receiveEmail).not.toHaveBeenCalled();
  });
});

describe('when the database refuses the message as read (R3-02)', () => {
  it('keeps it as unreadable under its own Message-ID instead', async () => {
    db.receiveEmail.mockRejectedValueOnce(answeredError).mockResolvedValueOnce({
      status: 'received',
      id: 'x',
      counterpartyId: null,
      duplicate: false,
    });
    const m = message();
    const outcome = await receiveMessage(m, env, open);
    expect(outcome).toMatch(/^kept /);
    expect(db.receiveEmail).toHaveBeenCalledTimes(2);
    const second = db.receiveEmail.mock.calls[1]?.[0];
    expect(second?.email).toMatchObject({
      parseFailed: true,
      subject: '(could not be read)',
      messageId: '<reply-1@farm.example>',
      attachments: [],
    });
    expect(bucket.keys('pending/')).toEqual([]);
  });

  it('then under a Message-ID from its contents', async () => {
    db.receiveEmail
      .mockRejectedValueOnce(answeredError)
      .mockRejectedValueOnce(answeredError)
      .mockResolvedValueOnce({
        status: 'received',
        id: 'x',
        counterpartyId: null,
        duplicate: false,
      });
    await receiveMessage(message(), env, open);
    expect(db.receiveEmail.mock.calls[2]?.[0].email.messageId).toMatch(
      /^<[0-9a-f]{64}@missing\.invalid>$/,
    );
  });
});
