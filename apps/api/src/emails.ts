import {
  attachmentFileName,
  composeEmailBody,
  fillSignature,
  linkEmailSchema,
  saveEmailSettingsSchema,
  saveMemberEmailSchema,
  sendEmailSchema,
  type EmailSettingsView,
  type EmailView,
} from '@grain/domain';
import { Hono } from 'hono';

import type { Database, RequestContext } from './db';
import { emailConfig, gssAddress, type EmailConfig, type MailerFactory } from './email';
import type { EmailCursor } from './emails-db';
import { attachmentFromOriginal, MAX_RAW_BYTES } from './inbound-email';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

// /api/v1/emails: email sent by hand from a company's page (F-114 step 3), its settings on Team,
// and a company's emails. A person writes every email and clicks Send; nothing sends by itself.
// The domain and the one organization that sends from it come from the Worker's configuration,
// never from the request (Codex's design review of F-114-3, finding D1-01).

/** A message of 100,000 characters, which JSON may write as up to six bytes each, and the rest. */
const MAX_SEND_BYTES = 640 * 1024;
const MAX_SETTINGS_BYTES = 16 * 1024;
const NOT_MEMBER = 'You are not a member of this organization.';
const NOT_CONFIGURED = 'Email is not set up yet. An admin adds the email settings in Cloudflare.';
const NOT_THIS_ORGANIZATION = 'Email is not set up for this organization.';
const NOT_RECEIVING = 'Received email is not set up yet.';
const NO_LONGER_LISTED = 'This email is no longer listed.';

/** The person's organization: the one they belong to, or the one named when they have several. */
async function organizationOf(c: ApiContext, db: Database): Promise<string | null> {
  const memberships = await db.memberships(c.get('user').id);
  const named = c.req.query('organization_id');
  if (named !== undefined) {
    return memberships.some((m) => m.organizationId === named) ? named : null;
  }
  return memberships.length === 1 ? (memberships[0]?.organizationId ?? null) : null;
}

/** The configuration, when it is this organization's to send with. */
function sendingFor(config: EmailConfig | null, organizationId: string): EmailConfig | null {
  return config !== null && config.organizationId === organizationId.toLowerCase() ? config : null;
}

/** A page cursor (`before_id`: the last email of the page before), absent, or invalid. */
function cursorOf(c: ApiContext): EmailCursor | null | 'invalid' {
  const id = c.req.query('before_id');
  if (id === undefined) return null;
  return isUuid(id) ? { id } : 'invalid';
}

async function settingsView(
  db: Database,
  ctx: RequestContext,
  organizationId: string,
  config: EmailConfig | null,
): Promise<EmailSettingsView | null> {
  const settings = await db.getEmailSettings(ctx, organizationId);
  if (settings === null) return null;
  const sending = sendingFor(config, organizationId);
  return {
    configured: sending !== null,
    domain: sending?.domain ?? null,
    sharedLocalPart: settings.sharedLocalPart,
    signature: settings.signature,
    ownLocalPart: settings.members.find((m) => m.userId === ctx.userId)?.localPart ?? null,
    you: settings.members.find((m) => m.userId === ctx.userId) ?? null,
    members: settings.members,
    updatedByName: settings.updatedByName,
    updatedAt: settings.updatedAt,
  };
}

export function emailRoutes(openDatabase: DatabaseFactory, mailer: MailerFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/settings', (c) => {
    c.header('Cache-Control', 'no-store');
    const config = emailConfig(c.env);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const settings = await settingsView(db, ctx, org, config);
      return settings === null ? apiError(c, 403, 'FORBIDDEN', NOT_MEMBER) : c.json({ settings });
    });
  });

  routes.put('/settings', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_SETTINGS_BYTES);
    if (!body.ok) return body.response;
    const parsed = saveEmailSettingsSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const config = emailConfig(c.env);
    if (config === null) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      if (sendingFor(config, org) === null)
        return apiError(c, 403, 'FORBIDDEN', NOT_THIS_ORGANIZATION);
      const saved = await db.saveEmailSettings(
        ctx,
        org,
        parsed.data.sharedLocalPart,
        parsed.data.signature,
      );
      switch (saved) {
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', 'Only admins change the email settings.');
        case 'address_taken':
          return apiError(
            c,
            409,
            'ADDRESS_TAKEN',
            'That address is already a person’s own address.',
          );
        case 'saved':
          break;
      }
      return c.json({ settings: await settingsView(db, ctx, org, config) });
    });
  });

  routes.put('/members/:userId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const member = c.req.param('userId');
    if (!isUuid(member)) return apiError(c, 404, 'NOT_FOUND', 'No such member.');
    const body = await readJson(c, MAX_SETTINGS_BYTES);
    if (!body.ok) return body.response;
    const parsed = saveMemberEmailSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.');
    const config = emailConfig(c.env);
    if (config === null) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      if (sendingFor(config, org) === null)
        return apiError(c, 403, 'FORBIDDEN', NOT_THIS_ORGANIZATION);
      const saved = await db.saveMemberEmail(ctx, org, member, parsed.data);
      switch (saved) {
        case 'forbidden':
          return apiError(
            c,
            403,
            'FORBIDDEN',
            'Only admins set people’s addresses and signature details.',
          );
        case 'not_a_member':
          return apiError(c, 404, 'NOT_FOUND', 'No such member.');
        case 'address_taken':
          return apiError(
            c,
            409,
            'ADDRESS_TAKEN',
            'That address is the shared address or another person’s.',
          );
        case 'saved':
          break;
      }
      return c.json({ settings: await settingsView(db, ctx, org, config) });
    });
  });

  routes.get('/', (c) => {
    c.header('Cache-Control', 'no-store');
    const company = c.req.query('counterparty_id') ?? '';
    if (!isUuid(company)) return apiError(c, 422, 'VALIDATION_FAILED', 'Name a counterparty.');
    const before = cursorOf(c);
    if (before === 'invalid')
      return apiError(c, 422, 'VALIDATION_FAILED', 'The page cursor is malformed.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const emails = await db.listEmails(ctx, org, company, before);
      if (emails === null) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
      return c.json({ emails });
    });
  });

  // Received mail on no company (F-114 step 4b): everyone on the team reads it, links it to a
  // company or deletes it (the owner's answers 8 to 10). Before '/:id'.
  routes.get('/unmatched', (c) => {
    c.header('Cache-Control', 'no-store');
    const before = cursorOf(c);
    if (before === 'invalid')
      return apiError(c, 422, 'VALIDATION_FAILED', 'The page cursor is malformed.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      return c.json(await db.listUnmatchedEmails(ctx, org, before));
    });
  });

  routes.post('/:id/link', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_LONGER_LISTED);
    const body = await readJson(c, MAX_SETTINGS_BYTES);
    if (!body.ok) return body.response;
    const parsed = linkEmailSchema.safeParse(body.value);
    if (!parsed.success) return apiError(c, 422, 'VALIDATION_FAILED', 'Choose a company.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const result = await db.linkEmail(
        ctx,
        org,
        id,
        parsed.data.counterpartyId,
        parsed.data.contactId,
      );
      switch (result) {
        case 'done':
          return c.json({ email: await db.getEmail(ctx, org, id) });
        case 'not_found':
        case 'removed':
          return apiError(c, 404, 'NOT_FOUND', NO_LONGER_LISTED);
        case 'already_linked':
          return apiError(c, 409, 'ALREADY_LINKED', 'Someone linked this email already.');
        case 'company_not_found':
          return apiError(
            c,
            409,
            'COMPANY_UNAVAILABLE',
            'That company is archived or no longer listed, or the contact is not one of its. Choose again.',
          );
      }
    });
  });

  routes.post('/:id/remove', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_LONGER_LISTED);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const result = await db.removeEmail(ctx, org, id);
      switch (result) {
        case 'done':
        case 'already_removed':
          // A retry after a lost answer is not an error.
          return c.json({ removed: true });
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', 'Only admins delete email on a company.');
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', NO_LONGER_LISTED);
      }
    });
  });

  // A received email's original, as kept in the private bucket (shown for mail that could not be
  // read), and one listed attachment read again from it. Always downloads, never shown in a page.
  routes.get('/:id/original', (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', NO_LONGER_LISTED);
    const bucket = c.env.EMAIL_FILES;
    if (bucket === undefined) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_RECEIVING);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const stored = await db.storedEmailFile(ctx, org, id, null);
      if (stored === null) return apiError(c, 404, 'NOT_FOUND', NO_LONGER_LISTED);
      const object = await bucket.get(stored.rawKey);
      if (object === null) return originalMissing(c, id);
      return download(object.body ?? (await object.arrayBuffer()), `email-${id}.eml`);
    });
  });

  routes.get('/:id/attachments/:position', (c) => {
    const id = c.req.param('id');
    const position = Number(c.req.param('position'));
    if (!isUuid(id) || !/^(0|[1-9][0-9]?)$/.test(c.req.param('position')))
      return apiError(c, 404, 'NOT_FOUND', 'No such attachment.');
    const bucket = c.env.EMAIL_FILES;
    if (bucket === undefined) return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_RECEIVING);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const stored = await db.storedEmailFile(ctx, org, id, position);
      if (stored?.attachment == null) return apiError(c, 404, 'NOT_FOUND', 'No such attachment.');
      if (stored.rawSize > MAX_RAW_BYTES) return attachmentUnreadable(c, id);
      const object = await bucket.get(stored.rawKey);
      if (object === null) return originalMissing(c, id);
      const raw = new Uint8Array(await object.arrayBuffer());
      if (raw.byteLength > MAX_RAW_BYTES) return attachmentUnreadable(c, id);
      const bytes = await attachmentFromOriginal(raw, position, stored.attachment.sha256);
      if (bytes === 'unreadable') return attachmentUnreadable(c, id);
      return download(bytes, attachmentFileName(stored.attachment.fileName, position));
    });
  });

  routes.get('/:id', (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such email.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      const email = await db.getEmail(ctx, org, id);
      return email === null ? apiError(c, 404, 'NOT_FOUND', 'No such email.') : c.json({ email });
    });
  });

  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_SEND_BYTES);
    if (!body.ok) return body.response;
    const parsed = sendEmailSchema.safeParse(body.value);
    if (!parsed.success) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        parsed.error.issues[0]?.message ?? 'The request is malformed.',
      );
    }
    const request = parsed.data;
    const config = emailConfig(c.env);
    const sender = mailer(c.env);
    if (config === null || sender === null)
      return apiError(c, 503, 'EMAIL_NOT_CONFIGURED', NOT_CONFIGURED);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const org = await organizationOf(c, db);
      if (org === null) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      if (sendingFor(config, org) === null)
        return apiError(c, 403, 'FORBIDDEN', NOT_THIS_ORGANIZATION);
      const settings = await db.getEmailSettings(ctx, org);
      const me = settings?.members.find((m) => m.userId === ctx.userId);
      if (settings === null || me === undefined) return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
      if (settings.sharedLocalPart === null) {
        return apiError(c, 409, 'EMAIL_SETTINGS_MISSING', 'An admin sets up email on Team first.');
      }
      const localPart = request.from === 'own' ? me.localPart : settings.sharedLocalPart;
      if (localPart === null) {
        return apiError(
          c,
          409,
          'NO_OWN_ADDRESS',
          'You have no address of your own yet. An admin sets it on Team, or send from the shared address.',
        );
      }
      const fromAddress = gssAddress(localPart, config);
      const signature = fillSignature(settings.signature, {
        name: me.name,
        title: me.title,
        phone: me.phone,
        email: fromAddress,
      });
      // Exactly what is kept is what is sent.
      const text = composeEmailBody(request.message, signature);

      const started = await db.startOutgoingEmail(ctx, {
        organizationId: org,
        counterpartyId: request.counterpartyId,
        contactId: request.contactId,
        fromLocalPart: localPart,
        domain: config.domain,
        to: request.to,
        cc: request.cc,
        subject: request.subject,
        body: text,
        messageId: `gss-${request.sendKey}`,
      });
      switch (started.status) {
        case 'started':
          break;
        case 'already_started':
          return earlierAttempt(c, started.email);
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', NOT_MEMBER);
        case 'no_settings':
          return apiError(
            c,
            409,
            'EMAIL_SETTINGS_MISSING',
            'An admin sets up email on Team first.',
          );
        case 'from_not_allowed':
          return apiError(c, 409, 'NO_OWN_ADDRESS', 'You cannot send from that address.');
        case 'company_not_found':
          return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
        case 'archived':
          return apiError(
            c,
            409,
            'ARCHIVED',
            'This counterparty is archived. Restore it before emailing.',
          );
        case 'contact_not_found':
          return apiError(
            c,
            422,
            'VALIDATION_FAILED',
            'That contact is not one of this company’s.',
          );
        case 'bad_recipients':
          return apiError(c, 422, 'VALIDATION_FAILED', 'Add one to 50 recipients.');
      }

      const outcome = await sender.send({
        fromAddress,
        fromName: me.name,
        to: request.to,
        cc: request.cc,
        subject: request.subject,
        text,
      });
      if (outcome.kind === 'unknown') {
        // Left sending: whether it went is not known, so nobody is told it failed (or sent).
        console.error(
          `Email ${started.id} unconfirmed in request ${c.get('requestId')}: code=${outcome.code}`,
        );
        return apiError(
          c,
          504,
          'EMAIL_UNCONFIRMED',
          'Cloudflare did not confirm the email. It may have been sent: check with the recipient before sending again.',
          { email: await db.getEmail(ctx, org, started.id) },
        );
      }
      if (outcome.kind === 'refused') {
        console.error(
          `Email ${started.id} refused in request ${c.get('requestId')}: code=${outcome.code}`,
        );
        await db.finishOutgoingEmail(ctx, started.id, {
          ok: false,
          failure: `${outcome.code}: ${outcome.failure}`,
        });
        return apiError(c, 502, 'EMAIL_REFUSED', `Not sent. ${outcome.failure}`, {
          email: await db.getEmail(ctx, org, started.id),
        });
      }
      await db.finishOutgoingEmail(ctx, started.id, { ok: true, providerId: outcome.messageId });
      return c.json({ email: await db.getEmail(ctx, org, started.id) }, 201);
    });
  });

  return routes;
}

/**
 * A file the sender chose, as a download: plain bytes whatever the sender declared, never shown
 * in a page or sniffed, never run (F-114 step 4b).
 */
export function download(
  body: ReadableStream<Uint8Array> | ArrayBuffer | Uint8Array,
  name: string,
) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDisposition(name),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, no-store',
    },
  });
}

/** `attachment` with an ASCII name and the exact one in UTF-8 (RFC 6266, RFC 8187). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const exact = encodeURIComponent(name).replace(
    /['()*!]/g,
    (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${exact}`;
}

function originalMissing(c: ApiContext, id: string) {
  console.error(`Email file: original missing id=${id} request=${c.get('requestId')}`);
  return apiError(c, 404, 'NOT_FOUND', 'The original of this email is not available.');
}

function attachmentUnreadable(c: ApiContext, id: string) {
  console.error(`Email file: attachment unreadable id=${id} request=${c.get('requestId')}`);
  return apiError(
    c,
    502,
    'ATTACHMENT_UNREADABLE',
    'The attachment could not be read from the original.',
  );
}

/** A send key used before: the earlier email as it stands, never sent again. */
function earlierAttempt(c: ApiContext, email: EmailView) {
  switch (email.state) {
    case 'sent':
      return c.json({ email }, 200);
    case 'failed':
      return apiError(c, 409, 'EMAIL_REFUSED', `Not sent. ${email.failure ?? ''}`.trim(), {
        email,
      });
    default:
      return apiError(
        c,
        409,
        'EMAIL_IN_PROGRESS',
        'This email was already sent once and is not confirmed yet. Check its state on the company’s page.',
        { email },
      );
  }
}
