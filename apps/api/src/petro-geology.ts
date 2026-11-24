import {
  FORMATION_PLAY_ZONES,
  FORMATION_SOURCE_NAME,
  formationCell,
  formationZone,
  inZone,
  sampleInPlay,
  sampleMaturity,
  type MaturityWindow,
} from '@grain/domain';

import type { FormationCellRow } from './formation-db';
import type { GeologyOfWell, PickedWellRow, PickNameRow, PlaySamples } from './petro-geology-db';
import { GEOLOGY_PICKS_KM, GEOLOGY_SAMPLES_KM } from './petro-geology-db';

/**
 * A well's Geology section (F-287 part 2; docs/FEATURES_OIL_GAS.md): the tops the Survey picked
 * in it or in the picked wells nearest it, its play's zone in the Survey's model under it (depth,
 * thickness, where each leg lies in it), and the nearest Rock-Eval samples of the play with the
 * maturity each one reads (packages/domain/src/geology.ts). Open data under the Open Government
 * Licence – Alberta, the Survey named.
 */

/** The oil and gas schema version the section needs (20261209010000_petro_geology.sql). */
export const GEOLOGY_SCHEMA_VERSION = 22;

/** The picked wells near the well shown, after its own: the nearest few. */
export const GEOLOGY_NEAREST_PICKED = 3;
/** The play's samples shown, after the well's own: the nearest few. */
export const GEOLOGY_NEAREST_SAMPLES = 5;

export const PICKS_SOURCE_NAME =
  'Alberta Energy Regulator / Alberta Geological Survey, Geological Framework of Alberta, Version 4, stratigraphic picks';
export const SAMPLES_SOURCE_NAME =
  'Alberta Energy Regulator / Alberta Geological Survey, Digital Dataset 2013-0003, Rock-Eval and TOC data';

const PICK_SOURCES = ['unknown', 'Survey', 'AER'] as const;

export interface GeologyPick {
  name: string;
  /** The model's zone number the pick is the top (or base) of, from its surface code. */
  zone: number | null;
  tvdM: number;
  /** Metres above sea level, when the well's kelly bushing is known. */
  elevationM: number | null;
  source: (typeof PICK_SOURCES)[number];
}

export interface GeologyPickedWell {
  uwi: string;
  /** True for a leg of this well's licence. */
  own: boolean;
  /** From the nearer of the well's two ends; 0 for its own legs. */
  distanceKm: number;
  picks: GeologyPick[];
}

export interface GeologyLegInZone {
  uwi: string;
  /** Points of the drilled path in its lateral (within 100 m of its deepest point). */
  points: number;
  /** Of them, inside the play's zone in the model. */
  inside: number;
  /** Their average distance under the zone's top and over its base, in metres. */
  belowTopM: number | null;
  aboveBaseM: number | null;
}

export interface GeologySample {
  sampleId: number;
  run: number;
  uwi: string | null;
  own: boolean;
  distanceKm: number;
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

export interface GeologyAnswer {
  source: {
    picks: { name: string; loadedAt: string | null; sourceDate: string | null };
    samples: { name: string; loadedAt: string | null; sourceDate: string | null };
    model: { name: string; loadedAt: string | null };
  };
  /** The play the well was loaded for, and its zone in the model; null for no play. */
  play: { key: string; zone: number; name: string } | null;
  /** The play's zone under the well's bottom hole: depth from the ground and thickness. */
  zoneHere: { topDepthM: number | null; topElevationM: number; thicknessM: number } | null;
  legs: GeologyLegInZone[];
  picked: GeologyPickedWell[];
  samples: GeologySample[];
  /** How far around the well picked wells and samples were looked for. */
  reach: { picksKm: number; samplesKm: number };
}

/** Kilometres between two places, near enough at Alberta's latitudes. */
export function kmBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const kx = 111.32 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * kx, (a[1] - b[1]) * 110.574);
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function cellAt(cells: readonly FormationCellRow[], lon: number, lat: number) {
  const { x, y } = formationCell(lon, lat);
  return cells.find((c) => c.x === x && c.y === y) ?? null;
}

function picksOf(row: PickedWellRow, names: ReadonlyMap<number, PickNameRow>): GeologyPick[] {
  return row.names.flatMap((id, i) => {
    const name = names.get(id);
    const tvd = row.tvdM[i];
    if (!name || tvd === undefined) return [];
    const zone = /^(\d{2})/.exec(name.surface);
    return [
      {
        name: name.name,
        zone: zone ? Number(zone[1]) : null,
        tvdM: tvd,
        elevationM: row.kbElevationM === null ? null : round1(row.kbElevationM - tvd),
        source: PICK_SOURCES[row.sources[i] ?? 0] ?? 'unknown',
      },
    ];
  });
}

/** The lateral of a path: the points within 100 m of its deepest. */
export function lateralOf(points: readonly [number, number, number][]) {
  if (points.length === 0) return [];
  const deepest = Math.min(...points.map((p) => p[2]));
  return points.filter((p) => p[2] <= deepest + 100);
}

export function geologyAnswer(data: GeologyOfWell): GeologyAnswer {
  const { well, loads } = data;
  const source = {
    picks: {
      name: PICKS_SOURCE_NAME,
      loadedAt: loads.picks?.loadedAt ?? null,
      sourceDate: loads.picks?.sourceDate ?? null,
    },
    samples: {
      name: SAMPLES_SOURCE_NAME,
      loadedAt: loads.samples?.loadedAt ?? null,
      sourceDate: loads.samples?.sourceDate ?? null,
    },
    model: { name: FORMATION_SOURCE_NAME, loadedAt: loads.model?.loadedAt ?? null },
  };
  const reach = { picksKm: GEOLOGY_PICKS_KM, samplesKm: GEOLOGY_SAMPLES_KM };
  if (!well)
    return { source, play: null, zoneHere: null, legs: [], picked: [], samples: [], reach };

  const zoneNumber = well.formation ? FORMATION_PLAY_ZONES[well.formation] : undefined;
  const zone = zoneNumber === undefined ? undefined : formationZone(zoneNumber);
  const play =
    well.formation && zoneNumber !== undefined && zone
      ? { key: well.formation, zone: zoneNumber, name: zone.short }
      : null;

  // The zone under the bottom hole.
  let zoneHere: GeologyAnswer['zoneHere'] = null;
  if (play) {
    const cell = cellAt(data.cells, well.bottom[0], well.bottom[1]);
    const top = cell?.tops[play.zone - 1] ?? null;
    const base = cell?.bases[play.zone - 1] ?? null;
    if (top !== null && base !== null && top > base) {
      zoneHere = {
        topElevationM: Math.round(top),
        topDepthM: well.groundElevationM === null ? null : Math.round(well.groundElevationM - top),
        thicknessM: Math.round(top - base),
      };
    }
  }

  // Each leg's lateral against the zone, point by point, each in its own cell.
  const legs: GeologyLegInZone[] = [];
  if (play) {
    for (const leg of data.legs) {
      const lateral = lateralOf(leg.points ?? []);
      let inside = 0;
      let measured = 0;
      let below = 0;
      let above = 0;
      for (const [lon, lat, z] of lateral) {
        const cell = cellAt(data.cells, lon, lat);
        const at = inZone(z, cell?.tops[play.zone - 1] ?? null, cell?.bases[play.zone - 1] ?? null);
        if (!at) continue;
        measured += 1;
        below += at.belowTopM;
        above += at.aboveBaseM;
        if (at.inside) inside += 1;
      }
      if (lateral.length === 0) continue;
      legs.push({
        uwi: leg.uwi,
        points: lateral.length,
        inside,
        belowTopM: measured ? Math.round(below / measured) : null,
        aboveBaseM: measured ? Math.round(above / measured) : null,
      });
    }
  }

  // Picks: the licence's own legs, then the nearest others within reach.
  const names = new Map(data.names.map((n) => [n.id, n]));
  const ends: [number, number][] = [well.surface, well.bottom];
  const picked = data.picked
    .map((row) => {
      const own = row.licenceNumber !== '' && row.licenceNumber === well.licenceNumber;
      const distanceKm = own
        ? 0
        : round1(Math.min(...ends.map((e) => kmBetween(e, [row.longitude, row.latitude]))));
      return { row, own, distanceKm };
    })
    .filter((p) => p.own || p.distanceKm <= GEOLOGY_PICKS_KM)
    .sort(
      (a, b) =>
        Number(b.own) - Number(a.own) ||
        a.distanceKm - b.distanceKm ||
        a.row.uwi.localeCompare(b.row.uwi),
    );
  const ownPicked = picked.filter((p) => p.own);
  const nearPicked = picked.filter((p) => !p.own).slice(0, GEOLOGY_NEAREST_PICKED);
  const pickedOut = [...ownPicked, ...nearPicked].map((p) => ({
    uwi: p.row.uwi,
    own: p.own,
    distanceKm: p.distanceKm,
    picks: picksOf(p.row, names),
  }));

  // Samples: the licence's own legs', whatever their unit, then the play's nearest.
  const legUwis = new Set(data.legs.map((l) => l.uwi));
  const middle: [number, number] = [
    (well.surface[0] + well.bottom[0]) / 2,
    (well.surface[1] + well.bottom[1]) / 2,
  ];
  const scored = data.samples.map((s) => ({
    s,
    own: s.uwi !== null && legUwis.has(s.uwi),
    distanceKm: round1(kmBetween(middle, [s.longitude, s.latitude])),
  }));
  const ownSamples = scored.filter((x) => x.own);
  const playSamples = play
    ? scored
        .filter(
          (x) => !x.own && x.distanceKm <= GEOLOGY_SAMPLES_KM && sampleInPlay(x.s.unit, play.key),
        )
        .sort(
          (a, b) => a.distanceKm - b.distanceKm || a.s.sampleId - b.s.sampleId || a.s.run - b.s.run,
        )
        .slice(0, GEOLOGY_NEAREST_SAMPLES)
    : [];
  const samples = [...ownSamples, ...playSamples].map(({ s, own, distanceKm }) => ({
    sampleId: s.sampleId,
    run: s.run,
    uwi: s.uwi,
    own,
    distanceKm: own ? 0 : distanceKm,
    unit: s.unit,
    lithology: s.lithology,
    depthM: s.topDepthM,
    collectedOn: s.collectedOn,
    tmaxC: s.tmaxC,
    tocPct: s.tocPct,
    hydrogenIndex: s.hydrogenIndex,
    ...sampleMaturity(s.tmaxC, s.s2),
  }));

  return { source, play, zoneHere, legs, picked: pickedOut, samples, reach };
}

/** A sample on the Maturity map (F-287 part 4): where it is and what it reads. */
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

/** A play's samples with the maturity each one reads, the same rules as a well's panel. */
export function playSamplesAnswer(
  play: { key: string; name: string },
  data: PlaySamples,
): PlaySamplesAnswer {
  return {
    source: {
      name: SAMPLES_SOURCE_NAME,
      loadedAt: data.load?.loadedAt ?? null,
      sourceDate: data.load?.sourceDate ?? null,
    },
    play,
    samples: data.samples.map((s) => ({
      sampleId: s.sampleId,
      run: s.run,
      uwi: s.uwi,
      site: s.site,
      longitude: s.longitude,
      latitude: s.latitude,
      unit: s.unit,
      lithology: s.lithology,
      depthM: s.topDepthM,
      collectedOn: s.collectedOn,
      tmaxC: s.tmaxC,
      tocPct: s.tocPct,
      hydrogenIndex: s.hydrogenIndex,
      ...sampleMaturity(s.tmaxC, s.s2),
    })),
  };
}
