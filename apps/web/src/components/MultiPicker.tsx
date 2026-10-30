import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

export interface PickerOption {
  value: string;
  label: string;
}

function summary(chosen: readonly string[], options: readonly PickerOption[]): string {
  if (chosen.length === 0) return 'None';
  if (chosen.length === options.length) return 'All';
  if (chosen.length <= 2) {
    return options
      .filter((option) => chosen.includes(option.value))
      .map((option) => option.label)
      .join(', ');
  }
  return `${String(chosen.length)} of ${String(options.length)}`;
}

/**
 * Choose one, several or all of a list: the workspace's commodity picker, for any list
 * (commodities, markets, tiers on Counterparties; owner's request, 2026-10-30). The button
 * reads "Commodities: All", "Commodities: Canola, Oats" or "Commodities: 3 of 20".
 */
export function MultiPicker({
  label,
  icon,
  options,
  chosen,
  allLabel,
  onChange,
}: {
  /** What is chosen, e.g. "Commodities". */
  label: string;
  icon: ReactNode;
  /** Every choice, in display order. */
  options: readonly PickerOption[];
  /** The chosen values, in the same order. */
  chosen: readonly string[];
  /** The first item, which chooses all or none, e.g. "All commodities". */
  allLabel: string;
  onChange: (chosen: string[]) => void;
}) {
  const all = chosen.length === options.length;
  const toggle = (value: string) => {
    const next = new Set(chosen);
    if (!next.delete(value)) next.add(value);
    onChange(options.filter((option) => next.has(option.value)).map((option) => option.value));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="justify-between gap-3"
          aria-label={`${label}: ${summary(chosen, options)}`}
        >
          <span className="flex items-center gap-2">
            {icon}
            <span>
              <span className="text-muted-foreground">{label}: </span>
              {summary(chosen, options)}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-60 overflow-y-auto">
        <DropdownMenuCheckboxItem
          checked={all ? true : chosen.length === 0 ? false : 'indeterminate'}
          onSelect={() => {
            onChange(all ? [] : options.map((option) => option.value));
          }}
        >
          {allLabel}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.value}
            checked={chosen.includes(option.value)}
            onSelect={() => {
              toggle(option.value);
            }}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
