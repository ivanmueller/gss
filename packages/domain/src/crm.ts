import { z } from 'zod';

import { VERSION } from './directory';
import { clean, cleanLines, LABEL_MAX, oneOf } from './terms';

// The CRM for counterparties: a contact log and follow-ups (the owner's request and
// decisions of 2026-10-29, docs/DECISIONS.md). Shared by the API, which checks every
// request, and the web app's forms, so both give the same messages. The database checks
// the same rules again (20261029070000_counterparty_crm.sql). Times arrive as UTC instants;
// the forms take and show them in Alberta time (alberta.ts).

/** How the contact happened. */
export const CONTACT_CHANNELS = ['call', 'email', 'meeting', 'visit'] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  visit: 'Visit',
};

/** Longest notes of a contact log entry: room for a meeting's notes. */
export const CONTACT_NOTES_MAX = 5000;

/** A contact time may run a little ahead of the server's clock, not more. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const EARLIEST = Date.parse('2000-01-01T00:00:00Z');
const LATEST_DUE = Date.parse('2100-01-01T00:00:00Z');
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The fields of the contact log form, then of the follow-up form; their ids never clash. */
export const CONTACT_LOG_FIELD_IDS = ['occurredAt', 'channel', 'contactName', 'notes'] as const;
export const FOLLOW_UP_FIELD_IDS = ['task', 'dueAt', 'assignedTo'] as const;
export type ContactLogFieldId = (typeof CONTACT_LOG_FIELD_IDS)[number];
export type FollowUpFieldId = (typeof FOLLOW_UP_FIELD_IDS)[number];
export type CrmFieldId = ContactLogFieldId | FollowUpFieldId;
export type ContactLogFormValues = Partial<Record<ContactLogFieldId, string>>;
export type FollowUpFormValues = Partial<Record<FollowUpFieldId, string>>;

export interface CrmIssue {
  field: CrmFieldId | null;
  message: string;
}

/** What a contact log revision records, checked and cleaned. */
export interface ContactLogInput {
  /** When the contact happened (UTC ISO 8601). */
  occurredAt: string;
  channel: ContactChannel;
  /** Who at the counterparty was spoken to. */
  contactName: string;
  notes: string | null;
}

/** What a follow-up plans, checked and cleaned. */
export interface FollowUpInput {
  task: string;
  /** UTC ISO 8601. */
  dueAt: string;
  /** The user id of the team member responsible. */
  assignedTo: string;
}

const contactLogValues = z.partialRecord(z.enum(CONTACT_LOG_FIELD_IDS), z.string().max(6000));
const followUpValues = z.partialRecord(z.enum(FOLLOW_UP_FIELD_IDS), z.string().max(400));

/** POST /api/v1/contact-log: a contact with a counterparty, and optionally a follow-up. */
export const createContactLogSchema = z.object({
  counterpartyId: z.uuid(),
  values: contactLogValues,
  followUp: followUpValues.optional(),
});
export type CreateContactLogRequest = z.infer<typeof createContactLogSchema>;

/**
 * POST /api/v1/contact-log/{id}/revisions: a correction, of the version the person was
 * looking at, so a correction someone else made meanwhile is never replaced unseen.
 */
export const correctContactLogSchema = z.object({
  basedOnRevision: z.number().int().min(1).max(1_000_000),
  values: contactLogValues,
});
export type CorrectContactLogRequest = z.infer<typeof correctContactLogSchema>;

/** POST /api/v1/follow-ups: a follow-up planned on its own. */
export const createFollowUpSchema = z.object({
  counterpartyId: z.uuid(),
  values: followUpValues,
});
export type CreateFollowUpRequest = z.infer<typeof createFollowUpSchema>;

/** PATCH /api/v1/follow-ups/{id}: new task, due time or person, of the version that was open. */
export const updateFollowUpSchema = z.object({
  version: z.string().regex(VERSION),
  values: followUpValues,
});
export type UpdateFollowUpRequest = z.infer<typeof updateFollowUpSchema>;

type Report = (field: CrmFieldId | null, message: string) => void;

function instant(text: string): number | null {
  if (!INSTANT.test(text)) return null;
  const time = Date.parse(text);
  return Number.isNaN(time) ? null : time;
}

function label(value: string | undefined, field: CrmFieldId, issue: Report): string | null {
  const text = clean(value);
  if (text === null) issue(field, 'is required');
  else if (text.length > LABEL_MAX) issue(field, `is longer than ${String(LABEL_MAX)} characters`);
  else if (/\p{Cc}/u.test(text)) issue(field, 'has characters that cannot be shown');
  else return text;
  return null;
}

/**
 * Checks a contact log form. `now` is the server's (or browser's) clock: the time of the
 * contact defaults to it and may not be later than it.
 */
export function parseContactLog(
  values: ContactLogFormValues,
  now: Date,
): { status: 'ok'; value: ContactLogInput } | { status: 'invalid'; issues: CrmIssue[] } {
  const issues: CrmIssue[] = [];
  const issue: Report = (field, message) => {
    issues.push({ field, message });
  };

  let occurredAt: string | null = now.toISOString();
  const when = clean(values.occurredAt);
  if (when !== null) {
    const time = instant(when);
    occurredAt = null;
    if (time === null) issue('occurredAt', 'must be a date and time');
    else if (time > now.getTime() + CLOCK_SKEW_MS) issue('occurredAt', 'must not be in the future');
    else if (time < EARLIEST) issue('occurredAt', 'must be in 2000 or later');
    else occurredAt = new Date(time).toISOString();
  }
  const channelText = clean(values.channel);
  const channel = oneOf(CONTACT_CHANNELS, channelText);
  if (channel === null) {
    issue('channel', channelText === null ? 'is required' : 'is not one of the choices');
  }
  const contactName = label(values.contactName, 'contactName', issue);
  const notes = cleanLines(values.notes);
  if (notes !== null && notes.length > CONTACT_NOTES_MAX) {
    issue('notes', `are longer than ${CONTACT_NOTES_MAX.toLocaleString('en-CA')} characters`);
  }

  if (issues.length > 0 || occurredAt === null || channel === null || contactName === null) {
    return { status: 'invalid', issues };
  }
  return { status: 'ok', value: { occurredAt, channel, contactName, notes } };
}

/**
 * Checks a follow-up form. A due time already past is allowed (a follow-up may be recorded
 * late); it then shows as overdue. Whether the person responsible is an active member is
 * the database's to check.
 */
export function parseFollowUp(
  values: FollowUpFormValues,
): { status: 'ok'; value: FollowUpInput } | { status: 'invalid'; issues: CrmIssue[] } {
  const issues: CrmIssue[] = [];
  const issue: Report = (field, message) => {
    issues.push({ field, message });
  };

  const task = label(values.task, 'task', issue);
  let dueAt: string | null = null;
  const due = clean(values.dueAt);
  if (due === null) issue('dueAt', 'is required');
  else {
    const time = instant(due);
    if (time === null) issue('dueAt', 'must be a date and time');
    else if (time < EARLIEST || time >= LATEST_DUE) issue('dueAt', 'must be between 2000 and 2099');
    else dueAt = new Date(time).toISOString();
  }
  const assignee = clean(values.assignedTo);
  const assignedTo = assignee !== null && UUID.test(assignee) ? assignee.toLowerCase() : null;
  if (assignedTo === null) {
    issue('assignedTo', assignee === null ? 'is required' : 'is not one of the choices');
  }

  if (issues.length > 0 || task === null || dueAt === null || assignedTo === null) {
    return { status: 'invalid', issues };
  }
  return { status: 'ok', value: { task, dueAt, assignedTo } };
}

// The API's answers (apps/api/src/crm.ts), shared with the web app.

/** One version of a contact log entry; never changed afterwards. */
export interface ContactLogRevision extends ContactLogInput {
  id: string;
  revisionNumber: number;
  recordedByName: string;
  /** When it was recorded (UTC ISO 8601). */
  recordedAt: string;
}

/** A contact log entry with every version, newest first; `current` is the first of them. */
export interface ContactLogEntry {
  id: string;
  counterpartyId: string;
  createdAt: string;
  current: ContactLogRevision;
  revisions: ContactLogRevision[];
}

/** A follow-up, open or done. */
export interface FollowUp {
  id: string;
  counterparty: { id: string; legalName: string; tradingName: string | null; archived: boolean };
  /** The contact log entry it came from, if any. */
  contactLogEntryId: string | null;
  task: string;
  dueAt: string;
  assignedTo: { userId: string; name: string };
  createdByName: string;
  createdAt: string;
  doneAt: string | null;
  doneByName: string | null;
  /** Sent back with a change; a change of an older version is refused. */
  version: string;
}

/** Open follow-ups the signed-in person is responsible for that are overdue or due today. */
export interface FollowUpCount {
  overdue: number;
  dueToday: number;
}

/** A team member who can be made responsible for a follow-up. */
export interface TeamMemberName {
  userId: string;
  name: string;
}
