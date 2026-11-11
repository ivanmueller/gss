import {
  composeEmailBody,
  fillSignature,
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

/** A page cursor from `before_at` and `before_id`, absent, or invalid. */
function cursorOf(c: ApiContext): EmailCursor | null | 'invalid' {
  const at = c.req.query('before_at');
  const id = c.req.query('before_id');
  if (at === undefined && id === undefined) return null;
  if (at === undefined || id === undefined || !isUuid(id)) return 'invalid';
  // Kept as given, to the microsecond: Postgres keeps microseconds, and a cursor rounded to the
  // millisecond skips emails at a page's edge (Codex's review of F-114-3, R1-01).
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(at) ||
    Number.isNaN(new Date(at).getTime())
  ) {
    return 'invalid';
  }
  return { occurredAt: at, id };
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
