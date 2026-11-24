import { FORMATION_OUTLINES } from './formationOutlines';
import {
  mapSettingsSchema,
  type MapAskReason,
  type MapSection,
  type MapSettings,
} from './mapSettings';
import type { St37StatusClass } from './st37';

/**
 * The Ask the map bar's own reader (F-254 part 1): plain word matching, no AI, run in the
 * browser. It knows set phrasings only ("Duvernay wells drilled since 2020", "rigs now",
 * "satellite", "gas plants operated by …"); Claude (part 2) takes over the reading and this one
 * stays as the fallback when Claude cannot be reached. Its answer is the same settings shape
 * Claude's will be, checked by the same schema, with the same fixed reason codes.
 */

export interface MapRequestReading {
  settings: MapSettings;
  reasons: MapAskReason[];
}

const SECTION_WORDS: [MapSection, RegExp][] = [
  ['sales', /\bland sales?\b|\bsales?\b|\bparcels?\b|\bauctions?\b/],
  [
    'land',
    /\bland (?:today|held)\b|\bleases?\b|\bholders?\b|\bfreehold\b|\boffsets?\b|\bagreements?\b|\bland\b(?! sales?)/,
  ],
  [
    'facilities',
    /\bfacilit(?:y|ies)\b|\bbatter(?:y|ies)\b|\bgas plants?\b|\bcompressors?\b|\bterminals?\b|\bdisposal\b/,
  ],
  ['pipelines', /\bpipe ?lines?\b/],
  ['rigs', /\brigs?\b/],
  ['wells', /\bwells?\b|\bdrilled\b|\bspud(?:ded)?\b|\blicen[cs]es?\b/],
  ['formations', /\boutlines?\b/],
  ['prices', /\bprices?\b|\broyalt(?:y|ies)\b/],
  ['geology', /\bgeolog(?:y|ical)\b|\bdepth\b|\bdeep\b|\bthickness\b|\bthick\b|\bmaturity\b/],
];

const STATUS_WORDS: [St37StatusClass, RegExp][] = [
  ['producing', /\bproducing\b|\bproducers?\b|\binjecting\b/],
  ['awaiting', /\bawaiting\b/],
  ['drilling', /\bdrilling\b|\bbeing drilled\b|\bcompleting\b/],
  ['inactive', /\bclosed\b|\binactive\b/],
  ['suspended', /\bsuspended\b/],
  ['abandoned', /\babandoned\b/],
  ['licensed', /\blicensed\b|\bnot (?:yet )?drilled\b|\bundrilled\b/],
];

/** Words that end a name typed after "operated by". */
const NAME_ENDS =
  /\s+(?:since|after|before|from|in|with|and|on|near|that|which|drilled|spud|for|over|during|between|until|up)\b|[,.;]|$/;

const year = (s: string) => Number(s);

/** An outline's names as typed: "Winterburn (Nisku)" is " winterburn " and " nisku ". */
function outlineNames(name: string): string[] {
  const lower = name.toLowerCase();
  const inBrackets = /\(([^)]+)\)/.exec(lower)?.[1];
  const outside = lower.replace(/\s*\([^)]*\)/, '').trim();
  return [outside, inBrackets].filter((n): n is string => !!n).map((n) => ` ${n} `);
}

/** Reads a typed request into map settings and the reasons for what it could not do. */
export function readMapRequest(input: string): MapRequestReading {
  const t = ` ${input.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  const reasons = new Set<MapAskReason>();
  const s: MapSettings = {};

  // The sections named, in the order they appear: the first is left open.
  const named = SECTION_WORDS.map(([section, words]) => ({ section, at: t.search(words) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.section);
  const has = (section: MapSection) => named.includes(section);

  if (/\bsatellite\b|\baerial\b|\bimagery\b/.test(t)) s.basemap = 'satellite';
  else if (/\b(?:street|road|plain) map\b|\bmap view\b/.test(t)) s.basemap = 'map';
  if (/\b(?:township )?grid\b/.test(t)) s.grid = { on: !/\b(?:no|hide|without|off)\b/.test(t) };

  const duvernay = /\bduvernay\b/.test(t);
  if (duvernay) s.goTo = 'duvernay';

  // The name after "operated by", "operator", "licensee", "contractor", "bought by".
  const nameAfter = (lead: RegExp): string | undefined => {
    const m = lead.exec(t);
    if (!m) return undefined;
    const rest = t.slice(m.index + m[0].length);
    const end = rest.search(NAME_ENDS);
    const name = (end < 0 ? rest : rest.slice(0, end)).trim();
    return name === '' ? undefined : name.slice(0, 80);
  };
  const operator = nameAfter(/\b(?:operated by|operator)\s+/);

  if (has('wells')) {
    const w: NonNullable<MapSettings['wells']> = { on: true };
    if (duvernay) w.play = 'duvernay';
    const statuses = STATUS_WORDS.filter(([, words]) => words.test(t)).map(([k]) => k);
    if (statuses.length > 0) w.statuses = statuses;
    if (operator) w.operator = operator;
    const between =
      /\b(?:between|from)\s+((?:19|20)\d\d)\s+(?:and|to|-)\s+((?:19|20)\d\d)\b/.exec(t) ??
      /\b((?:19|20)\d\d)\s*(?:-|to)\s*((?:19|20)\d\d)\b/.exec(t);
    const since = /\b(?:since|from|after)\s+((?:19|20)\d\d)\b/.exec(t);
    const before = /\b(?:before|until|up to|prior to)\s+((?:19|20)\d\d)\b/.exec(t);
    const inYear = /\b(?:in|during)\s+((?:19|20)\d\d)\b/.exec(t);
    if (between?.[1] && between[2]) {
      const [a, b] = [year(between[1]), year(between[2])];
      w.spudFrom = Math.min(a, b);
      w.spudTo = Math.max(a, b);
    } else {
      if (since?.[1]) w.spudFrom = year(since[1]) + (/\bafter\b/.test(since[0]) ? 1 : 0);
      if (before?.[1]) w.spudTo = year(before[1]) - (/\bbefore|prior\b/.test(before[0]) ? 1 : 0);
      if (inYear?.[1] && !since && !before) w.spudFrom = w.spudTo = year(inYear[1]);
    }
    s.wells = w;
  }

  if (has('sales')) {
    const sa: NonNullable<MapSettings['sales']> = { on: true };
    if (duvernay) sa.rights = 'duvernay';
    if (/\bnext sale\b|\bupcoming sale\b/.test(t)) sa.sale = 'next';
    else if (/\b(?:last|latest|most recent) sale\b/.test(t)) sa.sale = 'last';
    else if (/\b(?:past|last) (?:year|12 months)\b|\bthis year\b/.test(t)) sa.period = '1';
    else if (/\b(?:2|two) years\b/.test(t)) sa.period = '2';
    else if (/\b(?:5|five) years\b/.test(t)) sa.period = '5';
    else if (/\ball (?:years|time|sales)\b|\bever\b/.test(t)) sa.period = 'all';
    const buyer = nameAfter(/\b(?:bought by|buyer|won by|purchased by)\s+/);
    if (buyer) sa.buyer = buyer;
    if (/\bno offers?\b|\bunsold\b/.test(t)) sa.states = ['no_offers'];
    else if (/\bsold\b/.test(t)) sa.states = ['sold'];
    else if (/\bupcoming\b/.test(t) && sa.sale !== 'next') sa.states = ['upcoming'];
    s.sales = sa;
  }

  if (has('land')) {
    const l: NonNullable<MapSettings['land']> = { on: true };
    if (duvernay) l.rights = 'duvernay';
    const holder = nameAfter(/\b(?:held by|holder)\s+/);
    if (holder) l.holder = holder;
    if (/\bexpir/.test(t)) l.terms = ['expiring'];
    else if (/\bcontinued\b/.test(t)) l.terms = ['continued'];
    else if (/\bprimary term\b/.test(t)) l.terms = ['primary'];
    if (/\bfreehold\b/.test(t) && !/\bagreements?\b|\bleases?\b/.test(t)) {
      l.kinds = ['freehold'];
    } else if (/\boffsets?\b/.test(t) && !/\bagreements?\b|\bleases?\b/.test(t)) {
      l.kinds = ['offsets'];
    }
    s.land = l;
  }

  if (has('facilities')) {
    const f: NonNullable<MapSettings['facilities']> = { on: true };
    const kinds: NonNullable<typeof f.kinds> = [];
    if (/\bgas plants?\b/.test(t)) kinds.push('gas_plant');
    if (/\bcompressors?\b/.test(t)) kinds.push('compressor');
    if (/\boil batter/.test(t)) kinds.push('oil_battery');
    if (/\bgas batter/.test(t)) kinds.push('gas_battery');
    if (/\bbatter(?:y|ies)\b/.test(t) && !/\b(?:oil|gas) batter/.test(t)) {
      kinds.push('oil_battery', 'gas_battery');
    }
    if (/\bterminals?\b|\brefiner/.test(t)) kinds.push('terminal');
    if (/\bdisposal\b|\binjection\b/.test(t)) kinds.push('injection');
    if (kinds.length > 0) f.kinds = kinds;
    if (/\bevery status\b|\binactive\b|\babandoned\b|\ball statuses\b/.test(t))
      f.activeOnly = false;
    if (operator && !has('wells')) f.operator = operator;
    s.facilities = f;
  }

  if (has('pipelines')) {
    const p: NonNullable<MapSettings['pipelines']> = { on: true };
    const subs: NonNullable<typeof p.substances> = [];
    if (/\bsour\b/.test(t)) subs.push('sour_gas');
    else if (/\bgas\b/.test(t)) subs.push('gas');
    if (/\bcrude\b|\boil\b(?! ?well)/.test(t)) subs.push('crude');
    if (/\bwater\b/.test(t)) subs.push('water');
    if (subs.length > 0) p.substances = subs;
    if (/\babandoned\b/.test(t)) p.statuses = ['Abandoned'];
    else if (/\bdiscontinued\b/.test(t)) p.statuses = ['Discontinued'];
    const size = /\b(\d{2,4})\s?mm\b/.exec(t);
    if (size?.[1]) p.minSizeMm = Math.min(2000, Number(size[1]));
    const licensee = nameAfter(/\b(?:licensee|licensed to|owned by)\s+/) ?? operator;
    if (licensee && !has('wells')) p.licensee = licensee;
    s.pipelines = p;
  }

  if (has('rigs')) {
    const r: NonNullable<MapSettings['rigs']> = { on: true };
    if (/\b90 days\b|\b(?:3|three) months\b|\bquarter\b/.test(t)) r.period = '90';
    else if (/\b30 days\b|\bmonth\b/.test(t)) r.period = '30';
    else if (/\bnow\b|\btoday\b|\bcurrent(?:ly)?\b|\bactive\b/.test(t)) r.period = 'now';
    const contractor = nameAfter(/\bcontractor\s+/);
    if (contractor) r.contractor = contractor;
    if (operator && !has('wells')) r.operator = operator;
    s.rigs = r;
  }

  // Outlines by name: "Cardium outline", "show the Montney and Leduc outlines".
  const words = t.replace(/[^a-z0-9]+/g, ' ');
  const outlines = FORMATION_OUTLINES.filter((f) =>
    outlineNames(f.name).some((n) => words.includes(n)),
  ).map((f) => f.key);
  if (has('formations')) {
    s.formations = { on: true, ...(outlines.length > 0 ? { shown: outlines } : {}) };
  } else if (outlines.some((key) => key !== 'duvernay' && key !== 'muskwa')) {
    // A play other than the Duvernay named for wells, land or sales: not loaded whole yet.
    reasons.add('other_play');
  }

  if (has('prices')) {
    const pr: NonNullable<MapSettings['prices']> = { on: true };
    if (/\bpropane\b/.test(t)) pr.product = 'propane';
    else if (/\bbutanes?\b/.test(t)) pr.product = 'butanes';
    else if (/\bpentanes?\b|\bcondensate\b/.test(t)) pr.product = 'pentanes';
    else if (/\bsulph?ur\b|\bsulfur\b/.test(t)) pr.product = 'sulphur';
    else if (/\boil\b|\bcrude\b/.test(t)) pr.product = 'oil';
    else if (/\bgas\b/.test(t)) pr.product = 'gas';
    if (/\b15 years\b|\bfifteen years\b/.test(t)) pr.period = '15';
    else if (/\b(?:5|five) years\b/.test(t)) pr.period = '5';
    else if (/\ball\b|\bsince 1994\b|\bever\b/.test(t)) pr.period = 'all';
    s.prices = pr;
  }

  if (has('geology')) {
    const g: NonNullable<MapSettings['geology']> = { on: true };
    if (/\bmatur/.test(t)) g.shown = 'maturity';
    else if (/\bthick/.test(t)) g.shown = 'thickness';
    else if (/\bdepth\b|\bdeep\b/.test(t)) g.shown = 'depth';
    s.geology = g;
  }

  const first = named[0];
  if (first) s.open = first;

  // What the map cannot do yet.
  if (/\bproduction\b|\bbbl\b|\bbarrels?\b|\bboe\b|\bmcf\b|\bm3\b|\brates?\b/.test(t)) {
    reasons.add('production_filter');
  }
  // Fields and pools are looked up by the Worker with Claude's reading: the word matching finds none.
  if (/\b(?:field|pool)s?\b/.test(t)) reasons.add('field_not_found');
  if (/\bbritish columbia\b|\bb\.?c\.?\b|\bsaskatchewan\b|\bsask\b|\bmanitoba\b/.test(t)) {
    reasons.add('other_province');
  }
  // A place is looked up by the Worker with Claude's reading: the word matching finds none.
  if (/\b(?:near|around|close to|outside of)\s+[a-z]/.test(t)) reasons.add('place_not_found');

  const settings = mapSettingsSchema.parse(s);
  if (Object.keys(settings).length === 0 && reasons.size === 0) reasons.add('not_understood');
  return { settings, reasons: [...reasons] };
}
