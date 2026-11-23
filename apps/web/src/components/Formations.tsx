import { FORMATION_OUTLINES } from '@grain/domain';
import { useEffect, useMemo, useState } from 'react';

import { FORMATION_COLOURS, type FormationsView } from '../lib/formationsMap';
import { LegendTitle, MapSection, SwitchRow } from './MapSide';

// The Formations section of the oil and gas map (F-280; the owner, 2026-11-23: "Add a section
// called formations. This will be where each formation can be turned on and off but it won't be
// connected to the wells & licences section"). Each formation's outline is a file kept with the
// app (apps/web/public/outlines/, made by scripts/build-formation-outlines.js), fetched the first
// time it is switched on. The Duvernay starts on, as its outline was drawn before.

/** The formations on when the map opens. */
export const FORMATIONS_AT_START: ReadonlySet<string> = new Set(['duvernay']);

export const formationUrl = (key: string) => `/outlines/${key}.geojson`;

/** The outlines switched on and fetched, each feature marked with its formation's key. */
export function formationFeatures(
  on: ReadonlySet<string>,
  fetched: ReadonlyMap<string, GeoJSON.FeatureCollection>,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: FORMATION_OUTLINES.filter((f) => on.has(f.key)).flatMap((f) =>
      (fetched.get(f.key)?.features ?? []).map((feature) => ({
        ...feature,
        properties: { key: f.key },
      })),
    ),
  };
}

export interface Formations {
  /** What the map draws; null while off or with none fetched. */
  view: FormationsView | null;
  section: (props: {
    open: boolean;
    onToggle: () => void;
    tone: 'light' | 'dark';
  }) => React.ReactNode;
  legend: (tone: 'light' | 'dark') => React.ReactNode;
  about: () => React.ReactNode;
}

export function useFormations(): Formations {
  const [on, setOn] = useState(true);
  const [shown, setShown] = useState<ReadonlySet<string>>(FORMATIONS_AT_START);
  const [fetched, setFetched] = useState<ReadonlyMap<string, GeoJSON.FeatureCollection>>(new Map());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  // Each outline asked for once, when it is first switched on while the section is on.
  const wanted = on ? [...shown].filter((key) => !fetched.has(key) && !failed.has(key)) : [];
  const wantedKey = wanted.join(',');
  useEffect(() => {
    if (wantedKey === '') return;
    const controller = new AbortController();
    for (const key of wantedKey.split(',')) {
      fetch(formationUrl(key), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          return (await response.json()) as GeoJSON.FeatureCollection;
        })
        .then((collection) => {
          setFetched((before) => new Map(before).set(key, collection));
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setFailed((before) => new Set(before).add(key));
        });
    }
    return () => {
      controller.abort();
    };
  }, [wantedKey]);

  const outlines = useMemo(() => formationFeatures(shown, fetched), [shown, fetched]);
  const view = useMemo(
    (): FormationsView | null => (on && outlines.features.length > 0 ? { outlines } : null),
    [on, outlines],
  );

  const toggle = (key: string) => {
    setShown((before) => {
      const next = new Set(before);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    // A failed outline is asked for again when switched on anew.
    setFailed((before) => {
      if (!before.has(key)) return before;
      const next = new Set(before);
      next.delete(key);
      return next;
    });
  };

  const section = ({
    open,
    onToggle,
    tone,
  }: {
    open: boolean;
    onToggle: () => void;
    tone: 'light' | 'dark';
  }) => (
    <MapSection
      title="Formations"
      open={open}
      onToggle={onToggle}
      on={on}
      onSwitch={setOn}
      sample={
        <span aria-hidden="true" className="flex gap-0.5">
          {FORMATION_OUTLINES.filter((f) => shown.has(f.key))
            .slice(0, 4)
            .map((f) => (
              <span
                key={f.key}
                className="h-0.5 w-2.5"
                style={{ backgroundColor: FORMATION_COLOURS[tone][f.key] }}
              />
            ))}
        </span>
      }
    >
      <div className="flex flex-col gap-1.5" role="group" aria-label="Formations shown">
        {FORMATION_OUTLINES.map((f) => (
          <SwitchRow
            key={f.key}
            title={f.name}
            note={failed.has(f.key) ? 'not loaded' : f.age}
            checked={shown.has(f.key)}
            onChange={() => {
              toggle(f.key);
            }}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Each outline is the area the Alberta Geological Survey evaluated for its 2012 shale report,
        not the formation’s full extent. Switching one here changes no well, sale or land shown.
      </p>
    </MapSection>
  );

  const legend = (tone: 'light' | 'dark') => {
    const drawn = FORMATION_OUTLINES.filter((f) => shown.has(f.key) && fetched.has(f.key));
    return !view || drawn.length === 0 ? null : (
      <div className="flex flex-col gap-1.5">
        <LegendTitle>Formations</LegendTitle>
        {drawn.map((f) => (
          <p key={f.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-0.5 w-5 shrink-0"
              style={{ backgroundColor: FORMATION_COLOURS[tone][f.key] }}
            />
            {f.name} outline
          </p>
        ))}
      </div>
    );
  };

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Formations.</strong> Outlines: Alberta Energy
      Regulator / Alberta Geological Survey, Digital Dataset 2013-0024 (Rokosh et al., 2013, the
      areas evaluated in its 2012 shale report). Contains information licensed under the Open
      Government Licence – Alberta.
    </p>
  );

  return { view, section, legend, about };
}
