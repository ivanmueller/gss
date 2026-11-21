/**
 * Which rights include a play (F-241, F-242): read from the zones of Crown agreements and sale
 * parcels as the province words them, with the order of formations taken from those same
 * descriptions and from nowhere else.
 *
 * A zone is one or more clauses, each a substance and an interval:
 *   PETROLEUM AND NATURAL GAS IN THE VIKING FM(D6)
 *   PETROLEUM AND NATURAL GAS FROM SURFACE TO THE BASE OF THE MANNVILLE GRP(D4)
 *   PETROLEUM AND NATURAL GAS BELOW THE BASE OF THE CARDIUM FM(D3) TO BASEMENT
 * Every interval says its upper limit lies above its lower one ("below the base of the Cardium
 * to the base of the Duvernay": the Cardium's base is above the Duvernay's). Chained, those
 * statements order the limits. A clause includes a play when its upper limit is known to lie
 * above the base of one of the play's formations and its lower limit below that formation's
 * top. Where the descriptions do not settle it, the clause is not counted: nothing is assumed
 * about which formation lies above which.
 *
 * Kept free of imports and of TypeScript-only syntax.
 */

/** The plays rights can be asked to include, with the formations that are the play. */
export const LAND_RIGHTS: Record<string, { key: string; name: string; formation: string }> = {
  duvernay: { key: 'duvernay', name: 'Duvernay', formation: '^DUVERNAY\\b' },
};

/** A limit of an interval: the surface, the basement, or the top or base of a formation. */
type Limit = string;
const SURFACE: Limit = 'SURFACE';
const BASEMENT: Limit = 'BASEMENT';
const top = (name: string): Limit => `T:${name}`;
const base = (name: string): Limit => `B:${name}`;

export interface RightsClause {
  /** A clause that takes rights away ("EXCEPTING NATURAL GAS IN THE ..."), not one that gives. */
  excepting: boolean;
  upper: Limit;
  lower: Limit;
}

/** A formation's name without the province's zone code: `VIKING FM(D6)` is `VIKING FM`. */
function formationName(text: string): string {
  return text
    .replace(/\([A-Z]\d+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function limit(text: string): Limit | null {
  const t = text.trim();
  if (t === 'BASEMENT') return BASEMENT;
  if (t === 'SURFACE') return SURFACE;
  const m = /^THE (BASE|TOP) OF THE (.+)$/.exec(t);
  const name = m ? formationName(m[2] ?? '') : '';
  if (!m || name === '') return null;
  return m[1] === 'BASE' ? base(name) : top(name);
}

const SUBSTANCE =
  /(EXCEPTING )?(?:PETROLEUM AND NATURAL GAS|NATURAL GAS|PETROLEUM|OIL SANDS) (?=IN THE |FROM SURFACE |BELOW THE )/g;

/**
 * The clauses of a zone, in order; a clause that cannot be read is left out (`unread` counts
 * them), so it neither gives rights nor says anything of the order.
 */
export function rightsClauses(zone: string): { clauses: RightsClause[]; unread: number } {
  const text = zone.replace(/\s+/g, ' ').trim();
  const starts = [...text.matchAll(SUBSTANCE)];
  const clauses: RightsClause[] = [];
  let unread = starts.length === 0 && text !== '' ? 1 : 0;
  starts.forEach((start, i) => {
    const from = start.index + start[0].length;
    const body = text.slice(from, starts[i + 1]?.index ?? text.length).trim();
    let upper: Limit | null = null;
    let lower: Limit | null = null;
    const inThe = /^IN THE (.+)$/.exec(body);
    const fromSurface = /^FROM SURFACE TO (.+)$/.exec(body);
    const below =
      /^BELOW (THE (?:BASE|TOP) OF THE .+?) TO (BASEMENT|THE (?:BASE|TOP) OF THE .+)$/.exec(body);
    if (inThe) {
      const name = formationName(inThe[1] ?? '');
      if (name !== '') {
        upper = top(name);
        lower = base(name);
      }
    } else if (fromSurface) {
      upper = SURFACE;
      lower = limit(fromSurface[1] ?? '');
    } else if (below) {
      upper = limit(below[1] ?? '');
      lower = limit(below[2] ?? '');
    }
    if (upper === null || lower === null || upper === lower) unread += 1;
    else clauses.push({ excepting: start[1] !== undefined, upper, lower });
  });
  return { clauses, unread };
}

/** Which limits are known to lie above which, from every clause given. */
export interface RightsOrder {
  /** For each limit, the limits stated to lie directly below it. */
  below: Map<Limit, Set<Limit>>;
  /** The formations named anywhere. */
  formations: Set<string>;
}

/** The order the zones themselves state: each clause's upper limit above its lower one. */
export function rightsOrder(zones: Iterable<string>): RightsOrder {
  const below = new Map<Limit, Set<Limit>>();
  const formations = new Set<string>();
  const say = (upper: Limit, lower: Limit) => {
    if (upper === lower) return;
    let set = below.get(upper);
    if (!set) below.set(upper, (set = new Set()));
    set.add(lower);
  };
  const note = (l: Limit) => {
    if (l.startsWith('T:') || l.startsWith('B:')) formations.add(l.slice(2));
  };
  for (const zone of zones) {
    for (const clause of rightsClauses(zone).clauses) {
      // What a clause takes away is an interval too: its limits are ordered the same way.
      say(clause.upper, clause.lower);
      note(clause.upper);
      note(clause.lower);
    }
  }
  // A formation's top lies above its base.
  for (const name of formations) say(top(name), base(name));
  return { below, formations };
}

/** Every limit known to lie below `from`, following the statements from one to the next. */
function reach(from: Limit, edges: Map<Limit, Set<Limit>>): Set<Limit> {
  const seen = new Set<Limit>();
  const queue = [from];
  // The list grows as it is walked: each limit found is followed in its turn.
  for (const at of queue) {
    for (const next of edges.get(at) ?? []) {
      if (!seen.has(next) && next !== from) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/**
 * A test of whether a zone includes a play's rights, for the order given. A clause counts when
 * its upper limit is the surface, or the formation's own top, or known to lie above the
 * formation's base and not also stated to lie below it; and its lower limit is the basement,
 * or the formation's own base, or known to lie below the formation's top and not also above.
 */
export function rightsIncluding(
  order: RightsOrder,
  play: string,
): (zone: string | null) => boolean {
  const rights = Object.hasOwn(LAND_RIGHTS, play) ? LAND_RIGHTS[play] : undefined;
  if (!rights) return () => false;
  const named = new RegExp(rights.formation);
  const above = new Map<Limit, Set<Limit>>();
  for (const [upper, lowers] of order.below) {
    for (const lower of lowers) {
      let set = above.get(lower);
      if (!set) above.set(lower, (set = new Set()));
      set.add(upper);
    }
  }
  const tests = [...order.formations]
    .filter((name) => named.test(name))
    .map((name) => {
      const t = top(name);
      const b = base(name);
      return {
        t,
        b,
        aboveBase: reach(b, above),
        belowBase: reach(b, order.below),
        belowTop: reach(t, order.below),
        aboveTop: reach(t, above),
      };
    });
  return (zone) => {
    if (zone === null) return false;
    return rightsClauses(zone).clauses.some(
      (clause) =>
        !clause.excepting &&
        tests.some((f) => {
          const upperOk =
            clause.upper === SURFACE ||
            clause.upper === f.t ||
            (f.aboveBase.has(clause.upper) && !f.belowBase.has(clause.upper));
          const lowerOk =
            clause.lower === BASEMENT ||
            clause.lower === f.b ||
            (f.belowTop.has(clause.lower) && !f.aboveTop.has(clause.lower));
          return upperOk && lowerOk && clause.upper !== f.b && clause.lower !== f.t;
        }),
    );
  };
}

/** The zones, of those given, that include a play's rights; the order is read from them all. */
export function rightsZones(zones: readonly string[], play: string): string[] {
  const includes = rightsIncluding(rightsOrder(zones), play);
  return zones.filter((zone) => includes(zone));
}
