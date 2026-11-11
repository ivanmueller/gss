import type { EmailState, EmailView, MemberEmailView } from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

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
  | 'bad_recipients';
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
}

export interface EmailsDatabase {
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
  /** One email with its text, or null. */
  getEmail: (ctx: RequestContext, organizationId: string, id: string) => Promise<EmailView | null>;
}

/** Where a page of emails ends: the last email's time (UTC instant) and id. */
export interface EmailCursor {
  occurredAt: string;
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
];
const FINISH_RESULTS: readonly FinishEmailResult[] = ['done', 'not_found', 'already_finished'];
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

export function emailQueries(asUser: AsUser): EmailsDatabase {
  // A sending email unfinished after ten minutes is shown as not confirmed (EMAIL_UNCONFIRMED_AFTER_MS).
  const columns = (tx: postgres.TransactionSql) => tx`
    e.id, e.direction, e.from_address, e.from_name, e.to_addresses::text[] as to_addresses,
    e.cc_addresses::text[] as cc_addresses, e.subject, e.sent_by_name, e.contact_name, e.failure,
    e.occurred_at,
    case when e.status = 'sending' and e.occurred_at < now() - interval '10 minutes' then 'unconfirmed'
         else e.status::text end as state`;

  return {
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
              ${email.domain}, ${email.to}::text[], ${email.cc}::text[], ${email.subject}, ${email.body},
              ${email.messageId}) as result`;
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
             ${before === null ? tx`` : tx`and (e.occurred_at, e.id) < (${before.occurredAt}::timestamptz, ${before.id}::uuid)`}
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
        return row ? emailView(row) : null;
      });
    },
  };
}
