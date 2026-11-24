import { useEffect, useState } from 'react';

import { apiJson } from '../lib/api';
import { addTonnes, type FracAnswer } from '../lib/wellRoyalty';
import { PanelTiles } from './MapPanel';

/**
 * A well's fracs on its panel (F-288): when it was fractured, its stages, water and proppant,
 * from the AER's frac data (Directive 059), the licence's well events together. The same answer
 * feeds the royalty's C* (WellRoyalty).
 */

/** The answers read in this visit, by licence: a panel opened again asks nothing. */
const fracRead = new Map<string, Promise<FracAnswer>>();

/** For tests: forget the answers read. */
export function clearFrac() {
  fracRead.clear();
}

/** The licence's frac data: null while it loads, 'failed' when it could not be read. */
export function useFrac(
  organizationId: string,
  token: string,
  licence: string,
): FracAnswer | null | 'failed' {
  const key = `${organizationId}|${licence}`;
  const [state, setState] = useState<{ key: string; value: FracAnswer | 'failed' } | null>(null);
  useEffect(() => {
    let live = true;
    let read = fracRead.get(key);
    if (!read) {
      read = apiJson<FracAnswer>(
        `/petroleum/frac/licence?${new URLSearchParams({ organization_id: organizationId, licence }).toString()}`,
        token,
      );
      fracRead.set(key, read);
      read.catch(() => fracRead.delete(key));
    }
    read
      .then((value) => {
        if (live) setState({ key, value });
      })
      .catch(() => {
        if (live) setState({ key, value: 'failed' });
      });
    return () => {
      live = false;
    };
  }, [key, organizationId, token, licence]);
  return state?.key === key ? state.value : null;
}

const tonnes = (t: string) =>
  `${Number(t).toLocaleString('en-CA', { maximumFractionDigits: 0 })} t`;
const cubic = (m3: string) =>
  `${Number(m3).toLocaleString('en-CA', { maximumFractionDigits: 0 })} m³`;

export function WellFrac({
  organizationId,
  token,
  licence,
}: {
  organizationId: string;
  token: string;
  licence: string;
}) {
  const frac = useFrac(organizationId, token, licence);
  if (frac === 'failed') {
    return <p className="text-xs text-muted-foreground">The frac data could not be loaded.</p>;
  }
  if (frac === null) return <p className="text-xs text-muted-foreground">Frac: loading…</p>;
  if (!frac.source.loadedAt) {
    return (
      <p className="text-xs text-muted-foreground">
        The AER&rsquo;s frac data is not loaded yet: GitHub → Actions → Load frac data.
      </p>
    );
  }
  if (frac.wells.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No frac reported to the AER for this licence (reports from 2013 on).
      </p>
    );
  }
  const first = frac.wells.map((w) => w.firstFracDate).sort()[0] ?? '';
  const last =
    frac.wells
      .map((w) => w.lastFracDate)
      .sort()
      .at(-1) ?? '';
  const stages = frac.wells.reduce<number | null>(
    (sum, w) => (w.stages === null ? sum : (sum ?? 0) + w.stages),
    null,
  );
  const proppant = addTonnes(frac.wells.map((w) => w.proppantT));
  const hinted = addTonnes(frac.wells.map((w) => w.upgradeHintT));
  const refrac = addTonnes(frac.wells.map((w) => w.refracProppantT));
  const water = addTonnes(frac.wells.map((w) => w.waterM3));
  const suspect = frac.wells.some((w) => w.suspect);
  return (
    <div>
      <PanelTiles
        tiles={[
          {
            label: 'Fractured',
            value: first,
            title: last !== first ? `Last frac ${last}` : undefined,
          },
          { label: 'Stages', value: stages === null ? '—' : String(stages) },
          { label: 'Proppant', value: tonnes(proppant), title: `Water ${cubic(water)}` },
        ]}
      />
      <p className="mt-2 text-xs">
        Water {cubic(water)}
        {refrac !== '0' ? ` · re-fractured later with ${tonnes(refrac)}` : ''}
        {frac.wells.length > 1 ? ` · ${String(frac.wells.length)} legs reported` : ''}.
      </p>
      {suspect && (
        <p className="mt-1 text-xs">
          The proppant reported is more than 1,000 t a stage, which reads as a reporting error.
        </p>
      )}
      {hinted !== '0' && (
        <p className="mt-1 text-xs text-muted-foreground">
          {tonnes(hinted)} of it is named as coated or ceramic, which the royalty may count at more
          than sand (×1.5 or ×2.5) if the province accepted it; here every tonne counts as sand.
        </p>
      )}
      <p className="mt-2 text-[0.6875rem] leading-snug text-muted-foreground">
        Source: Alberta Energy Regulator, Hydraulic Fracturing Summary Chemical and Water Use Data
        (Directive 059){frac.source.sourceDate ? `, file of ${frac.source.sourceDate}` : ''}; not an
        official version. The first completion is every frac within a year of the first.
      </p>
    </div>
  );
}
