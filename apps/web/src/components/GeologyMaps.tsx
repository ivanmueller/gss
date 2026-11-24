import {
  GEOLOGY_MAPS,
  decodeGeologyGrid,
  geologyAt,
  geologyContoursUrl,
  geologyGridCorners,
  geologyGridUrl,
  geologyRange,
  geologyValues,
  type GeologyGrid,
  type GeologyMeasure,
} from '@grain/domain';
import { useEffect, useMemo, useState } from 'react';

import { GEOLOGY_RAMPS, geologyPixels, type GeologyView } from '../lib/geologyMap';
import { FilterChip, LegendTitle, MapSection, SIDE_LABEL } from './MapSide';

// The Geology section of the oil and gas map (F-287 part 3; the owner, 2026-11-23: "its own
// section in the menus below Prices"; 2026-11-24: the Duvernay first, about 1 km squares). A
// formation's depth to its top from the ground, or its thickness, shaded on the map from the
// Alberta Geological Survey's model with contour lines; the pointer reads both where it is. Off
// when the map opens; the files (apps/web/public/geology/, scripts/build-geology-grids.js) are
// asked for once it is switched on.

const MEASURES: { key: GeologyMeasure; label: string }[] = [
  { key: 'depth', label: 'Depth' },
  { key: 'thickness', label: 'Thickness' },
];

const metres = (value: number) =>
  `${value.toLocaleString('en-CA', { maximumFractionDigits: 0 })} m`;

/** The words at the pointer: "Duvernay / Muskwa top 3,093 m deep, 57 m thick". */
export function geologyTip(name: string, at: ReturnType<typeof geologyAt>): string | null {
  if (!at) return null;
  const parts = [
    at.depthM === null ? null : `top ${metres(at.depthM)} deep`,
    at.thicknessM === null ? null : `${metres(at.thicknessM)} thick`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : `${name} ${parts.join(', ')}`;
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
}

export function useGeologyMaps(): GeologyMaps {
  const [on, setOn] = useState(false);
  const [measure, setMeasure] = useState<GeologyMeasure>('depth');
  const formation = GEOLOGY_MAPS[0];
  const [grid, setGrid] = useState<GeologyGrid | null>(null);
  const [contours, setContours] = useState<
    Partial<Record<GeologyMeasure, GeoJSON.FeatureCollection>>
  >({});
  const [problem, setProblem] = useState<string | null>(null);

  // The grid, once, when the section is first switched on.
  const wantGrid = on && grid === null && problem === null;
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
  const wantLines = on && contours[measure] === undefined;
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

  const every = measure === 'depth' ? formation.depthEvery : formation.thicknessEvery;
  const shaded = useMemo(() => {
    if (!grid) return null;
    const values = geologyValues(grid, measure);
    const range = geologyRange(values, every);
    if (!range) return null;
    const image = pictureOf(grid, geologyPixels(values, range, GEOLOGY_RAMPS[measure]));
    return { range, image };
  }, [grid, measure, every]);

  const view = useMemo((): GeologyView | null => {
    if (!on || !grid || !shaded?.image) return null;
    return {
      measure,
      image: shaded.image,
      corners: geologyGridCorners(grid),
      contours: contours[measure] ?? null,
    };
  }, [on, grid, shaded, measure, contours]);

  const tipAt = useMemo(() => {
    if (!view || !grid) return null;
    return (lon: number, lat: number) => geologyTip(formation.name, geologyAt(grid, lon, lat));
  }, [view, grid, formation.name]);

  const scale = (range: [number, number]) => (
    <div className="flex flex-col gap-1">
      <span
        aria-hidden="true"
        className="h-2.5 w-full rounded-sm"
        style={{ background: `linear-gradient(to right, ${GEOLOGY_RAMPS[measure].join(', ')})` }}
      />
      <span className="flex justify-between text-muted-foreground">
        <span>{metres(range[0])}</span>
        <span>{metres(range[1])}</span>
      </span>
    </div>
  );

  const words = measure === 'depth' ? 'Depth from the ground to the top' : 'Vertical thickness';

  const section = ({ open, onToggle }: { open: boolean; onToggle: () => void }) => (
    <MapSection title="Geology" open={open} onToggle={onToggle} on={on} onSwitch={setOn}>
      <div className="flex flex-col gap-1.5">
        <span className={SIDE_LABEL}>Formation</span>
        {/* One formation for now (the owner, 2026-11-24: the Duvernay to start). */}
        <span className="text-sm">{formation.name}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Measure shown">
        {MEASURES.map((m) => (
          <FilterChip
            key={m.key}
            plain
            pressed={measure === m.key}
            onClick={() => {
              setMeasure(m.key);
            }}
          >
            {m.label}
          </FilterChip>
        ))}
      </div>
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      {on && !grid && !problem && <p className="text-xs text-muted-foreground">Loading…</p>}
      {shaded && (
        <div className="flex flex-col gap-1.5 text-xs">
          <span>
            {words}, contour lines every {metres(every)}
          </span>
          {scale(shaded.range)}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Point at the map to read the depth and thickness there. The Survey’s model, averaged over
        squares of about 1 km: a guide to the area, not a measurement at a well (a well’s panel
        shows the tops picked in it).
      </p>
    </MapSection>
  );

  const legend = () =>
    !view || !shaded ? null : (
      <div className="flex flex-col gap-1.5">
        <LegendTitle>
          {formation.name} {measure === 'depth' ? 'depth' : 'thickness'}
        </LegendTitle>
        {scale(shaded.range)}
      </div>
    );

  const about = () => (
    <p>
      <strong className="font-medium text-foreground">Geology.</strong> Depth and thickness: Alberta
      Energy Regulator / Alberta Geological Survey, Geological Framework of Alberta, Version 4 (its
      zone 68, Duvernay and Muskwa), averaged over squares of about 1 km. Contains information
      licensed under the Open Government Licence – Alberta.
    </p>
  );

  return { view, tipAt, section, legend, about };
}
