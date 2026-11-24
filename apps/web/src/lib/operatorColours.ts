import { operatorKey } from '@grain/domain';
import type { ExpressionSpecification } from 'mapbox-gl';

// Colour by operator on the oil and gas map (F-302 part 2, the owner, 2026-11-24): the ten
// operators with the most wells, facilities and pipeline segments in view get a colour each,
// the same on every layer; every other operator is grey. Each feature carries its operator's
// key (`op`, operatorKey) so the map can colour it.

/** Ten colours told apart on the light and the dark map, none of them grey. */
export const OPERATOR_PALETTE = [
  '#4e79a7',
  '#f28e2b',
  '#e15759',
  '#59a14f',
  '#b07aa1',
  '#edc948',
  '#76b7b2',
  '#ff9da7',
  '#9c755f',
  '#1f3b73',
] as const;

/** Every operator not among the ten. */
export const OPERATOR_OTHER = '#a8a29e';

/** An operator in view: its key, the name shown and how many of its things are in view. */
export interface OperatorCount {
  key: string;
  name: string;
  count: number;
}

/** An operator among the ten, with its colour. */
export interface OperatorColour extends OperatorCount {
  colour: string;
}

/** The operators of a list of names, counted by key (no name: left out). */
export function countOperators(names: Iterable<string | null | undefined>): OperatorCount[] {
  const byKey = new Map<string, OperatorCount>();
  for (const name of names) {
    const key = operatorKey(name);
    if (key === '' || !name) continue;
    const found = byKey.get(key);
    if (found) found.count += 1;
    else byKey.set(key, { key, name: name.trim(), count: 1 });
  }
  return [...byKey.values()];
}

/**
 * The ten (or `n`) operators with the most in view over every layer given, the largest first,
 * each with its colour by rank; ties by name. A null list (a layer off) counts nothing.
 */
export function topOperators(
  lists: readonly (readonly OperatorCount[] | null)[],
  n: number = OPERATOR_PALETTE.length,
): OperatorColour[] {
  const byKey = new Map<string, OperatorCount>();
  for (const list of lists) {
    for (const o of list ?? []) {
      const found = byKey.get(o.key);
      if (found) found.count += o.count;
      else byKey.set(o.key, { ...o });
    }
  }
  return [...byKey.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'en-CA'))
    .slice(0, Math.min(n, OPERATOR_PALETTE.length))
    .map((o, i) => ({ ...o, colour: OPERATOR_PALETTE[i] ?? OPERATOR_OTHER }));
}

/** The map's colour for a feature by its `op`: one of the ten's colours, else grey. */
export function operatorColourExpression(
  top: readonly OperatorColour[],
): ExpressionSpecification | string {
  if (top.length === 0) return OPERATOR_OTHER;
  return [
    'match',
    ['get', 'op'],
    ...top.flatMap((o) => [o.key, o.colour]),
    OPERATOR_OTHER,
  ] as unknown as ExpressionSpecification;
}
