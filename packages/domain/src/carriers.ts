import { z } from 'zod';

import {
  createCounterpartySchema,
  TRANSPORT_ACCESS,
  updateCounterpartySchema,
  type TransportAccess,
} from './directory';
import { EQUIPMENT, isLaneRegion, laneCountry, laneRegionName } from './carrier-basics';

export * from './carrier-basics';

// A carrier's lanes and equipment (owner's request and answers, 2026-11-01; docs/DECISIONS.md).

/** Where a carrier runs: from one province or state to another, by truck, rail or both. */
export interface CarrierLane {
  origin: string;
  destination: string;
  /** Truck, rail or both only when stated; null when not (owner's answer, 2026-11-01). */
  transport: TransportAccess | null;
}

/**
 * A lane as listed on a carrier: verified by someone on the team (when), or not yet, as a lane
 * from a spreadsheet is until a rep calls the carrier (owner's request, 2026-11-01).
 */
export interface ListedLane extends CarrierLane {
  verifiedAt: string | null;
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
    /** Listed lanes to verify, in the person's name; one already verified stays as it is. */
    verify: z.array(lanePlaces).max(MAX_LANE_CHANGE).default([]),
  })
  .refine((change) => change.add.length + change.remove.length + change.verify.length > 0, {
    message: 'nothing to change',
  });
export type LaneChange = z.infer<typeof laneChangeSchema>;
/** A change as sent; `verify` may be left out. */
export type LaneChangeInput = z.input<typeof laneChangeSchema>;

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
