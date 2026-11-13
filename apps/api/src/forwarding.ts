import {
  FORWARDING_CODE_DIGITS,
  addForwardingAddressSchema,
  confirmForwardingAddressSchema,
} from '@grain/domain';
import { Hono } from 'hono';

import type { Database, RequestContext } from './db';
import { emailConfig, gssAddress, type EmailConfig, type MailerFactory } from './email';
import { sha256Hex } from './inbound-email';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

// /api/v1/me/forwarding-addresses (F-233): the signed-in member's own personal addresses, from
// which mail they forward to GSS's domain is filed under the original sender's company. Each is
// confirmed by a 6-digit code emailed to it, so nobody can name a company's or a colleague's
// address as theirs. Every role may add its own (the owner's answer 1). Each code email is
// reserved in the database before it is sent (Codex's design review, D1-03).

const MAX_BODY_BYTES = 2 * 1024;
const NOT_MEMBER = 'You are not a member of this organization.';
const NOT_CONFIGURED = 'Email is not set up yet. An admin adds the email settings in Cloudflare.';
const NOT_FOUND = 'No such forwarding address.';

async function organizationOf(c: ApiContext, db: Database): Promise<string | null> {
  const memberships = await db.memberships(c.get('user').id);
  const named = c.req.query('organization_id');
  if (named !== undefined) {
    return memberships.some((m) => m.organizationId === named) ? named : null;
  }
  return memberships.length === 1 ? (memberships[0]?.organizationId ?? null) : null;
}

function sendingFor(config: EmailConfig | null, organizationId: string): EmailConfig | null {
  return config !== null && config.organizationId === organizationId.toLowerCase() ? config : null;
}

/** A uniformly random code of FORWARDING_CODE_DIGITS digits (rejection sampling, no bias). */
export function newForwardingCode(): string {
  const range = 10 ** FORWARDING_CODE_DIGITS;
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  const draw = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(draw);
    const value = draw[0] ?? limit;
    if (value < limit) return String(value % range).padStart(FORWARDING_CODE_DIGITS, '0');
  }
}

/** What the database keeps of a code: its hash with the address row's id. */
export function forwardingCodeHash(code: string, addressId: string): Promise<string> {
  return sha256Hex(`${code}:${addressId.toLowerCase()}`);
}

/** The code email's text. */
export function forwardingCodeText(code: string, memberName: string): string {
  return [
    `Your GSS forwarding code is ${code}.`,
    '',
    `${memberName} asked to forward email from this address into GSS's platform. Type the code on the Team page within 30 minutes.`,
    '',
    'If you did not ask for this, ignore this email: nothing changes.',
  ].join('\n');
}

export function forwardingRoutes(openDatabase: DatabaseFactory, mailer: MailerFactory) {
  const routes = new Hono<ApiEnv>();

  const list = async (db: Database, ctx: RequestContext, org: string) =>
    (await db.myForwardingAddresses(ctx, org)) ?? [];

  /** Reserves, sends and records one code email; a Response when it could not be sent. */
  async function sendCode(
    c: ApiContext,
    db: Database,
    ctx: RequestContext,
    org: string,
    config: EmailConfig,
    addressId: string,
  ): Promise<Response | null> {
    const sender = mailer(c.env);
    const settings = await db.getEmailSettings(ctx, org);
    const me = settings?.members.find((m) => m.userId === ctx.userId);
    if (sender === null) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
    if (settings === null || me === undefined) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
    if (settings.sharedLocalPart === null) {
      return apiError(c, 409, 'EMAIL_SETTINGS_MISSING', 'An admin sets up email on Team first.');
    }
    const reserved = await db.reserveForwardingCode(ctx, org, addressId);
    switch (reserved.status) {
      case 'reserved':
        break;
      case 'too_soon':
        return apiError(
          c,
          429,
          'TOO_SOON',
          'A code was just sent. Wait a minute before asking again.',
        );
      case 'too_many':
        return apiError(
          c,
          429,
          'TOO_MANY_CODES',
          'Too many codes were asked for. Try again tomorrow, or remove the address and add it again.',
        );
      case 'already_confirmed':
        return apiError(c, 409, 'ALREADY_CONFIRMED', 'This address is already confirmed.');
      case 'not_found':
        return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
      case 'forbidden':
        return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
    }
    const code = newForwardingCode();
    const outcome = await sender.send({
      fromAddress: gssAddress(settings.sharedLocalPart, config),
      fromName: 'GSS',
      to: [reserved.address],
      cc: [],
      subject: 'Your GSS forwarding code',
      text: forwardingCodeText(code, me.name),
    });
    if (outcome.kind !== 'sent') {
      await db.failForwardingCode(ctx, org, reserved.sendId);
      return apiError(
        c,
        502,
        'CODE_NOT_SENT',
        outcome.kind === 'refused'
          ? `The code could not be sent. ${outcome.failure}`
          : 'The code may not have been sent. Check that inbox, or ask for a new code in a minute.',
      );
    }
    await db.finishForwardingCode(
      ctx,
      org,
      reserved.sendId,
      await forwardingCodeHash(code, addressId),
    );
    return null;
  }

  routes.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const addresses = await db.myForwardingAddresses(ctx, org);
      if (addresses === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      return c.json({
        addresses,
        available: sendingFor(emailConfig(c.env), org) !== null,
        domain: sendingFor(emailConfig(c.env), org)?.domain ?? null,
      });
    });
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = addForwardingAddressSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'Enter one email address.');
    const config = emailConfig(c.env);
    if (config === null) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const sending = sendingFor(config, org);
      if (sending === null) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
      const added = await db.addForwardingAddress(ctx, org, parsed.data.address, sending.domain);
      switch (added.status) {
        case 'added':
        case 'exists':
          break;
        case 'invalid':
          return apiError(c, 422, 'VALIDATION_FAILED', 'Enter one email address.');
        case 'on_own_domain':
          return apiError(
            c,
            422,
            'ON_OWN_DOMAIN',
            'Addresses at the business’s own domain are already the platform’s. Add a personal address.',
          );
        case 'taken':
          return apiError(
            c,
            409,
            'ADDRESS_TAKEN',
            'Someone on the team already uses this address.',
          );
        case 'too_many':
          return apiError(c, 409, 'TOO_MANY', 'You have 5 forwarding addresses. Remove one first.');
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      }
      if (!added.confirmed) {
        const failed = await sendCode(c, db, ctx, org, sending, added.id);
        if (failed !== null) return failed;
      }
      return c.json({ id: added.id, addresses: await list(db, ctx, org) }, 201);
    });
  });

  routes.post('/:id/code', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    const config = emailConfig(c.env);
    if (config === null) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const sending = sendingFor(config, org);
      if (sending === null) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
      const failed = await sendCode(c, db, ctx, org, sending, id);
      if (failed !== null) return failed;
      return c.json({ addresses: await list(db, ctx, org) });
    });
  });

  routes.post('/:id/confirm', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    const body = await readJson(c, MAX_BODY_BYTES);
    if (!body.ok) return body.response;
    const parsed = confirmForwardingAddressSchema.safeParse(body.value);
    if (!parsed.success)
      return apiError(c, 422, 'VALIDATION_FAILED', 'Type the 6 digits from the email.');
    const hash = await forwardingCodeHash(parsed.data.code, id);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const result = await db.confirmForwardingAddress(ctx, org, id, hash);
      switch (result) {
        case 'confirmed':
          return c.json({ addresses: await list(db, ctx, org) });
        case 'wrong':
          return apiError(
            c,
            422,
            'WRONG_CODE',
            'That code is not right. Check the email and try again.',
          );
        case 'expired':
          return apiError(
            c,
            410,
            'CODE_EXPIRED',
            'That code has expired or was tried too often. Ask for a new code.',
          );
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      }
    });
  });

  routes.delete('/:id', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const removed = await db.removeForwardingAddress(ctx, org, id);
      if (removed === 'not_found') return apiError(c, 404, 'NOT_FOUND', NOT_FOUND);
      return c.json({ addresses: await list(db, ctx, org) });
    });
  });

  return routes;
}
