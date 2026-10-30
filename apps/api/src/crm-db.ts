import {
  type ContactChannel,
  type ContactLogEntry,
  type ContactLogInput,
  type ContactLogRevision,
  type FollowUp,
  type FollowUpCount,
  type FollowUpInput,
  type TeamMemberName,
} from '@grain/domain';
import type postgres from 'postgres';

import type { RequestContext } from './db';

// The CRM for counterparties in Postgres (20261029070000_counterparty_crm.sql): the contact
// log and follow-ups. Every call runs as the verified user, so row level security and the
// triggers decide what is visible and writable; the checks here only choose the answer.

/** Largest list of contact log entries or follow-ups returned. */
export const CRM_LIST_LIMIT = 1000;

export type FollowUpStatus = 'open' | 'done' | 'all';

export interface FollowUpFilter {
  organizationId: string | null;
  counterpartyId: string | null;
  /** 'me' for the signed-in person, a user id, or null for anyone. */
  assignedTo: string | null;
  status: FollowUpStatus;
}

export interface NewContactLog {
  counterpartyId: string;
  log: ContactLogInput;
  /** A follow-up planned with it, or null. */
  followUp: FollowUpInput | null;
  /** The recorder's name as shown with the entry and the follow-up. */
  recordedByName: string;
}

export type CreateContactLogResult =
  | { status: 'created'; id: string; followUpId: string | null }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'archived' }
  /** The person named responsible is not an active member of the team. */
  | { status: 'not_a_member' };

export type CorrectContactLogResult =
  | { status: 'saved' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'archived' }
  /** Someone corrected the entry after the version the person was looking at. */
  | { status: 'changed'; currentRevision: number };

export type CreateFollowUpResult =
  | { status: 'created'; id: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'archived' }
  | { status: 'not_a_member' };

export type FollowUpWriteResult =
  | { status: 'saved' }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'archived' }
  | { status: 'not_a_member' }
  /** Changed by someone else after the version the person was looking at. */
  | { status: 'changed' }
  /** Done already, so no longer changed. */
  | { status: 'done' };

export interface CrmDatabase {
  /** A counterparty's contact log, latest contact first, each entry with every version. */
  listContactLog: (ctx: RequestContext, counterpartyId: string) => Promise<ContactLogEntry[]>;
  getContactLogEntry: (ctx: RequestContext, id: string) => Promise<ContactLogEntry | null>;
  /** Logs a contact, and plans its follow-up when there is one, in one transaction. */
  createContactLog: (ctx: RequestContext, entry: NewContactLog) => Promise<CreateContactLogResult>;
  /** Appends a corrected version, unless someone corrected it after `basedOnRevision`. */
  correctContactLog: (
    ctx: RequestContext,
    id: string,
    basedOnRevision: number,
    log: ContactLogInput,
    recordedByName: string,
  ) => Promise<CorrectContactLogResult>;
  /** Open follow-ups soonest due first, then done ones latest done first. */
  listFollowUps: (ctx: RequestContext, filter: FollowUpFilter) => Promise<FollowUp[]>;
  /**
   * The signed-in person's open follow-ups overdue and due later today: before `endOfDay`, the
   * end of today in Alberta time, worked out by the caller with the same rules as the web app.
   */
  countFollowUps: (
    ctx: RequestContext,
    organizationId: string,
    endOfDay: string,
  ) => Promise<FollowUpCount>;
  /** Active members who can be made responsible; empty for anyone not an active member. */
  teamNames: (ctx: RequestContext, organizationId: string) => Promise<TeamMemberName[]>;
  getFollowUp: (ctx: RequestContext, id: string) => Promise<FollowUp | null>;
  createFollowUp: (
    ctx: RequestContext,
    counterpartyId: string,
    followUp: FollowUpInput,
    createdByName: string,
  ) => Promise<CreateFollowUpResult>;
  updateFollowUp: (
    ctx: RequestContext,
    id: string,
    version: string,
    followUp: FollowUpInput,
  ) => Promise<FollowUpWriteResult>;
  /** Marks a follow-up done for good; marking a done one again changes nothing. */
  finishFollowUp: (
    ctx: RequestContext,
    id: string,
    doneByName: string,
  ) => Promise<FollowUpWriteResult>;
  /**
   * Removes a follow-up, open or done, for an admin of its organization: kept in the
   * database with who removed it and when, and left out of every list and count.
   */
  removeFollowUp: (ctx: RequestContext, id: string) => Promise<FollowUpWriteResult>;
}

type AsUser = <T>(
  ctx: RequestContext,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) => Promise<T>;

/** A record's version: its updated_at to the microsecond, in UTC (VERSION in @grain/domain). */
const VERSION_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

interface RevisionRow {
  id: string;
  entry_id: string;
  revision_number: number;
  occurred_at: Date;
  channel: ContactChannel;
  contact_name: string;
  notes: string | null;
  recorded_by_name: string;
  recorded_at: Date;
}

interface EntryRow {
  id: string;
  counterparty_id: string;
  created_at: Date;
}

interface FollowUpRow {
  id: string;
  counterparty_id: string;
  legal_name: string;
  trading_name: string | null;
  archived: boolean;
  contact_log_entry_id: string | null;
  task: string;
  due_at: Date;
  assigned_to: string;
  assigned_to_name: string;
  created_by_name: string;
  created_at: Date;
  done_at: Date | null;
  done_by_name: string | null;
  version: string;
}

function revision(row: RevisionRow): ContactLogRevision {
  return {
    id: row.id,
    revisionNumber: row.revision_number,
    occurredAt: row.occurred_at.toISOString(),
    channel: row.channel,
    contactName: row.contact_name,
    notes: row.notes,
    recordedByName: row.recorded_by_name,
    recordedAt: row.recorded_at.toISOString(),
  };
}

function followUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    counterparty: {
      id: row.counterparty_id,
      legalName: row.legal_name,
      tradingName: row.trading_name,
      archived: row.archived,
    },
    contactLogEntryId: row.contact_log_entry_id,
    task: row.task,
    dueAt: row.due_at.toISOString(),
    assignedTo: { userId: row.assigned_to, name: row.assigned_to_name },
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    doneAt: row.done_at?.toISOString() ?? null,
    doneByName: row.done_by_name,
    version: row.version,
  };
}

/** Entries with their versions, newest version first, latest contact first. */
function entries(rows: EntryRow[], revisions: RevisionRow[]): ContactLogEntry[] {
  const byEntry = new Map<string, ContactLogRevision[]>();
  for (const row of revisions) {
    const list = byEntry.get(row.entry_id) ?? [];
    list.push(revision(row));
    byEntry.set(row.entry_id, list);
  }
  return rows
    .flatMap((row) => {
      const versions = byEntry.get(row.id);
      const current = versions?.[0];
      return versions && current
        ? [
            {
              id: row.id,
              counterpartyId: row.counterparty_id,
              createdAt: row.created_at.toISOString(),
              current,
              revisions: versions,
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        Date.parse(b.current.occurredAt) - Date.parse(a.current.occurredAt) ||
        b.createdAt.localeCompare(a.createdAt),
    );
}

/** Whether the counterparty can get new CRM records from the user: visible, allowed, not archived. */
async function target(
  tx: postgres.TransactionSql,
  counterpartyId: string,
): Promise<
  | { status: 'ok'; organizationId: string }
  | { status: 'not_found' }
  | { status: 'forbidden' }
  | { status: 'archived' }
> {
  const [row] = await tx<{ organization_id: string; allowed: boolean; archived: boolean }[]>`
    select organization_id, app.can_log_contacts(organization_id) as allowed,
           archived_at is not null as archived
    from app.counterparties where id = ${counterpartyId}`;
  if (!row) return { status: 'not_found' };
  if (!row.allowed) return { status: 'forbidden' };
  if (row.archived) return { status: 'archived' };
  return { status: 'ok', organizationId: row.organization_id };
}

/** Whether the user can be made responsible: an active member of the organization. */
async function isTeamMember(tx: postgres.TransactionSql, organizationId: string, userId: string) {
  const [row] = await tx<{ name: string | null }[]>`
    select app.member_name(${organizationId}, ${userId}) as name`;
  return row?.name != null;
}

async function insertRevision(
  tx: postgres.TransactionSql,
  organizationId: string,
  entryId: string,
  log: ContactLogInput,
  recordedByName: string,
) {
  // revision_number is set by the database (app.number_contact_log_revision); 1 is a placeholder.
  await tx`
    insert into app.contact_log_revisions
      (organization_id, entry_id, revision_number, occurred_at, channel, contact_name, notes,
       recorded_by, recorded_by_name)
    values (${organizationId}, ${entryId}, 1, ${log.occurredAt}::timestamptz,
            ${log.channel}::app.contact_channel, ${log.contactName}, ${log.notes},
            app.current_user_id(), ${recordedByName})
  `;
}

async function insertFollowUp(
  tx: postgres.TransactionSql,
  organizationId: string,
  counterpartyId: string,
  entryId: string | null,
  plan: FollowUpInput,
  createdByName: string,
): Promise<string> {
  // assigned_to_name is filled in by the database from the person's login.
  const [row] = await tx<{ id: string }[]>`
    insert into app.follow_ups
      (organization_id, counterparty_id, contact_log_entry_id, task, due_at, assigned_to,
       assigned_to_name, created_by, created_by_name)
    values (${organizationId}, ${counterpartyId}, ${entryId}, ${plan.task},
            ${plan.dueAt}::timestamptz, ${plan.assignedTo}, '-', app.current_user_id(),
            ${createdByName})
    returning id
  `;
  if (!row) throw new Error('follow-up was not created');
  return row.id;
}

export function crmQueries(asUser: AsUser): CrmDatabase {
  const revisionsOf = (tx: postgres.TransactionSql, entryIds: string[]) => tx<RevisionRow[]>`
    select r.id, r.entry_id, r.revision_number, r.occurred_at, r.channel::text as channel,
           r.contact_name, r.notes, r.recorded_by_name, r.created_at as recorded_at
    from app.contact_log_revisions r
    where r.entry_id = any (${`{${entryIds.join(',')}}`}::uuid[])
    order by r.entry_id, r.revision_number desc
  `;

  const followUpSelect = (tx: postgres.TransactionSql) => tx`
    select f.id, f.counterparty_id, c.legal_name, c.trading_name,
           c.archived_at is not null as archived, f.contact_log_entry_id, f.task, f.due_at,
           f.assigned_to, f.assigned_to_name, f.created_by_name, f.created_at, f.done_at,
           f.done_by_name, to_char(f.updated_at at time zone 'UTC', ${VERSION_FORMAT}) as version
    from app.follow_ups f
    join app.counterparties c on c.id = f.counterparty_id
  `;

  return {
    listContactLog(ctx, counterpartyId) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<EntryRow[]>`
          select e.id, e.counterparty_id, e.created_at
          from app.contact_log_entries e
          where e.counterparty_id = ${counterpartyId}
          order by e.created_at desc
          limit ${CRM_LIST_LIMIT}`;
        if (rows.length === 0) return [];
        return entries(
          rows,
          await revisionsOf(
            tx,
            rows.map((row) => row.id),
          ),
        );
      });
    },

    getContactLogEntry(ctx, id) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<EntryRow[]>`
          select id, counterparty_id, created_at from app.contact_log_entries where id = ${id}`;
        if (rows.length === 0) return null;
        return entries(rows, await revisionsOf(tx, [id]))[0] ?? null;
      });
    },

    createContactLog(ctx, entry) {
      return asUser(ctx, async (tx): Promise<CreateContactLogResult> => {
        const found = await target(tx, entry.counterpartyId);
        if (found.status !== 'ok') return found;
        const org = found.organizationId;
        if (entry.followUp && !(await isTeamMember(tx, org, entry.followUp.assignedTo))) {
          return { status: 'not_a_member' };
        }
        const [created] = await tx<{ id: string }[]>`
          insert into app.contact_log_entries (organization_id, counterparty_id, created_by)
          values (${org}, ${entry.counterpartyId}, app.current_user_id())
          returning id`;
        if (!created) throw new Error('contact log entry was not created');
        await insertRevision(tx, org, created.id, entry.log, entry.recordedByName);
        const followUpId = entry.followUp
          ? await insertFollowUp(
              tx,
              org,
              entry.counterpartyId,
              created.id,
              entry.followUp,
              entry.recordedByName,
            )
          : null;
        return { status: 'created', id: created.id, followUpId };
      });
    },

    correctContactLog(ctx, id, basedOnRevision, log, recordedByName) {
      return asUser(ctx, async (tx): Promise<CorrectContactLogResult> => {
        const [entry] = await tx<{ organization_id: string; counterparty_id: string }[]>`
          select organization_id, counterparty_id from app.contact_log_entries where id = ${id}`;
        if (!entry) return { status: 'not_found' };
        const found = await target(tx, entry.counterparty_id);
        if (found.status !== 'ok') return found;
        // Take the entry's lock, then read its latest version in a statement of its own, so
        // a correction recorded meanwhile is seen (as reviseQuote does).
        await tx`select app.lock_contact_log_entry(${id})`;
        const [latest] = await tx<{ current: number | null }[]>`
          select max(revision_number) as current from app.contact_log_revisions
          where entry_id = ${id}`;
        const current = latest?.current ?? 0;
        if (current !== basedOnRevision) return { status: 'changed', currentRevision: current };
        await insertRevision(tx, entry.organization_id, id, log, recordedByName);
        return { status: 'saved' };
      });
    },

    listFollowUps(ctx, filter) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<FollowUpRow[]>`
          ${followUpSelect(tx)}
          where ${filter.organizationId === null ? tx`true` : tx`f.organization_id = ${filter.organizationId}`}
            and ${filter.counterpartyId === null ? tx`true` : tx`f.counterparty_id = ${filter.counterpartyId}`}
            and ${
              filter.assignedTo === null
                ? tx`true`
                : filter.assignedTo === 'me'
                  ? tx`f.assigned_to = app.current_user_id()`
                  : tx`f.assigned_to = ${filter.assignedTo}`
            }
            and f.removed_at is null
            and ${
              filter.status === 'open'
                ? tx`f.done_at is null`
                : filter.status === 'done'
                  ? tx`f.done_at is not null`
                  : tx`true`
            }
          order by f.done_at is not null, f.due_at, f.done_at desc, f.id
          limit ${CRM_LIST_LIMIT + 1}`;
        return rows.map(followUp);
      });
    },

    countFollowUps(ctx, organizationId, endOfDay) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<{ overdue: number; due_today: number }[]>`
          select count(*) filter (where f.due_at < now())::int as overdue,
                 count(*) filter (
                   where f.due_at >= now() and f.due_at < ${endOfDay}::timestamptz
                 )::int as due_today
          from app.follow_ups f
          where f.organization_id = ${organizationId} and f.assigned_to = app.current_user_id()
            and f.done_at is null and f.removed_at is null`;
        return { overdue: row?.overdue ?? 0, dueToday: row?.due_today ?? 0 };
      });
    },

    teamNames(ctx, organizationId) {
      return asUser(ctx, async (tx) => {
        const rows = await tx<{ user_id: string; name: string }[]>`
          select user_id, name from app.team_names(${organizationId})`;
        return rows.map((row) => ({ userId: row.user_id, name: row.name }));
      });
    },

    getFollowUp(ctx, id) {
      return asUser(ctx, async (tx) => {
        const [row] = await tx<FollowUpRow[]>`
          ${followUpSelect(tx)} where f.id = ${id} and f.removed_at is null`;
        return row ? followUp(row) : null;
      });
    },

    createFollowUp(ctx, counterpartyId, plan, createdByName) {
      return asUser(ctx, async (tx): Promise<CreateFollowUpResult> => {
        const found = await target(tx, counterpartyId);
        if (found.status !== 'ok') return found;
        if (!(await isTeamMember(tx, found.organizationId, plan.assignedTo))) {
          return { status: 'not_a_member' };
        }
        const id = await insertFollowUp(
          tx,
          found.organizationId,
          counterpartyId,
          null,
          plan,
          createdByName,
        );
        return { status: 'created', id };
      });
    },

    updateFollowUp(ctx, id, version, plan) {
      return asUser(ctx, async (tx): Promise<FollowUpWriteResult> => {
        const [row] = await tx<
          { organization_id: string; allowed: boolean; done: boolean; archived: boolean }[]
        >`
          select f.organization_id, app.can_log_contacts(f.organization_id) as allowed,
                 f.done_at is not null as done, c.archived_at is not null as archived
          from app.follow_ups f join app.counterparties c on c.id = f.counterparty_id
          where f.id = ${id} and f.removed_at is null`;
        if (!row) return { status: 'not_found' };
        if (!row.allowed) return { status: 'forbidden' };
        if (row.done) return { status: 'done' };
        if (row.archived) return { status: 'archived' };
        if (!(await isTeamMember(tx, row.organization_id, plan.assignedTo))) {
          return { status: 'not_a_member' };
        }
        const updated = await tx`
          update app.follow_ups
          set task = ${plan.task}, due_at = ${plan.dueAt}::timestamptz,
              assigned_to = ${plan.assignedTo}
          where id = ${id} and done_at is null
            and to_char(updated_at at time zone 'UTC', ${VERSION_FORMAT}) = ${version}
          returning id`;
        if (updated.length === 1) return { status: 'saved' };
        const [now] = await tx<{ done: boolean }[]>`
          select done_at is not null as done from app.follow_ups where id = ${id}`;
        if (!now) return { status: 'not_found' };
        return now.done ? { status: 'done' } : { status: 'changed' };
      });
    },

    finishFollowUp(ctx, id, doneByName) {
      return asUser(ctx, async (tx): Promise<FollowUpWriteResult> => {
        const [row] = await tx<{ allowed: boolean }[]>`
          select app.can_log_contacts(organization_id)
                 or assigned_to = app.current_user_id() as allowed
          from app.follow_ups where id = ${id} and removed_at is null`;
        if (!row) return { status: 'not_found' };
        if (!row.allowed) return { status: 'forbidden' };
        await tx`
          update app.follow_ups
          set done_at = now(), done_by = app.current_user_id(), done_by_name = ${doneByName}
          where id = ${id} and done_at is null`;
        return { status: 'saved' };
      });
    },

    removeFollowUp(ctx, id) {
      return asUser(ctx, async (tx): Promise<FollowUpWriteResult> => {
        const [row] = await tx<{ allowed: boolean }[]>`
          select app.is_org_admin(organization_id) as allowed
          from app.follow_ups where id = ${id} and removed_at is null`;
        if (!row) return { status: 'not_found' };
        if (!row.allowed) return { status: 'forbidden' };
        // The database fills in when and the admin's name, and checks they are an admin.
        await tx`
          update app.follow_ups set removed_by = app.current_user_id()
          where id = ${id} and removed_by is null`;
        return { status: 'saved' };
      });
    },
  };
}
