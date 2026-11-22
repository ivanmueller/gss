import {
  FORMATION_LAT_STEP,
  FORMATION_LON_STEP,
  FORMATION_ROCK_SOURCE_NAME,
  FORMATION_SOURCE_NAME,
  FORMATION_ZONE_COUNT,
} from '@grain/domain';

import type { FormationCellRow, FormationLoad, FormationRange } from './formation-db';
import type { St37Box } from './st37-db';

/**
 * The layers of the ground under a well's 3D view (F-261 part 2; docs/FEATURES_OIL_GAS.md). The
 * Alberta Geological Survey's Geological Framework of Alberta, Version 4: open data under the
 * Open Government Licence – Alberta, shown with the Survey named (docs/DECISIONS.md,
 * 2026-11-22). Each zone's name and rock type are in @grain/domain (formationZones.ts); this
 * answer carries only the elevations.
 */

/** The oil and gas schema version the layers need (20261130010000_petro_formation_cells.sql). */
export const FORMATION_SCHEMA_VERSION = 13;

/** At most this many cells across and up in one answer: a view of some 60 km. */
export const FORMATION_MAX_CELLS_A_SIDE = 64;

/**
 * The lattice cells that cover a box, one cell beyond each edge so a value can be read between
 * cells anywhere in it; a sentence when the box is too large for one answer.
 */
export function formationRange(box: St37Box): FormationRange | string {
  const range = {
    x0: Math.floor(box.west / FORMATION_LON_STEP),
    x1: Math.ceil(box.east / FORMATION_LON_STEP),
    y0: Math.floor(box.south / FORMATION_LAT_STEP),
    y1: Math.ceil(box.north / FORMATION_LAT_STEP),
  };
  if (
    range.x1 - range.x0 + 1 > FORMATION_MAX_CELLS_A_SIDE ||
    range.y1 - range.y0 + 1 > FORMATION_MAX_CELLS_A_SIDE
  ) {
    return 'The box is too large: ask for the ground around one well.';
  }
  return range;
}

/**
 * The layers over a run of cells: for each zone present in at least one cell, its top and base
 * at every cell of the grid, the south row first, null where the zone is absent or the cell is
 * not kept.
 */
export function formationAnswer(
  range: FormationRange,
  load: FormationLoad | null,
  cells: readonly FormationCellRow[],
) {
  const columns = range.x1 - range.x0 + 1;
  const rows = range.y1 - range.y0 + 1;
  const zones: { zone: number; tops: (number | null)[]; bases: (number | null)[] }[] = [];
  for (let z = 0; z < FORMATION_ZONE_COUNT; z += 1) {
    if (!cells.some((cell) => cell.tops[z] != null && cell.bases[z] != null)) continue;
    const tops = new Array<number | null>(columns * rows).fill(null);
    const bases = new Array<number | null>(columns * rows).fill(null);
    for (const cell of cells) {
      const at = (cell.y - range.y0) * columns + (cell.x - range.x0);
      if (at < 0 || at >= tops.length) continue;
      const [top, base] = [cell.tops[z] ?? null, cell.bases[z] ?? null];
      if (top === null || base === null) continue;
      tops[at] = top;
      bases[at] = base;
    }
    zones.push({ zone: z + 1, tops, bases });
  }
  return {
    source: {
      name: FORMATION_SOURCE_NAME,
      rocks: FORMATION_ROCK_SOURCE_NAME,
      model: load?.model ?? null,
      loadedAt: load?.loadedAt ?? null,
      sourceDate: load?.sourceDate ?? null,
    },
    grid: {
      lonStep: load?.lonStep ?? FORMATION_LON_STEP,
      latStep: load?.latStep ?? FORMATION_LAT_STEP,
      x0: range.x0,
      y0: range.y0,
      columns,
      rows,
    },
    // How many cells of the grid are kept: none means the layers are not loaded here.
    cells: cells.length,
    zones,
  };
}
