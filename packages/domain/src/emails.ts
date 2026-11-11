import { z } from 'zod';

// Email through the platform, step 3: sent by hand (F-114; the owner's decisions of 2026-11-10 in
// docs/DECISIONS.md and the answers in docs/FEATURES.md). Shared by the API and the web app. The
// database keeps emails in 20261111010000_emails.sql; the Worker sends through Cloudflare Email
// Service. Text only; a person writes every email and clicks Send.

/** Cloudflare's limit: To and Cc together, at most 50 recipients per email. */
export const EMAIL_MAX_RECIPIENTS = 50;
/** The longest subject a header carries (and the database keeps). */
export const EMAIL_SUBJECT_MAX = 998;
/** The longest message a person writes (the signature is added after it). */
export const EMAIL_MESSAGE_MAX = 100_000;
/** The team signature's longest template (as the database keeps it). */
export const EMAIL_SIGNATURE_MAX = 2000;
/** A sending email not finished after this long is shown as not confirmed. */
export const EMAIL_UNCONFIRMED_AFTER_MS = 10 * 60 * 1000;

/** The part before the @ of a GSS address, as the database's app.email_local_part. */
export const EMAIL_LOCAL_PART = /^[a-z0-9][a-z0-9._-]{0,63}$/;

// An address someone types: one @, no spaces, control characters or the characters that would
// let it be read as several addresses or a display name. Stricter than the database's domain.
const ADDRESS =
  /^[^@\s<>,;:"()[\]\\]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** An address trimmed and lowercased, or null when it is not one. */
export function normalizeEmailAddress(value: string): string | null {
  const address = value.trim().toLowerCase();
  if (address.length === 0 || address.length > 254) return null;
  // Control characters are refused before the pattern (it only names the visible ones).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(address)) return null;
  return ADDRESS.test(address) ? address : null;
}

const addressSchema = z
  .string()
  .max(254)
  .transform((value, context) => {
    const address = normalizeEmailAddress(value);
    if (address === null) {
      context.addIssue({ code: 'custom', message: 'Not an email address' });
      return z.NEVER;
    }
    return address;
  });

/** POST /api/v1/emails: send an email from a company's page. */
export const sendEmailSchema = z
  .strictObject({
    counterpartyId: z.uuid(),
    contactId: z.uuid().nullable(),
    from: z.enum(['own', 'shared']),
    to: z.array(addressSchema).min(1, 'Add at least one recipient').max(EMAIL_MAX_RECIPIENTS),
    cc: z.array(addressSchema).max(EMAIL_MAX_RECIPIENTS),
    subject: z
      .string()
      .trim()
      .min(1, 'Add a subject')
      .max(EMAIL_SUBJECT_MAX)
      .refine((value) => !/[\r\n]/.test(value), 'A subject is one line'),
    message: z
      .string()
      .max(EMAIL_MESSAGE_MAX)
      .refine((value) => value.trim() !== '', 'Write a message'),
    /** Made once when the form opens: sending it twice never sends twice. */
    sendKey: z.uuid(),
  })
  .transform((value) => {
    // Each address once: To first, then Cc without the To addresses.
    const to = [...new Set(value.to)];
    const cc = [...new Set(value.cc)].filter((address) => !to.includes(address));
    return { ...value, to, cc };
  })
  .refine((value) => value.to.length + value.cc.length <= EMAIL_MAX_RECIPIENTS, {
    message: `At most ${String(EMAIL_MAX_RECIPIENTS)} recipients in To and Cc together`,
    path: ['cc'],
  });
export type SendEmailRequest = z.infer<typeof sendEmailSchema>;

/** PUT /api/v1/emails/settings (admins). */
export const saveEmailSettingsSchema = z.strictObject({
  sharedLocalPart: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      EMAIL_LOCAL_PART,
      'Letters, digits, dots, dashes and underscores, starting with a letter or digit',
    ),
  signature: z.string().max(EMAIL_SIGNATURE_MAX).nullable(),
});
export type SaveEmailSettings = z.infer<typeof saveEmailSettingsSchema>;

const blankToNull = (value: string | null) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
};

/** PUT /api/v1/emails/members/:userId (admins): a person's address and signature details. */
export const saveMemberEmailSchema = z.strictObject({
  localPart: z
    .string()
    .nullable()
    .transform((value) => blankToNull(value)?.toLowerCase() ?? null)
    .refine(
      (value) => value === null || EMAIL_LOCAL_PART.test(value),
      'Letters, digits, dots, dashes and underscores',
    ),
  title: z
    .string()
    .max(100)
    .nullable()
    .transform(blankToNull)
    // eslint-disable-next-line no-control-regex
    .refine((value) => value === null || !/[\u0000-\u001f\u007f]/.test(value), 'One line'),
  phone: z
    .string()
    .max(40)
    .nullable()
    .transform(blankToNull)
    .refine(
      (value) => value === null || (value.length >= 3 && /^[0-9+(). /x-]+$/.test(value)),
      'Digits, spaces and + ( ) . / - x only',
    ),
});
export type SaveMemberEmail = z.infer<typeof saveMemberEmailSchema>;

/** What a signature is filled with for one sender. */
export interface SignatureDetails {
  name: string;
  title: string | null;
  phone: string | null;
  email: string;
}

/**
 * The team signature filled in for a sender: {name}, {title}, {phone} and {email} replaced; a
 * line whose placeholders are all empty is left out, with its label. Null when
 * there is no signature.
 */
export function fillSignature(template: string | null, details: SignatureDetails): string | null {
  if (template === null || template.trim() === '') return null;
  const values: Record<string, string> = {
    name: details.name.trim(),
    title: details.title?.trim() ?? '',
    phone: details.phone?.trim() ?? '',
    email: details.email.trim(),
  };
  const lines: string[] = [];
  for (const line of template.replace(/\r\n?/g, '\n').split('\n')) {
    const placeholders = [...line.matchAll(/\{(name|title|phone|email)\}/g)].map((m) => m[1] ?? '');
    const filled = line.replace(
      /\{(name|title|phone|email)\}/g,
      (_, key: string) => values[key] ?? '',
    );
    // "Phone: {phone}" for someone with no phone: the whole line is left out.
    if (placeholders.length > 0 && placeholders.every((key) => values[key] === '')) continue;
    lines.push(filled.trimEnd());
  }
  const text = lines.join('\n').replace(/^\n+|\n+$/g, '');
  return text === '' ? null : text;
}

/** The text sent and kept: the message, then the filled signature after the usual "-- " line. */
export function composeEmailBody(message: string, signature: string | null): string {
  const text = message.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  return signature === null ? text : `${text}\n\n-- \n${signature}`;
}

/** Where an email stands, as people read it. */
export type EmailState = 'sending' | 'unconfirmed' | 'sent' | 'failed' | 'received';

export const EMAIL_STATE_LABELS: Record<EmailState, string> = {
  sending: 'Sending…',
  unconfirmed: 'Not confirmed: check with the recipient before sending again',
  sent: 'Sent',
  failed: 'Not sent',
  received: 'Received',
};

/** An email on a company's page. */
export interface EmailView {
  id: string;
  direction: 'outgoing' | 'incoming';
  state: EmailState;
  fromAddress: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  subject: string;
  /** The person who sent it (outgoing). */
  sentByName: string | null;
  contactName: string | null;
  /** Why it was not sent. */
  failure: string | null;
  /** UTC instant. */
  occurredAt: string;
  /** The same instant to the microsecond, for asking for the page after it (before_at). */
  cursorAt: string;
  /** Only in the single-email answer. */
  body?: string;
  bodyTruncated?: boolean;
}

/** A team member's address and signature details, for the Team page and the form. */
export interface MemberEmailView {
  userId: string;
  name: string;
  localPart: string | null;
  title: string | null;
  phone: string | null;
}

/** GET /api/v1/emails/settings. */
export interface EmailSettingsView {
  /** The Worker can send (its binding and domain are set). */
  configured: boolean;
  /** The domain from the Worker's configuration; null when not configured. */
  domain: string | null;
  /** Null until an admin saves the email settings. */
  sharedLocalPart: string | null;
  signature: string | null;
  /** The signed-in person's own local part. */
  ownLocalPart: string | null;
  /** The signed-in person, as their signature is filled. */
  you: MemberEmailView | null;
  members: MemberEmailView[];
  updatedByName: string | null;
  /** UTC instant. */
  updatedAt: string | null;
}
