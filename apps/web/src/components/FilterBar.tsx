import type { FacilityRole } from '../data/types';
import { SegmentedControl } from './ui/segmented-control';

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
      <SegmentedControl
        label="Show facilities"
        options={OPTIONS}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}
