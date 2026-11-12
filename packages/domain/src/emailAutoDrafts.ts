/**
 * Email drafts Claude makes by itself (F-114 step 5c): after a call that asked for an email, or a
 * received email that needs an answer, the Worker's job writes one draft, which waits on the
 * company's Emails card and on Follow-ups until a person opens it in the email form and sends it,
 * or dismisses it. Nothing is ever sent by itself (AGENTS.md rule 8).
 */

/** A draft waiting for a person, as the API lists it. */
export interface EmailAutoDraftView {
  id: string;
  counterpartyId: string;
  counterpartyName: string;
  /** After a call, a reply to a received email, or a reminder of a GSS email left unanswered. */
  source: 'call' | 'email' | 'reminder';
  /** What the email should cover, in Claude's words from its reading. */
  about: string;
  /** The call it follows (call drafts). */
  callAt: string | null;
  callContactName: string | null;
  callBy: string | null;
  /** The received email it answers (email drafts), or the GSS email it reminds (reminders). */
  emailId: string | null;
  emailFrom: string | null;
  emailSubject: string | null;
  emailAt: string | null;
  /** The person it waits for; null: anyone on the team. */
  assignedTo: string | null;
  assignedToName: string | null;
  /** The address it is sent from by default: the person's own, or the shared one. */
  fromChoice: 'own' | 'shared';
  to: string[];
  subject: string;
  message: string;
  /** Numbers in the draft not found in what Claude was given (see emailDrafts.ts). */
  checkThis: string[];
  /** Placeholders such as [price], to be filled in before Send. */
  placeholders: string[];
  draftedAt: string;
  /** A person answered by email since (a reply, or an email after the call): by whom, when. */
  answeredSince: { by: string; at: string } | null;
}

export interface EmailAutoDraftListResponse {
  drafts: EmailAutoDraftView[];
  /** More than the 200 listed. */
  truncated: boolean;
}

const DAY_MS = 86_400_000;
/** Alberta time is UTC−6 all year (AGENTS.md). */
const ALBERTA_OFFSET_MS = -6 * 3_600_000;

/** The Alberta calendar day of an instant, as a day number. */
function albertaDay(ms: number): number {
  return Math.floor((ms + ALBERTA_OFFSET_MS) / DAY_MS);
}

/**
 * How old a draft is, for the list: "today", "yesterday", "3 days old" (the owner's answer 30),
 * in Alberta calendar days, so a draft from 23:00 is "yesterday" at 01:00 (F-114-5c-R1-01).
 */
export function draftAge(draftedAt: string, now: Date): string {
  const days = albertaDay(now.getTime()) - albertaDay(Date.parse(draftedAt));
  if (!Number.isFinite(days) || days < 1) return 'today';
  if (days === 1) return 'yesterday';
  return `${String(days)} days old`;
}
