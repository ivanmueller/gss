/**
 * Operators across the oil and gas map's layers (F-302): the AER's wells (ST37) name their
 * licensee only, its facilities (ST102) and pipelines name a company with its four-character
 * business associate code. Names are written differently from one list to the next
 * ("EXAMPLE ENERGY LTD." and "Example Energy Ltd."), so they are compared by a key: upper case,
 * a trailing "(A1XX)" code taken off, every other character than letters and digits a space.
 */

/** A company as one source counts it: its code when the source has one, its name, how many. */
export interface OperatorSourceRow {
  source: 'wells' | 'facilities' | 'pipelines';
  code: string | null;
  name: string | null;
  count: number;
}

/** One operator over every source: the name shown, its codes and what it holds in each. */
export interface Operator {
  name: string;
  codes: string[];
  wells: number;
  facilities: number;
  pipelines: number;
}

const CODE_SUFFIX = /\s*\(([0-9A-Z]{4})\)\s*$/;

/** The key a name is compared by; '' for no name. */
export function operatorKey(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toUpperCase()
    .replace(CODE_SUFFIX, '')
    .replace(/&/g, ' AND ')
    .replace(/[^0-9A-Z]+/g, ' ')
    .trim();
}

/**
 * Whether a company's name holds the text typed or picked, compared by their keys: "sample
 * midstream" and "sample mid" hold in "SAMPLE MIDSTREAM ALBERTA LTD."; every name holds no text.
 */
export function operatorMatches(name: string | null | undefined, text: string): boolean {
  const wanted = operatorKey(text);
  if (wanted === '') return true;
  const key = operatorKey(name);
  return key !== '' && key.includes(wanted);
}

/** A name for reading: one with lower case letters before one in capitals, then the most used. */
function better(a: { name: string; count: number }, b: { name: string; count: number }): boolean {
  const mixed = (s: string) => s !== s.toUpperCase();
  if (mixed(a.name) !== mixed(b.name)) return mixed(a.name);
  return a.count > b.count;
}

/**
 * Every operator once, the largest first (wells, facilities and pipelines together), then by
 * name. Rows with no name are left out.
 */
export function mergeOperators(rows: readonly OperatorSourceRow[]): Operator[] {
  const byKey = new Map<
    string,
    { operator: Operator; shown: { name: string; count: number }; codes: Set<string> }
  >();
  for (const row of rows) {
    const key = operatorKey(row.name);
    if (key === '' || row.name === null || row.count <= 0) continue;
    const name = row.name.replace(CODE_SUFFIX, '').trim();
    const code = row.code ?? CODE_SUFFIX.exec(row.name)?.[1] ?? null;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        operator: { name, codes: [], wells: 0, facilities: 0, pipelines: 0 },
        shown: { name, count: row.count },
        codes: new Set(),
      };
      byKey.set(key, entry);
    } else if (better({ name, count: row.count }, entry.shown)) {
      entry.shown = { name, count: row.count };
      entry.operator.name = name;
    }
    if (code !== null) entry.codes.add(code);
    entry.operator[row.source] += row.count;
  }
  const total = (o: Operator) => o.wells + o.facilities + o.pipelines;
  return [...byKey.values()]
    .map(({ operator, codes }) => ({ ...operator, codes: [...codes].sort() }))
    .sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name, 'en-CA'));
}
