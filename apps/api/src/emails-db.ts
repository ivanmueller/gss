import {
  UNMATCHED_EMAIL_COUNT_CAP,
  UNMATCHED_EMAIL_PAGE,
  type EmailAttachmentView,
  type EmailState,
  type EmailView,
  type MemberEmailView,
  type UnmatchedEmailsView,
} from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';
import type { InboundEmail } from './inbound-email';

// Emails in Postgres (20261111010000_emails.sql, 20261111020000_email_signatures.sql; F-114).
// Every write goes through the database's own functions, as the signed-in person; app_api only
// reads the tables. The domain is never stored: the Worker's configuration names it.

export type SaveEmailSettingsResult = 'saved' | 'forbidden' | 'address_taken';
export type SaveMemberEmailResult = 'saved' | 'forbidden' | 'not_a_member' | 'address_taken';
export type StartEmailRefusal =
  | 'forbidden'
  | 'no_settings'
  | 'from_not_allowed'
  | 'company_not_found'
  | 'archived'
  | 'contact_not_found'
  | 'bad_recipients'
  | 'reply_not_found'
  | 'draft_not_found'
  | 'auto_draft_not_found'
  | 'auto_draft_used';
export type StartEmailResult =
  | { status: 'started'; id: string }
  /**
   * The same send key was started before (a second click or a retry): never sent twice; the
   * earlier email as it stands (Codex's design review of F-114-3, finding D1-02).
   */
  | { status: 'already_started'; email: EmailView }
  | { status: StartEmailRefusal };
export type FinishEmailResult = 'done' | 'not_found' | 'already_finished';

/** The settings and the team's addresses and signature details. */
export interface EmailSettingsRecord {
  sharedLocalPart: string | null;
  signature: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
  members: MemberEmailView[];
}

export interface StartEmail {
  organizationId: string;
  counterpartyId: string;
  contactId: string | null;
  fromLocalPart: string;
  domain: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  /** GSS's own id for the email, from the form's send key. */
  messageId: string;
  /** The received email it answers (Reply). */
  replyToEmailId: string | null;
  /** The Draft with Claude request it started from. */
  claudeDraftId: string | null;
  /** The automatic draft it was opened from (F-114 step 5c). */
  autoDraftId: string | null;
}

/** app.start_email_draft's answer (F-114 step 5b). */
export type StartDraftResult =
  | { status: 'started'; id: string }
  | {
      status:
        'forbidden' | 'not_found' | 'archived' | 'reply_not_found' | 'already' | 'in_progress';
    };

/** An email as Claude sees it in a draft's context. */
export interface DraftContextEmail {
  id: string;
  direction: 'incoming' | 'outgoing';
  occurredAt: string;
  from: string;
  fromName: string | null;
  subject: string;
  body: string;
}

/** What Claude is given to draft an email (app.email_draft_context), each part limited. */
export interface EmailDraftContext {
  name: string;
  types: string[];
  country: string;
  notes: string | null;
  contacts: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    main: boolean;
  }[];
  commodities: { code: string; direction: 'buys' | 'sells' }[];
  locations: { name: string | null; city: string | null; region: string | null; country: string }[];
  quotes: {
    side: 'bid' | 'offer';
    commodity: string;
    firmness: string;
    price: string;
    currency: string;
    priceUnit: string;
    grade: string | null;
    deliveryBasis: string;
    basisLocation: string | null;
    quantityMinMt: string | null;
    quantityMaxMt: string;
    deliveryStart: string | null;
    deliveryEnd: string | null;
    validUntil: string;
  }[];
  followUps: { task: string; dueAt: string; assignedTo: string }[];
  history: {
    occurredAt: string;
    channel: string;
    contactName: string;
    by: string;
    notes: string | null;
    claudeNotes: string | null;
  }[];
  /** The latest call with a transcript in the last 7 days. */
  call: { at: string; by: string; contactName: string; transcript: string } | null;
  /** The email being answered, whatever its age or kind. */
  answer: (DraftContextEmail & { to: string[]; automatic: boolean }) | null;
  /** Other emails of the thread, oldest first, as context. */
  thread: DraftContextEmail[];
}

/** app.admit_email's answer: whether a delivery may be stored and kept. */
export type EmailAdmission =
  'admit' | 'duplicate' | 'own_copy' | 'too_many' | 'unknown_organization';

/** A received message as the Worker passes it to app.receive_email (F-114 step 4a). */
export interface ReceivedEmail {
  organizationId: string;
  email: InboundEmail;
  rawKey: string;
  rawSize: number;
  /** When the Worker accepted the message (kept as its time, also when kept later). */
  receivedAt: Date;
}

/** app.link_email's answer (F-114 step 4b). */
export type LinkEmailResult =
  'done' | 'not_found' | 'removed' | 'already_linked' | 'company_not_found';
/** app.remove_email's answer. */
export type RemoveEmailResult = 'done' | 'not_found' | 'already_removed' | 'forbidden';

/** Where a received email's original is kept, and one attachment's hash, for a download. */
export interface StoredEmailFile {
  rawKey: string;
  rawSize: number;
  /** The listed attachment asked for, or null when only the original is asked for. */
  attachment: { position: number; fileName: string | null; sha256: string } | null;
}

export type ReceiveEmailResult =
  | { status: 'received'; id: string; counterpartyId: string | null; duplicate: boolean }
  | { status: 'own_copy' }
  | { status: 'unknown_organization' };

export interface EmailsDatabase {
  /** Before anything is stored; the Worker's email handler, with nobody signed in. */
  admitEmail: (
    organizationId: string,
    sender: string,
    messageId: string,
  ) => Promise<EmailAdmission>;
  /** Keeps a received message and its attachment list; nobody signed in. */
  receiveEmail: (received: ReceivedEmail) => Promise<ReceiveEmailResult>;
  getEmailSettings: (
    ctx: RequestContext,
    organizationId: string,
  ) => Promise<EmailSettingsRecord | null>;
  saveEmailSettings: (
    ctx: RequestContext,
    organizationId: string,
    sharedLocalPart: string,
    signature: string | null,
  ) => Promise<SaveEmailSettingsResult>;
  /** A person's address, title and phone, saved together or not at all. */
  saveMemberEmail: (
    ctx: RequestContext,
    organizationId: string,
    member: string,
    details: { localPart: string | null; title: string | null; phone: string | null },
  ) => Promise<SaveMemberEmailResult>;
  startOutgoingEmail: (ctx: RequestContext, email: StartEmail) => Promise<StartEmailResult>;
  /**
   * The Message-ID and References of the email answered, for a reply's headers: a received
   * email's own, or a sent email's id from Cloudflare (a reminder); null if none.
   */
  answeredEmailIds: (
    ctx: RequestContext,
    organizationId: string,
    id: string,
  ) => Promise<{ messageId: string; references: string[] } | null>;
  /** Records a Draft with Claude request before it is sent to Anthropic (F-114 step 5b). */
  startEmailDraft: (
    ctx: RequestContext,
    organizationId: string,
    counterpartyId: string,
    replyToEmailId: string | null,
    draftKey: string,
  ) => Promise<StartDraftResult>;
  /** Records what came of it: drafted or failed, the model and tokens. */
  finishEmailDraft: (
    ctx: RequestContext,
    id: string,
    outcome: { drafted: boolean; model: string | null; inputTokens: number; outputTokens: number },
  ) => Promise<void>;
  /** What Claude is given; null when the company or the answered email is not draftable. */
  emailDraftContext: (
    ctx: RequestContext,
    organizationId: string,
    counterpartyId: string,
    replyToEmailId: string | null,
  ) => Promise<EmailDraftContext | null>;
  finishOutgoingEmail: (
    ctx: RequestContext,
    id: string,
    outcome: { ok: true; providerId: string | null } | { ok: false; failure: string },
  ) => Promise<FinishEmailResult>;
  /**
   * A company's emails not removed, newest first, a page at a time: those before the cursor (the
   * last email of the page before); null when the company is not the organization's.
   */
  listEmails: (
    ctx: RequestContext,
    organizationId: string,
    counterpartyId: string,
    before: EmailCursor | null,
  ) => Promise<EmailView[] | null>;
  /** One email with its text (and, received, its attachments), or null. */
  getEmail: (ctx: RequestContext, organizationId: string, id: string) => Promise<EmailView | null>;
  /**
   * Received mail on no company, not removed, newest first, a page before the cursor; an unknown
   * cursor gives an empty page (F-114 step 4b).
   */
  listUnmatchedEmails: (
    ctx: RequestContext,
    organizationId: string,
    before: EmailCursor | null,
  ) => Promise<UnmatchedEmailsView>;
  linkEmail: (
    ctx: RequestContext,
    organizationId: string,
    id: string,
    counterpartyId: string,
    contactId: string | null,
  ) => Promise<LinkEmailResult>;
  removeEmail: (
    ctx: RequestContext,
    organizationId: string,
    id: string,
  ) => Promise<RemoveEmailResult>;
  /**
   * A received email's original (and, with a position, that listed attachment), when the email
   * is the organization's and not removed; null otherwise (also when no attachment is listed at
   * that position).
   */
  storedEmailFile: (
    ctx: RequestContext,
    organizationId: string,
    id: string,
    position: number | null,
  ) => Promise<StoredEmailFile | null>;
}

/**
 * Where a page of emails ends: the last email listed. The database reads its exact time itself,
 * so no time is rounded on its way through the browser (Codex's review of F-114-3, R1-01).
 */
export interface EmailCursor {
  id: string;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

/** At most this many emails listed on a company's page. */
export const EMAIL_LIST_LIMIT = 200;

const SETTINGS_RESULTS: readonly SaveEmailSettingsResult[] = [
  'saved',
  'forbidden',
  'address_taken',
];
const MEMBER_RESULTS: readonly SaveMemberEmailResult[] = [
  'saved',
  'forbidden',
  'not_a_member',
  'address_taken',
];
const START_REFUSALS: readonly StartEmailRefusal[] = [
  'forbidden',
  'no_settings',
  'from_not_allowed',
  'company_not_found',
  'archived',
  'contact_not_found',
  'bad_recipients',
  'reply_not_found',
  'draft_not_found',
  'auto_draft_not_found',
  'auto_draft_used',
];
const DRAFT_REFUSALS = [
  'forbidden',
  'not_found',
  'archived',
  'reply_not_found',
  'already',
  'in_progress',
] as const;
const FINISH_RESULTS: readonly FinishEmailResult[] = ['done', 'not_found', 'already_finished'];
const LINK_RESULTS: readonly LinkEmailResult[] = [
  'done',
  'not_found',
  'removed',
  'already_linked',
  'company_not_found',
];
const REMOVE_RESULTS: readonly RemoveEmailResult[] = [
  'done',
  'not_found',
  'already_removed',
  'forbidden',
];
const STATES: readonly EmailState[] = ['sending', 'unconfirmed', 'sent', 'failed', 'received'];

interface EmailRow {
  id: string;
  direction: 'outgoing' | 'incoming';
  state: string;
  from_address: string;
  from_name: string | null;
  to_addresses: string[];
  cc_addresses: string[];
  subject: string;
  sent_by_name: string | null;
  contact_name: string | null;
  failure: string | null;
  occurred_at: Date;
  auth_passed: boolean | null;
  automatic: boolean;
  parse_failed: boolean;
  counterparty_id: string | null;
  envelope_to: string | null;
  attachment_count: number;
  reply_to: string | null;
  in_reply_to_subject: string | null;
  drafted_by_claude: boolean;
  body_text?: string;
  body_truncated?: boolean;
}

function emailView(row: EmailRow): EmailView {
  const state = STATES.find((value) => value === row.state);
  if (state === undefined) throw new Error('Unexpected email state');
  return {
    id: row.id,
    direction: row.direction,
    state,
    fromAddress: row.from_address,
    fromName: row.from_name,
    to: row.to_addresses,
    cc: row.cc_addresses,
    subject: row.subject,
    sentByName: row.sent_by_name,
    contactName: row.contact_name,
    failure: row.failure,
    occurredAt: row.occurred_at.toISOString(),
    unverifiedSender: row.direction === 'incoming' && row.auth_passed !== true,
    automatic: row.automatic,
    parseFailed: row.parse_failed,
    counterpartyId: row.counterparty_id,
    sentTo: row.direction === 'incoming' ? row.envelope_to : null,
    attachmentCount: row.attachment_count,
    replyToAddress: row.direction === 'incoming' ? row.reply_to : null,
    inReplyToSubject: row.in_reply_to_subject,
    draftedByClaude: row.drafted_by_claude,
    ...(row.body_text === undefined
      ? {}
      : { body: row.body_text, bodyTruncated: row.body_truncated ?? false }),
  };
}

/** A save refused part-way, so the transaction is rolled back with what the database answered. */
class Refused extends Error {
  constructor(readonly result: SaveMemberEmailResult) {
    super('refused');
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '23505' &&
    'constraint_name' in error &&
    error.constraint_name === constraint
  );
}

const ADMISSIONS: readonly EmailAdmission[] = [
  'admit',
  'duplicate',
  'own_copy',
  'too_many',
  'unknown_organization',
];

export function emailQueries(asUser: AsUser, sql: postgres.Sql): EmailsDatabase {
  // A sending email unfinished after ten minutes is shown as not confirmed (EMAIL_UNCONFIRMED_AFTER_MS).
  const columns = (tx: postgres.TransactionSql) => tx`
    e.id, e.direction, e.from_address, e.from_name, to_jsonb(e.to_addresses::text[]) as to_addresses,
    to_jsonb(e.cc_addresses::text[]) as cc_addresses, e.subject, e.sent_by_name, e.contact_name, e.failure,
    e.occurred_at, e.auth_passed, e.automatic, e.parse_failed, e.counterparty_id, e.envelope_to,
    e.reply_to,
    (select count(*)::integer from app.email_attachments a
      where a.organization_id = e.organization_id and a.email_id = e.id) as attachment_count,
    (select r.subject from app.emails r
      where r.organization_id = e.organization_id and r.id = e.reply_to_email_id
        and not exists (select 1 from app.email_removals x where x.email_id = r.id))
      as in_reply_to_subject,
    (e.claude_draft_id is not null or e.auto_draft_id is not null) as drafted_by_claude,
    case when e.status = 'sending' and e.occurred_at < now() - interval '10 minutes' then 'unconfirmed'
         else e.status::text end as state`;

  return {
    async admitEmail(organizationId, sender, messageId) {
      // No app.user_id is set: the Worker acts for nobody, as the function requires.
      const [row] = await sql<{ answer: string }[]>`
        select app.admit_email(${organizationId}, ${sender}, ${messageId}) as answer`;
      const answer = ADMISSIONS.find((value) => value === row?.answer);
      if (answer === undefined) throw new Error('Unexpected admission answer');
      return answer;
    },

    async receiveEmail({ organizationId, email, rawKey, rawSize, receivedAt }) {
      const attachments = email.attachments.map((a) => ({
        position: a.position,
        file_name: a.fileName,
        content_type: a.contentType,
        size_bytes: a.sizeBytes,
        sha256: a.sha256,
        disposition: a.disposition,
        content_id: a.contentId,
      }));
      const [row] = await sql<{ result: Record<string, unknown> }[]>`
        select app.receive_email(
          ${organizationId}, ${email.envelopeTo}, ${email.fromAddress}, ${email.fromName},
          -- Lists go as JSON: without fetch_types (the Worker's connection), postgres.js sends
          -- an array as text (as for sending; Codex's review, finding R1-01).
          array(select t.x from jsonb_array_elements_text(${sql.json(email.to)}::jsonb) as t(x)),
          array(select t.x from jsonb_array_elements_text(${sql.json(email.cc)}::jsonb) as t(x)),
          ${email.replyTo}, ${email.subject}, ${email.body}, ${email.bodyTruncated},
          ${email.messageId}, ${email.inReplyTo},
          array(select t.x from jsonb_array_elements_text(${sql.json(email.references)}::jsonb) as t(x)),
          ${email.dmarc === 'pass'}, ${email.automatic}, ${email.parseFailed}, ${rawKey},
          ${rawSize}, ${sql.json(attachments)}::jsonb, ${receivedAt.toISOString()}::timestamptz) as result`;
      const result = row?.result ?? {};
      if (result.status === 'own_copy' || result.status === 'unknown_organization') {
        return { status: result.status };
      }
      if (result.status === 'received' && typeof result.id === 'string') {
        return {
          status: 'received',
          id: result.id,
          counterpartyId:
            typeof result.counterparty_id === 'string' ? result.counterparty_id : null,
          duplicate: result.duplicate === true,
        };
      }
      throw new Error('Unexpected answer from app.receive_email');
    },

    getEmailSettings(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const [member] = await tx<
          { ok: boolean }[]
        >`select app.is_active_member(${organizationId}) as ok`;
        if (member?.ok !== true) return null;
        const [settings] = await tx<
          {
            shared_local_part: string;
            signature: string | null;
            updated_by_name: string;
            updated_at: Date;
          }[]
        >`
          select s.shared_local_part, s.signature, s.updated_by_name, s.updated_at
            from app.email_settings s where s.organization_id = ${organizationId}`;
        const members = await tx<
          {
            user_id: string;
            name: string;
            local_part: string | null;
            title: string | null;
            phone: string | null;
          }[]
        >`
          select t.user_id, t.name, a.local_part, d.title, d.phone
            from app.team_names(${organizationId}) t
            left join app.member_email_addresses a
              on a.organization_id = ${organizationId} and a.user_id = t.user_id
            left join app.member_signature_details d
              on d.organization_id = ${organizationId} and d.user_id = t.user_id
           order by lower(t.name), t.user_id`;
        return {
          sharedLocalPart: settings?.shared_local_part ?? null,
          signature: settings?.signature ?? null,
          updatedByName: settings?.updated_by_name ?? null,
          updatedAt: settings?.updated_at.toISOString() ?? null,
          members: members.map((row) => ({
            userId: row.user_id,
            name: row.name,
            localPart: row.local_part,
            title: row.title,
            phone: row.phone,
          })),
        };
      });
    },

    saveEmailSettings(ctx, organizationId, sharedLocalPart, signature) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.save_email_settings(${organizationId}, ${sharedLocalPart}, ${signature}) as result`;
        const result = SETTINGS_RESULTS.find((value) => value === row?.result);
        if (result === undefined) throw new Error('Unexpected answer from app.save_email_settings');
        return result;
      });
    },

    async saveMemberEmail(ctx, organizationId, member, details) {
      try {
        return await asUser(ctx, async (tx) => {
          const check = (name: string, row: { result: string } | undefined) => {
            const result = MEMBER_RESULTS.find((value) => value === row?.result);
            if (result === undefined) throw new Error(`Unexpected answer from ${name}`);
            // Rolls the address back when the signature details are refused, and the reverse.
            if (result !== 'saved') throw new Refused(result);
          };
          const [address] = await tx<{ result: string }[]>`
            select app.save_member_email_address(${organizationId}, ${member}, ${details.localPart}) as result`;
          check('app.save_member_email_address', address);
          const [signature] = await tx<{ result: string }[]>`
            select app.save_member_signature(${organizationId}, ${member}, ${details.title}, ${details.phone}) as result`;
          check('app.save_member_signature', signature);
          return 'saved' as const;
        });
      } catch (error) {
        if (error instanceof Refused) return error.result;
        throw error;
      }
    },

    async startOutgoingEmail(ctx, email) {
      try {
        return await asUser(ctx, async (tx) => {
          const [row] = await tx<{ result: { status?: unknown; id?: unknown } }[]>`
            select app.start_outgoing_email(
              ${email.organizationId}, ${email.counterpartyId}, ${email.contactId}, ${email.fromLocalPart},
              ${email.domain},
              -- Lists go as JSON: without fetch_types, postgres.js sends an array as text.
              array(select t.x from jsonb_array_elements_text(${tx.json(email.to)}::jsonb)
                      with ordinality t(x, n) order by t.n),
              array(select t.x from jsonb_array_elements_text(${tx.json(email.cc)}::jsonb)
                      with ordinality t(x, n) order by t.n),
              ${email.subject}, ${email.body},
              ${email.messageId}, ${email.replyToEmailId}::uuid, ${email.claudeDraftId}::uuid,
              ${email.autoDraftId}::uuid) as result`;
          const status = row?.result.status;
          if (status === 'started' && typeof row?.result.id === 'string') {
            return { status: 'started' as const, id: row.result.id };
          }
          const refusal = START_REFUSALS.find((value) => value === status);
          if (refusal === undefined)
            throw new Error('Unexpected answer from app.start_outgoing_email');
          return { status: refusal };
        });
      } catch (error) {
        if (!isUniqueViolation(error, 'emails_organization_id_direction_message_id_key'))
          throw error;
        // Started before with the same send key: the earlier email, never a second one.
        const [existing] = await asUser(
          ctx,
          (tx) => tx<EmailRow[]>`
          select ${columns(tx)} from app.emails e
           where e.organization_id = ${email.organizationId} and e.direction = 'outgoing'
             and e.message_id = ${email.messageId}`,
        );
        if (existing === undefined) throw error;
        return { status: 'already_started', email: emailView(existing) };
      }
    },

    answeredEmailIds(ctx, organizationId, id) {
      return asUser(ctx, async (tx) => {
        // A sent email (a reminder replies to it, F-114 step 5c part 2) is known to the
        // recipient by the id Cloudflare gave it, the one received replies are matched against;
        // without one, no thread headers.
        const [row] = await tx<{ message_id: string | null; references: string[] }[]>`
          select case when e.direction = 'incoming' then e.message_id
                      else e.provider_message_id end as message_id,
                 to_jsonb(e.reference_ids::text[]) as references
            from app.emails e
           where e.organization_id = ${organizationId} and e.id = ${id}
             and (e.direction = 'incoming' or e.status = 'sent')`;
        return row === undefined || row.message_id === null
          ? null
          : { messageId: row.message_id, references: row.references };
      });
    },

    startEmailDraft(ctx, organizationId, counterpartyId, replyToEmailId, draftKey) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: { status?: unknown; id?: unknown } }[]>`
          select app.start_email_draft(${organizationId}, ${counterpartyId},
                                       ${replyToEmailId}::uuid, ${draftKey}) as result`;
        const status = row?.result.status;
        if (status === 'started' && typeof row?.result.id === 'string') {
          return { status: 'started' as const, id: row.result.id };
        }
        const refusal = DRAFT_REFUSALS.find((value) => value === status);
        if (refusal === undefined) throw new Error('Unexpected answer from app.start_email_draft');
        return { status: refusal };
      });
    },

    async finishEmailDraft(ctx, id, outcome) {
      await asUser(
        ctx,
        (tx) => tx`
          select app.finish_email_draft(${id}, ${outcome.drafted}, ${outcome.model},
                                        ${outcome.inputTokens}, ${outcome.outputTokens})`,
      );
    },

    emailDraftContext(ctx, organizationId, counterpartyId, replyToEmailId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ context: EmailDraftContext | null }[]>`
          select app.email_draft_context(${organizationId}, ${counterpartyId},
                                         ${replyToEmailId}::uuid) as context`;
        return row?.context ?? null;
      });
    },

    finishOutgoingEmail(ctx, id, outcome) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.finish_outgoing_email(${id}, ${outcome.ok},
            ${outcome.ok ? outcome.providerId : null}, ${outcome.ok ? null : outcome.failure}) as result`;
        const result = FINISH_RESULTS.find((value) => value === row?.result);
        if (result === undefined)
          throw new Error('Unexpected answer from app.finish_outgoing_email');
        return result;
      });
    },

    listEmails(ctx, organizationId, counterpartyId, before) {
      return asUser(ctx, async (tx) => {
        const [company] = await tx<{ id: string }[]>`
          select c.id from app.counterparties c
           where c.organization_id = ${organizationId} and c.id = ${counterpartyId}`;
        if (company === undefined) return null;
        // Newest first, ties by id: the cursor is a strict (occurred_at, id) position.
        const rows = await tx<EmailRow[]>`
          select ${columns(tx)}
            from app.emails e
           where e.organization_id = ${organizationId} and e.counterparty_id = ${counterpartyId}
             and not exists (select 1 from app.email_removals x where x.email_id = e.id)
             ${
               before === null
                 ? tx``
                 : tx`and (e.occurred_at, e.id) < (
                       select o.occurred_at, o.id from app.emails o
                        where o.organization_id = ${organizationId}
                          and o.counterparty_id = ${counterpartyId} and o.id = ${before.id})`
             }
           order by e.occurred_at desc, e.id desc
           limit ${EMAIL_LIST_LIMIT}`;
        return rows.map(emailView);
      });
    },

    getEmail(ctx, organizationId, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<EmailRow[]>`
          select ${columns(tx)}, e.body_text, e.body_truncated
            from app.emails e
           where e.organization_id = ${organizationId} and e.id = ${id}
             and not exists (select 1 from app.email_removals x where x.email_id = e.id)`;
        if (row === undefined) return null;
        const view = emailView(row);
        if (row.direction !== 'incoming') return view;
        const attachments = await tx<
          {
            position: number;
            file_name: string | null;
            content_type: string;
            size_bytes: number;
            disposition: 'attachment' | 'inline';
          }[]
        >`
          select a.position, a.file_name, a.content_type, a.size_bytes, a.disposition
            from app.email_attachments a
           where a.organization_id = ${organizationId} and a.email_id = ${id}
           order by a.position`;
        return {
          ...view,
          attachments: attachments.map((a): EmailAttachmentView => ({
            position: a.position,
            fileName: a.file_name,
            contentType: a.content_type,
            sizeBytes: a.size_bytes,
            disposition: a.disposition,
          })),
        };
      });
    },

    listUnmatchedEmails(ctx, organizationId, before) {
      return asUser(ctx, async (tx) => {
        const unmatched = () => tx`
          e.organization_id = ${organizationId} and e.direction = 'incoming'
          and e.counterparty_id is null
          and not exists (select 1 from app.email_removals x where x.email_id = e.id)`;
        // The cursor's place is read from the email itself, whatever became of it since (linked
        // or deleted between two pages), so the next page still starts after it; an id that is
        // no received email of this organization gives an empty page.
        const rows = await tx<EmailRow[]>`
          select ${columns(tx)}
            from app.emails e
           where ${unmatched()}
             ${
               before === null
                 ? tx``
                 : tx`and (e.occurred_at, e.id) < (
                       select o.occurred_at, o.id from app.emails o
                        where o.organization_id = ${organizationId} and o.direction = 'incoming'
                          and o.id = ${before.id})`
             }
           order by e.occurred_at desc, e.id desc
           limit ${UNMATCHED_EMAIL_PAGE + 1}`;
        const [count] = await tx<{ total: number }[]>`
          select count(*)::integer as total
            from (select 1 from app.emails e where ${unmatched()}
                   limit ${UNMATCHED_EMAIL_COUNT_CAP}) as listed`;
        return {
          emails: rows.slice(0, UNMATCHED_EMAIL_PAGE).map(emailView),
          more: rows.length > UNMATCHED_EMAIL_PAGE,
          total: count?.total ?? 0,
        };
      });
    },

    linkEmail(ctx, organizationId, id, counterpartyId, contactId) {
      return asUser(ctx, async (tx) => {
        // Only an email of the organization the request names (the function itself checks the
        // caller's membership of the email's own organization).
        const [mine] = await tx<{ id: string }[]>`
          select e.id from app.emails e where e.organization_id = ${organizationId} and e.id = ${id}`;
        if (mine === undefined) return 'not_found';
        const [row] = await tx<{ result: string }[]>`
          select app.link_email(${id}, ${counterpartyId}, ${contactId}) as result`;
        const result = LINK_RESULTS.find((value) => value === row?.result);
        if (result === undefined) throw new Error('Unexpected answer from app.link_email');
        return result;
      });
    },

    removeEmail(ctx, organizationId, id) {
      return asUser(ctx, async (tx) => {
        const [mine] = await tx<{ id: string }[]>`
          select e.id from app.emails e where e.organization_id = ${organizationId} and e.id = ${id}`;
        if (mine === undefined) return 'not_found';
        const [row] = await tx<{ result: string }[]>`
          select app.remove_email(${id}) as result`;
        const result = REMOVE_RESULTS.find((value) => value === row?.result);
        if (result === undefined) throw new Error('Unexpected answer from app.remove_email');
        return result;
      });
    },

    storedEmailFile(ctx, organizationId, id, position) {
      return asUser(ctx, async (tx) => {
        const [email] = await tx<{ raw_key: string | null; raw_size: number | null }[]>`
          select e.raw_key, e.raw_size from app.emails e
           where e.organization_id = ${organizationId} and e.id = ${id} and e.direction = 'incoming'
             and not exists (select 1 from app.email_removals x where x.email_id = e.id)`;
        if (email?.raw_key == null || email.raw_size == null) return null;
        if (position === null) {
          return { rawKey: email.raw_key, rawSize: email.raw_size, attachment: null };
        }
        const [attachment] = await tx<{ file_name: string | null; sha256: string }[]>`
          select a.file_name, a.sha256 from app.email_attachments a
           where a.organization_id = ${organizationId} and a.email_id = ${id}
             and a.position = ${position}`;
        if (attachment === undefined) return null;
        return {
          rawKey: email.raw_key,
          rawSize: email.raw_size,
          attachment: { position, fileName: attachment.file_name, sha256: attachment.sha256 },
        };
      });
    },
  };
}
