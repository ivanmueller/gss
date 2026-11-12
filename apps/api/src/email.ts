import { EMAIL_LOCAL_PART } from '@grain/domain';

// Sending email through Cloudflare Email Service, from the Worker only (F-114; the owner's
// decisions of 2026-11-10, docs/DECISIONS.md). Kept in this one module so that sending through
// each person's mailbox (option B, such as Microsoft 365) can replace it later. The shapes follow
// Cloudflare's Workers API page for Email Service (read 2026-11-10, recorded in
// docs/DECISIONS.md): `env.EMAIL.send({ from, to, cc, subject, text })` answers `{ messageId }`
// or throws an Error with a `code` such as E_RECIPIENT_SUPPRESSED. Cloudflare sets the
// Message-ID itself; no custom header is sent.

/** The `send_email` binding, as Cloudflare documents it (only what the Worker uses). */
export interface SendEmailBinding {
  send(message: {
    from: { email: string; name?: string };
    to: string[];
    cc?: string[];
    subject: string;
    text: string;
    /** Custom headers; Cloudflare allows In-Reply-To and References (docs/DECISIONS.md). */
    headers?: Record<string, string>;
  }): Promise<{ messageId: string }>;
}

export interface EmailBindings {
  /** Cloudflare Email Service (wrangler.jsonc, `send_email`). */
  EMAIL?: SendEmailBinding | undefined;
  /** The business's domain, onboarded for sending (a Worker secret the owner adds). */
  EMAIL_DOMAIN?: string | undefined;
  /**
   * The only organization that sends (and, in step 4, receives) for that domain (a Worker
   * secret): another organization never sends as GSS (Codex's design review of F-114-3, D1-01).
   */
  EMAIL_ORGANIZATION_ID?: string | undefined;
}

export interface EmailConfig {
  domain: string;
  organizationId: string;
}

const DOMAIN =
  /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The sending settings, or null when the binding, the domain or the organization is missing. */
export function emailConfig(env: EmailBindings): EmailConfig | null {
  const domain = env.EMAIL_DOMAIN?.trim().toLowerCase() ?? '';
  const organizationId = env.EMAIL_ORGANIZATION_ID?.trim().toLowerCase() ?? '';
  if (env.EMAIL === undefined || !DOMAIN.test(domain) || !UUID.test(organizationId)) return null;
  return { domain, organizationId };
}

/** A GSS address on the configured domain. */
export function gssAddress(localPart: string, config: EmailConfig): string {
  if (!EMAIL_LOCAL_PART.test(localPart)) throw new Error('Not a GSS address');
  return `${localPart}@${config.domain}`;
}

export interface OutgoingEmail {
  fromAddress: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  /** A reply's In-Reply-To and References (threadHeaders), so mail programs thread it. */
  headers?: Record<string, string>;
}

/** At most this many ids in a reply's References, the oldest dropped first. */
const REFERENCES_MOST = 10;
/** At most this many characters in the References header. */
const REFERENCES_CHARS = 900;

/** A Message-ID as a header writes it: in angle brackets. */
function bracketed(id: string): string {
  const bare = id.replace(/^<+|>+$/g, '');
  return `<${bare}>`;
}

/**
 * The headers of a reply to a received email (F-114 step 5b; Codex's final review,
 * F-114-5b-R3-01): In-Reply-To its Message-ID, References its own references then its
 * Message-ID, the oldest dropped to stay within REFERENCES_MOST ids and REFERENCES_CHARS. The ids
 * are kept as header tokens (no spaces or control characters), so nothing can add a header.
 */
export function threadHeaders(messageId: string, references: string[]): Record<string, string> {
  const answered = bracketed(messageId);
  const chain = [...references.map(bracketed).filter((id) => id !== answered), answered].slice(
    -REFERENCES_MOST,
  );
  while (chain.length > 1 && chain.join(' ').length > REFERENCES_CHARS) chain.shift();
  return { 'In-Reply-To': answered, References: chain.join(' ') };
}

export type SendOutcome =
  | { kind: 'sent'; messageId: string | null }
  /** Cloudflare refused it: nothing was sent, and the email can be corrected and sent again. */
  | { kind: 'refused'; code: string; failure: string }
  /** No answer, or one that does not say: it may or may not have gone. */
  | { kind: 'unknown'; code: string };

export interface Mailer {
  send(email: OutgoingEmail): Promise<SendOutcome>;
}

export type MailerFactory = (env: EmailBindings) => Mailer | null;

/** How long the Worker waits for Cloudflare before calling the outcome unknown. */
export const SEND_TIMEOUT_MS = 30_000;

// Cloudflare's codes that mean nothing was sent, in plain words for the page and the record.
const REFUSALS: Record<string, string> = {
  E_VALIDATION_ERROR: 'Cloudflare refused the email as malformed.',
  E_FIELD_MISSING: 'Cloudflare refused the email: a required part is missing.',
  E_TOO_MANY_RECIPIENTS: 'Too many recipients: at most 50 in To and Cc together.',
  E_SENDER_NOT_VERIFIED: 'The sending address is not verified in Cloudflare.',
  E_SENDER_DOMAIN_NOT_AVAILABLE: 'The domain is not set up for sending in Cloudflare.',
  E_RECIPIENT_NOT_ALLOWED: 'Cloudflare does not allow sending to this recipient.',
  E_RECIPIENT_SUPPRESSED:
    'A recipient is on Cloudflare’s suppression list (an earlier email to them bounced or was marked as spam).',
  E_ACCOUNT_SUSPENDED: 'Sending is paused on the Cloudflare account.',
  E_CONTENT_TOO_LARGE: 'The email is too large to send.',
  E_RATE_LIMIT_EXCEEDED: 'Too many emails at once. Wait a minute and send again.',
  E_DAILY_LIMIT_EXCEEDED:
    'Today’s sending limit on the Cloudflare account is reached. Send again tomorrow.',
  E_HEADER_NOT_ALLOWED: 'Cloudflare refused one of the email’s headers.',
  E_HEADER_USE_API_FIELD: 'Cloudflare refused one of the email’s headers.',
  E_HEADER_VALUE_INVALID: 'Cloudflare refused one of the email’s headers.',
  E_HEADER_VALUE_TOO_LONG: 'Cloudflare refused one of the email’s headers.',
  E_HEADER_NAME_INVALID: 'Cloudflare refused one of the email’s headers.',
  E_HEADERS_TOO_LARGE: 'Cloudflare refused one of the email’s headers.',
  E_HEADERS_TOO_MANY: 'Cloudflare refused one of the email’s headers.',
};

/**
 * What a thrown error means. Cloudflare documents no retry rule: a code meaning the request was
 * refused before sending is definite; delivery failures, its internal errors and anything
 * unrecognised are unknown, so a person checks before sending again (never re-sent by itself).
 */
export function sendFailure(error: unknown): SendOutcome {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  const safeCode = /^E_[A-Z_]{1,60}$/.test(code) ? code : 'E_UNKNOWN';
  const failure = REFUSALS[safeCode];
  return failure === undefined
    ? { kind: 'unknown', code: safeCode }
    : { kind: 'refused', code: safeCode, failure };
}

/** Cloudflare Email Service through the Worker's binding. */
export const cloudflareMailer: MailerFactory = (env) => {
  const binding = env.EMAIL;
  if (binding === undefined || emailConfig(env) === null) return null;
  return {
    async send(email) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          resolve('timeout');
        }, SEND_TIMEOUT_MS);
      });
      try {
        const answer = await Promise.race([
          binding.send({
            from: { email: email.fromAddress, name: email.fromName },
            to: email.to,
            ...(email.cc.length > 0 ? { cc: email.cc } : {}),
            subject: email.subject,
            text: email.text,
            ...(email.headers === undefined ? {} : { headers: email.headers }),
          }),
          timeout,
        ]);
        if (answer === 'timeout') return { kind: 'unknown', code: 'E_TIMEOUT' };
        const id = typeof answer.messageId === 'string' ? answer.messageId.trim() : '';
        // Kept only as a header token (app.email_header_token): no spaces, at most 998.
        return {
          kind: 'sent',
          messageId: id !== '' && id.length <= 998 && !/\s/.test(id) ? id : null,
        };
      } catch (error) {
        return sendFailure(error);
      } finally {
        clearTimeout(timer);
      }
    },
  };
};
