/**
 * The AER's Hydraulic Fracturing Summary Chemical and Water Use Data (F-288): one pipe-delimited
 * file of every frac reported in Alberta under Directive 059 since 31 December 2012, a line per
 * ingredient of each component, read 2026-11-23 from
 * https://www.aer.ca/data-and-performance-reports/activity-and-data/lists-and-activities/hydraulic-fracture-fluid-data
 * (SummaryChemical-WaterUse.csv). Kept one line per well event: its fracs' dates, stages, water
 * and the proppant placed, as the C* of the Modernized Royalty Framework needs it
 * (packages/domain/src/royalties.ts). Used on the owner's decision for the AER's data
 * (docs/DECISIONS.md, 2026-11-19): members only, non-commercial, the AER named.
 *
 * Amounts are summed in thousandths as whole numbers (the file writes three decimals), so no
 * float ever adds them; they leave as decimal strings.
 */

const UWI = /^[0-9A-Z]{2}\/[0-9]{2}-[0-9]{2}-[0-9]{3}-[0-9]{2}W[4-6]\/[0-9A-Z]$/;
const DAY = /^(\d{4}-\d{2}-\d{2})[ T]/;
const AMOUNT = /^\d{1,9}(?:\.\d{1,6})?$/;

/** The columns read, by their names in the file's header line. */
const COLUMNS = [
  'Well_Licence_Number',
  'Last_Submission_Date',
  'UWI',
  'Number_Of_Stages',
  'Max_True_Vertical_Depth',
  'Total_Water_Volume',
  'Start_Date',
  'End_Date',
  'Component_Type',
  'Component_Trade_Name',
  'Component_Quantity_UOM',
  'Total_Component_Volume_or_Weight',
  'Component_Supplier_Name',
  'Ingredient_Name',
] as const;
type Column = (typeof COLUMNS)[number];

/** A frac done within this many days of a well's first frac is part of its first completion. */
export const FIRST_COMPLETION_DAYS = 365;

/**
 * More proppant than this a stage reads as a reporting error (a unit slip): across every well of
 * the file of 2026-11-16 the median is 30 t a stage and 99% are under about 1,000 t, then values
 * run to 163,146 t a stage. Such a well's proppant is kept as reported but marked, and not used.
 */
export const SUSPECT_TONNES_PER_STAGE = 1000;

// Words in a proppant's trade name or ingredients that suggest a resin coating or a ceramic. A
// hint only: the royalty counts coated sand at 1.5 and engineered proppant at 2.5 only when the
// province accepts them as such, which the file does not say.
const UPGRADE_HINT =
  /\b(rcs|crc|prc|resin\w*|coated|ceramic\w*|carbo\w*|bauxite|mullite|corundum|aluminum oxide|alumina|phenol\w*|formaldehyde|furfuryl|polyurethane|hexamethylenetetramine)\b/i;

/** One well event's fracs, as kept. */
export interface FracWell {
  uwi: string;
  licenceNumber: string;
  /** YYYY-MM-DD: the first frac's start and the last frac's end. */
  firstFracDate: string;
  lastFracDate: string;
  /** Reports (frac jobs) filed. */
  fracs: number;
  /** Stages of the first completion. */
  stages: number | null;
  /** Water of every frac, m3. */
  waterM3: string;
  /** Proppant of the first completion (within FIRST_COMPLETION_DAYS), tonnes. */
  proppantT: string;
  /** Of it, tonnes whose name or ingredients suggest coated or ceramic proppant. */
  upgradeHintT: string;
  /** Proppant of later fracs (re-fracs), tonnes. */
  refracProppantT: string;
  /** The deepest true vertical depth reported, m. */
  maxTvdM: string | null;
  /** True when the first completion's proppant passes SUSPECT_TONNES_PER_STAGE a stage. */
  suspect: boolean;
}

export interface FracRead {
  wells: FracWell[];
  /** Lines that could not be read (a wrong number of fields, a malformed UWI or date). */
  skipped: number;
  /** Proppant lines in a unit other than metric tonnes, left out. */
  otherUnits: number;
}

/** "1,376.520" or "1376.520" → 1376520 thousandths; null for NULL, empty or not a number. */
export function thousandths(text: string): number | null {
  const t = text.trim().replaceAll(',', '');
  if (!AMOUNT.test(t)) return null;
  const [whole = '0', fraction = ''] = t.split('.');
  return Number(whole) * 1000 + Number(fraction.padEnd(3, '0').slice(0, 3));
}

/** 1376520 thousandths → "1376.52". */
export function fromThousandths(n: number): string {
  const whole = Math.trunc(n / 1000);
  const rest = n % 1000;
  return rest === 0
    ? String(whole)
    : `${String(whole)}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`;
}

interface Submission {
  /** From its additive and proppant lines: carrier fluid lines may span earlier fracs too. */
  start: string | null;
  end: string | null;
  /** From its carrier fluid lines, for a report with no others (water alone). */
  fluidStart: string;
  fluidEnd: string;
  stages: number | null;
  water: number;
  /** Proppant by component, so a component's tonnes count once however many ingredients it lists. */
  components: Map<string, { start: string; tonnes: number; hint: boolean }>;
}

interface WellParts {
  licence: string;
  tvd: number | null;
  submissions: Map<string, Submission>;
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Reads the file's lines (the AER's disclaimer lines first, then a header) into one line per
 * well event. A component's tonnes are written on each of its ingredient lines: counted once.
 */
export function fracWells(lines: Iterable<string>): FracRead {
  let index: Record<Column, number> | null = null;
  let width = 0;
  let skipped = 0;
  let otherUnits = 0;
  const wells = new Map<string, WellParts>();
  for (const raw of lines) {
    // The file starts with a byte order mark (U+FEFF), dropped.
    const fields = (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).split('|');
    if (index === null) {
      if (fields[0]?.trim() === 'Well_Licence_Number') {
        const names = fields.map((f) => f.trim());
        const found = Object.fromEntries(COLUMNS.map((c) => [c, names.indexOf(c)])) as Record<
          Column,
          number
        >;
        if (COLUMNS.some((c) => found[c] < 0)) {
          throw new Error('The frac file has changed: a column read is missing.');
        }
        index = found;
        width = names.length;
      }
      continue;
    }
    if (raw.trim() === '') continue;
    const at = index;
    const get = (c: Column) => (fields[at[c]] ?? '').trim();
    const uwi = get('UWI');
    const start = DAY.exec(get('Start_Date'))?.[1];
    const end = DAY.exec(get('End_Date'))?.[1];
    if (fields.length !== width || !UWI.test(uwi) || !start || !end) {
      skipped += 1;
      continue;
    }
    let well = wells.get(uwi);
    if (!well) {
      well = { licence: get('Well_Licence_Number'), tvd: null, submissions: new Map() };
      wells.set(uwi, well);
    }
    const tvd = thousandths(get('Max_True_Vertical_Depth'));
    if (tvd !== null && (well.tvd === null || tvd > well.tvd)) well.tvd = tvd;
    const key = get('Last_Submission_Date');
    let sub = well.submissions.get(key);
    if (!sub) {
      sub = {
        start: null,
        end: null,
        fluidStart: start,
        fluidEnd: end,
        stages: null,
        water: 0,
        components: new Map(),
      };
      well.submissions.set(key, sub);
    }
    // A report's stages and water are written on each of its lines, not always alike: the most.
    const stages = Number(get('Number_Of_Stages'));
    if (
      get('Number_Of_Stages') !== '' &&
      Number.isSafeInteger(stages) &&
      stages >= 0 &&
      (sub.stages === null || stages > sub.stages)
    ) {
      sub.stages = stages;
    }
    sub.water = Math.max(sub.water, thousandths(get('Total_Water_Volume')) ?? 0);
    const type = get('Component_Type');
    if (type !== 'Carrier Fluid') {
      if (sub.start === null || start < sub.start) sub.start = start;
      if (sub.end === null || end > sub.end) sub.end = end;
    } else {
      if (start < sub.fluidStart) sub.fluidStart = start;
      if (end > sub.fluidEnd) sub.fluidEnd = end;
    }
    if (type !== 'Proppant') continue;
    if (get('Component_Quantity_UOM') !== 'Metric Tonnes') {
      otherUnits += 1;
      continue;
    }
    const tonnes = thousandths(get('Total_Component_Volume_or_Weight'));
    if (tonnes === null) continue;
    const name = get('Component_Trade_Name');
    const component = [name, get('Component_Supplier_Name'), start, end, String(tonnes)].join('|');
    const hint = UPGRADE_HINT.test(name) || UPGRADE_HINT.test(get('Ingredient_Name'));
    const before = sub.components.get(component);
    sub.components.set(component, { start, tonnes, hint: hint || (before?.hint ?? false) });
  }
  if (index === null) throw new Error('The frac file has no header line.');

  const out: FracWell[] = [];
  for (const [uwi, well] of wells) {
    const subs = [...well.submissions.values()]
      .map((s) => ({ ...s, start: s.start ?? s.fluidStart, end: s.end ?? s.fluidEnd }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const first = subs[0];
    if (!first) continue;
    const cutoff = addDays(first.start, FIRST_COMPLETION_DAYS);
    let proppant = 0;
    let hinted = 0;
    let refrac = 0;
    let water = 0;
    let stages: number | null = null;
    let last = first.end;
    for (const sub of subs) {
      water += sub.water;
      if (sub.end > last) last = sub.end;
      if (sub.start <= cutoff && sub.stages !== null) stages = (stages ?? 0) + sub.stages;
      // Each proppant by its own date: a report can hold a later frac's lines.
      for (const component of sub.components.values()) {
        if (component.start <= cutoff) {
          proppant += component.tonnes;
          if (component.hint) hinted += component.tonnes;
        } else refrac += component.tonnes;
      }
    }
    out.push({
      uwi,
      licenceNumber: well.licence,
      firstFracDate: first.start,
      lastFracDate: last,
      fracs: subs.length,
      stages,
      waterM3: fromThousandths(water),
      proppantT: fromThousandths(proppant),
      upgradeHintT: fromThousandths(hinted),
      refracProppantT: fromThousandths(refrac),
      maxTvdM: well.tvd === null ? null : fromThousandths(well.tvd),
      suspect: proppant > SUSPECT_TONNES_PER_STAGE * 1000 * Math.max(stages ?? 1, 1),
    });
  }
  out.sort((a, b) => a.uwi.localeCompare(b.uwi));
  return { wells: out, skipped, otherUnits };
}
