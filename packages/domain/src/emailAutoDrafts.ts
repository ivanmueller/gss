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
  source: 'call' | 'email';
  /** What the email should cover, in Claude's words from its reading. */
  about: string;
  /** The call it follows (call drafts). */
  callAt: string | null;
  callContactName: string | null;
  callBy: string | null;
  /** The received email it answers (email drafts). */
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

/** How old a draft is, for the list: "today", "yesterday", "3 days old" (the owner's answer 30). */
export function draftAge(draftedAt: string, now: Date): string {
  const days = Math.floor((now.getTime() - Date.parse(draftedAt)) / 86_400_000);
  if (!Number.isFinite(days) || days < 1) return 'today';
  if (days === 1) return 'yesterday';
  return `${String(days)} days old`;
}
