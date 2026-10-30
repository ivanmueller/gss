import {
  COMMODITIES,
  commodityDirections,
  type CommodityDirection,
  type CommodityInterest,
} from '@grain/domain';
import { Pencil, Wheat } from 'lucide-react';
import { useState } from 'react';

import { ApiError, sendJson, type CounterpartyDetail } from '../lib/api';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardHeader, CardTitle } from './ui/card';

const HEADINGS: Record<CommodityDirection, string> = {
  buys: 'What they buy',
  sells: 'What they sell',
};
const SHORT: Record<CommodityDirection, string> = { buys: 'Buys', sells: 'Sells' };

const key = ({ commodity, direction }: CommodityInterest) => `${direction}:${commodity}`;

/** The directions shown: what its types allow, and any it already has listed. */
export function shownDirections(
  types: readonly string[],
  listed: readonly { direction: CommodityDirection }[],
): CommodityDirection[] {
  const allowed = commodityDirections(types);
  return (['buys', 'sells'] as const).filter(
    (direction) =>
      allowed.includes(direction) || listed.some((item) => item.direction === direction),
  );
}

/** What to add and remove to go from the listed commodities to the chosen ones. */
export function commodityChange(
  listed: ReadonlySet<string>,
  chosen: ReadonlySet<string>,
): { add: CommodityInterest[]; remove: CommodityInterest[] } {
  const parse = (item: string): CommodityInterest => {
    const [direction, commodity] = item.split(':') as [
      CommodityDirection,
      CommodityInterest['commodity'],
    ];
    return { commodity, direction };
  };
  return {
    add: [...chosen].filter((item) => !listed.has(item)).map(parse),
    remove: [...listed].filter((item) => !chosen.has(item)).map(parse),
  };
}

/**
 * What a counterparty buys and sells, on its page (owner's request, 2026-10-30): a list kept
 * by hand from the shared list of commodities. Anyone on the team can change it; nothing
 * changes on an archived counterparty.
 */
export function CounterpartyCommodities({
  token,
  detail,
  onSaved,
}: {
  token: string;
  detail: Pick<CounterpartyDetail, 'id' | 'types' | 'archivedAt' | 'commodities'>;
  /** After a save: the page shows its message and loads the counterparty again. */
  onSaved: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const directions = shownDirections(detail.types, detail.commodities);
  if (directions.length === 0) return null;
  const listed = new Set(
    detail.commodities.map((item) =>
      key({ commodity: item.code as CommodityInterest['commodity'], direction: item.direction }),
    ),
  );
  const canChange = detail.archivedAt === null;
  const title = directions.length === 1 ? HEADINGS[directions[0] ?? 'buys'] : 'Commodities';

  async function save() {
    const change = commodityChange(listed, chosen);
    if (change.add.length + change.remove.length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendJson(`/counterparties/${detail.id}/commodities`, token, 'PATCH', change);
      setEditing(false);
      onSaved('Commodities saved.');
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card asChild>
      <section aria-labelledby="commodities-heading">
        <CardHeader>
          <CardTitle id="commodities-heading">{title}</CardTitle>
          {canChange && !editing && (
            <Button
              size="sm"
              variant="outline"
              aria-label={`Edit ${title.toLowerCase()}`}
              onClick={() => {
                setChosen(new Set(listed));
                setError(null);
                setEditing(true);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit
            </Button>
          )}
        </CardHeader>

        {editing ? (
          <form
            aria-label={`Edit ${title.toLowerCase()}`}
            className="flex flex-col gap-4 bg-muted/40 px-4 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {directions.map((direction) => (
              <fieldset key={direction} className="flex flex-col gap-2">
                {directions.length > 1 && (
                  <legend className="mb-1 text-sm font-medium">{HEADINGS[direction]}</legend>
                )}
                <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {COMMODITIES.map(({ code, name }) => {
                    const item = key({ commodity: code, direction });
                    return (
                      <label key={code} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4 accent-primary"
                          disabled={busy}
                          checked={chosen.has(item)}
                          aria-label={directions.length > 1 ? `${SHORT[direction]} ${name}` : name}
                          onChange={(event) => {
                            const next = new Set(chosen);
                            if (event.target.checked) next.add(item);
                            else next.delete(item);
                            setChosen(next);
                          }}
                        />
                        {name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? 'Saving…' : 'Save commodities'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-3 px-4 py-4">
            {directions.map((direction) => {
              const items = detail.commodities.filter((item) => item.direction === direction);
              return (
                <div key={direction} className="flex flex-col gap-2">
                  {directions.length > 1 && (
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {HEADINGS[direction]}
                    </h3>
                  )}
                  {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">None listed yet.</p>
                  ) : (
                    <ul aria-label={HEADINGS[direction]} className="flex flex-wrap gap-1.5">
                      {items.map((item) => (
                        <li key={item.code}>
                          <Badge
                            variant={direction === 'buys' ? 'bid' : 'offer'}
                            className="px-2 py-1 text-sm"
                          >
                            <Wheat aria-hidden="true" />
                            {item.name}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </Card>
  );
}
