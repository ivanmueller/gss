import { z } from 'zod';

/**
 * The shared list of commodities, as `app.commodities` holds it (20261028040000_quotes.sql),
 * in its order. The database is the source; this copy lets the browser and the API read a
 * spreadsheet's commodity names alike, and a database test keeps the two the same.
 */
export const COMMODITIES = [
  { code: 'canola', name: 'Canola' },
  { code: 'flaxseed', name: 'Flaxseed' },
  { code: 'yellow_peas', name: 'Yellow peas' },
  { code: 'green_peas', name: 'Green peas' },
  { code: 'red_lentils', name: 'Red lentils' },
  { code: 'green_lentils', name: 'Green lentils' },
  { code: 'chickpeas', name: 'Chickpeas' },
  { code: 'faba_beans', name: 'Faba beans' },
  { code: 'spring_wheat', name: 'Spring wheat' },
  { code: 'durum_wheat', name: 'Durum wheat' },
  { code: 'winter_wheat', name: 'Winter wheat' },
  { code: 'feed_barley', name: 'Feed barley' },
  { code: 'malt_barley', name: 'Malt barley' },
  { code: 'oats', name: 'Oats' },
  { code: 'rye', name: 'Rye' },
  { code: 'corn', name: 'Corn' },
  { code: 'soybeans', name: 'Soybeans' },
  { code: 'mustard_seed', name: 'Mustard seed' },
  { code: 'canary_seed', name: 'Canary seed' },
  { code: 'sunflower_seed', name: 'Sunflower seed' },
] as const;

export type CommodityCode = (typeof COMMODITIES)[number]['code'];

const CODES = COMMODITIES.map((commodity) => commodity.code) as [CommodityCode, ...CommodityCode[]];

export function commodityName(code: string): string {
  return COMMODITIES.find((commodity) => commodity.code === code)?.name ?? code;
}

/** Whether a counterparty buys or sells a commodity. */
export const COMMODITY_DIRECTIONS = ['buys', 'sells'] as const;
export type CommodityDirection = (typeof COMMODITY_DIRECTIONS)[number];

/** One commodity a counterparty buys or sells. */
export interface CommodityInterest {
  commodity: CommodityCode;
  direction: CommodityDirection;
}

/** What a counterparty can buy or sell by its types: buyers buy, sellers sell, brokers both. */
export function commodityDirections(types: readonly string[]): CommodityDirection[] {
  return COMMODITY_DIRECTIONS.filter((direction) =>
    types.some((type) =>
      direction === 'buys'
        ? type === 'buyer' || type === 'broker'
        : type === 'seller' || type === 'broker',
    ),
  );
}

const interest = z.object({
  commodity: z.enum(CODES),
  direction: z.enum(COMMODITY_DIRECTIONS),
});

/** PATCH /api/v1/counterparties/{id}/commodities: what to add and what to remove. */
export const commodityChangeSchema = z
  .object({
    add: z.array(interest).max(CODES.length * 2),
    remove: z.array(interest).max(CODES.length * 2),
  })
  .refine((change) => change.add.length + change.remove.length > 0, {
    message: 'nothing to change',
  });
export type CommodityChange = z.infer<typeof commodityChangeSchema>;

/** Lower case, no accents, words separated by single spaces. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Words without a plural "s" or "es", so "Chickpea" and "Oat" match. */
function singular(text: string): string {
  return text
    .split(' ')
    .map((word) => word.replace(/(?<=..)e?s$/, ''))
    .join(' ');
}

/** Other names a spreadsheet may use for one commodity; ambiguous ones (wheat, barley, peas) are left out. */
const ALIASES: Record<string, CommodityCode> = {
  flax: 'flaxseed',
  durum: 'durum_wheat',
  hrs: 'spring_wheat',
  cwrs: 'spring_wheat',
  'hard red spring': 'spring_wheat',
  'hard red spring wheat': 'spring_wheat',
  'feed wheat': 'winter_wheat',
  'fava bean': 'faba_beans',
  'faba bean': 'faba_beans',
  fababean: 'faba_beans',
  soy: 'soybeans',
  soybean: 'soybeans',
  'soy bean': 'soybeans',
  mustard: 'mustard_seed',
  canary: 'canary_seed',
  canaryseed: 'canary_seed',
  sunflower: 'sunflower_seed',
  'sunflower seed': 'sunflower_seed',
  'yellow pea': 'yellow_peas',
  'green pea': 'green_peas',
  'red lentil': 'red_lentils',
  'green lentil': 'green_lentils',
  'garbanzo bean': 'chickpeas',
  garbanzo: 'chickpeas',
  'malting barley': 'malt_barley',
};

const BY_NAME = new Map<string, CommodityCode>();
for (const { code, name } of COMMODITIES) {
  for (const text of [name, code]) {
    BY_NAME.set(singular(normalize(text)), code);
  }
}
for (const [alias, code] of Object.entries(ALIASES)) BY_NAME.set(singular(normalize(alias)), code);

/** The commodity a name means ("Yellow Peas", "yellow_peas", "Flax"), or null. */
export function commodityFromName(text: string): CommodityCode | null {
  return BY_NAME.get(singular(normalize(text))) ?? null;
}

/**
 * A spreadsheet cell of commodities ("Canola; Yellow peas, Flax") as codes, in the list's
 * order, each once; with the names that match none.
 */
export function parseCommodityList(text: string): {
  commodities: CommodityCode[];
  unknown: string[];
} {
  const found = new Set<CommodityCode>();
  const unknown: string[] = [];
  for (const part of text.split(/[;,/|\n]+| and /i)) {
    const name = part.trim();
    if (name === '') continue;
    const code = commodityFromName(name);
    if (code === null) unknown.push(name);
    else found.add(code);
  }
  return { commodities: CODES.filter((code) => found.has(code)), unknown };
}
