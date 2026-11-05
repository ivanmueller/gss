import { ACREAGE } from '../data/grains/acreage';
import type { Grain, GrainClass } from '../data/grains';
import { fold } from './grains';

// What a grain's window shows (owner's request, 2026-11-05): only the classes most grown on
// the Prairies (Alberta, Saskatchewan, Manitoba), most acres first, each with its most grown
// varieties, from the Canadian Grain Commission's acres insured in 2025 (data/grains/acreage.ts).

type Acreage = typeof ACREAGE;

/** A class shown in the window, with its Prairie acres (when known) and top varieties. */
export interface ShownClass {
  grainClass: GrainClass;
  /** Acres insured in 2025 over the three provinces; undefined when the source gives no class. */
  acres?: number;
  /** Most grown first, at most five. */
  varieties: string[];
}

/** Classes under this share of their grain's Prairie acres are left out of the window. */
export const MIN_SHARE = 0.005;
const SHOWN_VARIETIES = 5;

/** The CSV's barley classes as the grading guide names them. */
const BARLEY: Record<string, string> = {
  CW_2_ROW_MALTING: 'Barley, Canada Western Malting, Two-row',
  CW_6_ROW_MALTING: 'Barley, Canada Western Malting, Six-row',
  CW_2_ROW_MALTING_HULLESS: 'Barley, Canada Western Malting, Two-row Hulless',
  CW_2_ROW_FOOD: 'Barley, Canada Western Food, Two-row',
  CW_2_ROW_HULLESS_FOOD: 'Barley, Canada Western Food, Two-row Hulless',
  // Varieties in no malting or food class are graded General Purpose (any registered variety).
  'UNKNOWN CLASS': 'Barley, Canada Western General Purpose',
};

/**
 * "AAC BRANDON" as the grading guide or a trial table spells it ("AAC Brandon"); otherwise
 * long words capitalized ("SNOWBIRD" → "Snowbird") and codes kept ("DKC31-85RIB").
 */
export function varietyName(printed: string, grain: Grain): string {
  const known = [
    ...grain.classes.flatMap((grainClass) => grainClass.varieties ?? []),
    ...grain.tables.flatMap((table) => table.rows.map((row) => row[0] ?? '')),
    ...grain.classes.flatMap((grainClass) =>
      (grainClass.tables ?? []).flatMap((table) => table.rows.map((row) => row[0] ?? '')),
    ),
  ];
  const match = known.find((name) => fold(name) === fold(printed));
  if (match) return match;
  return printed
    .split(' ')
    .map((word) => (/^[A-Z]{4,}$/.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word))
    .join(' ');
}

/** Which of the grain's classes a CSV class (and, for CPS wheat, a variety) belongs to. */
function classFor(grain: Grain, kind: string, variety: string): GrainClass | undefined {
  const western = grain.classes.filter((grainClass) => grainClass.region !== 'Eastern');
  if (grain.id === 'wheat') {
    if (kind === 'CPS') {
      // Canada Prairie Spring: red or white, told apart by the variety's designation.
      return western.find(
        (grainClass) =>
          (grainClass.abbreviation === 'CPSR' || grainClass.abbreviation === 'CPSW') &&
          (grainClass.varieties ?? []).some((name) => fold(name) === fold(variety)),
      );
    }
    return western.find((grainClass) => grainClass.abbreviation === kind);
  }
  if (grain.id === 'barley') return western.find((grainClass) => grainClass.name === BARLEY[kind]);
  return undefined;
}

/**
 * The classes the window shows. For wheat and barley, whose acres are given by class: those
 * with at least MIN_SHARE of the grain's classed acres, most acres first, each with its own
 * most grown varieties. For the others: their Western and Canada-wide classes as the guide
 * lists them, without varieties (see grainVarieties).
 */
export function shownClasses(grain: Grain, acreage: Acreage = ACREAGE): ShownClass[] {
  const kinds = acreage[grain.id] ?? {};
  if (grain.id === 'wheat' || grain.id === 'barley') {
    const byClass = new Map<GrainClass, { acres: number; varieties: [string, number][] }>();
    for (const [kind, entry] of Object.entries(kinds)) {
      if (kind === 'CPS') {
        for (const [variety, acres] of entry.varieties) {
          const grainClass = classFor(grain, kind, variety);
          if (!grainClass) continue;
          const shown = byClass.get(grainClass) ?? { acres: 0, varieties: [] };
          shown.acres += acres;
          shown.varieties.push([variety, acres]);
          byClass.set(grainClass, shown);
        }
        continue;
      }
      const grainClass = classFor(grain, kind, '');
      if (!grainClass) continue;
      const shown = byClass.get(grainClass) ?? { acres: 0, varieties: [] };
      shown.acres += entry.acres;
      shown.varieties.push(...entry.varieties);
      byClass.set(grainClass, shown);
    }
    const total = [...byClass.values()].reduce((sum, entry) => sum + entry.acres, 0);
    return [...byClass.entries()]
      .filter(([, entry]) => total > 0 && entry.acres / total >= MIN_SHARE)
      .sort((a, b) => b[1].acres - a[1].acres)
      .map(([grainClass, entry]) => ({
        grainClass,
        acres: entry.acres,
        varieties: entry.varieties
          .sort((a, b) => b[1] - a[1])
          .slice(0, SHOWN_VARIETIES)
          .map(([name]) => varietyName(name, grain)),
      }));
  }
  return grain.classes
    .filter((grainClass) => grainClass.region !== 'Eastern')
    .map((grainClass) => ({ grainClass, varieties: [] }));
}

/**
 * For a grain whose acres are not given by class (all but wheat and barley): its most grown
 * varieties over all its kinds, most acres first, at most five.
 */
export function grainVarieties(grain: Grain, acreage: Acreage = ACREAGE): string[] {
  if (grain.id === 'wheat' || grain.id === 'barley') return [];
  return Object.values(acreage[grain.id] ?? {})
    .flatMap((entry) => entry.varieties)
    .sort((a, b) => b[1] - a[1])
    .slice(0, SHOWN_VARIETIES)
    .map(([name]) => varietyName(name, grain));
}
