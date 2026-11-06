import {
  draftReadiness,
  type CheckedReading,
  type DraftInput,
  type DraftKind,
  type OpenDraftView,
  type TranscriptLine,
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
  /** It cannot be saved as it is: what is missing or wrong, in plain words. */
  | { status: 'incomplete'; missing: string[] }
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
   * Saves a draft as it is (with the usual form's defaults) and marks it as saved by the person,
   * in one transaction; anything refused leaves nothing saved.
   */
  verifyCallDraft: (
    ctx: RequestContext,
    draftId: string,
    recordedByName: string,
    now: Date,
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
                                     ${inputTokens}, ${outputTokens}) as kept`;
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
            call_id: string;
            called_at: Date;
            placed_by: string;
            placed_by_name: string;
            contact_name: string;
          }[]
        >`
          select d.id, d.kind, d.fields, d.lines, d.contact_id, d.counterparty_id,
                 p.legal_name as counterparty_name, c.id as call_id,
                 coalesce(c.connected_at, c.created_at) as called_at,
                 c.placed_by, c.placed_by_name, c.contact_name
          from app.call_drafts d
          join app.calls c on c.id = d.call_id and c.organization_id = d.organization_id
          join app.counterparties p
            on p.id = d.counterparty_id and p.organization_id = d.organization_id
          where d.organization_id = ${filter.organizationId} and d.status = 'open'
            and p.archived_at is null
            and ${filter.counterpartyId === null ? tx`true` : tx`d.counterparty_id = ${filter.counterpartyId}`}
            and ${filter.kind === null ? tx`true` : tx`d.kind = ${filter.kind}`}
          order by coalesce(c.connected_at, c.created_at) desc, d.recording_id, d.position
          limit ${OPEN_DRAFTS_LIMIT}`;
        return rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          fields: row.fields,
          lines: row.lines,
          contactId: row.contact_id,
          counterpartyId: row.counterparty_id,
          counterpartyName: row.counterparty_name,
          callId: row.call_id,
          calledAt: row.called_at.toISOString(),
          callerId: row.placed_by,
          callerName: row.placed_by_name,
          contactName: row.contact_name,
        }));
      });
    },

    verifyCallDraft(ctx, draftId, recordedByName, now) {
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

        // New details of a listed contact are laid over its own, as the usual form does, and
        // saved only while it is still as read here.
        let listed: ListedRow | null = null as ListedRow | null;
        if (draft.kind === 'contact' && draft.contact_id !== null) {
          const [row] = await tx<ListedRow[]>`
            select name, role, email, phone,
                   to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
            from app.counterparty_contacts
            where id = ${draft.contact_id} and counterparty_id = ${draft.counterparty_id}`;
          if (!row) return { status: 'contact_changed' };
          listed = row;
        }

        const ready = draftReadiness({ kind: draft.kind, fields: draft.fields }, now, listed);
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
