import { Wheat } from 'lucide-react';

import type { ApiHealth } from '../lib/useApiHealth';
import { cn } from '../lib/utils';

const HEALTH = {
  checking: { text: 'Checking API…', dot: 'bg-muted-foreground' },
  ok: { text: 'API reachable', dot: 'bg-emerald-600' },
  unreachable: { text: 'API unreachable', dot: 'bg-red-600' },
} as const;

export function AppHeader({ health }: { health: ApiHealth }) {
  const { text, dot } = HEALTH[health];
  return (
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-2">
          <Wheat aria-hidden="true" className="size-6 text-primary" />
          <div>
            <h1 className="text-base leading-tight font-semibold">Grain Trading Workspace</h1>
            <p className="text-xs text-muted-foreground">Canada–U.S. physical grain · demo shell</p>
          </div>
        </div>
        <p
          role="status"
          className="flex items-center gap-2 text-xs whitespace-nowrap text-muted-foreground"
        >
          <span aria-hidden="true" className={cn('size-2 rounded-full', dot)} />
          {text}
        </p>
      </div>
    </header>
  );
}
