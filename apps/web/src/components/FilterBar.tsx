import type { FacilityRole } from '../data/types';
import { cn } from '../lib/utils';

export type RoleFilter = 'all' | FacilityRole;

const OPTIONS: readonly { value: RoleFilter; label: string }[] = [
  { value: 'all', label: 'All facilities' },
  { value: 'seller', label: 'Sellers' },
  { value: 'buyer', label: 'Buyers' },
];

export function FilterBar({
  value,
  onChange,
}: {
  value: RoleFilter;
  onChange: (value: RoleFilter) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="text-sm">
        <span className="text-muted-foreground">Commodity </span>
        <span className="font-medium">Flaxseed</span>
      </p>
      <div
        role="group"
        aria-label="Show facilities"
        className="inline-flex rounded-lg border bg-card p-0.5"
      >
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              'rounded-md px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
              value === option.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
