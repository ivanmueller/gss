import { z } from 'zod';

import {
  createCounterpartySchema,
  TRANSPORT_ACCESS,
  updateCounterpartySchema,
  type TransportAccess,
} from './directory';
import { CA_REGIONS, US_REGIONS, type CountryCode } from './regions';

// A carrier's lanes and equipment (owner's request and answers, 2026-11-01; docs/DECISIONS.md).

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

/** Where a carrier runs: from one province or state to another, by truck, rail or both. */
export interface CarrierLane {
  origin: string;
  destination: string;
  /** Truck, rail or both only when stated; null when not (owner's answer, 2026-11-01). */
  transport: TransportAccess | null;
}

const laneRegion = z.string().refine(isLaneRegion, { message: 'not a province or state' });
const lanePlaces = z.object({ origin: laneRegion, destination: laneRegion });

/** One lane as sent: its places, and truck, rail or both, or null when not stated. */
export const laneSchema = lanePlaces.extend({
  transport: z.enum(TRANSPORT_ACCESS).nullable(),
});

/** Most lanes one change may add or remove (every pair of places is far more than needed). */
export const MAX_LANE_CHANGE = 500;

/**
 * PATCH /api/v1/counterparties/{id}/lanes: lanes to add (or whose transport to change, when
 * the pair of places is listed) and lanes to remove, by their places.
 */
export const laneChangeSchema = z
  .object({
    add: z.array(laneSchema).max(MAX_LANE_CHANGE),
    remove: z.array(lanePlaces).max(MAX_LANE_CHANGE),
  })
  .refine((change) => change.add.length + change.remove.length > 0, {
    message: 'nothing to change',
  });
export type LaneChange = z.infer<typeof laneChangeSchema>;

/** A lane that crosses the border between Canada and the United States. */
export function crossesBorder(lane: Pick<CarrierLane, 'origin' | 'destination'>): boolean {
  return laneCountry(lane.origin) !== laneCountry(lane.destination);
}

/**
 * Whether any lane runs from one of `from` to one of `to`; an empty list stands for anywhere.
 * Used by the Counterparties filter for carriers.
 */
export function runsLane(
  lanes: readonly Pick<CarrierLane, 'origin' | 'destination'>[],
  from: readonly string[],
  to: readonly string[],
): boolean {
  if (from.length === 0 && to.length === 0) return true;
  return lanes.some(
    (lane) =>
      (from.length === 0 || from.includes(lane.origin)) &&
      (to.length === 0 || to.includes(lane.destination)),
  );
}

/** One origin's lanes with the same transport, to show as "From Alberta → Montana, North Dakota". */
export interface LaneGroup {
  origin: string;
  transport: TransportAccess | null;
  destinations: string[];
}

/** Truck, rail and both in that order, then not stated. */
function transportOrder(transport: TransportAccess | null): number {
  return transport === null ? TRANSPORT_ACCESS.length : TRANSPORT_ACCESS.indexOf(transport);
}

/** Lanes grouped by origin and transport, origins and destinations by name. */
export function groupLanes(lanes: readonly CarrierLane[]): LaneGroup[] {
  const groups = new Map<string, LaneGroup>();
  for (const lane of lanes) {
    const key = `${lane.origin} ${lane.transport ?? 'not_stated'}`;
    const group = groups.get(key) ?? {
      origin: lane.origin,
      transport: lane.transport,
      destinations: [],
    };
    group.destinations.push(lane.destination);
    groups.set(key, group);
  }
  const byName = (a: string, b: string) => laneRegionName(a).localeCompare(laneRegionName(b));
  return [...groups.values()]
    .map((group) => ({ ...group, destinations: [...group.destinations].sort(byName) }))
    .sort(
      (a, b) =>
        byName(a.origin, b.origin) || transportOrder(a.transport) - transportOrder(b.transport),
    );
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

/** Equipment as sent: each once, in EQUIPMENT order. */
export const equipmentSchema = z
  .array(z.enum(EQUIPMENT))
  .max(EQUIPMENT.length * 2)
  .transform((items) => EQUIPMENT.filter((item) => items.includes(item)));

/**
 * PATCH /api/v1/counterparties/{id}: the company's fields and, for a carrier, its equipment;
 * left out, the equipment is kept.
 */
export const updateCounterpartyDetailsSchema = updateCounterpartySchema.extend({
  equipment: equipmentSchema.optional(),
});

/**
 * POST /api/v1/counterparties: one counterparty entered by hand and, for a carrier, its
 * equipment and first lanes (owner's request, 2026-11-01).
 */
export const createCounterpartyDetailsSchema = createCounterpartySchema.extend({
  equipment: equipmentSchema.optional(),
  lanes: z.array(laneSchema).max(MAX_LANE_CHANGE).optional(),
});
