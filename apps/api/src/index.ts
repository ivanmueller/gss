import { choosePasswordSchema, MIN_PASSWORD_LENGTH } from '@grain/domain';
import { Hono } from 'hono';

import { claudeClient, type ClaudeFactory } from './anthropic';
import { requireUser } from './auth';
import {
  callRoutes,
  memberPhoneRoutes,
  RECORDINGS_CRON,
  runRecordingsJob,
  telnyxWebhookRoutes,
} from './calls';
import { counterpartyRoutes } from './counterparties';
import { callbackRoutes } from './callbacks';
import { contactLogRoutes, followUpRoutes } from './crm';
import { postgresDatabase } from './db';
import { cloudflareMailer, type MailerFactory } from './email';
import { emailRoutes } from './emails';
import { forwardingRoutes } from './forwarding';
import { handleEmail, replayPendingMail } from './receive-mail';
import { facilityRoutes } from './facilities';
import { freightRoutes } from './freight';
import { fxQuoteRoutes, refreshFxRates } from './fx';
import { LoginServiceError, secretKey, setOwnPassword } from './logins';
import { mapLayerRoutes } from './map-layers';
import { memberRoutes } from './members';
import { commodityRoutes, quoteRoutes } from './quotes';
import { callReadingRoutes, readNewTranscripts } from './readings';
import { readNewEmails } from './email-readings';
import { draftWaitingEmails, emailAutoDraftRoutes } from './email-auto-drafts';
import { counterpartySummaryRoutes, writeDueSummaries } from './summaries';
import { apiError, readJson, withDatabase, type ApiEnv, type DatabaseFactory } from './respond';
import { telnyxClient, type TelnyxFactory } from './telnyx';

export type { ApiEnv, DatabaseFactory } from './respond';

export function createApp(
  openDatabase: DatabaseFactory,
  options: { telnyx?: TelnyxFactory; mailer?: MailerFactory; claude?: ClaudeFactory } = {},
) {
  const telnyx = options.telnyx ?? telnyxClient;
  const mailer = options.mailer ?? cloudflareMailer;
  const claude = options.claude ?? claudeClient;
  const app = new Hono<ApiEnv>().basePath('/api/v1');

  // Every response carries a request id; writes record it in the audit trail.
  app.use('*', async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-Id', requestId);
    await next();
  });

  // Errors no route handled. Only the error's type is logged: an error object can carry
  // configuration such as a connection string, and its message can echo request data.
  app.onError((error, c) => {
    console.error(`Unhandled ${error.name} in request ${c.get('requestId')}`);
    return apiError(c, 500, 'INTERNAL_ERROR', 'Something went wrong.');
  });

  // Public liveness probe. It reads nothing and returns no tenant or
  // environment data, so it needs no authentication.
  app.get('/health', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ status: 'ok', service: 'api' });
  });

  // Telnyx's call events carry no signed-in user; each is checked by its Ed25519 signature.
  app.route('/telnyx', telnyxWebhookRoutes(openDatabase, telnyx));

  // Everything registered after this line requires a signed-in user with MFA,
  // including unknown paths, so a new route cannot be left public by mistake.
  app.use('*', requireUser);

  app.get('/me', (c) => {
    const user = c.get('user');
    c.header('Cache-Control', 'no-store');
    return withDatabase(c, openDatabase, async (db) => {
      const organizations = await db.memberships(user.id);
      return c.json({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        mustChangePassword: user.mustChangePassword,
        organizations: organizations.map((m) => ({
          id: m.organizationId,
          name: m.organizationName,
          role: m.role,
        })),
      });
    });
  });

  // The person's own password, replacing the temporary one their login was made with.
  app.post('/me/password', async (c) => {
    c.header('Cache-Control', 'no-store');
    const user = c.get('user');
    if (!user.mustChangePassword) {
      return apiError(c, 409, 'NOT_NEEDED', 'Your password is already your own.');
    }
    const key = secretKey(c.env);
    if (key === null) {
      return apiError(c, 503, 'LOGINS_NOT_CONFIGURED', 'Choosing a password is not set up yet.');
    }
    const body = await readJson(c, 2048);
    if (!body.ok) return body.response;
    const request = choosePasswordSchema.safeParse(body.value);
    if (!request.success) {
      return apiError(
        c,
        422,
        'VALIDATION_FAILED',
        `Choose a password of at least ${String(MIN_PASSWORD_LENGTH)} characters.`,
      );
    }
    try {
      const result = await setOwnPassword(c.env, key, user.id, request.data.password);
      return result === 'saved'
        ? c.json({ saved: true })
        : apiError(c, 422, 'WEAK_PASSWORD', 'Supabase refused this password. Choose a longer one.');
    } catch (error) {
      if (!(error instanceof LoginServiceError)) throw error;
      console.error(
        `Supabase Auth refused a password in request ${c.get('requestId')}: status=${String(error.status)}`,
      );
      return apiError(
        c,
        502,
        'LOGIN_SERVICE_FAILED',
        'The password could not be saved. Try again.',
      );
    }
  });

  app.route('/counterparties', counterpartyRoutes(openDatabase));
  app.route('/counterparties', counterpartySummaryRoutes(openDatabase));
  app.route('/facilities', facilityRoutes(openDatabase));
  app.route('/members', memberRoutes(openDatabase));
  app.route('/quotes', quoteRoutes(openDatabase));
  app.route('/commodities', commodityRoutes(openDatabase));
  app.route('/freight-quotes', freightRoutes(openDatabase));
  app.route('/fx-quotes', fxQuoteRoutes(openDatabase));
  app.route('/contact-log', contactLogRoutes(openDatabase));
  app.route('/follow-ups', followUpRoutes(openDatabase));
  app.route('/me/phone', memberPhoneRoutes(openDatabase));
  app.route('/me/forwarding-addresses', forwardingRoutes(openDatabase, mailer));
  // Claude's drafts first: GET /calls/drafts would otherwise be taken for a call's id.
  app.route('/calls', callReadingRoutes(openDatabase));
  app.route('/calls', callRoutes(openDatabase, telnyx));
  app.route('/callbacks', callbackRoutes(openDatabase, telnyx));
  app.route('/map-layers', mapLayerRoutes(openDatabase));
  app.route('/emails', emailRoutes(openDatabase, mailer, claude));
  app.route('/email-auto-drafts', emailAutoDraftRoutes(openDatabase));

  return app;
}

export const app = createApp(postgresDatabase);

export default {
  fetch: app.fetch,
  // wrangler.jsonc, triggers: the Bank of Canada's USD/CAD rate twice a day, and every 2 minutes
  // (RECORDINGS_CRON) new recordings transcribed by side, call audio 24 hours old deleted, and
  // new transcripts and received emails read by Claude (F-114 step 5a), the email drafts they
  // asked for written by Claude (step 5c), the company summaries
  // that are due written by Claude, and
  // received mail kept while the database could not be reached (src/receive-mail.ts).
  scheduled(controller, env, ctx) {
    if (controller.cron === RECORDINGS_CRON) {
      ctx.waitUntil(runRecordingsJob(env, postgresDatabase));
      ctx.waitUntil(readNewTranscripts(env, postgresDatabase));
      ctx.waitUntil(readNewEmails(env, postgresDatabase));
      ctx.waitUntil(draftWaitingEmails(env, postgresDatabase));
      ctx.waitUntil(writeDueSummaries(env, postgresDatabase));
      ctx.waitUntil(replayPendingMail(env, postgresDatabase));
      return;
    }
    ctx.waitUntil(refreshFxRates(env, postgresDatabase, new Date()));
  },
  // Cloudflare Email Routing: the business domain's mail (F-114 step 4a). Awaited, not
  // waitUntil: whether the message is rejected must be decided before the handler returns.
  async email(message, env) {
    await handleEmail(message, env, postgresDatabase);
  },
} satisfies ExportedHandler<ApiEnv['Bindings']>;
