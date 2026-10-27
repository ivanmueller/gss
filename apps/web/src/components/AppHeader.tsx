import { Wheat } from 'lucide-react';

import { Link } from '../lib/router';
import type { ApiHealth } from '../lib/useApiHealth';
import type { MeState } from '../lib/useMe';
import { cn } from '../lib/utils';

const HEALTH = {
  checking: { text: 'Checking API…', dot: 'bg-muted-foreground' },
  ok: { text: 'API reachable', dot: 'bg-emerald-600' },
  unreachable: { text: 'API unreachable', dot: 'bg-red-600' },
} as const;

export interface HeaderUser {
  /** Email as reported by the API's /me, falling back to the session's. */
  email: string | null;
  /** Organization name from /me; null once /me answered with no membership. */
  organization: string | null | undefined;
  check: MeState['status'];
  onSignOut: () => void;
}

const NAV = [
  { id: 'workspace', href: '/', label: 'Workspace' },
  { id: 'counterparties', href: '/counterparties', label: 'Counterparties' },
] as const;

export function AppHeader({
  health,
  user,
  current = null,
}: {
  health: ApiHealth;
  user?: HeaderUser;
  current?: (typeof NAV)[number]['id'] | null;
}) {
  const { text, dot } = HEALTH[health];
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Wheat aria-hidden="true" className="size-6 text-primary" />
          <div>
            <h1 className="text-base leading-tight font-semibold">Grain Trading Workspace</h1>
            <p className="text-xs text-muted-foreground">Canada–U.S. physical grain · demo shell</p>
          </div>
          <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:ml-4">
            {NAV.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={current === item.id ? 'page' : undefined}
                className={cn(
                  'rounded-md px-2 py-1 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  current === item.id && 'bg-muted font-medium',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <p
            role="status"
            className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground"
          >
            <span aria-hidden="true" className={cn('size-2 rounded-full', dot)} />
            {text}
          </p>
          {user && (
            <div className="flex items-center gap-2 text-xs">
              <p>
                Signed in as <span className="font-medium">{user.email ?? 'unknown user'}</span>
                {user.organization !== undefined && (
                  <span className="text-muted-foreground">
                    {' · '}
                    {user.organization ?? 'no organization yet'}
                  </span>
                )}
                {user.check === 'error' && (
                  <span className="text-red-700"> · server could not confirm your session</span>
                )}
              </p>
              <button
                type="button"
                onClick={user.onSignOut}
                className="rounded-md border px-2 py-0.5 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
