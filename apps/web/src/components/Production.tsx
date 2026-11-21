import { petrinexMonths } from '@grain/domain';
import { useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';

/**
 * Monthly production on the oil and gas map (F-252 step 3): a well's months on its card, and the
 * formation's total by month in the Wells panel. Petrinex's public data, used on the owner's
 * decision (docs/DECISIONS.md, 2026-11-20): its name and Crown copyright are shown, and nothing
 * here offers a download. Every number is a volume as published; nothing is estimated.
 *
 * One small chart per product, each on its own scale: oil, condensate and water are in m³, gas
 * in 10³ m³, so they never share an axis.
 */

export type Product = 'oil' | 'gas' | 'condensate' | 'water';

export interface ProductionMonth {
  month: string;
  oil: number | null;
  gas: number | null;
  water: number | null;
  condensate: number | null;
  hours?: number | null;
  wells?: number;
}

export interface ProductionAnswer {
  source: {
    name: string;
    loadedAt: string | null;
    firstMonth: string | null;
    lastMonth: string | null;
  };
  months: ProductionMonth[];
}

export const PRODUCTS: readonly { key: Product; label: string; unit: string }[] = [
  { key: 'oil', label: 'Oil', unit: 'm³' },
  { key: 'gas', label: 'Gas', unit: '10³ m³' },
  { key: 'condensate', label: 'Condensate', unit: 'm³' },
  { key: 'water', label: 'Water', unit: 'm³' },
];

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** "2026-08" → "Aug 2026". */
export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  return `${MONTH_NAMES[Number(m) - 1] ?? ''} ${year ?? ''}`.trim();
}

/** A volume for reading: whole numbers from 100 up, one decimal below. */
export function volumeText(value: number): string {
  return value.toLocaleString('en-CA', { maximumFractionDigits: value >= 100 ? 0 : 1 });
}

/**
 * One product over every month of the load: the value of each month (null where the well, or
 * the formation, has no line that month), and their sum.
 */
export function productSeries(
  answer: ProductionAnswer,
  product: Product,
): { months: string[]; values: (number | null)[]; total: number; any: boolean } {
  const { firstMonth, lastMonth } = answer.source;
  const byMonth = new Map(answer.months.map((m) => [m.month, m[product]]));
  const months =
    firstMonth && lastMonth
      ? petrinexMonths(firstMonth, lastMonth)
      : answer.months.map((m) => m.month);
  const values = months.map((m) => byMonth.get(m) ?? null);
  let total = 0;
  for (const v of values) total += v ?? 0;
  return { months, values, total, any: values.some((v) => v !== null && v > 0) };
}

const W = 260;
const H = 40;

/**
 * The line of the months that have a value, broken where a month has none. A month alone
 * between two empty ones is drawn as a dot (a line to itself, with the line's round ends).
 */
export function seriesPath(values: readonly (number | null)[], max: number): string {
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  let path = '';
  let pen = false;
  values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const x = Math.round(i * step * 10) / 10;
    const y = Math.round((H - 1 - (max > 0 ? v / max : 0) * (H - 3)) * 10) / 10;
    const alone = !pen && (values[i + 1] ?? null) === null;
    path += `${pen ? 'L' : 'M'}${String(x)} ${String(y)}${alone ? `L${String(x)} ${String(y)}` : ''}`;
    pen = true;
  });
  return path;
}

function MiniSeries({
  label,
  unit,
  months,
  values,
  at,
  onAt,
  marks = [],
}: {
  label: string;
  unit: string;
  months: readonly string[];
  values: readonly (number | null)[];
  /** The month pointed at, shared by the charts of one group; null when none. */
  at: number | null;
  onAt?: (index: number | null) => void;
  /** Months marked with a thin dashed line: where another leg of the well starts (F-258). */
  marks?: readonly number[];
}) {
  const max = Math.max(0, ...values.map((v) => v ?? 0));
  const last = values.reduce<number>((found, v, i) => (v === null ? found : i), -1);
  const shown = at ?? last;
  const value = shown >= 0 ? (values[shown] ?? null) : null;
  const step = values.length > 1 ? W / (values.length - 1) : 0;
  const y = value === null ? null : H - 1 - (max > 0 ? value / max : 0) * (H - 3);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">
          {label} <span className="font-normal text-muted-foreground">{unit} a month</span>
        </span>
        <span className="text-muted-foreground tabular-nums">
          {shown >= 0 && months[shown] ? `${monthLabel(months[shown])}: ` : ''}
          <span className="text-foreground">{value === null ? 'none' : volumeText(value)}</span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        className="mt-0.5 block h-10 w-full overflow-visible text-foreground"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}, ${unit} a month, ${months[0] ? monthLabel(months[0]) : ''} to ${
          months.at(-1) ? monthLabel(months.at(-1) ?? '') : ''
        }; highest month ${volumeText(max)}`}
        onPointerMove={
          onAt &&
          ((event) => {
            const box = event.currentTarget.getBoundingClientRect();
            const ratio = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
            onAt(Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1)))));
          })
        }
        onPointerLeave={
          onAt &&
          (() => {
            onAt(null);
          })
        }
      >
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="currentColor" strokeOpacity="0.2" />
        {marks.map((index) => (
          <line
            key={index}
            data-leg-start={months[index]}
            x1={index * step}
            x2={index * step}
            y1="0"
            y2={H}
            stroke="currentColor"
            strokeOpacity="0.45"
            strokeDasharray="2 2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path
          d={seriesPath(values, max)}
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

/** The charts of the products that have any volume, with one month pointed at in all of them. */
export function ProductionCharts({
  answer,
  interactive,
  starts = [],
}: {
  answer: ProductionAnswer;
  interactive: boolean;
  /** The months another leg of the well starts producing, marked on every chart (F-258). */
  starts?: readonly string[];
}) {
  const [at, setAt] = useState<number | null>(null);
  const series = useMemo(
    () => PRODUCTS.map((p) => ({ ...p, ...productSeries(answer, p.key) })).filter((s) => s.any),
    [answer],
  );
  if (series.length === 0) return null;
  const months = series[0]?.months ?? [];
  const marks = starts.map((month) => months.indexOf(month)).filter((index) => index > 0);
  return (
    <div className="flex flex-col gap-2">
      {series.map((s) => (
        <MiniSeries
          key={s.key}
          label={s.label}
          unit={s.unit}
          months={s.months}
          values={s.values}
          at={interactive ? at : null}
          marks={marks}
          {...(interactive && { onAt: setAt })}
        />
      ))}
      <div className="flex justify-between text-[0.6875rem] text-muted-foreground tabular-nums">
        <span>{months[0] ? monthLabel(months[0]) : ''}</span>
        <span>{months.at(-1) ? monthLabel(months.at(-1) ?? '') : ''}</span>
      </div>
    </div>
  );
}

interface Loaded {
  key: string;
  failed: boolean;
}

/** Answers already read in this visit, by address: pointing at a well again asks nothing. */
const cache = new Map<string, ProductionAnswer>();

/**
 * Reads production answers (one address each) after a short wait, so passing over wells asks for
 * none of them. All of them, or none: a well's total is never shown with a leg missing.
 */
function useProductions(paths: readonly string[], token: string, waitMs: number) {
  const key = paths.join('\n');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    const missing = key === '' ? [] : key.split('\n').filter((path) => !cache.has(path));
    if (missing.length === 0) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      Promise.all(
        missing.map((path) =>
          apiJson<ProductionAnswer>(path, token, { signal: controller.signal }).then((answer) => {
            cache.set(path, answer);
          }),
        ),
      )
        .then(() => {
          setLoaded({ key, failed: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) setLoaded({ key, failed: true });
        });
    }, waitMs);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, token, waitMs]);
  if (paths.length === 0) return { answers: null, state: 'idle' as const };
  const answers = paths.flatMap((path) => cache.get(path) ?? []);
  if (answers.length === paths.length) return { answers, state: 'ok' as const };
  if (loaded?.key === key && loaded.failed) return { answers: null, state: 'failed' as const };
  return { answers: null, state: 'loading' as const };
}

function useProduction(path: string | null, token: string, waitMs: number) {
  const { answers, state } = useProductions(path === null ? [] : [path], token, waitMs);
  const answer = answers?.[0];
  if (answer) return { answer, state: 'ok' as const };
  return { answer: null, state: state === 'ok' ? ('loading' as const) : state };
}

/**
 * A well's production: its legs' months added together (F-258). A month is empty only when no
 * leg has a line; `starts` are the months a leg begins producing after another already has.
 */
export function productionTotal(answers: readonly ProductionAnswer[]): {
  answer: ProductionAnswer | null;
  starts: string[];
} {
  const [first] = answers;
  if (!first) return { answer: null, starts: [] };
  const add = (a: number | null, b: number | null) =>
    a === null ? b : b === null ? a : Math.round((a + b) * 1000) / 1000;
  const byMonth = new Map<string, ProductionMonth>();
  const begins: string[] = [];
  for (const { months } of answers) {
    const begin = months.map((m) => m.month).sort()[0];
    if (begin !== undefined) begins.push(begin);
    for (const m of months) {
      const sum = byMonth.get(m.month);
      byMonth.set(
        m.month,
        sum
          ? {
              month: m.month,
              oil: add(sum.oil, m.oil),
              gas: add(sum.gas, m.gas),
              water: add(sum.water, m.water),
              condensate: add(sum.condensate, m.condensate),
            }
          : { month: m.month, oil: m.oil, gas: m.gas, water: m.water, condensate: m.condensate },
      );
    }
  }
  begins.sort();
  return {
    answer: {
      source: first.source,
      months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    },
    // The first leg to produce starts the well; each later one is a new leg starting.
    starts: [...new Set(begins.slice(1))].filter((month) => month !== begins[0]),
  };
}

/** For tests: forget the answers read. */
export function clearProductionCache() {
  cache.clear();
}

/**
 * A well's monthly production, on its card: one leg's, or several legs' added together with a
 * mark where a later leg starts (F-258).
 */
export function WellProduction({
  uwis,
  organizationId,
  token,
  interactive = false,
}: {
  /** The legs to add together: every leg of the well, or the one chosen. */
  uwis: readonly string[];
  organizationId: string;
  token: string;
  /** Whether pointing at a chart shows that month (a card kept open). */
  interactive?: boolean;
}) {
  const { answers, state } = useProductions(
    uwis.map(
      (uwi) =>
        `/petroleum/production/well?${new URLSearchParams({ organization_id: organizationId, uwi }).toString()}`,
    ),
    token,
    250,
  );
  const { answer, starts } = useMemo(() => productionTotal(answers ?? []), [answers]);
  if (state === 'loading') {
    return <p className="mt-2 text-xs text-muted-foreground">Production: loading…</p>;
  }
  if (state === 'failed') {
    return <p className="mt-2 text-xs text-muted-foreground">Production could not be loaded.</p>;
  }
  if (!answer?.source.loadedAt) return null;
  const { firstMonth } = answer.source;
  if (answer.months.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        No production reported{firstMonth ? ` since ${monthLabel(firstMonth)}` : ''}.
      </p>
    );
  }
  return (
    <div className="mt-2 border-t pt-2">
      <ProductionCharts answer={answer} interactive={interactive} starts={starts} />
    </div>
  );
}

/** The formation's total production by month, in the Wells panel. */
export function FormationProduction({
  formation,
  name,
  organizationId,
  token,
}: {
  /** The play's key ("duvernay"). */
  formation: string;
  name: string;
  organizationId: string;
  token: string;
}) {
  const query = new URLSearchParams({ organization_id: organizationId, formation });
  const { answer, state } = useProduction(
    `/petroleum/production/formation?${query.toString()}`,
    token,
    0,
  );
  if (state !== 'ok' || !answer.source.loadedAt || answer.months.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {name} production
      </p>
      <ProductionCharts answer={answer} interactive />
    </div>
  );
}

/**
 * What the formation's charts show and where the numbers come from, for the panel's "About this
 * data" (Petrinex's terms ask that Crown copyright be acknowledged). Nothing before a load.
 */
export function FormationProductionAbout({
  formation,
  organizationId,
  token,
}: {
  formation: string;
  organizationId: string;
  token: string;
}) {
  const query = new URLSearchParams({ organization_id: organizationId, formation });
  const { answer, state } = useProduction(
    `/petroleum/production/formation?${query.toString()}`,
    token,
    0,
  );
  if (state !== 'ok' || !answer.source.loadedAt || answer.months.length === 0) return null;
  const { firstMonth, lastMonth } = answer.source;
  const wells = answer.months.at(-1)?.wells;
  return (
    <p>
      Production: the total of the formation's wells, by month
      {firstMonth && lastMonth ? `, ${monthLabel(firstMonth)} to ${monthLabel(lastMonth)}` : ''}
      {wells !== undefined ? `; ${wells.toLocaleString('en-CA')} wells in the last month` : ''}.
      Point at a chart for a month.
      {firstMonth
        ? ` A well drilled before ${monthLabel(firstMonth)} shows only its production since then.`
        : ''}{' '}
      {answer.source.name}. Not an official record.
    </p>
  );
}
