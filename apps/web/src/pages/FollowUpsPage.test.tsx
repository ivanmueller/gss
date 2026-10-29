import type { FollowUp } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { FollowUpsPage } from './FollowUpsPage';

// Synthetic values only. The clock is fixed at 10 am Central daylight time, 30 October 2026.
const ME = '00000000-0000-4000-8000-0000000044aa';

function followUp(task: string, dueAt: string, extra: Partial<FollowUp> = {}): FollowUp {
  return {
    id: `00000000-0000-4000-8000-${String(task.length).padStart(12, '0')}`,
    counterparty: {
      id: '00000000-0000-4000-8000-00000000c001',
      legalName: 'Synthetic Prairie Mills Ltd.',
      tradingName: 'Prairie Mills',
      archived: false,
    },
    contactLogEntryId: null,
    task,
    dueAt,
    assignedTo: { userId: ME, name: 'Tess Trader' },
    createdByName: 'Tess Trader',
    createdAt: '2026-10-28T14:00:00.000Z',
    doneAt: null,
    doneByName: null,
    version: '2026-10-28T14:00:00.000000Z',
    ...extra,
  };
}

const CALL_BACK = followUp('Call back', '2026-10-29T14:00:00.000Z');
const LIST = [
  CALL_BACK,
  followUp('Send the bid sheet', '2026-10-30T22:00:00.000Z'),
  followUp('Visit the elevator', '2026-10-31T15:00:00.000Z'),
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-30T15:00:00.000Z'));
  window.history.replaceState(null, '', '/follow-ups');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('FollowUpsPage', () => {
  it('groups the person’s own follow-ups: overdue, due today, coming up', async () => {
    const calls = mockApi({
      [`GET /follow-ups?organization_id=${ORG.id}&assigned_to=me`]: () =>
        Response.json({ followUps: LIST, truncated: false }),
    });
    render(
      <FollowUpsPage
        session={{ ...SESSION, organization: { ...ORG, role: 'viewer' }, userId: ME }}
      />,
    );
    const overdue = await screen.findByRole('region', { name: 'Overdue (1)' });
    expect(overdue).toHaveTextContent('OverdueCall back');
    expect(within(overdue).getByRole('link', { name: 'Prairie Mills' })).toHaveAttribute(
      'href',
      '/counterparties/00000000-0000-4000-8000-00000000c001',
    );
    expect(screen.getByRole('region', { name: 'Due today (1)' })).toHaveTextContent(
      'Due todaySend the bid sheet',
    );
    expect(screen.getByRole('region', { name: 'Coming up (1)' })).toHaveTextContent(
      'Due Sat 31 Oct 2026, 10:00 am CT · Tess Trader',
    );
    // A viewer marks done what they are responsible for, and cannot change it.
    expect(
      within(overdue).getByRole('button', { name: 'Mark done: Call back' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument();
    expect(calls.map((call) => call.path)).not.toContain(
      `/follow-ups/team?organization_id=${ORG.id}`,
    );
  });

  it('shows everyone’s and done ones when asked, keeping the choice in the address', async () => {
    const calls = mockApi({
      [`GET /follow-ups?organization_id=${ORG.id}&assigned_to=me`]: () =>
        Response.json({ followUps: [], truncated: false }),
      [`GET /follow-ups?organization_id=${ORG.id}`]: () =>
        Response.json({ followUps: [], truncated: false }),
      [`GET /follow-ups?organization_id=${ORG.id}&status=all`]: () =>
        Response.json({
          followUps: [
            followUp('Call back', '2026-10-29T14:00:00.000Z', {
              doneAt: '2026-10-29T15:00:00.000Z',
              doneByName: 'Adam Admin',
            }),
          ],
          truncated: false,
        }),
      [`GET /follow-ups/team?organization_id=${ORG.id}`]: () => Response.json({ members: [] }),
    });
    const user = userEvent.setup();
    render(<FollowUpsPage session={SESSION} />);
    expect(await screen.findByText('You have no open follow-ups.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Everyone' }));
    expect(window.location.search).toBe('?who=everyone');
    expect(await screen.findByText('No open follow-ups.')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Include done'));
    const done = await screen.findByRole('region', { name: 'Done (1)' });
    expect(done).toHaveTextContent('Done Thu 29 Oct 2026, 10:00 am CT by Adam Admin');
    expect(calls.map((call) => call.path)).toContain(
      `/follow-ups?organization_id=${ORG.id}&status=all`,
    );
  });

  it('marks a follow-up done and reloads the list', async () => {
    let done = false;
    const calls = mockApi({
      [`GET /follow-ups?organization_id=${ORG.id}&assigned_to=me`]: () =>
        Response.json({ followUps: done ? LIST.slice(1) : LIST, truncated: false }),
      [`GET /follow-ups/team?organization_id=${ORG.id}`]: () => Response.json({ members: [] }),
      [`POST /follow-ups/${CALL_BACK.id}/done`]: () => {
        done = true;
        return Response.json(CALL_BACK);
      },
    });
    const changed = vi.fn();
    window.addEventListener('app:follow-ups-changed', changed);
    render(<FollowUpsPage session={{ ...SESSION, userId: ME }} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Mark done: Call back' }));
    expect(await screen.findByRole('region', { name: 'Due today (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Overdue/ })).not.toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(changed).toHaveBeenCalled();
    window.removeEventListener('app:follow-ups-changed', changed);
  });
});
