/**
 * The formation outlines of the oil and gas map's Formations section (F-280; the owner,
 * 2026-11-23: each formation switched on and off by itself, not tied to Wells & licences; F-281,
 * the same day: "we need to add all the types of formations so the shale plays and the other ones
 * like Nisku, Mannville, Leduc, etc"). Each is kept as `apps/web/public/outlines/<key>.geojson`
 * by `scripts/build-formation-outlines.js`, from one of two sources of the Alberta Geological
 * Survey, both under the Open Government Licence – Alberta:
 *
 * - `shale-report`: a unit of Digital Dataset 2013-0024 (Rokosh et al., 2013: the areas its 2012
 *   shale report evaluated, not a formal edge of the formation);
 * - `model`: a zone of the Geological Framework of Alberta, Version 4 (the Survey's 3D model, the
 *   same zones as `FORMATION_ZONES`), its `Extent_Top` outline: where the zone is present. Several
 *   zones join formations, and a formation asked for by a name the model does not use (Nisku, Rock
 *   Creek, Halfway, Beaverhill Lake, Edmonton Group) is the zone that holds it, named beside it.
 *
 * Each group listed from the shallowest to the deepest.
 */
export interface FormationOutline {
  key: string;
  /** The name shown on the map. */
  name: string;
  source: 'shale-report' | 'model';
  /** The dataset's unit (`Shale_Unit`) for the shale report; the model zone's code otherwise. */
  unit: string;
  /** Its age, as the source gives it. */
  age: string;
}

export const FORMATION_OUTLINES: readonly FormationOutline[] = [
  {
    key: 'wilrich',
    name: 'Wilrich',
    source: 'shale-report',
    unit: 'Wilrich',
    age: 'Lower Cretaceous',
  },
  {
    key: 'north-nordegg',
    name: 'North Nordegg',
    source: 'shale-report',
    unit: 'North Nordegg',
    age: 'Jurassic',
  },
  { key: 'montney', name: 'Montney', source: 'shale-report', unit: 'Montney', age: 'Triassic' },
  {
    key: 'basal-banff-exshaw',
    name: 'Basal Banff / Exshaw',
    source: 'shale-report',
    unit: 'Basal Banff/Exshaw',
    age: 'Mississippian–Devonian',
  },
  { key: 'muskwa', name: 'Muskwa', source: 'shale-report', unit: 'Muskwa', age: 'Devonian' },
  { key: 'duvernay', name: 'Duvernay', source: 'shale-report', unit: 'Duvernay', age: 'Devonian' },
  {
    key: 'horseshoe-canyon',
    name: 'Horseshoe Canyon (Edmonton Group)',
    source: 'model',
    unit: '09_K_HC_SM_Bd',
    age: 'Cretaceous',
  },
  { key: 'cardium', name: 'Cardium', source: 'model', unit: '28_K_Ca', age: 'Cretaceous' },
  {
    key: 'second-white-specks',
    name: 'Second White Specks',
    source: 'model',
    unit: '31_K_SW_BF_FS',
    age: 'Cretaceous',
  },
  { key: 'dunvegan', name: 'Dunvegan', source: 'model', unit: '34_K_D', age: 'Cretaceous' },
  { key: 'viking', name: 'Viking', source: 'model', unit: '39_K_BoI_V_Pl', age: 'Cretaceous' },
  {
    key: 'spirit-river',
    name: 'Spirit River (Falher, Wilrich, Notikewin)',
    source: 'model',
    unit: '45_K_SR',
    age: 'Cretaceous',
  },
  {
    key: 'mannville',
    name: 'Mannville (undivided)',
    source: 'model',
    unit: '46_K_undiv_Mn',
    age: 'Cretaceous',
  },
  {
    key: 'clearwater',
    name: 'Clearwater',
    source: 'model',
    unit: '47_K_C_excl_C-w',
    age: 'Cretaceous',
  },
  {
    key: 'bluesky',
    name: 'Bluesky / Gething / Cadomin',
    source: 'model',
    unit: '50_K_Bs_Ge_Cd_bc',
    age: 'Cretaceous',
  },
  {
    key: 'rock-creek',
    name: 'Fernie / Nikanassin (Rock Creek)',
    source: 'model',
    unit: '53_KJ_N_M_Fn',
    age: 'Cretaceous–Jurassic',
  },
  {
    key: 'halfway',
    name: 'Schooler Creek (Halfway, Charlie Lake)',
    source: 'model',
    unit: '54_T_SC',
    age: 'Triassic',
  },
  { key: 'doig', name: 'Doig', source: 'model', unit: '55_T_Dg', age: 'Triassic' },
  { key: 'wabamun', name: 'Wabamun', source: 'model', unit: '65_D_Wa_undiff_D', age: 'Devonian' },
  { key: 'nisku', name: 'Winterburn (Nisku)', source: 'model', unit: '66_D_Wt', age: 'Devonian' },
  { key: 'leduc', name: 'Leduc', source: 'model', unit: '69_D_Ld', age: 'Devonian' },
  {
    key: 'beaverhill-lake',
    name: 'Swan Hills / Slave Point (Beaverhill Lake)',
    source: 'model',
    unit: '73_D_SH_SP',
    age: 'Devonian',
  },
];
