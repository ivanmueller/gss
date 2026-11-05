import type { CheckedReading, TranscriptLine } from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

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
      const [row] = await sql<{ kept: boolean }[]>`
        select app.keep_call_reading(${claim.recordingId}, ${claim.token}, ${model},
                                     ${reading.voicemail},
                                     ${reading.summary}, ${sql.json(drafts)}::jsonb,
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
