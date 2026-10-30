import { albertaDay, type FollowUp } from '@grain/domain';

// The CRM's helpers for the web app: who may do what, and its times in Alberta time.

/** Roles that log contacts and plan, change and finish follow-ups (owner's decision, 2026-10-29). */
export function canLogContacts(role: string): boolean {
  return role === 'trader' || role === 'operations' || role === 'org_admin';
}

/** Whether the person may mark this follow-up done: those who plan, or the person responsible. */
export function canFinish(followUp: FollowUp, role: string, userId: string | undefined): boolean {
  return canLogContacts(role) || (userId !== undefined && followUp.assignedTo.userId === userId);
}

/** Admins remove follow-ups, open or done (owner's request, 2026-10-30). */
export function canRemoveFollowUps(role: string): boolean {
  return role === 'org_admin';
}

/** 9:00 am tomorrow in Alberta, as a datetime-local input shows it: a follow-up's first due time. */
export function defaultDueInput(now = new Date()): string {
  const tomorrow = new Date(`${albertaDay(now)}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return `${tomorrow.toISOString().slice(0, 10)}T09:00`;
}

export type DueState = 'done' | 'overdue' | 'today' | 'upcoming';

/** Done; overdue (its due time has passed); due later today in Alberta time; or upcoming. */
export function dueState(followUp: Pick<FollowUp, 'dueAt' | 'doneAt'>, now = new Date()): DueState {
  if (followUp.doneAt !== null) return 'done';
  if (Date.parse(followUp.dueAt) < now.getTime()) return 'overdue';
  return albertaDay(followUp.dueAt) === albertaDay(now) ? 'today' : 'upcoming';
}

/** The window event that asks the menu's follow-up count to refresh after a change. */
export const FOLLOW_UPS_CHANGED = 'app:follow-ups-changed';

export function noteFollowUpsChanged() {
  window.dispatchEvent(new Event(FOLLOW_UPS_CHANGED));
}
