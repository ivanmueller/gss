import { GRAINS, type Grain } from '../data/grains';
import type { SourceId } from '../data/grains/sources';

/** Lower case, accents removed, runs of spaces made one: how search compares text. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a search found in a grain: the grain itself (by name) or one of its classes or varieties. */
export interface GrainMatch {
  grain: Grain;
  /** E.g. "Variety of Canada Western Red Spring (CWRS)"; absent when the grain's name matched. */
  detail?: string;
  /** The matched name, e.g. "AAC Brandon". */
  name: string;
}

function matches(words: string[], text: string): boolean {
  const folded = fold(text);
  return words.every((word) => folded.includes(word));
}

function className(name: string, abbreviation: string | undefined): string {
  return abbreviation ? `${name} (${abbreviation})` : name;
}

/**
 * Searches every grain's names, classes (and their abbreviations) and varieties for all the
 * words typed, ignoring case and accents: the grains whose names match first, then classes,
 * then varieties, at most `limit` results.
 */
export function searchGrains(query: string, grains: readonly Grain[] = GRAINS, limit = 60) {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const byName: GrainMatch[] = [];
  const byClass: GrainMatch[] = [];
  const byVariety: GrainMatch[] = [];
  for (const grain of grains) {
    if ([grain.name, ...(grain.otherNames ?? [])].some((name) => matches(words, name))) {
      byName.push({ grain, name: grain.name });
    }
    const varieties = new Map<string, string[]>();
    for (const grainClass of grain.classes) {
      const label = className(grainClass.name, grainClass.abbreviation);
      if (matches(words, label)) byClass.push({ grain, name: label, detail: 'Class' });
      for (const variety of grainClass.varieties ?? []) {
        if (matches(words, variety)) {
          varieties.set(variety, [...(varieties.get(variety) ?? []), label]);
        }
      }
    }
    // Varieties only in a trial table (e.g. a grain without designated varieties).
    for (const table of grain.tables) {
      if (fold(table.columns[0] ?? '') !== 'variety') continue;
      for (const row of table.rows) {
        const variety = row[0];
        if (variety !== undefined && !varieties.has(variety) && matches(words, variety)) {
          varieties.set(variety, []);
        }
      }
    }
    for (const [variety, classes] of varieties) {
      byVariety.push({
        grain,
        name: variety,
        detail: classes.length > 0 ? `Variety · ${classes.join(', ')}` : 'Variety',
      });
    }
  }
  return [...byName, ...byClass, ...byVariety].slice(0, limit);
}

/** The grain a GSS commodity belongs to, for the link from its badge. */
export function grainForCommodity(
  code: string,
  grains: readonly Grain[] = GRAINS,
): Grain | undefined {
  return grains.find((grain) => (grain.commodities as readonly string[]).includes(code));
}

/** The sources a grain's facts cite, in the order first cited. */
export function sourcesOf(grain: Grain): SourceId[] {
  const seen = new Set<SourceId>();
  const add = (citation: { source: SourceId } | undefined) => {
    if (citation) seen.add(citation.source);
  };
  grain.facts.forEach(add);
  for (const grainClass of grain.classes) {
    add(grainClass.gradesCitation);
    add(grainClass.varietiesCitation);
    grainClass.facts?.forEach(add);
    grainClass.tables?.forEach(add);
  }
  grain.tables.forEach(add);
  return [...seen];
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "2026-11-05" as "November 5, 2026": a calendar date, with no time zone to shift it. */
export function formatCheckedDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  if (!match || month === undefined) return iso;
  return `${month} ${String(Number(match[3]))}, ${match[1] ?? ''}`;
}
