import { CA_REGIONS, US_REGIONS, type CountryCode } from './regions';

// The places a lane runs between and the equipment a carrier hauls with (owner's request and
// answers, 2026-11-01; docs/DECISIONS.md), with how a spreadsheet's cells are read. Kept apart
// from carriers.ts, which builds on directory.ts, so that directory.ts can read these columns
// without the two importing each other.

/**
 * The places a lane runs from and to: Canada's provinces and territories and the U.S. states
 * and DC, as ISO 3166-2 codes ("CA-AB", "US-MT"). The database holds the same list
 * (app.lane_region, 20261101010000_carrier_lanes.sql).
 */
export const LANE_REGIONS: readonly string[] = [
  ...Object.keys(CA_REGIONS).map((code) => `CA-${code}`),
  ...Object.keys(US_REGIONS).map((code) => `US-${code}`),
];
const LANE_REGION_SET = new Set(LANE_REGIONS);

export function isLaneRegion(code: string): boolean {
  return LANE_REGION_SET.has(code);
}

/** "CA-AB" → "CA". */
export function laneCountry(code: string): CountryCode {
  return code.startsWith('US-') ? 'US' : 'CA';
}

/** "CA-AB" → "Alberta"; an unknown code as it is. */
export function laneRegionName(code: string): string {
  const [country, region = ''] = code.split('-');
  const names = country === 'US' ? US_REGIONS : country === 'CA' ? CA_REGIONS : {};
  return names[region] ?? code;
}

/** "CA-AB" → "AB". */
export function laneRegionShort(code: string): string {
  return code.slice(code.indexOf('-') + 1);
}

/** A location's country and province or state as a lane's place; null when not a known one. */
export function laneRegionOf(country: string, region: string | null): string | null {
  if (region === null) return null;
  const code = `${country}-${region}`;
  return isLaneRegion(code) ? code : null;
}

/** The lane places of one country, by name, for pickers. */
export function laneRegionsOf(country: CountryCode): { code: string; name: string }[] {
  return LANE_REGIONS.filter((code) => laneCountry(code) === country)
    .map((code) => ({ code, name: laneRegionName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What a carrier hauls with (owner's request, 2026-11-01: only what traders need). Bulk grain
 * goes in hoppers or railcars; bagged pet and bird feed in vans or on flatdecks.
 */
export const EQUIPMENT = [
  'super_b',
  'tridem',
  'walking_floor',
  'van',
  'flatdeck',
  'container',
  'hopper_car',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  super_b: 'Super B hopper',
  tridem: 'Tridem hopper',
  walking_floor: 'Walking floor',
  van: 'Dry van',
  flatdeck: 'Flatdeck',
  container: 'Container',
  hopper_car: 'Rail hopper car',
};

/** "Super B, Dry van" (names or codes, separated by commas, semicolons, slashes or "and"). */
export function parseEquipmentList(text: string): { equipment: Equipment[]; unknown: string[] } {
  const found = new Set<Equipment>();
  const unknown: string[] = [];
  for (const part of text.split(/[;,/|\n]+| and | & /i)) {
    const name = part.trim();
    if (name === '') continue;
    const item = EQUIPMENT_NAMES.get(equipmentKey(name));
    if (item) found.add(item);
    else unknown.push(name);
  }
  return { equipment: EQUIPMENT.filter((item) => found.has(item)), unknown };
}

/** Lower case, letters and digits only: "Super-B" and "super b" read the same. */
function equipmentKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const EQUIPMENT_NAMES = new Map<string, Equipment>([
  ...EQUIPMENT.map((item) => [equipmentKey(EQUIPMENT_LABELS[item]), item] as const),
  ...EQUIPMENT.map((item) => [equipmentKey(item), item] as const),
  [equipmentKey('Super B'), 'super_b'],
  [equipmentKey('B-train'), 'super_b'],
  [equipmentKey('Super B hoppers'), 'super_b'],
  [equipmentKey('Tridem'), 'tridem'],
  [equipmentKey('Tridem hoppers'), 'tridem'],
  [equipmentKey('Van'), 'van'],
  [equipmentKey('Dry vans'), 'van'],
  [equipmentKey('Flat deck'), 'flatdeck'],
  [equipmentKey('Flatbed'), 'flatdeck'],
  [equipmentKey('Containers'), 'container'],
  [equipmentKey('Hopper car'), 'hopper_car'],
  [equipmentKey('Hopper cars'), 'hopper_car'],
  [equipmentKey('Railcar'), 'hopper_car'],
  [equipmentKey('Rail car'), 'hopper_car'],
]);

/** A province, territory or state by its code or name, in either country; null when not one. */
function placeFrom(name: string): string | null {
  const wanted = name.trim().replace(/\./g, '').toLowerCase();
  if (wanted === '') return null;
  const iso = /^(ca|us)-([a-z]{2})$/.exec(wanted);
  if (iso) {
    const code = `${(iso[1] ?? '').toUpperCase()}-${(iso[2] ?? '').toUpperCase()}`;
    return isLaneRegion(code) ? code : null;
  }
  for (const [country, regions] of [
    ['CA', CA_REGIONS],
    ['US', US_REGIONS],
  ] as const) {
    for (const [code, full] of Object.entries(regions)) {
      if (wanted === code.toLowerCase() || wanted === full.toLowerCase())
        return `${country}-${code}`;
    }
  }
  return null;
}

/** "AB, SK" or "Alberta; Montana": the places, each once in the order given, and any not known. */
export function parsePlaceList(text: string): { places: string[]; unknown: string[] } {
  const places: string[] = [];
  const unknown: string[] = [];
  for (const part of text.split(/[;,/|\n]+| and | & /i)) {
    const name = part.trim();
    if (name === '') continue;
    const place = placeFrom(name);
    if (place === null) unknown.push(name);
    else if (!places.includes(place)) places.push(place);
  }
  return { places, unknown };
}

/** A Mode cell: truck, rail or both; null for an empty cell; undefined when not one of them. */
export function parseLaneMode(
  text: string | null,
): 'truck' | 'rail' | 'rail_and_truck' | null | undefined {
  if (text === null) return null;
  const words = text
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
  if (['truck', 'trucks', 'trucking'].includes(words)) return 'truck';
  if (['rail', 'train', 'railcar', 'rail car'].includes(words)) return 'rail';
  if (['both', 'truck and rail', 'rail and truck', 'truck rail', 'rail truck'].includes(words)) {
    return 'rail_and_truck';
  }
  return undefined;
}
