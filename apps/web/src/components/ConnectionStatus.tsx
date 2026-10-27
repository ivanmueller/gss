import type { ApiHealth } from '../lib/useApiHealth';
import { cn } from '../lib/utils';

const STATE = {
  checking: { label: 'Checking the connection to the server', dot: 'bg-muted-foreground' },
  ok: { label: 'Connected to the server', dot: 'bg-success' },
  unreachable: {
    label: 'Server unreachable: the app cannot load or save data. Reload to try again.',
    dot: 'bg-danger',
  },
} as const;

/**
 * A dot in the top bar: green when the server answers, red when it does not. A problem also
 * shows the words "Server unreachable", so colour is not the only signal; screen readers hear
 * the full sentence.
 */
export function ConnectionStatus({ health }: { health: ApiHealth }) {
  const { label, dot } = STATE[health];
  const down = health === 'unreachable';
  return (
    <p
      role="status"
      title={label}
      className={cn(
        'flex h-8 items-center gap-2 rounded-full text-xs font-medium',
        down && 'border border-danger-border bg-danger-subtle px-2.5 text-danger',
      )}
    >
      <span aria-hidden="true" className="relative flex size-2.5">
        {down && (
          <span className="absolute inset-0 animate-ping rounded-full bg-danger opacity-60 motion-reduce:hidden" />
        )}
        <span className={cn('relative size-2.5 rounded-full', dot)} />
      </span>
      <span className="sr-only">{label}</span>
      {down && <span aria-hidden="true">Server unreachable</span>}
    </p>
  );
}
