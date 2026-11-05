import type { Grain, GrainClass, GrainTable } from '../data/grains';
import { fold } from './grains';

// A grain's page shows one class at a time (owner's request, 2026-11-05): a short label for the
// picker, an address for each class, and its "on spec" limits: per grade the minimum test weight
// and protein, and the highest moisture a dry (straight grade) load may have. Every value is
// read from the grain's data as printed; nothing is calculated.

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The class's name without the grain's and Canada's words, e.g. "Red Spring" for "Wheat,
 * Canada Western Red Spring", "Malting, Two-row" for "Barley, Canada Western Malting, Two-row";
 * its region when nothing else is left ("Western" for "Oats, Canada Western"), or else the
 * name's first part ("Canola" for "Canola, Canada").
 */
export function classLabel(grainClass: GrainClass): string {
  const [first = grainClass.name, ...rest] = grainClass.name.split(',').map((part) => part.trim());
  const label = rest
    .map((part) =>
      part
        .replace(/\bCanada (Western|Eastern)\b/g, '')
        .replace(/\bCanada\b/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join(', ');
  // "Oats, Canada Western": its region is what tells it apart.
  if (label === '') return grainClass.region ?? first;
  return capitalize(label);
}

/** The class's address on its grain's page (?class=…), e.g. "cwrs-red-spring". */
export function classSlug(grainClass: GrainClass): string {
  const words = fold(
    `${grainClass.abbreviation ?? ''} ${grainClass.region ?? ''} ${classLabel(grainClass)}`,
  ).match(/[a-z0-9]+/g);
  // Each word once: "ce-eastern" for Eastern oats, not "ce-eastern-eastern".
  return [...new Set(words)].join('-');
}

/** The classes in groups for the picker: Western, Eastern, then those for all of Canada. */
export function classGroups(grain: Grain): { title: string | null; classes: GrainClass[] }[] {
  const groups = [
    { title: 'Western', classes: grain.classes.filter((c) => c.region === 'Western') },
    { title: 'Eastern', classes: grain.classes.filter((c) => c.region === 'Eastern') },
    { title: 'Canada', classes: grain.classes.filter((c) => c.region === undefined) },
  ].filter((group) => group.classes.length > 0);
  // One group, or one class in each (Western and Eastern oats), needs no headings.
  return groups.length === 1 || groups.every((group) => group.classes.length === 1)
    ? [{ title: null, classes: grain.classes }]
    : groups;
}

export interface Moisture {
  /** As printed, e.g. "less than 14.6": the most a straight (dry) grade may hold. */
  straight: string;
  tough?: string;
  damp?: string;
  /** The moisture table row it came from, when the grain's rows differ. */
  row?: string;
  table: GrainTable;
}

const IGNORED = new Set(['covered', 'kg', 'hl', 'and', 'the', 'or']);

function words(text: string): string[] {
  return (fold(text).match(/[a-z]+/g) ?? []).filter(
    (word) => word.length > 1 && !IGNORED.has(word),
  );
}

function column(table: GrainTable, name: string): number {
  return table.columns.findIndex((heading) => fold(heading).startsWith(name));
}

/**
 * The class's moisture limits from its grain's moisture table: the one row when every row has
 * the same limits, or else the rows whose words are all in the class's name (most words
 * first), hulless rows only for hulless classes. Undefined when no row fits.
 */
export function classMoisture(grain: Grain, grainClass: GrainClass): Moisture | undefined {
  const table = grain.tables.find((candidate) => /moisture/i.test(candidate.title));
  if (!table) return undefined;
  const [straight, tough, damp] = ['straight', 'tough', 'damp'].map((name) => column(table, name));
  if (straight === undefined || straight < 0) return undefined;
  const limits = (row: string[]): Moisture => ({
    straight: row[straight] ?? '',
    ...(tough !== undefined && tough >= 0 && { tough: row[tough] ?? '' }),
    ...(damp !== undefined && damp >= 0 && { damp: row[damp] ?? '' }),
    table,
  });
  const same = (a: Moisture, b: Moisture) =>
    a.straight === b.straight && a.tough === b.tough && a.damp === b.damp;

  const all = table.rows.map(limits);
  const [first] = all;
  if (first && all.every((entry) => same(entry, first))) return first;

  const name = new Set(words(`${grainClass.name} ${grainClass.abbreviation ?? ''}`));
  const hulless = name.has('hulless');
  const fitting = table.rows
    .map((row) => ({ row, label: words(row[0] ?? '') }))
    .filter(
      ({ label }) =>
        label.length > 0 &&
        label.every((word) => name.has(word)) &&
        label.includes('hulless') === hulless,
    );
  const most = Math.max(0, ...fitting.map(({ label }) => label.length));
  const best = fitting.filter(({ label }) => label.length === most).map(({ row }) => row);
  const [chosen] = best;
  if (!chosen || !best.every((row) => same(limits(row), limits(chosen)))) return undefined;
  return { ...limits(chosen), row: chosen[0] ?? '' };
}

/** "75 (365)" as "75": the kg/hL figure without its g/0.5 L equivalent. */
function kilograms(cell: string): string {
  return cell.replace(/\s*\(\d+\)\s*$/, '');
}

export interface OnSpec {
  columns: string[];
  rows: string[][];
  /** The tables the limits were read from, for their sources. */
  tables: GrainTable[];
  moisture?: Moisture;
}

/**
 * Per grade: the minimum test weight (kg/hL) and protein from the class's standard of quality
 * (columns no grade has are left out), and the class's moisture limits, the same for every
 * grade, shown once.
 */
export function onSpec(grain: Grain, grainClass: GrainClass): OnSpec {
  const quality = (grainClass.tables ?? []).find((table) =>
    /standard of quality/i.test(table.title),
  );
  const factor = (pattern: RegExp) => quality?.rows.find((row) => pattern.test(row[0] ?? ''));
  const testWeight = factor(/test weight/i);
  const protein = factor(/protein/i);
  const moisture = classMoisture(grain, grainClass);
  const grades = grainClass.grades ?? [];
  const cell = (row: string[] | undefined, grade: string, read = (text: string) => text) => {
    const index = quality ? quality.columns.indexOf(grade) : -1;
    const value = index > 0 ? row?.[index] : undefined;
    return value === undefined ? '—' : read(value);
  };
  const parts: { heading: string; values: string[] }[] = [];
  if (testWeight) {
    parts.push({
      heading: 'Min. test weight (kg/hL)',
      values: grades.map((grade) => cell(testWeight, grade, kilograms)),
    });
  }
  if (protein) {
    parts.push({
      heading: 'Min. protein (%)',
      values: grades.map((grade) => cell(protein, grade)),
    });
  }
  const used = parts.filter((part) => part.values.some((value) => value !== '—'));
  return {
    columns: ['Grade', ...used.map((part) => part.heading)],
    rows: grades.map((grade, index) => [grade, ...used.map((part) => part.values[index] ?? '—')]),
    tables: quality && (testWeight || protein) ? [quality] : [],
    ...(moisture && { moisture }),
  };
}
