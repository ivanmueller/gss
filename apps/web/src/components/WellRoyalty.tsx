import { CER_GJ_PER_E3M3, type WellMonthRoyalty } from '@grain/domain';
import { useEffect, useMemo, useState } from 'react';

import { apiJson } from '../lib/api';
import {
  blockText,
  blockedReasons,
  lastMonthsTotals,
  wellRoyalty,
  type RoyaltyWell,
} from '../lib/wellRoyalty';
import { PanelTiles } from './MapPanel';
import { useFrac } from './WellFrac';
import type { PricesAnswer } from './Prices';
import { monthLabel, useProductions, wellProductionPath } from './Production';

/**
 * A well's estimated Crown royalty, on its panel (F-285 part 4; the owner, 2026-11-23): each
 * month's rate from that month's prices and the well's own production, the royalty as rate ×
 * volume × price, and the effective rate (royalty ÷ value). An estimate: actual royalties paid
 * are confidential. What it assumes is written under it.
 */

/** The prices, read once in a visit for every well's panel. */
const pricesRead = new Map<string, Promise<PricesAnswer>>();

/** For tests: forget the prices read. */
export function clearRoyaltyPrices() {
  pricesRead.clear();
}

function usePricesAnswer(organizationId: string, token: string) {
  const [state, setState] = useState<{ answer: PricesAnswer | null; failed: boolean }>({
    answer: null,
    failed: false,
  });
  useEffect(() => {
    let live = true;
    let read = pricesRead.get(organizationId);
    if (!read) {
      read = apiJson<PricesAnswer>(
        `/petroleum/prices?organization_id=${encodeURIComponent(organizationId)}`,
        token,
      );
      pricesRead.set(organizationId, read);
      // A failed read is asked again on the next panel.
      read.catch(() => pricesRead.delete(organizationId));
    }
    read
      .then((answer) => {
        if (live) setState({ answer, failed: false });
      })
      .catch(() => {
        if (live) setState({ answer: null, failed: true });
      });
    return () => {
      live = false;
    };
  }, [organizationId, token]);
  return state;
}

const dollars = (amount: string) =>
  Number(amount).toLocaleString('en-CA', {
    style: 'currency',
    currency: 'CAD',
    maximumFractionDigits: 0,
  });
const percent = (pct: string | null) => (pct === null ? '—' : `${Number(pct).toFixed(1)}%`);

const PRODUCT_NAMES = { oil: 'oil', gas: 'gas', condensate: 'condensate' } as const;

/** Which rules the last estimated month fell under, in a sentence. */
function rulesLine(month: Extract<WellMonthRoyalty, { status: 'estimated' }>): string {
  if (month.framework === 'arf') {
    return 'Under the earlier rules (the 2009 royalty regulations) until December 2026; from January 2027 every well pays the modernized rules’ post-C* rates.';
  }
  if (month.framework === 'mrf_post_c_star') {
    return 'Under the modernized rules’ post-C* rates, as every well is from January 2027.';
  }
  return month.cStarPhase === 'pre'
    ? 'Under the modernized rules, still paying 5% until its revenue reaches its drilling and completion cost allowance (C*).'
    : 'Under the modernized rules, past its drilling and completion cost allowance (C*).';
}

export function WellRoyalty({
  well,
  uwis,
  legs,
  licence,
  organizationId,
  token,
}: {
  well: RoyaltyWell;
  /** Every leg of the well, added together. */
  uwis: readonly string[];
  /** Every leg's depths, the main leg among them, for C*. */
  legs?: readonly RoyaltyWell[];
  /** The well's licence, whose frac data gives C* its proppant (F-288). */
  licence: string;
  organizationId: string;
  token: string;
}) {
  const { answers, state } = useProductions(
    uwis.map((uwi) => wellProductionPath(organizationId, uwi)),
    token,
    250,
  );
  const prices = usePricesAnswer(organizationId, token);
  // Frac data that cannot be read leaves C* waiting; it never stops the older wells' estimate.
  const frac = useFrac(organizationId, token, licence);
  const fracReady = frac !== null;
  const result = useMemo(
    () =>
      answers && prices.answer && fracReady
        ? wellRoyalty(
            well,
            answers,
            prices.answer,
            frac === 'failed' ? null : frac,
            undefined,
            legs ?? [well],
          )
        : null,
    [well, legs, answers, prices.answer, frac, fracReady],
  );
  if (state === 'failed' || prices.failed) {
    return (
      <p className="text-xs text-muted-foreground">The royalty estimate could not be loaded.</p>
    );
  }
  if (!result) return <p className="text-xs text-muted-foreground">Royalty: loading…</p>;
  const { estimate, firstLoaded } = result;
  if (estimate.months.length === 0) {
    return <p className="text-xs text-muted-foreground">No production loaded, so no royalty.</p>;
  }
  const firstLabel = firstLoaded ? monthLabel(firstLoaded) : null;
  const estimated = estimate.months.filter(
    (m): m is Extract<WellMonthRoyalty, { status: 'estimated' }> => m.status === 'estimated',
  );
  const reasons = blockedReasons(estimate.months);
  const last = estimated.at(-1);
  const year = lastMonthsTotals(estimate.months, 12);
  const firstEstimated = estimated[0];
  const reasonList =
    reasons.length > 0 ? (
      <ul className="mt-2 flex flex-col gap-0.5 text-xs" aria-label="Months not estimated">
        {reasons.map(([reason, count]) => (
          <li key={reason}>
            {estimated.length > 0
              ? `${String(count)} ${count === 1 ? 'month' : 'months'} not estimated. `
              : ''}
            {blockText(reason, firstLabel)}
          </li>
        ))}
      </ul>
    ) : null;
  return (
    <div>
      {last && firstEstimated ? (
        <>
          <PanelTiles
            tiles={[
              {
                label: 'Effective rate',
                value: percent(year.effectivePct),
                title: `Royalty ÷ value over the last ${String(year.months)} months estimated`,
              },
              {
                label: `Royalty, ${String(year.months)} mo`,
                value: dollars(year.royaltyCad),
                title: `Of ${dollars(year.valueCad)} of production`,
              },
              {
                label: `Since ${monthLabel(firstEstimated.month)}`,
                value: dollars(estimate.royaltyCad),
                title: `Effective rate ${percent(estimate.effectivePct)} of ${dollars(estimate.valueCad)}`,
              },
            ]}
          />
          <p className="mt-2 text-xs">
            {monthLabel(last.month)}:{' '}
            {last.products
              .map((p) => `${PRODUCT_NAMES[p.product]} ${percent(p.ratePct)}`)
              .join(', ')}
            .
          </p>
        </>
      ) : null}
      {/* With nothing estimated, the reasons are the answer and stay in view. */}
      {!last && reasonList}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
          More info
        </summary>
        {last && <p className="mt-1 text-xs text-muted-foreground">{rulesLine(last)}</p>}
        {last && reasonList}
        <p className="mt-2 text-[0.6875rem] leading-snug text-muted-foreground">
          An estimate, as if all Crown land, before cost allowances; royalties actually paid are
          confidential. Gas is valued at {CER_GJ_PER_E3M3} GJ per 10³ m³ (the Canada Energy
          Regulator&rsquo;s standard conversion; Petrinex gives no energy for a well&rsquo;s gas)
          and rated as methane: liquids taken out at the plant are not counted. Oil at the light oil
          par price, the regulation&rsquo;s default without its density. The new-well programs of
          2011 to 2016 are not applied, so such a well&rsquo;s first months may read higher than it
          paid.
          {firstLabel ? ` Production from ${firstLabel} only.` : ''} Formulas: Government of Alberta
          (version {estimate.version}).
        </p>
      </details>
    </div>
  );
}
