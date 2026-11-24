import {
  GEOLOGY_MAPS,
  MATURITY_MIN_S2,
  MATURITY_RO_EDGES,
  MATURITY_WINDOW_LABELS,
  decodeGeologyGrid,
  geologyAt,
  geologyContoursUrl,
  geologyGridCorners,
  geologyGridUrl,
  geologyRange,
  geologyValues,
  type GeologyGrid,
  type GeologyMeasure,
  type MapSettings,
  type MaturityWindow,
} from '@grain/domain';
import { useEffect, useMemo, useState } from 'react';

import { ApiError, apiJson } from '../lib/api';
import { GEOLOGY_RAMPS, geologyPixels, type GeologyView } from '../lib/geologyMap';
import { FilterChip, LegendTitle, MapSection, SIDE_LABEL } from './MapSide';
import { WINDOW_COLOURS } from './WellGeology';

// The Geology section of the oil and gas map (F-287 parts 3 and 4; the owner, 2026-11-23: "its
// own section in the menus below Prices"; 2026-11-24: the Duvernay first, about 1 km squares). A
// formation's depth to its top from the ground, or its thickness, shaded on the map from the
// Alberta Geological Survey's model with contour lines, the pointer reading both where it is; or
// its Rock-Eval samples as dots coloured by maturity window, each one's values at the pointer.
// Off when the map opens; the files (apps/web/public/geology/, scripts/build-geology-grids.js)
// and the samples (members only) are asked for once wanted.

type Shown = GeologyMeasure | 'maturity';

const SHOWN: { key: Shown; label: string }[] = [
  { key: 'depth', label: 'Depth' },
  { key: 'thickness', label: 'Thickness' },
  { key: 'maturity', label: 'Maturity' },
];

const WINDOWS: MaturityWindow[] = ['immature', 'oil', 'condensate', 'dry-gas'];
/** A sample without a window: hollow-looking grey. */
export const NO_WINDOW_COLOUR = '#e5e7eb';

export interface PlaySample {
  sampleId: number;
  run: number;
  uwi: string | null;
  site: 'well' | 'outcrop';
  longitude: number;
  latitude: number;
  unit: string | null;
  lithology: string | null;
  depthM: string | null;
  collectedOn: string | null;
  tmaxC: string | null;
  tocPct: string | null;
  hydrogenIndex: string | null;
  ro: number | null;
  window: MaturityWindow | null;
  note: 'no-tmax' | 'small-s2' | null;
}

export interface PlaySamplesAnswer {
  source: { name: string; loadedAt: string | null; sourceDate: string | null };
  play: { key: string; name: string };
  samples: PlaySample[];
}

const metres = (value: number) =>
  `${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })} m`;
const decimal = (text: string, digits: number) =>
  Number(text).toLocaleString('en-CA', { maximumFractionDigits: digits });

/** The words at the pointer: "Duvernay / Muskwa top 3,093 m deep, 57 m thick". */
export function geologyTip(name: string, at: ReturnType<typeof geologyAt>): string | null {
  if (!at) return null;
  const parts = [
    at.depthM === null ? null : `top ${metres(at.depthM)} deep`,
    at.thicknessM === null ? null : `${metres(at.thicknessM)} thick`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `${name} ${parts.join(', ')}`;
}

/** A sample's box: what it is, its window, and what was measured. */
export function sampleTip(s: PlaySample): string {
  const head = [
    `Sample ${String(s.sampleId)}`,
    s.unit,
    s.depthM === null ? (s.site === 'outcrop' ? 'outcrop' : null) : metres(Number(s.depthM)),
  ].filter((part): part is string => part !== null && part !== '');
  const window = s.window
    ? MATURITY_WINDOW_LABELS[s.window]
    : s.note === 'small-s2'
      ? 'No window: S2 too small to read Tmax'
      : 'No window: no Tmax';
  const reading = [
    s.ro === null ? null : `Ro ${s.ro.toFixed(2)}%`,
    s.tmaxC === null ? null : `Tmax ${decimal(s.tmaxC, 0)} °C`,
  ].filter((part): part is string => part !== null);
  const rock = [
    s.tocPct === null ? null : `TOC ${decimal(s.tocPct, 2)}%`,
    s.hydrogenIndex === null ? null : `HI ${decimal(s.hydrogenIndex, 0)}`,
  ].filter((part): part is string => part !== null);
  return [
    head.join(' · '),
    reading.length > 0 ? `${window} · ${reading.join(' · ')}` : window,
    rock.join(' · '),
    s.uwi ?? '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** The samples as dots: each one's colour by window and the words of its box. */
export function sampleFeatures(samples: readonly PlaySample[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: samples.map((s) => ({
      type: 'Feature',
      properties: {
        colour: s.window ? WINDOW_COLOURS[s.window] : NO_WINDOW_COLOUR,
        tip: sampleTip(s),
      },
      geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
    })),
  };
}

/** The grid file's bytes, gunzipped (the file is kept gzipped; a server may already have). */
export async function gridBytes(response: Response): Promise<Uint8Array> {
  const raw = new Uint8Array(await response.arrayBuffer());
  if (raw[0] !== 0x1f || raw[1] !== 0x8b) return raw;
  const body = new Response(raw).body;
  if (!body) throw new Error('The grid file is empty.');
  const stream = body.pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The shading as a picture (a data URL); null where the browser cannot draw one. */
function pictureOf(grid: GeologyGrid, pixels: Uint8ClampedArray): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = grid.columns;
  canvas.height = grid.rows;
  try {
    const context = canvas.getContext('2d');
    if (!context) return null;
    const image = context.createImageData(grid.columns, grid.rows);
    image.data.set(pixels);
    context.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

export interface GeologyMaps {
  view: GeologyView | null;
  /** The words for the pointer at a place; null where nothing is shown there. */
  tipAt: ((lon: number, lat: number) => string | null) | null;
  section: (props: { open: boolean; onToggle: () => void }) => React.ReactNode;
  legend: () => React.ReactNode;
  about: () => React.ReactNode;
  /** Every setting of the section as it is now, and a way to set some of them (F-254). */
  settings: GeologySettings;
  apply: (settings: GeologySettings) => void;
}

export type GeologySettings = NonNullable<MapSettings['geology']>;

export function useGeologyMaps(organizationId: string, token: string): GeologyMaps {
  const [on, setOn] = useState(false);
  const [shown, setShown] = useState<Shown>('depth');
  const formation = GEOLOGY_MAPS[0];
  const [grid, setGrid] = useState<GeologyGrid | null>(null);
  const [contours, setContours] = useState<
    Partial<Record<GeologyMeasure, GeoJSON.FeatureCollection>>
  >({});
  const [problem, setProblem] = useState<string | null>(null);
  const [samples, setSamples] = useState<PlaySamplesAnswer | null>(null);
  const [samplesProblem, setSamplesProblem] = useState<string | null>(null);
  const measure: GeologyMeasure | null = shown === 'maturity' ? null : shown;

  // The grid, once, when a measure is first shown.
  const wantGrid = on && measure !== null && grid === null && problem === null;
  useEffect(() => {
    if (!wantGrid) return;
    const controller = new AbortController();
    fetch(geologyGridUrl(formation.key), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return decodeGeologyGrid(await gridBytes(response));
      })
      .then(setGrid)
      .catch(() => {
        if (!controller.signal.aborted) setProblem('The map could not be loaded. Try again later.');
      });
    return () => {
      controller.abort();
    };
  }, [wantGrid, formation.key]);

  // Each measure's contour lines, once, when first shown.
  const wantLines = on && measure !== null && contours[measure] === undefined;
  useEffect(() => {
    if (!wantLines) return;
    const controller = new AbortController();
    fetch(geologyContoursUrl(formation.key, measure), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as GeoJSON.FeatureCollection;
      })
      .then((collection) => {
        setContours((before) => ({ ...before, [measure]: collection }));
      })
      .catch(() => {
        // The shading still shows; the lines are left out.
      });
    return () => {
      controller.abort();
    };
  }, [wantLines, formation.key, measure]);

  // The samples, once, when Maturity is first shown.
  const wantSamples = on && shown === 'maturity' && samples === null && samplesProblem === null;
  useEffect(() => {
    if (!wantSamples) return;
    const controller = new AbortController();
    apiJson<PlaySamplesAnswer>(
      `/petroleum/geology/samples?play=${encodeURIComponent(formation.key)}&organization_id=${encodeURIComponent(organizationId)}`,
      token,
      { signal: controller.signal },
    )
      .then(setSamples)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSamplesProblem(
          error instanceof ApiError && error.code === 'PETROLEUM_NOT_READY'
            ? 'The oil and gas database is being updated. Try again in a few minutes.'
            : 'The samples could not be loaded. Try again later.',
        );
      });
    return () => {
      controller.abort();
    };
  }, [wantSamples, formation.key, organizationId, token]);

  const every = measure === 'thickness' ? formation.thicknessEvery : formation.depthEvery;
  const shaded = useMemo(() => {
    if (!grid || measure === null) return null;
    const values = geologyValues(grid, measure);
    const range = geologyRange(values, every);
    if (!range) return null;
    const image = pictureOf(grid, geologyPixels(values, range, GEOLOGY_RAMPS[measure]));
    return { range, image, measure };
  }, [grid, measure, every]);

  const dots = useMemo(() => (samples ? sampleFeatures(samples.samples) : null), [samples]);

  const view = useMemo((): GeologyView | null => {
    if (!on) return null;
    if (shown === 'maturity') return dots ? { shading: null, samples: dots } : null;
    if (!grid || !shaded?.image) return null;
    return {
      shading: {
        measure: shaded.measure,
        image: shaded.image,
        corners: geologyGridCorners(grid),
        contours: contours[shaded.measure] ?? null,
      },
      samples: null,
    };
  }, [on, shown, dots, grid, shaded, contours]);

  // The squares' words only while a measure is shaded; a dot's own box answers on Maturity.
  const tipAt = useMemo(() => {
    if (!view?.shading || !grid) return null;
    return (lon: number, lat: number) => geologyTip(formation.name, geologyAt(grid, lon, lat));
  }, [view, grid, formation.name]);

  const counts = useMemo(() => {
    const by = new Map<MaturityWindow | null, number>();
    for (const s of samples?.samples ?? []) by.set(s.window, (by.get(s.window) ?? 0) + 1);
    return by;
  }, [samples]);

  const scale = (range: [number, number], m: GeologyMeasure) => (
    <div className="flex flex-col gap-1">
      <span
        aria-hidden="true"
        className="h-2.5 w-full rounded-sm"
        style={{ background: `linear-gradient(to right, ${GEOLOGY_RAMPS[m].join(', ')})` }}
      />
      <span className="flex justify-between text-muted-foreground">
        <span>{metres(range[0])}</span>
        <span>{metres(range[1])}</span>
      </span>
    </div>
  );

  const windowKey = (withCounts: boolean) => (
    <ul className="flex flex-col gap-1">
      {[...WINDOWS, null].map((w) => (
        <li key={w ?? 'none'} className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="size-2.5 shrink-0 rounded-full border border-card"
            style={{ backgroundColor: w ? WINDOW_COLOURS[w] : NO_WINDOW_COLOUR }}
          />
          <span className="flex-1">{w ? MATURITY_WINDOW_LABELS[w] : 'No window'}</span>
          {withCounts && (
            <span className="text-muted-foreground tabular-nums">{counts.get(w) ?? 0}</span>
          )}
        </li>
      ))}
    </ul>
  );

  const words = measure === 'depth' ? 'Depth from the ground to the top' : 'Vertical thickness';

  const section = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <MapSection title="Geology" open={open} onToggle={onToggle} on={on} onSwitch={setOn}>
      <div className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Formation</span>
        {/* One formation for now (the owner, 2026-11-24: the Duvernay to start). */}
        <span className="text-sm">{formation.name}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Shown on the map">
        {SHOWN.map((m) => (
          <FilterChip
            key={m.key}
            plain
            pressed={shown === m.key}
            onClick={() => {
              setShown(m.key);
            }}
          >
            {m.label}
          </FilterChip>
        ))}
      </div>
      {measure !== null && (
        <>
          {problem && <p className="text-xs text-destructive">{problem}</p>}
          {on && !grid && !problem && <p className="text-xs text-muted-foreground">Loading…</p>}
          {shaded && (
            <div className="flex flex-col gap-1.5 text-xs">
              <span>
                {words}, contour lines every {metres(every)}
              </span>
              {scale(shaded.range, shaded.measure)}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Point at the map to read the depth and thickness there. The Survey’s model, averaged
            over squares of about 1 km: a guide to the area, not a measurement at a well (a well’s
            panel shows the tops picked in it).
          </p>
        </>
      )}
      {shown === 'maturity' && (
        <>
          {samplesProblem && <p className="text-xs text-destructive">{samplesProblem}</p>}
          {on && !samples && !samplesProblem && (
            <p className="text-xs text-muted-foreground">Loading…</p>
          )}
          {samples?.samples.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No samples loaded yet: an admin runs Load geology (GitHub → Actions).
            </p>
          )}
          {samples && samples.samples.length > 0 && (
            <div className="flex flex-col gap-1.5 text-xs">
              <span>
                {samples.samples.length.toLocaleString('en-CA')} measured samples of the Duvernay
                and the Muskwa, by maturity window
              </span>
              {windowKey(true)}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Point at a dot to read its sample. Each window is read from the sample’s Tmax, as Ro =
            0.018 × Tmax − 7.16: under {MATURITY_RO_EDGES.oil}% immature, to{' '}
            {MATURITY_RO_EDGES.condensate.toFixed(1)}% oil, to {MATURITY_RO_EDGES.dryGas}% wet gas
            and condensate, then dry gas; no window without a Tmax or with an S2 under{' '}
            {MATURITY_MIN_S2} mg/g. Measured samples only: nothing is drawn between them.
          </p>
        </>
      )}
    </MapSection>
  );

  const legend = () => {
    if (!view) return null;
    if (view.samples) {
      return (
        <div className="flex flex-col gap-1.5">
          <LegendTitle>{formation.name} maturity</LegendTitle>
          {windowKey(false)}
        </div>
      );
    }
    return !shaded ? null : (
      <div className="flex flex-col gap-1.5">
        <LegendTitle>
          {formation.name} {shaded.measure === 'depth' ? 'depth' : 'thickness'}
        </LegendTitle>
        {scale(shaded.range, shaded.measure)}
      </div>
    );
  };

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Geology.</strong> Depth and thickness: Alberta
      Energy Regulator / Alberta Geological Survey, Geological Framework of Alberta, Version 4 (its
      zone 68, Duvernay and Muskwa), averaged over squares of about 1 km. Maturity: Alberta Energy
      Regulator / Alberta Geological Survey, Digital Dataset 2013-0003, Rock-Eval and TOC data.
      Contains information licensed under the Open Government Licence – Alberta.
    </p>
  );

  const settings: GeologySettings = { on, shown };
  const apply = (next: GeologySettings) => {
    if (next.on !== undefined) setOn(next.on);
    if (next.shown) setShown(next.shown);
  };

  return { view, tipAt, section, legend, about, settings, apply };
}
