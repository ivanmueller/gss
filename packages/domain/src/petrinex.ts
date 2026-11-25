/**
 * Petrinex's public Conventional Volumetric Data (F-252 step 3): one CSV file a month, each
 * line a facility's activity for one product. A well's own production is the lines whose
 * "from" is the well (FromToIDType WI) with activity PROD. Units are Petrinex's (its
 * "Conventional Volumetric Data Download" description, read 2026-11-20): "m3 for liquids, e3m3
 * for gas"; hours are "Hours of production or injection". Used on the owner's decision
 * (docs/DECISIONS.md, 2026-11-20): non-commercial, members only, never exported.
 */

/**
 * One line of a CSV file as its fields (quotes doubled inside quoted fields). Its own copy of
 * st37.ts's reader: the loader script runs this file with Node directly, which follows no
 * import between the package's files.
 */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (line.charAt(i + 1) === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** A well's production in one month. Volumes in thousandths (of m3, or of e3m3 for gas). */
export interface PetrinexWellMonth {
  oil: number | null;
  gas: number | null;
  water: number | null;
  condensate: number | null;
  hours: number | null;
}

const PRODUCTS: Record<string, 'oil' | 'gas' | 'water' | 'condensate'> = {
  OIL: 'oil',
  GAS: 'gas',
  WATER: 'water',
  COND: 'condensate',
};

/** The columns read, by their names in the file's first line. */
const COLUMNS = [
  'ProductionMonth',
  'ActivityID',
  'ProductID',
  'FromToIDType',
  'FromToIDIdentifier',
  'Volume',
  'Hours',
] as const;
type Column = (typeof COLUMNS)[number];

/**
 * Petrinex's well identifier as the UWI the wells use: 100020606503W400 → 00/02-06-065-03W4/0.
 * Null when it is not an Alberta-style well identifier, or its event has no one-character form.
 */
export function petrinexWellUwi(id: string): string | null {
  const m = /^1([0-9A-Z]{2})(\d{2})(\d{2})(\d{3})(\d{2})W([4-6])0([0-9A-Z])$/.exec(id.trim());
  if (!m) return null;
  const [, le, lsd, section, township, range, meridian, event] = m;
  return `${String(le)}/${String(lsd)}-${String(section)}-${String(township)}-${String(range)}W${String(meridian)}/${String(event)}`;
}

/** "12.5" → 12500 thousandths; null when it is not a plain number of at most 3 decimals. */
export function petrinexThousandths(value: string): number | null {
  const m = /^(\d{1,10})(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'));
}

/** Thousandths as a decimal text for the database: 12500 → "12.500". */
export function petrinexDecimal(thousandths: number): string {
  const whole = Math.floor(thousandths / 1000);
  return `${String(whole)}.${String(thousandths - whole * 1000).padStart(3, '0')}`;
}

/**
 * What went into a well in one month (F-300): the lines whose "to" is the well (FromToIDType WI)
 * with activity INJ. Water of every kind (WATER, FSHWTR fresh, BRKWTR brackish) in thousandths
 * of m3, gas (GAS) in thousandths of e3m3; hours as for production.
 */
export interface PetrinexWellInjection {
  water: number | null;
  gas: number | null;
  hours: number | null;
}

const INJECTED: Record<string, 'water' | 'gas'> = {
  WATER: 'water',
  FSHWTR: 'water',
  BRKWTR: 'water',
  GAS: 'gas',
};

export interface PetrinexMonthResult {
  /** The production of the wells asked for, by UWI. */
  wells: Map<string, PetrinexWellMonth>;
  /** The injection of the wells asked for it, by UWI (F-300). */
  injection: Map<string, PetrinexWellInjection>;
  /** Lines of those wells left out as unreadable (a volume that is not a number). */
  skipped: number;
}

/**
 * Reads one month's file, line by line (the first is the header), and keeps the production of
 * the wells in `uwis` and the injection of those in `injectUwis` (F-300). A line of another month
 * than `month` ("2026-08") is an error: the file is not the one asked for.
 */
export function petrinexMonth(
  lines: Iterable<string>,
  month: string,
  uwis: ReadonlySet<string>,
  injectUwis: ReadonlySet<string> = new Set(),
): PetrinexMonthResult {
  const wells = new Map<string, PetrinexWellMonth>();
  const injection = new Map<string, PetrinexWellInjection>();
  const injecting = injectUwis.size > 0;
  let at: Record<Column, number> | null = null;
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line === '') continue;
    if (at === null) {
      const names = csvFields(line.charCodeAt(0) === 0xfeff ? line.slice(1) : line);
      const found = Object.fromEntries(COLUMNS.map((c) => [c, names.indexOf(c)])) as Record<
        Column,
        number
      >;
      const missing = COLUMNS.filter((c) => found[c] < 0);
      if (missing.length > 0) {
        throw new Error(`The file has no column ${missing.join(', ')}.`);
      }
      at = found;
      continue;
    }
    // Most lines are not a well's production or injection: a cheap look before splitting.
    if (!line.includes(',PROD,') && !(injecting && line.includes(',INJ,'))) continue;
    const fields = csvFields(line);
    const get = (c: Column) => (fields[at?.[c] ?? -1] ?? '').trim();
    const activity = get('ActivityID');
    if ((activity !== 'PROD' && activity !== 'INJ') || get('FromToIDType') !== 'WI') continue;
    const uwi = petrinexWellUwi(get('FromToIDIdentifier'));
    if (uwi === null || !(activity === 'PROD' ? uwis : injectUwis).has(uwi)) continue;
    if (get('ProductionMonth') !== month) {
      throw new Error(`The file holds ${get('ProductionMonth')}, not ${month}.`);
    }
    const hours = /^\d{1,3}$/.test(get('Hours')) ? Number(get('Hours')) : null;
    if (activity === 'INJ') {
      const fluid = INJECTED[get('ProductID')];
      if (!fluid) continue;
      const volume = petrinexThousandths(get('Volume'));
      if (volume === null) {
        skipped += 1;
        continue;
      }
      const well = injection.get(uwi) ?? { water: null, gas: null, hours: null };
      well[fluid] = (well[fluid] ?? 0) + volume;
      if (hours !== null && hours <= 744) well.hours = Math.max(well.hours ?? 0, hours);
      injection.set(uwi, well);
      continue;
    }
    const product = PRODUCTS[get('ProductID')];
    if (!product) continue;
    const volume = petrinexThousandths(get('Volume'));
    if (volume === null) {
      skipped += 1;
      continue;
    }
    const well = wells.get(uwi) ?? {
      oil: null,
      gas: null,
      water: null,
      condensate: null,
      hours: null,
    };
    well[product] = (well[product] ?? 0) + volume;
    // Hours come with one product or several: the well's are the most any of them reports.
    if (hours !== null && hours <= 744) well.hours = Math.max(well.hours ?? 0, hours);
    wells.set(uwi, well);
  }
  if (at === null) throw new Error('The file is empty.');
  return { wells, injection, skipped };
}

/** The months from `first` to `last`, both "YYYY-MM", in order. */
export function petrinexMonths(first: string, last: string): string[] {
  const parse = (m: string) => {
    const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(m);
    if (!match) throw new Error(`Not a month: ${m}`);
    return Number(match[1]) * 12 + Number(match[2]) - 1;
  };
  const out: string[] = [];
  for (let n = parse(first); n <= parse(last); n += 1) {
    out.push(`${String(Math.floor(n / 12))}-${String((n % 12) + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * The first month Petrinex gives free: January of the fourth year before the current production
 * year ("current production year plus the past four production years", its public data page).
 */
export function petrinexFirstFreeMonth(today: Date): string {
  return `${String(today.getUTCFullYear() - 4)}-01`;
}
