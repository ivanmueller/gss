/**
 * The formation outlines of the oil and gas map's Formations section (F-280; the owner,
 * 2026-11-23: each formation switched on and off by itself, not tied to Wells & licences). Each
 * is one of the six units of the Alberta Geological Survey's Digital Dataset 2013-0024 (Rokosh et
 * al., 2013: the areas its 2012 shale report evaluated, not a formal edge of the formation), kept
 * as `apps/web/public/outlines/<key>.geojson` by `scripts/build-formation-outlines.js`. Listed
 * from the shallowest to the deepest, as the Alberta Table of Formations orders them.
 */
export interface FormationOutline {
  key: string;
  /** The name shown on the map. */
  name: string;
  /** The unit's name in the dataset (its `Shale_Unit`). */
  unit: string;
  /** Its age, as the dataset's report gives it. */
  age: string;
}

export const FORMATION_OUTLINES: readonly FormationOutline[] = [
  { key: 'wilrich', name: 'Wilrich', unit: 'Wilrich', age: 'Lower Cretaceous' },
  { key: 'north-nordegg', name: 'North Nordegg', unit: 'North Nordegg', age: 'Jurassic' },
  { key: 'montney', name: 'Montney', unit: 'Montney', age: 'Triassic' },
  {
    key: 'basal-banff-exshaw',
    name: 'Basal Banff / Exshaw',
    unit: 'Basal Banff/Exshaw',
    age: 'Mississippian–Devonian',
  },
  { key: 'muskwa', name: 'Muskwa', unit: 'Muskwa', age: 'Devonian' },
  { key: 'duvernay', name: 'Duvernay', unit: 'Duvernay', age: 'Devonian' },
];
