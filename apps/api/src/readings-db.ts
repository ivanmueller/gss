import {
  draftReadiness,
  type CheckedReading,
  type DraftInput,
  type DraftKind,
  type OpenDraftView,
  type TranscriptLine,
  type VerifyDraftRequest,
} from '@grain/domain';
import type postgres from 'postgres';

import { insertPlannedFollowUp } from './crm-db';
import { addContactIn, updateContactIn, type RequestContext } from './db';
import { insertQuote } from './quotes-db';

// Claude's readings of call transcripts and their drafts, in Postgres
// (20261105010000_call_readings.sql). The job's calls run without a signed-in user, through the
// functions that claim, describe and keep a reading; a person's decisions run as that person.

/** What Claude is given to read a claimed recording (app.call_reading_context). */
export interface ReadingContextRow {
  recordingId: string;
  callId: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyTypes: string[];
  contactName: string;
  callerId: string;
  callerName: string;
  /** UTC instant: when the call connected (or was placed). */
  calledAt: string;
  /** Placed from the platform, or a call to GSS's number (a callback); outgoing when absent. */
  direction?: 'outgoing' | 'incoming';
  /** A voicemail left on GSS's number. */
  voicemail?: boolean;
  /** The transcript by side; null for a transcript kept before it was split. */
  lines: TranscriptLine[] | null;
  transcript: string;
  contacts: {
    id: string;
    name: string;
    role: string | null;
    email: string | null;
    phone: string | null;
  }[];
}

/** A recording claimed for reading, and the claim's token. */
export interface ReadingClaim {
  recordingId: string;
  token: string;
}

/** A received email claimed for reading, and the claim's token (F-114 step 5a). */
export interface EmailReadingClaim {
  emailId: string;
  token: string;
}

/** What Claude is given to read a claimed email (app.email_reading_context). */
export interface EmailReadingContextRow {
  emailId: string;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyTypes: string[];
  fromName: string | null;
  fromAddress: string;
  /** The listed contact who sent it, when matched. */
  contactId: string | null;
  subject: string;
  body: string | null;
  /** UTC instant. */
  receivedAt: string;
  /** The GSS person a follow-up goes to: who sent the email it answers, else whose address it
   * was sent to, while an active member; else null. */
  assigneeId: string | null;
  contacts: ReadingContextRow['contacts'];
}

export type DecideDraftResult =
  'decided' | 'not_found' | 'forbidden' | 'already_decided' | 'result_not_found';

export type CorrectVoicemailResult = 'saved' | 'not_found' | 'forbidden' | 'not_read';

/** Which open drafts to list: one organization's, optionally of one company or one kind. */
export interface OpenDraftFilter {
  organizationId: string;
  counterpartyId: string | null;
  kind: DraftKind | null;
}

/** Open drafts listed at most (newest calls first). */
export const OPEN_DRAFTS_LIMIT = 500;

/**
 * A draft verified in one click: saved as it is and marked as saved together, or nothing at all
 * (the owner's answers of 2026-11-06, F-115).
 */
export type VerifyDraftResult =
  | { status: 'verified'; kind: DraftKind; resultId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'already_decided' }
  | { status: 'archived' }
  /** It cannot be saved as it is: what is missing or wrong, in plain words and by field. */
  | { status: 'incomplete'; missing: string[]; issues: { field: string | null; message: string }[] }
  /** A bid from a company not marked as a buyer (or broker), an offer from a non-seller. */
  | { status: 'wrong_type' }
  /** The follow-up is for someone no longer on the team. */
  | { status: 'not_a_member' }
  /** The listed contact it updates was removed or changed meanwhile. */
  | { status: 'contact_changed' };

export interface ReadingsDatabase {
  /**
   * Claims up to `most` recordings for Claude to read now, newest first, each with its claim's
   * token, which the calls below need (Codex's review of c9222d3, finding 5).
   */
  claimCallReadings: (most: number) => Promise<ReadingClaim[]>;
  /** Gives a claim back without counting its attempt (Anthropic did not take the request). */
  releaseCallReading: (claim: ReadingClaim) => Promise<void>;
  /** The call a claimed recording is of, for Claude to read; null unless the claim is current. */
  callReadingContext: (claim: ReadingClaim) => Promise<ReadingContextRow | null>;
  /** Keeps a reading and its drafts, once; false when read already or the claim is not current. */
  keepCallReading: (
    claim: ReadingClaim,
    model: string,
    reading: CheckedReading,
    inputTokens: number,
    outputTokens: number,
  ) => Promise<boolean>;
  /** Claims up to `most` received emails for Claude to read now, each with a reserved request. */
  claimEmailReadings: (most: number) => Promise<EmailReadingClaim[]>;
  /** Gives a claim back and refunds its request (Anthropic did not take it). */
  releaseEmailReading: (claim: EmailReadingClaim) => Promise<void>;
  /** The email a claim is of, for Claude to read; null unless the claim is current. */
  emailReadingContext: (claim: EmailReadingClaim) => Promise<EmailReadingContextRow | null>;
  /**
   * Keeps an email's reading (the lines Claude saw) and its drafts, once; false when read
   * already, the claim is not current, or the email may no longer be read. `reading` is null
   * when the email had no text of its own and nothing was sent to Claude.
   */
  keepEmailReading: (
    claim: EmailReadingClaim,
    lines: readonly string[],
    cut: boolean,
    answer: {
      model: string;
      reading: CheckedReading;
      inputTokens: number;
      outputTokens: number;
    } | null,
  ) => Promise<boolean>;
  /** A person accepts a draft (naming what they saved from it) or dismisses it. */
  decideCallDraft: (
    ctx: RequestContext,
    draftId: string,
    decision: 'accepted' | 'dismissed',
    resultId: string | null,
  ) => Promise<DecideDraftResult>;
  /** The open drafts a person may see, newest calls first, up to OPEN_DRAFTS_LIMIT. */
  listOpenDrafts: (ctx: RequestContext, filter: OpenDraftFilter) => Promise<OpenDraftView[]>;
  /**
   * Saves a draft exactly as drafted, or as the person edited it in the usual form, and marks it
   * as saved by the person, in one transaction; anything refused leaves nothing saved. New
   * details of a listed contact are saved only over the version the person saw.
   */
  verifyCallDraft: (
    ctx: RequestContext,
    draftId: string,
    recordedByName: string,
    now: Date,
    request?: VerifyDraftRequest,
  ) => Promise<VerifyDraftResult>;
  /** A person's answer to whether a read call reached a voicemail. */
  correctCallVoicemail: (
    ctx: RequestContext,
    recordingId: string,
    voicemail: boolean,
  ) => Promise<CorrectVoicemailResult>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

const DECIDE_RESULTS: readonly DecideDraftResult[] = [
  'decided',
  'not_found',
  'forbidden',
  'already_decided',
  'result_not_found',
];
const VOICEMAIL_RESULTS: readonly CorrectVoicemailResult[] = [
  'saved',
  'not_found',
  'forbidden',
  'not_read',
];

/** A record's version: its updated_at to the microsecond, in UTC (VERSION in @grain/domain). */
const VERSION_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** A listed contact as read before a draft's new details are laid over it. */
interface ListedRow {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  version: string;
}

/** Undoes the verifying transaction, answering `result`. */
class RolledBack extends Error {
  constructor(readonly result: VerifyDraftResult) {
    super('rolled back');
  }
}

/** What app.decide_call_draft answered, as a verification's result. */
function refusedDecision(answer: string | undefined): VerifyDraftResult {
  switch (answer) {
    case 'not_found':
      return { status: 'not_found' };
    case 'forbidden':
      return { status: 'forbidden' };
    case 'already_decided':
      return { status: 'already_decided' };
    default:
      throw new Error(`Unexpected answer from app.decide_call_draft: ${String(answer)}`);
  }
}

export function readingQueries(asUser: AsUser, sql: postgres.Sql): ReadingsDatabase {
  return {
    async claimCallReadings(most) {
      const rows = await sql<{ recording_id: string; claim_token: string }[]>`
        select recording_id, claim_token from app.claim_call_readings(${most})`;
      return rows.map((row) => ({ recordingId: row.recording_id, token: row.claim_token }));
    },

    async releaseCallReading(claim) {
      await sql`select app.release_call_reading(${claim.recordingId}, ${claim.token})`;
    },

    async callReadingContext(claim) {
      const [row] = await sql<{ context: ReadingContextRow | null }[]>`
        select app.call_reading_context(${claim.recordingId}, ${claim.token}) as context`;
      const context = row?.context ?? null;
      if (context === null) return null;
      return { ...context, calledAt: new Date(context.calledAt).toISOString() };
    },

    async keepCallReading(claim, model, reading, inputTokens, outputTokens) {
      const drafts = reading.drafts.map((draft) => ({
        kind: draft.kind,
        contactId: draft.kind === 'contact' ? draft.contactId : null,
        fields: draft.fields,
        lines: draft.lines,
      }));
      // As plain JSON: fields left out (undefined) are not kept.
      const json = JSON.parse(JSON.stringify(drafts)) as postgres.JSONValue;
      const [row] = await sql<{ kept: boolean }[]>`
        select app.keep_call_reading(${claim.recordingId}, ${claim.token}, ${model},
                                     ${reading.voicemail},
                                     ${reading.summary}, ${sql.json(json)}::jsonb,
                                     ${inputTokens}, ${outputTokens},
                                     ${reading.emailAbout !== null}::boolean,
                                     ${reading.emailAbout}::text) as kept`;
      return row?.kept === true;
    },

    async claimEmailReadings(most) {
      const rows = await sql<{ email_id: string; claim_token: string }[]>`
        select email_id, claim_token from app.claim_email_readings(${most})`;
      return rows.map((row) => ({ emailId: row.email_id, token: row.claim_token }));
    },

    async releaseEmailReading(claim) {
      await sql`select app.release_email_reading(${claim.emailId}, ${claim.token})`;
    },

    async emailReadingContext(claim) {
      const [row] = await sql<{ context: EmailReadingContextRow | null }[]>`
        select app.email_reading_context(${claim.emailId}, ${claim.token}) as context`;
      const context = row?.context ?? null;
      if (context === null) return null;
      return { ...context, receivedAt: new Date(context.receivedAt).toISOString() };
    },

    async keepEmailReading(claim, lines, cut, answer) {
      const drafts = (answer?.reading.drafts ?? []).map((draft) => ({
        kind: draft.kind,
        contactId: draft.kind === 'contact' ? draft.contactId : null,
        fields: draft.fields,
        lines: draft.lines,
      }));
      // As plain JSON: fields left out (undefined) are not kept.
      const json = JSON.parse(JSON.stringify(drafts)) as postgres.JSONValue;
      const [row] = await sql<{ kept: boolean }[]>`
        select app.keep_email_reading(${claim.emailId}, ${claim.token}, ${answer?.model ?? null},
                                      ${answer?.reading.summary ?? null},
                                      ${sql.json([...lines])}::jsonb, ${cut},
                                      ${sql.json(json)}::jsonb, ${answer?.inputTokens ?? null},
                                      ${answer?.outputTokens ?? null},
                                      ${(answer?.reading.emailAbout ?? null) !== null}::boolean,
                                      ${answer?.reading.emailAbout ?? null}::text) as kept`;
      return row?.kept === true;
    },

    decideCallDraft(ctx, draftId, decision, resultId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.decide_call_draft(${draftId}, ${decision}, ${resultId}) as result`;
        const result = DECIDE_RESULTS.find((value) => value === row?.result);
        if (result === undefined) throw new Error('Unexpected answer from app.decide_call_draft');
        return result;
      });
    },

    listOpenDrafts(ctx, filter) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<
          {
            id: string;
            kind: DraftKind;
            fields: DraftInput['fields'];
            lines: number[];
            contact_id: string | null;
            counterparty_id: string;
            counterparty_name: string;
            call_id: string | null;
            email_id: string | null;
            email_subject: string | null;
            called_at: Date;
            placed_by: string | null;
            placed_by_name: string;
            contact_name: string;
            source_lines: { line: number; text: string | null }[];
          }[]
        >`
          select d.id, d.kind, d.fields, d.lines, d.contact_id, d.counterparty_id,
                 p.legal_name as counterparty_name, c.id as call_id, m.id as email_id,
                 m.subject as email_subject,
                 coalesce(c.connected_at, c.created_at, m.occurred_at) as called_at,
                 c.placed_by,
                 coalesce(c.placed_by_name, m.from_name, m.from_address) as placed_by_name,
                 coalesce(c.contact_name, k.name, '') as contact_name,
                 -- The lines the draft and its checks point to: from the transcript by side, or
                 -- for one kept before it was split, its non-blank lines (as Claude read them);
                 -- for an email, the lines Claude saw.
                 (select coalesce(jsonb_agg(jsonb_build_object(
                           'line', n.line,
                           'text', coalesce(r.transcript_lines -> n.line ->> 'text',
                                            plain.lines[n.line + 1],
                                            er.text_read ->> n.line))
                           order by n.line), '[]'::jsonb)
                    from (select distinct v::int as line
                            from (select jsonb_array_elements_text(d.lines) as v
                                  union all
                                  select c2.value ->> 'line'
                                    from jsonb_each(case jsonb_typeof(d.fields -> 'checks')
                                                      when 'object' then d.fields -> 'checks'
                                                      else '{}'::jsonb end) c2) x
                           where v ~ '^[0-9]{1,4}$') n
                 ) as source_lines
          from app.call_drafts d
          left join app.calls c on c.id = d.call_id and c.organization_id = d.organization_id
          left join app.call_recordings r
            on r.id = d.recording_id and r.organization_id = d.organization_id
          left join app.emails m on m.id = d.email_id and m.organization_id = d.organization_id
          left join app.email_readings er on er.email_id = d.email_id
          left join app.counterparty_contacts k
            on k.id = m.contact_id and k.organization_id = m.organization_id
          cross join lateral (
            select case when r.id is not null and r.transcript_lines is null then array(
                     select btrim(t) from unnest(string_to_array(coalesce(r.transcript, ''), E'\n'))
                       with ordinality u(t, o)
                      where btrim(t) <> '' order by o) end as lines
          ) plain
          join app.counterparties p
            on p.id = d.counterparty_id and p.organization_id = d.organization_id
          where d.organization_id = ${filter.organizationId} and d.status = 'open'
            and p.archived_at is null
            -- A draft from an email removed since is no longer shown.
            and not exists (select 1 from app.email_removals x where x.email_id = d.email_id)
            and ${filter.counterpartyId === null ? tx`true` : tx`d.counterparty_id = ${filter.counterpartyId}`}
            and ${filter.kind === null ? tx`true` : tx`d.kind = ${filter.kind}`}
          order by coalesce(c.connected_at, c.created_at, m.occurred_at) desc,
                   coalesce(d.recording_id, d.email_id), d.position
          limit ${OPEN_DRAFTS_LIMIT}`;
        return rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          fields: row.fields,
          lines: row.lines,
          contactId: row.contact_id,
          counterpartyId: row.counterparty_id,
          counterpartyName: row.counterparty_name,
          source: row.email_id === null ? ('call' as const) : ('email' as const),
          callId: row.call_id,
          emailId: row.email_id,
          emailSubject: row.email_subject,
          calledAt: row.called_at.toISOString(),
          callerId: row.placed_by,
          callerName: row.placed_by_name,
          contactName: row.contact_name,
          sourceLines: row.source_lines.flatMap((line) =>
            line.text === null ? [] : [{ line: line.line, text: line.text }],
          ),
        }));
      });
    },

    verifyCallDraft(ctx, draftId, recordedByName, now, request = {}) {
      return asUser(ctx, async (tx): Promise<VerifyDraftResult> => {
        const [draft] = await tx<
          {
            id: string;
            organization_id: string;
            counterparty_id: string;
            kind: DraftKind;
            status: string;
            fields: DraftInput['fields'];
            contact_id: string | null;
          }[]
        >`
          select id, organization_id, counterparty_id, kind, status, fields, contact_id
          from app.call_drafts where id = ${draftId}`;
        if (!draft) return { status: 'not_found' };
        if (draft.status !== 'open') return { status: 'already_decided' };

        // New details of a listed contact are laid over its own, as the card showed them, and
        // saved only over the version the person saw (Codex's review of 88e09df, finding 2).
        let listed: ListedRow | null = null as ListedRow | null;
        if (draft.kind === 'contact' && draft.contact_id !== null) {
          const [row] = await tx<ListedRow[]>`
            select name, role, email, phone,
                   to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
            from app.counterparty_contacts
            where id = ${draft.contact_id} and counterparty_id = ${draft.counterparty_id}`;
          if (!row || request.contactVersion !== row.version) return { status: 'contact_changed' };
          listed = row;
        }

        const ready = draftReadiness(
          { kind: draft.kind, fields: draft.fields },
          now,
          listed,
          request.edited,
        );
        if (ready.status === 'incomplete') return ready;
        const { save } = ready;

        let resultId: string;
        switch (save.kind) {
          case 'quote': {
            const created = await insertQuote(tx, {
              organizationId: draft.organization_id,
              counterpartyId: draft.counterparty_id,
              facilityId: null,
              side: save.side,
              commodity: save.commodity,
              terms: save.terms,
              recordedByName,
            });
            if (created.status !== 'created') {
              throw new RolledBack(
                created.status === 'forbidden' || created.status === 'archived'
                  ? { status: created.status }
                  : created.status === 'wrong_type'
                    ? { status: 'wrong_type' }
                    : { status: 'not_found' },
              );
            }
            resultId = created.id;
            break;
          }
          case 'follow_up': {
            const created = await insertPlannedFollowUp(
              tx,
              draft.counterparty_id,
              save.followUp,
              recordedByName,
            );
            if (created.status !== 'created') throw new RolledBack({ status: created.status });
            resultId = created.id;
            break;
          }
          case 'contact': {
            if (listed === null || draft.contact_id === null) {
              const added = await addContactIn(tx, draft.counterparty_id, save.contact);
              if (added.status !== 'added') throw new RolledBack({ status: added.status });
              resultId = added.id;
            } else {
              const updated = await updateContactIn(
                tx,
                draft.counterparty_id,
                draft.contact_id,
                listed.version,
                save.contact,
              );
              if (updated.status !== 'saved') {
                throw new RolledBack(
                  updated.status === 'changed' || updated.status === 'not_found'
                    ? { status: 'contact_changed' }
                    : { status: updated.status },
                );
              }
              resultId = draft.contact_id;
            }
            break;
          }
        }

        // Marked as saved by this person, under the draft's lock; a draft someone else verified
        // or dismissed meanwhile undoes what was just saved.
        const [decided] = await tx<{ result: string }[]>`
          select app.decide_call_draft(${draft.id}, 'accepted', ${resultId}) as result`;
        if (decided?.result !== 'decided') throw new RolledBack(refusedDecision(decided?.result));
        return { status: 'verified', kind: draft.kind, resultId };
      }).catch((error: unknown) => {
        if (error instanceof RolledBack) return error.result;
        throw error;
      });
    },

    correctCallVoicemail(ctx, recordingId, voicemail) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.correct_call_voicemail(${recordingId}, ${voicemail}) as result`;
        const result = VOICEMAIL_RESULTS.find((value) => value === row?.result);
        if (result === undefined)
          throw new Error('Unexpected answer from app.correct_call_voicemail');
        return result;
      });
    },
  };
}
