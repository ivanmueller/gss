// Alberta's royalty prices on the oil and gas map's side card (F-285 part 2): every price the
// "Load prices" workflow stored, one small chart a series, a product at a time. Nothing is drawn
// on the map. Prices are shown as the province wrote them; the charts draw them as numbers only.
import { useEffect, useMemo, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import { FilterChip, MapSection, SIDE_LABEL } from './MapSide';
import { monthLabel } from './Production';

type PricePoint = [month: string, price: string, source: number];

export interface PricesAnswer {
  load: {
    loadedAt: string;
    prices: number;
    firstMonth: string | null;
    lastMonth: string | null;
    unread: number;
  } | null;
  sources: string[];
  series: { key: string; name: string; unit: string; points: PricePoint[] }[];
}

/** The products, each with its series as the province names them, older and newer apart. */
export const PRICE_GROUPS = [
  { key: 'gas', name: 'Gas', series: ['gas_reference', 'ethane_reference', 'ethane_par'] },
  {
    key: 'oil',
    name: 'Oil',
    series: ['oil_light_par', 'oil_medium_par', 'oil_heavy_par', 'oil_ultra_heavy_par'],
  },
  {
    key: 'propane',
    name: 'Propane',
    series: [
      'propane_spec_reference',
      'propane_mix_reference',
      'propane_reference',
      'propane_floor',
      'propane_par',
    ],
  },
  {
    key: 'butanes',
    name: 'Butanes',
    series: [
      'butanes_spec_reference',
      'butanes_mix_reference',
      'butanes_reference',
      'butanes_floor',
      'butanes_par',
    ],
  },
  {
    key: 'pentanes',
    name: 'Pentanes plus',
    series: [
      'pentanes_plus_spec_reference',
      'pentanes_plus_mix_reference',
      'pentanes_plus_reference',
      'pentanes_plus_par',
    ],
  },
  { key: 'sulphur', name: 'Sulphur', series: ['sulphur_default'] },
] as const;

type GroupKey = (typeof PRICE_GROUPS)[number]['key'];

export const PRICE_PERIODS = [
  { key: '5', label: '5 years', years: 5 },
  { key: '15', label: '15 years', years: 15 },
  { key: 'all', label: 'Since 1994', years: null },
] as const;

type PeriodKey = (typeof PRICE_PERIODS)[number]['key'];

/** Every month from `first` to `last` (YYYY-MM), both included. */
export function monthsBetween(first: string, last: string): string[] {
  const out: string[] = [];
  let [y, m] = first.split('-').map(Number) as [number, number];
  const [ly, lm] = last.split('-').map(Number) as [number, number];
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${String(y)}-${String(m).padStart(2, '0')}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** The first month of a period that ends at `last`: the same month `years` earlier, plus one. */
export function periodStart(last: string, years: number | null): string | null {
  if (years === null) return null;
  const [y, m] = last.split('-').map(Number) as [number, number];
  const month = m === 12 ? 1 : m + 1;
  const year = m === 12 ? y - years + 1 : y - years;
  return `${String(year)}-${String(month).padStart(2, '0')}`;
}

/** The unit for reading: "$/m3" → "$/m³". */
const unitText = (unit: string) => unit.replace('m3', 'm³');

const W = 260;
const H = 40;

/** The line of the months that have a price, broken where a month has none. */
export function pricePath(values: readonly (number | null)[], min: number, max: number): string {
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  const span = max - min;
  let path = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = Math.round(i * step * 10) / 10;
    const y = Math.round((H - 1 - (span > 0 ? (v - min) / span : 0.5) * (H - 3)) * 10) / 10;
    const alone = !pen && (values[i + 1] ?? null) === null;
    path += `${pen ? 'L' : 'M'}${String(x)} ${String(y)}${alone ? `L${String(x)} ${String(y)}` : ''}`;
    pen = true;
  });
  return path;
}

function PriceChart({
  name,
  unit,
  months,
  prices,
  at,
  onAt,
}: {
  name: string;
  unit: string;
  months: readonly string[];
  /** The price as written for each month, null where the province published none. */
  prices: readonly (string | null)[];
  at: number | null;
  onAt: (index: number | null) => void;
}) {
  const values = prices.map((p) => (p === null ? null : Number(p)));
  const known = values.filter((v): v is number => v !== null);
  // From zero, unless a price is below it (a differential); a flat line sits in the middle.
  const min = Math.min(0, ...known);
  const max = Math.max(0, ...known);
  const last = values.reduce<number>((found, v, i) => (v === null ? found : i), -1);
  const shown = at ?? last;
  const price = shown >= 0 ? (prices[shown] ?? null) : null;
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  const value = shown >= 0 ? (values[shown] ?? null) : null;
  const span = max - min;
  const y = value === null ? null : H - 1 - (span > 0 ? (value - min) / span : 0.5) * (H - 3);
  const missing = values.filter((v) => v === null).length;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">
          {name} <span className="font-normal text-muted-foreground">{unitText(unit)}</span>
        </span>
        <span className="text-muted-foreground tabular-nums">
          {shown >= 0 && months[shown] ? `${monthLabel(months[shown])}: ` : ''}
          <span className="text-foreground">{price === null ? 'none published' : `$${price}`}</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="mt-0.5 block h-10 w-full overflow-visible text-foreground"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${name}, ${unitText(unit)}, ${months[0] ? monthLabel(months[0]) : ''} to ${
          months.at(-1) ? monthLabel(months.at(-1) ?? '') : ''
        }; highest ${known.length > 0 ? String(Math.max(...known)) : 'none'}, lowest ${
          known.length > 0 ? String(Math.min(...known)) : 'none'
        }${missing > 0 ? `; ${String(missing)} months not published` : ''}`}
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
          onAt(Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1)))));
        }}
        onPointerLeave={() => {
          onAt(null);
        }}
      >
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="currentColor" strokeOpacity="0.2" />
        <path
          d={pricePath(values, min, max)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {at !== null && (
          <line
            x1={at * step}
            x2={at * step}
            y1="0"
            y2={H}
            stroke="currentColor"
            strokeOpacity="0.35"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {at !== null && y !== null && <circle cx={at * step} cy={y} r="2.5" fill="currentColor" />}
      </svg>
    </div>
  );
}

export interface Prices {
  section: (props: { open: boolean; onToggle: () => void }) => React.ReactNode;
  about: () => React.ReactNode;
}

export function usePrices(organizationId: string, token: string): Prices {
  // Off when the map opens (F-284): asked for once it is switched on.
  const [on, setOn] = useState(false);
  const [answer, setAnswer] = useState<PricesAnswer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [group, setGroup] = useState<GroupKey>('gas');
  const [period, setPeriod] = useState<PeriodKey>('5');
  const [at, setAt] = useState<number | null>(null);

  const wanted = on && answer === null;
  useEffect(() => {
    if (!wanted) return;
    const controller = new AbortController();
    apiJson<PricesAnswer>(
      `/petroleum/prices?organization_id=${encodeURIComponent(organizationId)}`,
      token,
      { signal: controller.signal },
    )
      .then((got) => {
        setAnswer(got);
        setProblem(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProblem(
          error instanceof ApiError && error.code === 'PETROLEUM_NOT_READY'
            ? 'The oil and gas database is being updated. Try again in a few minutes.'
            : 'The prices could not be loaded. Try again later.',
        );
      });
    return () => {
      controller.abort();
    };
  }, [wanted, organizationId, token]);

  const chosen = PRICE_GROUPS.find((g) => g.key === group) ?? PRICE_GROUPS[0];
  const view = useMemo(() => {
    if (!answer) return null;
    const bySeries = new Map(answer.series.map((s) => [s.key, s]));
    const list = chosen.series.flatMap((key) => {
      const s = bySeries.get(key);
      return s && s.points.length > 0 ? [s] : [];
    });
    const all = list.flatMap((s) => s.points.map((p) => p[0])).sort();
    const first = all[0];
    const last = all.at(-1);
    if (first === undefined || last === undefined) return { months: [], charts: [] };
    const years = PRICE_PERIODS.find((p) => p.key === period)?.years ?? null;
    const start = periodStart(last, years);
    const months = monthsBetween(start !== null && start > first ? start : first, last);
    const charts = list
      .map((s) => {
        const byMonth = new Map(s.points.map((p) => [p[0], p]));
        return {
          key: s.key,
          name: s.name,
          unit: s.unit,
          prices: months.map((m) => byMonth.get(m)?.[1] ?? null),
          sources: months.map((m) => {
            const p = byMonth.get(m);
            return p ? (answer.sources[p[2]] ?? null) : null;
          }),
        };
      })
      // A series with no price in the period (an older name) is left out of it.
      .filter((c) => c.prices.some((p) => p !== null));
    return { months, charts };
  }, [answer, chosen, period]);

  const pointed = at !== null && view ? (view.months[at] ?? null) : null;
  const pointedSource =
    at !== null && view ? (view.charts.map((c) => c.sources[at]).find((s) => s) ?? null) : null;
  const recent = view ? view.months.slice(-12).reverse() : [];

  const section = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <MapSection title="Prices" open={open} onToggle={onToggle} on={on} onSwitch={setOn}>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {answer?.load === null && (
        <p className="text-xs text-muted-foreground">
          Not loaded yet: an admin runs Load prices (GitHub → Actions).
        </p>
      )}
      {answer?.load && view && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className={SIDE_LABEL}>Product</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Product shown">
              {PRICE_GROUPS.map((g) => (
                <FilterChip
                  key={g.key}
                  pressed={group === g.key}
                  onClick={() => {
                    setGroup(g.key);
                    setAt(null);
                  }}
                >
                  {g.name}
                </FilterChip>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period shown">
            {PRICE_PERIODS.map((p) => (
              <FilterChip
                key={p.key}
                plain
                pressed={period === p.key}
                onClick={() => {
                  setPeriod(p.key);
                  setAt(null);
                }}
              >
                {p.label}
              </FilterChip>
            ))}
          </div>
          {view.charts.length === 0 ? (
            <p className="text-xs text-muted-foreground">No prices published for this product.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {view.charts.map((c) => (
                <PriceChart
                  key={c.key}
                  name={c.name}
                  unit={c.unit}
                  months={view.months}
                  prices={c.prices}
                  at={at}
                  onAt={setAt}
                />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            {pointed && pointedSource ? (
              <>
                {monthLabel(pointed)}:{' '}
                <a
                  href={pointedSource}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-foreground"
                >
                  the province’s page
                </a>
                .{' '}
              </>
            ) : null}
            A gap is a month the province published no price for. Source: Government of Alberta; not
            the official version.
          </p>
          {view.charts.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
                The last 12 months as a table
              </summary>
              <table className="mt-2 w-full tabular-nums">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-0.5 pr-2 font-normal">Month</th>
                    {view.charts.map((c) => (
                      <th key={c.key} className="py-0.5 pr-2 font-normal">
                        {c.name.replace(/ price$/, '')}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((m) => {
                    const i = view.months.indexOf(m);
                    return (
                      <tr key={m}>
                        <td className="py-0.5 pr-2 text-muted-foreground">{monthLabel(m)}</td>
                        {view.charts.map((c) => (
                          <td key={c.key} className="py-0.5 pr-2">
                            {c.prices[i] ?? '–'}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}
    </MapSection>
  );

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Prices.</strong> The Government of Alberta’s
      royalty prices, as it publishes them: the gas reference price since 1994, the reference, par
      and floor prices of the gas liquids and sulphur from its monthly reference price calculations
      (open.alberta.ca, Open Government Licence – Alberta), and the oil par prices since 2012 from
      its information letters (alberta.ca, for non-commercial use). Not the official version; a
      month the province did not publish, or published only as a picture, is left blank.
    </p>
  );

  return { section, about };
}
