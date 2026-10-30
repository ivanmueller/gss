import { Wheat } from 'lucide-react';

import { MultiPicker } from './MultiPicker';

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
  return (
    <MultiPicker
      label="Commodities"
      icon={<Wheat aria-hidden="true" className="text-muted-foreground" />}
      options={commodities.map((commodity) => ({ value: commodity, label: commodity }))}
      chosen={chosen}
      allLabel="All commodities"
      onChange={onChange}
    />
  );
}
