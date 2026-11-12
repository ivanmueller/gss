import { z } from 'zod';

import { albertaDay, albertaToUtc } from './alberta';
import { COMMODITIES } from './commodities';
import { parseFollowUp, type FollowUpInput } from './crm';
import { parseContactFields, type ContactInput } from './directory';
import { parseQuoteTerms, type QuoteFormValues, type QuoteSide, type QuoteTerms } from './quotes';
import type { ContactFormValues, DraftInput, DraftKind } from './readings';

// Claude's drafts shown in their own sections and verified in one click (the owner's request
// and answers of 2026-11-06, docs/DECISIONS.md, F-115). A draft stays a draft until a person
// verifies it. Verify saves exactly what Claude drafted, adding nothing that was not said (no
// default unit, firmness or due time: Codex's review of 88e09df, finding 1), and only when it is
// complete. One that is not names what is missing and is finished in the usual form, whose own
// defaults the person sees and confirms; what they save there is verified the same way, in one
// transaction. The API and the web app read drafts with the same rules.

/** An open draft as GET /api/v1/calls/drafts lists it, with the call it came from. */
export interface OpenDraftView {
  id: string;
  kind: DraftKind;
  fields: DraftInput['fields'];
  lines: number[];
  /** A listed contact these are new details of; null for a new person (contacts only). */
  contactId: string | null;
  counterpartyId: string;
  counterpartyName: string;
  /** What Claude read: a call's transcript, or a received email (F-114 step 5a). */
  source: 'call' | 'email';
  /** The call, for a draft from a call; else null. */
  callId: string | null;
  /** The email, for a draft from an email; else null. */
  emailId: string | null;
  /** The email's subject, for a draft from an email; else null. */
  emailSubject: string | null;
  /** UTC instant: when the call connected (or was placed), or the email was received. */
  calledAt: string;
  /** Who placed the call; null for an email. */
  callerId: string | null;
  /** Who placed the call, or who sent the email (their name, else their address). */
  callerName: string;
  /** The contact called; for an email, the listed contact who sent it, else "". */
  contactName: string;
  /**
   * The transcript lines the draft and its checks point to, by number (from 0), for the card to
   * show where each amount was said.
   */
  sourceLines: { line: number; text: string }[];
}

export interface OpenDraftList {
  drafts: OpenDraftView[];
}

/** GET /api/v1/calls/drafts: one organization's open drafts, optionally of one company or kind. */
export const listDraftsQuerySchema = z.object({
  organization_id: z.uuid(),
  counterparty_id: z.uuid().optional(),
  kind: z.enum(['quote', 'follow_up', 'contact']).optional(),
});

/** The most form values an edited draft may carry. */
const EDITED_FIELDS_MAX = 30;

/**
 * POST /api/v1/calls/drafts/{id}/verify. Empty to save the draft as it is; `edited` for what the
 * person saved in the usual form instead (a bid or offer's commodity and form values, a
 * follow-up's or a contact's form values). `contactVersion` is the version of the listed contact
 * the person saw, required for new details of a listed contact: a contact changed since is not
 * overwritten (Codex's review of 88e09df, finding 2).
 */
export const verifyDraftSchema = z
  .object({
    contactVersion: z.string().min(1).max(40).optional(),
    edited: z
      .object({
        commodity: z.string().min(1).max(40).optional(),
        values: z
          .record(z.string().max(40), z.string().max(5000))
          .refine((values) => Object.keys(values).length <= EDITED_FIELDS_MAX),
      })
      .strict()
      .optional(),
  })
  .strict();
export type VerifyDraftRequest = z.infer<typeof verifyDraftSchema>;

/** POST /api/v1/calls/drafts/{id}/verify answers this: what was saved from the draft. */
export interface VerifiedDraft {
  verified: true;
  kind: DraftKind;
  resultId: string;
}

/** The form's names for what a draft can be missing, in plain words. */
const MISSING_LABELS: Record<string, string> = {
  commodity: 'commodity',
  firmness: 'firm or indicative',
  price: 'price',
  currency: 'currency',
  priceUnit: 'price unit',
  grade: 'grade',
  deliveryBasis: 'delivery basis',
  basisLocation: 'delivery location',
  quantityMin: 'least quantity',
  quantityMax: 'quantity',
  deliveryStart: 'delivery start',
  deliveryEnd: 'delivery end',
  quotedAt: 'quoted time',
  validUntil: 'valid until',
  sourceType: 'source',
  sourceReference: 'source details',
  notes: 'notes',
  task: 'task',
  dueAt: 'due time',
  assignedTo: 'who it is for',
  contactName: 'name',
  contactRole: 'role',
  contactEmail: 'email',
  contactPhone: 'phone',
};

/** What a draft is missing or has wrong, once each, in plain words. */
function missingOf(issues: readonly { field: string | null; message: string }[]): string[] {
  const words = issues.map((issue) =>
    issue.field === null ? issue.message : (MISSING_LABELS[issue.field] ?? issue.field),
  );
  return [...new Set(words)];
}

/** Tomorrow at 9:00 am in Alberta, as the usual follow-up form opens with (the form only). */
export function defaultFollowUpDue(now: Date): string {
  const tomorrow = new Date(`${albertaDay(now)}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const due = albertaToUtc(`${tomorrow.toISOString().slice(0, 10)}T09:00`);
  if (due === null) throw new Error('tomorrow at 9:00 am could not be placed in Alberta time');
  return due;
}

/** A listed contact's details, which a draft's new details are laid over. */
export interface ListedContact {
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
}

export type DraftToSave =
  | { kind: 'quote'; side: QuoteSide; commodity: string; terms: QuoteTerms }
  | { kind: 'follow_up'; followUp: FollowUpInput }
  | { kind: 'contact'; contact: ContactInput };

/** A field the usual form would refuse, as the forms show it. */
export interface DraftIssue {
  field: string | null;
  message: string;
}

export type DraftReadiness =
  | { status: 'ready'; save: DraftToSave }
  /** Cannot be saved as it is: what is missing or wrong, in plain words and by field. */
  | { status: 'incomplete'; missing: string[]; issues: DraftIssue[] };

/**
 * The bid or offer form's values a draft opens with: indicative and per tonne unless said. For
 * the form only, where the person sees them before saving; Verify never adds them.
 */
export function draftQuoteValues(values: QuoteFormValues): QuoteFormValues {
  return { firmness: 'indicative', priceUnit: 'MT', ...values };
}

/** A contact draft's values over the listed contact's own (none for a new person). */
export function draftContactValues(
  values: ContactFormValues,
  listed: ListedContact | null,
): ContactFormValues {
  return {
    contactName: values.contactName ?? listed?.name ?? '',
    contactRole: values.contactRole ?? listed?.role ?? '',
    contactEmail: values.contactEmail ?? listed?.email ?? '',
    contactPhone: values.contactPhone ?? listed?.phone ?? '',
  };
}

const incomplete = (issues: DraftIssue[]): DraftReadiness => ({
  status: 'incomplete',
  missing: missingOf(issues),
  issues,
});

/**
 * Whether a draft can be saved, and what it saves: exactly the draft's own values (or, with
 * `edited`, what the person saved in the usual form), checked by the same rules as the usual form
 * and API, with nothing added. For new details of a listed contact, `listed` is that contact.
 */
export function draftReadiness(
  draft: Pick<DraftInput, 'kind' | 'fields'>,
  now: Date,
  listed: ListedContact | null = null,
  edited?: VerifyDraftRequest['edited'],
): DraftReadiness {
  switch (draft.kind) {
    case 'quote': {
      const fields = draft.fields as Extract<DraftInput, { kind: 'quote' }>['fields'];
      const values: QuoteFormValues = edited?.values ?? fields.values;
      const code = edited === undefined ? fields.commodity : (edited.commodity ?? null);
      const parsed = parseQuoteTerms(values, now);
      const commodity = COMMODITIES.find((item) => item.code === code)?.code ?? null;
      const issues = [
        ...(commodity === null ? [{ field: 'commodity', message: 'is required' }] : []),
        ...(parsed.status === 'invalid' ? parsed.issues : []),
      ];
      if (parsed.status === 'invalid' || commodity === null) return incomplete(issues);
      return {
        status: 'ready',
        save: { kind: 'quote', side: fields.side, commodity, terms: parsed.value },
      };
    }
    case 'follow_up': {
      const fields = draft.fields as Extract<DraftInput, { kind: 'follow_up' }>['fields'];
      const parsed = parseFollowUp(edited?.values ?? fields.values);
      if (parsed.status === 'invalid') return incomplete(parsed.issues);
      return { status: 'ready', save: { kind: 'follow_up', followUp: parsed.value } };
    }
    case 'contact': {
      const fields = draft.fields as Extract<DraftInput, { kind: 'contact' }>['fields'];
      const parsed = parseContactFields(
        draftContactValues(edited?.values ?? fields.values, listed),
      );
      if (parsed.status === 'invalid') return incomplete(parsed.issues);
      return { status: 'ready', save: { kind: 'contact', contact: parsed.value } };
    }
  }
}
