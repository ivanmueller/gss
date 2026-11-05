import type { CounterpartySummaryView } from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// Claude's summaries of companies, in Postgres (20261105030000_counterparty_summaries.sql). The
// job's calls run without a signed-in user, through the functions that claim, describe and keep
// a summary; reading one and asking for one run as the person.

/** What Claude is given to summarize a claimed company (app.counterparty_summary_context). */
export interface SummaryContextRow {
  counterpartyId: string;
  name: string;
  types: string[];
  country: string;
  tier: string | null;
  markets: string[];
  grainTypes: string[];
  sellerKind: string | null;
  annualTonnes: number | null;
  organicCertifiedUntil: string | null;
  equipment: string[];
  notes: string | null;
  contacts: { name: string; role: string | null; main: boolean }[];
  commodities: { code: string; direction: 'buys' | 'sells'; verified: boolean }[];
  locations: {
    name: string | null;
    type: string | null;
    city: string | null;
    region: string | null;
    country: string;
    access: string | null;
  }[];
  history: {
    occurredAt: string;
    channel: string;
    contactName: string;
    by: string;
    notes: string | null;
    claudeNotes: string | null;
    voicemail: boolean | null;
  }[];
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
    enteredBy: string;
  }[];
  followUps: { task: string; dueAt: string; assignedTo: string }[];
  doneFollowUps: { task: string; doneAt: string; by: string | null }[];
  draftsWaiting: number;
  changes: { occurredAt: string; what: string; action: string; fields: string[]; by: string }[];
}

/** A company claimed for its summary, and the claim's token. */
export interface SummaryClaim {
  counterpartyId: string;
  token: string;
}

export type RequestSummaryResult =
  'requested' | 'not_found' | 'forbidden' | 'archived' | 'too_soon';

export interface SummariesDatabase {
  /** Claims up to `most` companies whose summary is due, each with its claim's token. */
  claimCounterpartySummaries: (most: number) => Promise<SummaryClaim[]>;
  /** Gives a claim back without counting its attempt (Anthropic did not take the request). */
  releaseCounterpartySummary: (claim: SummaryClaim) => Promise<void>;
  /** The records of a claimed company, for Claude; null unless the claim is current. */
  counterpartySummaryContext: (claim: SummaryClaim) => Promise<SummaryContextRow | null>;
  /** Keeps a summary under its claim; false when the claim is no longer current. */
  keepCounterpartySummary: (
    claim: SummaryClaim,
    model: string,
    summary: string,
    inputTokens: number,
    outputTokens: number,
  ) => Promise<boolean>;
  /** A company's summary as the person sees it; null when they cannot see the company. */
  counterpartySummary: (
    ctx: RequestContext,
    counterpartyId: string,
  ) => Promise<CounterpartySummaryView | null>;
  /** A person asks for a new summary (Refresh). */
  requestCounterpartySummary: (
    ctx: RequestContext,
    counterpartyId: string,
  ) => Promise<RequestSummaryResult>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

const REQUEST_RESULTS: readonly RequestSummaryResult[] = [
  'requested',
  'not_found',
  'forbidden',
  'archived',
  'too_soon',
];

export function summaryQueries(asUser: AsUser, sql: postgres.Sql): SummariesDatabase {
  return {
    async claimCounterpartySummaries(most) {
      const rows = await sql<{ counterparty_id: string; claim_token: string }[]>`
        select counterparty_id, claim_token from app.claim_counterparty_summaries(${most})`;
      return rows.map((row) => ({ counterpartyId: row.counterparty_id, token: row.claim_token }));
    },

    async releaseCounterpartySummary(claim) {
      await sql`select app.release_counterparty_summary(${claim.counterpartyId}, ${claim.token})`;
    },

    async counterpartySummaryContext(claim) {
      const [row] = await sql<{ context: SummaryContextRow | null }[]>`
        select app.counterparty_summary_context(${claim.counterpartyId}, ${claim.token}) as context`;
      return row?.context ?? null;
    },

    async keepCounterpartySummary(claim, model, summary, inputTokens, outputTokens) {
      const [row] = await sql<{ kept: boolean }[]>`
        select app.keep_counterparty_summary(${claim.counterpartyId}, ${claim.token}, ${model},
                                             ${summary}, ${inputTokens}, ${outputTokens}) as kept`;
      return row?.kept === true;
    },

    counterpartySummary(ctx, counterpartyId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<
          {
            summary: string | null;
            written_at: Date | null;
            model: string | null;
            requested: boolean;
            writing: boolean;
            failed: boolean;
          }[]
        >`
          select s.summary, s.written_at, s.model,
                 coalesce(s.requested_at is not null, false) as requested,
                 coalesce(s.claimed_at > now() - interval '10 minutes', false) as writing,
                 coalesce(s.attempts >= 5 and s.claimed_at is null, false) as failed
            from app.counterparties c
            left join app.counterparty_summaries s
              on s.counterparty_id = c.id and s.organization_id = c.organization_id
           where c.id = ${counterpartyId}`;
        if (row === undefined) return null;
        return {
          summary: row.summary,
          writtenAt: row.written_at === null ? null : row.written_at.toISOString(),
          model: row.model,
          requested: row.requested,
          writing: row.writing,
          failed: row.failed,
        };
      });
    },

    requestCounterpartySummary(ctx, counterpartyId) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ result: string }[]>`
          select app.request_counterparty_summary(${counterpartyId}) as result`;
        const result = REQUEST_RESULTS.find((value) => value === row?.result);
        if (result === undefined) {
          throw new Error('Unexpected answer from app.request_counterparty_summary');
        }
        return result;
      });
    },
  };
}
