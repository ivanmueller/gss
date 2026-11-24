import { z } from 'zod';

import { FACILITY_GROUPS } from './facilities';
import { LAND_RIGHTS } from './landRights';
import { PIPELINE_STATUSES, PIPELINE_SUBSTANCES } from './pipelines';
import { ST37_STATUS_CLASSES, ST37_STATUS_LABELS } from './st37';

/**
 * The oil and gas map's settings in one shape (F-254 part 1): every choice the side card offers,
 * so a whole set can be applied at once (by the Ask the map bar, and Undo), and, in part 2, the
 * fixed list Claude answers from. Every part is optional: what a request leaves out stays as it
 * is. Objects are strict, so an unknown key is refused rather than ignored. Text filters are kept
 * as typed and matched as the card's own boxes match them; no names are guessed.
 */

export const MAP_SECTIONS = [
  'sales',
  'land',
  'facilities',
  'pipelines',
  'rigs',
  'wells',
  'formations',
  'prices',
  'geology',
] as const;
export type MapSection = (typeof MAP_SECTIONS)[number];

export const MAP_SECTION_NAMES: Record<MapSection, string> = {
  sales: 'Land sales',
  land: 'Land today',
  facilities: 'Facilities',
  pipelines: 'Pipelines',
  rigs: 'Rigs',
  wells: 'Wells & licences',
  formations: 'Formation outlines',
  prices: 'Prices',
  geology: 'Geology',
};

export const MAP_BASEMAPS = ['map', 'satellite'] as const;
export const SALE_PERIOD_KEYS = ['1', '2', '5', 'all'] as const;
export const SALE_STATES = ['sold', 'no_offers', 'upcoming'] as const;
export const LAND_KIND_KEYS = ['agreements', 'offsets', 'freehold'] as const;
export const LAND_TERM_KEYS = ['primary', 'expiring', 'continued'] as const;
export const RIG_PERIODS = ['now', '30', '90'] as const;
export const PRICE_PRODUCTS = ['gas', 'oil', 'propane', 'butanes', 'pentanes', 'sulphur'] as const;
export const PRICE_PERIOD_KEYS = ['5', '15', 'all'] as const;
export const GEOLOGY_SHOWN = ['depth', 'thickness', 'maturity'] as const;

const PLAY_KEYS = Object.keys(LAND_RIGHTS) as [string, ...string[]];
const FACILITY_KINDS = FACILITY_GROUPS.map((g) => g.key) as [
  (typeof FACILITY_GROUPS)[number]['key'],
  ...(typeof FACILITY_GROUPS)[number]['key'][],
];
const SUBSTANCES = PIPELINE_SUBSTANCES.map((s) => s.key) as [
  (typeof PIPELINE_SUBSTANCES)[number]['key'],
  ...(typeof PIPELINE_SUBSTANCES)[number]['key'][],
];

/** A text filter as typed: a name or part of one. */
const text = z.string().trim().max(80);
const year = z.number().int().min(1900).max(2100);
/** A list of choices, each at most once. */
const several = <T extends z.ZodType>(item: T) =>
  z.array(item).refine((list) => new Set(list).size === list.length, 'Each choice at most once');

export const mapSettingsSchema = z
  .object({
    /** The section left open in the side card. */
    open: z.enum(MAP_SECTIONS).optional(),
    basemap: z.enum(MAP_BASEMAPS).optional(),
    /** Move the map to a play's area. */
    goTo: z.enum(PLAY_KEYS).optional(),
    wells: z
      .object({
        on: z.boolean().optional(),
        /** The statuses shown; the others are hidden. */
        statuses: several(z.enum(ST37_STATUS_CLASSES)).optional(),
        play: z.enum(PLAY_KEYS).optional(),
        operator: text.optional(),
        /** Spud year from and to, both included; null clears it. */
        spudFrom: year.nullable().optional(),
        spudTo: year.nullable().optional(),
      })
      .strict()
      .refine(
        (w) => w.spudFrom == null || w.spudTo == null || w.spudFrom <= w.spudTo,
        'Spud from comes before spud to',
      )
      .optional(),
    sales: z
      .object({
        on: z.boolean().optional(),
        /** The play the parcels' rights must include; null for every parcel. */
        rights: z.enum(PLAY_KEYS).nullable().optional(),
        period: z.enum(SALE_PERIOD_KEYS).optional(),
        /** One sale alone: the next one posted or the last one held. */
        sale: z.enum(['next', 'last']).optional(),
        buyer: text.optional(),
        states: several(z.enum(SALE_STATES)).optional(),
      })
      .strict()
      .optional(),
    land: z
      .object({
        on: z.boolean().optional(),
        kinds: several(z.enum(LAND_KIND_KEYS)).optional(),
        rights: z.enum(PLAY_KEYS).nullable().optional(),
        holder: text.optional(),
        /** The terms kept; none keeps every term. */
        terms: several(z.enum(LAND_TERM_KEYS)).optional(),
        colourByHolder: z.boolean().optional(),
      })
      .strict()
      .optional(),
    facilities: z
      .object({
        on: z.boolean().optional(),
        kinds: several(z.enum(FACILITY_KINDS)).optional(),
        /** Only the active ones, or every status. */
        activeOnly: z.boolean().optional(),
        operator: text.optional(),
      })
      .strict()
      .optional(),
    pipelines: z
      .object({
        on: z.boolean().optional(),
        statuses: several(z.enum(PIPELINE_STATUSES)).optional(),
        substances: several(z.enum(SUBSTANCES)).optional(),
        licensee: text.optional(),
        /** The smallest outside diameter shown, in millimetres; 0 for every size. */
        minSizeMm: z.number().int().min(0).max(2000).optional(),
      })
      .strict()
      .optional(),
    rigs: z
      .object({
        on: z.boolean().optional(),
        period: z.enum(RIG_PERIODS).optional(),
        contractor: text.optional(),
        operator: text.optional(),
      })
      .strict()
      .optional(),
    formations: z
      .object({
        on: z.boolean().optional(),
        /** The outlines shown, by key (FORMATION_OUTLINES). */
        shown: several(z.string().regex(/^[a-z][a-z-]{1,40}$/)).optional(),
      })
      .strict()
      .optional(),
    prices: z
      .object({
        on: z.boolean().optional(),
        product: z.enum(PRICE_PRODUCTS).optional(),
        period: z.enum(PRICE_PERIOD_KEYS).optional(),
      })
      .strict()
      .optional(),
    geology: z
      .object({
        on: z.boolean().optional(),
        shown: z.enum(GEOLOGY_SHOWN).optional(),
      })
      .strict()
      .optional(),
    grid: z.object({ on: z.boolean().optional() }).strict().optional(),
  })
  .strict();

export type MapSettings = z.infer<typeof mapSettingsSchema>;

/**
 * What a request asked for that the map cannot do, as fixed codes: the page words them, so
 * nothing written by a model reaches the screen.
 */
export const MAP_ASK_REASONS = [
  'not_understood',
  'production_filter',
  'place_by_name',
  'field_or_pool',
  'other_province',
  'other_play',
] as const;
export type MapAskReason = (typeof MAP_ASK_REASONS)[number];

export const MAP_ASK_REASON_TEXT: Record<MapAskReason, string> = {
  not_understood: 'Nothing in the request matched what this map can show.',
  production_filter: 'This map cannot filter by production yet.',
  place_by_name: 'This map cannot find towns or places by name yet.',
  field_or_pool: 'This map cannot filter by field or pool yet.',
  other_province: 'This map covers Alberta only.',
  other_play: 'Only the Duvernay is loaded whole so far.',
};

const names = <T extends string>(list: readonly T[], label: (key: T) => string) =>
  list.map(label).join(', ');

const SALE_PERIOD_TEXT: Record<(typeof SALE_PERIOD_KEYS)[number], string> = {
  '1': 'last 12 mo',
  '2': 'last 2 yrs',
  '5': 'last 5 yrs',
  all: 'all years',
};
const SALE_STATE_TEXT: Record<(typeof SALE_STATES)[number], string> = {
  sold: 'sold',
  no_offers: 'no offers',
  upcoming: 'upcoming',
};
const RIG_PERIOD_TEXT: Record<(typeof RIG_PERIODS)[number], string> = {
  now: 'where they are now',
  '30': 'past 30 days',
  '90': 'past 90 days',
};
const PRICE_PERIOD_TEXT: Record<(typeof PRICE_PERIOD_KEYS)[number], string> = {
  '5': '5 years',
  '15': '15 years',
  all: 'since 1994',
};
const playName = (key: string) => LAND_RIGHTS[key]?.name ?? key;
const onOff = (on: boolean | undefined, name: string) =>
  on === undefined ? [] : [`${name} ${on ? 'on' : 'off'}`];

/** The settings in short phrases, one a chip, for the bar to show what it applied. */
export function describeMapSettings(s: MapSettings): string[] {
  const out: string[] = [];
  if (s.goTo) out.push(`Moved to the ${playName(s.goTo)}`);
  if (s.basemap) out.push(s.basemap === 'satellite' ? 'Satellite view' : 'Map view');
  const w = s.wells;
  if (w) {
    out.push(...onOff(w.on, 'Wells'));
    if (w.statuses) {
      out.push(
        w.statuses.length === 0
          ? 'No well statuses'
          : `Wells: ${names(w.statuses, (k) => ST37_STATUS_LABELS[k].toLowerCase())}`,
      );
    }
    if (w.play) out.push(`Wells of the ${playName(w.play)}`);
    if (w.operator !== undefined) {
      out.push(w.operator === '' ? 'Any well operator' : `Well operator “${w.operator}”`);
    }
    if (w.spudFrom != null && w.spudTo != null) {
      out.push(
        w.spudFrom === w.spudTo
          ? `Spud in ${String(w.spudFrom)}`
          : `Spud ${String(w.spudFrom)} to ${String(w.spudTo)}`,
      );
    } else if (w.spudFrom != null) out.push(`Spud since ${String(w.spudFrom)}`);
    else if (w.spudTo != null) out.push(`Spud up to ${String(w.spudTo)}`);
    else if (w.spudFrom === null || w.spudTo === null) out.push('Any spud year');
  }
  const sa = s.sales;
  if (sa) {
    out.push(...onOff(sa.on, 'Land sales'));
    if (sa.rights !== undefined) {
      out.push(
        sa.rights === null ? 'Sales of any rights' : `Sales of ${playName(sa.rights)} rights`,
      );
    }
    if (sa.period) out.push(`Sales of the ${SALE_PERIOD_TEXT[sa.period]}`);
    if (sa.sale) out.push(sa.sale === 'next' ? 'The next sale' : 'The last sale');
    if (sa.buyer !== undefined) out.push(sa.buyer === '' ? 'Any buyer' : `Buyer “${sa.buyer}”`);
    if (sa.states) out.push(`Parcels: ${names(sa.states, (k) => SALE_STATE_TEXT[k])}`);
  }
  const l = s.land;
  if (l) {
    out.push(...onOff(l.on, 'Land today'));
    if (l.kinds) out.push(`Land: ${l.kinds.join(', ')}`);
    if (l.rights !== undefined) {
      out.push(l.rights === null ? 'Land of any rights' : `Land with ${playName(l.rights)} rights`);
    }
    if (l.holder !== undefined) out.push(l.holder === '' ? 'Any holder' : `Holder “${l.holder}”`);
    if (l.terms) out.push(l.terms.length === 0 ? 'Every term' : `Terms: ${l.terms.join(', ')}`);
    if (l.colourByHolder !== undefined) {
      out.push(l.colourByHolder ? 'Coloured by holder' : 'Not coloured by holder');
    }
  }
  const f = s.facilities;
  if (f) {
    out.push(...onOff(f.on, 'Facilities'));
    if (f.kinds) {
      out.push(
        `Facilities: ${names(f.kinds, (k) => FACILITY_GROUPS.find((g) => g.key === k)?.name.toLowerCase() ?? k)}`,
      );
    }
    if (f.activeOnly !== undefined) {
      out.push(f.activeOnly ? 'Active facilities only' : 'Facilities of every status');
    }
    if (f.operator !== undefined) {
      out.push(f.operator === '' ? 'Any facility operator' : `Facility operator “${f.operator}”`);
    }
  }
  const p = s.pipelines;
  if (p) {
    out.push(...onOff(p.on, 'Pipelines'));
    if (p.statuses) out.push(`Pipelines: ${p.statuses.join(', ').toLowerCase()}`);
    if (p.substances) {
      out.push(
        `Carrying ${names(p.substances, (k) => PIPELINE_SUBSTANCES.find((x) => x.key === k)?.name.toLowerCase() ?? k)}`,
      );
    }
    if (p.licensee !== undefined) {
      out.push(p.licensee === '' ? 'Any licensee' : `Licensee “${p.licensee}”`);
    }
    if (p.minSizeMm !== undefined) {
      out.push(p.minSizeMm === 0 ? 'Every size' : `${String(p.minSizeMm)} mm and up`);
    }
  }
  const r = s.rigs;
  if (r) {
    out.push(...onOff(r.on, 'Rigs'));
    if (r.period) out.push(`Rigs: ${RIG_PERIOD_TEXT[r.period]}`);
    if (r.contractor !== undefined) {
      out.push(r.contractor === '' ? 'Any contractor' : `Contractor “${r.contractor}”`);
    }
    if (r.operator !== undefined) {
      out.push(r.operator === '' ? 'Any rig operator' : `Rig operator “${r.operator}”`);
    }
  }
  const fo = s.formations;
  if (fo) {
    out.push(...onOff(fo.on, 'Formation outlines'));
    if (fo.shown) out.push(`Outlines: ${fo.shown.length === 0 ? 'none' : fo.shown.join(', ')}`);
  }
  const pr = s.prices;
  if (pr) {
    out.push(...onOff(pr.on, 'Prices'));
    if (pr.product) out.push(`Prices of ${pr.product}`);
    if (pr.period) out.push(`Prices over ${PRICE_PERIOD_TEXT[pr.period]}`);
  }
  const g = s.geology;
  if (g) {
    out.push(...onOff(g.on, 'Geology'));
    if (g.shown) out.push(`Geology: ${g.shown}`);
  }
  if (s.grid) out.push(...onOff(s.grid.on, 'Township grid'));
  if (s.open) out.push(`${MAP_SECTION_NAMES[s.open]} open`);
  return out;
}
