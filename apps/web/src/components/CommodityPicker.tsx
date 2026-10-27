import { ChevronDown, Wheat } from 'lucide-react';

import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

function summary(chosen: readonly string[], all: readonly string[]): string {
  if (chosen.length === 0) return 'None';
  if (chosen.length === all.length) return 'All';
  if (chosen.length <= 2) return chosen.join(', ');
  return `${String(chosen.length)} of ${String(all.length)}`;
}

/**
 * Choose one, several or all commodities. The page shows only what trades in the chosen
 * ones: map pins, the order book and the facility list.
 */
export function CommodityPicker({
  commodities,
  chosen,
  onChange,
}: {
  /** Every commodity that can be chosen, in display order. */
  commodities: readonly string[];
  /** The chosen ones, in the same order. */
  chosen: readonly string[];
  onChange: (chosen: string[]) => void;
}) {
  const all = chosen.length === commodities.length;
  const toggle = (commodity: string) => {
    const next = new Set(chosen);
    if (!next.delete(commodity)) next.add(commodity);
    onChange(commodities.filter((item) => next.has(item)));
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="justify-between gap-3"
          aria-label={`Commodities: ${summary(chosen, commodities)}`}
        >
          <span className="flex items-center gap-2">
            <Wheat aria-hidden="true" className="text-muted-foreground" />
            <span>
              <span className="text-muted-foreground">Commodities: </span>
              {summary(chosen, commodities)}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuCheckboxItem
          checked={all ? true : chosen.length === 0 ? false : 'indeterminate'}
          onSelect={() => {
            onChange(all ? [] : [...commodities]);
          }}
        >
          All commodities
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {commodities.map((commodity) => (
          <DropdownMenuCheckboxItem
            key={commodity}
            checked={chosen.includes(commodity)}
            onSelect={() => {
              toggle(commodity);
            }}
          >
            {commodity}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
