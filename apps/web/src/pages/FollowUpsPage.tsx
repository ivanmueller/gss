import type { FollowUp } from '@grain/domain';

import { useTeam, type FollowUpListResponse } from '../components/CounterpartyCrm';
import { FollowUpItem } from '../components/FollowUpItem';
import { Card, CardHeader, CardTitle } from '../components/ui/card';
import { SegmentedControl } from '../components/ui/segmented-control';
import { dueState, type DueState } from '../lib/crm';
import { setSearchParams, useSearch } from '../lib/router';
import { useApiResource } from '../lib/useApiResource';
import type { DirectorySession } from './CounterpartiesPage';

const GROUPS: readonly { state: DueState; title: string }[] = [
  { state: 'overdue', title: 'Overdue' },
  { state: 'today', title: 'Due today' },
  { state: 'upcoming', title: 'Coming up' },
  { state: 'done', title: 'Done' },
];

/**
 * /follow-ups: follow-ups across counterparties, overdue first, then due today (Central
 * time), then coming up; the signed-in person's own by default, everyone's on request
 * (?who=everyone), done ones only when asked for (?status=all).
 */
export function FollowUpsPage({ session }: { session: DirectorySession }) {
  const { token, organization } = session;
  const params = new URLSearchParams(useSearch());
  const everyone = params.get('who') === 'everyone';
  const withDone = params.get('status') === 'all';
  const query = new URLSearchParams({ organization_id: organization.id });
  if (!everyone) query.set('assigned_to', 'me');
  if (withDone) query.set('status', 'all');
  const [list, reload] = useApiResource<FollowUpListResponse>(
    `/follow-ups?${query.toString()}`,
    token,
  );
  const team = useTeam(session);
  const now = new Date();
  const groups = GROUPS.map((group) => ({
    ...group,
    items:
      list.status === 'ok'
        ? list.data.followUps.filter((item: FollowUp) => dueState(item, now) === group.state)
        : [],
  })).filter((group) => group.items.length > 0);

  return (
    <section aria-labelledby="follow-ups-page-heading" className="flex flex-col gap-4">
      <h1 id="follow-ups-page-heading" className="sr-only">
        Follow-ups
      </h1>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Whose follow-ups"
          options={[
            { value: 'mine', label: 'Mine' },
            { value: 'everyone', label: 'Everyone' },
          ]}
          value={everyone ? 'everyone' : 'mine'}
          onChange={(next) => {
            setSearchParams({ who: next === 'everyone' ? 'everyone' : null });
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={withDone}
            onChange={(event) => {
              setSearchParams({ status: event.target.checked ? 'all' : null });
            }}
          />
          Include done
        </label>
        <p className="text-xs text-muted-foreground">Times in Central time (CT).</p>
      </div>

      {list.status === 'loading' && (
        <p className="text-sm text-muted-foreground">Loading follow-ups…</p>
      )}
      {list.status === 'error' && (
        <p role="alert" className="text-sm text-danger">
          Could not load follow-ups: {list.error.message}
        </p>
      )}
      {list.status === 'ok' && groups.length === 0 && (
        <Card className="px-4 py-10 text-center text-sm">
          <p className="font-medium">
            {everyone ? 'No open follow-ups.' : 'You have no open follow-ups.'}
          </p>
          <p className="text-muted-foreground">
            Plan one from a counterparty’s page, or when you log a contact there.
          </p>
        </Card>
      )}
      {groups.map((group) => (
        <Card asChild key={group.state} className="overflow-hidden">
          <section aria-labelledby={`follow-ups-${group.state}`}>
            <CardHeader>
              <CardTitle id={`follow-ups-${group.state}`}>
                {group.title} ({group.items.length})
              </CardTitle>
            </CardHeader>
            <ul className="divide-y">
              {group.items.map((followUp) => (
                <FollowUpItem
                  key={followUp.id}
                  session={session}
                  followUp={followUp}
                  team={team}
                  showCounterparty
                  onChanged={() => {
                    reload();
                  }}
                />
              ))}
            </ul>
          </section>
        </Card>
      ))}
      {list.status === 'ok' && list.data.truncated && (
        <p className="text-xs text-muted-foreground">The list is cut at 1,000.</p>
      )}
    </section>
  );
}
