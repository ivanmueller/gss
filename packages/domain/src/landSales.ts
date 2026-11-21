/**
 * Crown land sales (F-242, docs/FEATURES_OIL_GAS.md): Alberta Energy and Minerals' public
 * offerings of petroleum and natural gas rights. Each sale has a notice (its parcels: contract
 * number, hectares, land, rights) and, after the sale, results (status, bonus, price per
 * hectare, buyers), both as XML on the department's page
 * (content2.energy.alberta.ca/petroleum-and-natural-gas-tenure-public-offerings-and-results).
 * A parcel's land is a list of keys on the Alberta Township System, placed here on the
 * province's grid of sections.
 *
 * Kept free of imports and of TypeScript-only syntax, so the manual loader
 * (scripts/load-land-sales.js) can run it with Node's type stripping.
 */

/** A part of a section, as fractions of it: west to east (u) and south to north (v). */
export interface SectionPart {
  meridian: number;
  range: number;
  township: number;
  section: number;
  /** [u0, v0, u1, v1], each from 0 to 1. */
  rect: [number, number, number, number];
}

type Rect = [number, number, number, number];

/** A quarter (NE) or a half (N) of a rectangle; null for anything else. */
function partOf([u0, v0, u1, v1]: Rect, part: string): Rect | null {
  const um = (u0 + u1) / 2;
  const vm = (v0 + v1) / 2;
  switch (part) {
    case '':
      return [u0, v0, u1, v1];
    case 'N':
      return [u0, vm, u1, v1];
    case 'S':
      return [u0, v0, u1, vm];
    case 'E':
      return [um, v0, u1, v1];
    case 'W':
      return [u0, v0, um, v1];
    case 'NE':
      return [um, vm, u1, v1];
    case 'NW':
      return [u0, vm, um, v1];
    case 'SE':
      return [um, v0, u1, vm];
    case 'SW':
      return [u0, v0, um, vm];
    default:
      return null;
  }
}

/**
 * A legal subdivision's place in its section. The sixteen are numbered from the south-east
 * corner, west along the bottom row, then back east along the next, and so on north.
 */
function lsdRect(lsd: number): Rect | null {
  if (!Number.isInteger(lsd) || lsd < 1 || lsd > 16) return null;
  const row = Math.floor((lsd - 1) / 4);
  const along = (lsd - 1) % 4;
  const column = row % 2 === 0 ? 3 - along : along;
  return [column / 4, row / 4, (column + 1) / 4, (row + 1) / 4];
}

/**
 * A land key of a sale notice: meridian (1 digit), range (2), township (3), section (2), then
 * nothing (the whole section), a legal subdivision (2 digits), a quarter or half (NE, N), or a
 * legal subdivision and a quarter or half of it. `41203424` is section 24-034-12W4;
 * `4140133301` is LSD 01 of section 33-013-14W4; `40303921SW` is the south-west quarter of
 * section 21-039-03W4. Null when it is not in that form.
 */
export function landKeyPart(key: string): SectionPart | null {
  const m = /^([4-6])(\d{2})(\d{3})(\d{2})(\d{2})?([NSEW]{1,2})?$/.exec(key.trim());
  if (!m) return null;
  const [, meridian, range, township, section, lsd, part] = m;
  const sec = Number(section);
  if (sec < 1 || sec > 36) return null;
  const base: Rect | null = lsd === undefined ? [0, 0, 1, 1] : lsdRect(Number(lsd));
  const rect = base ? partOf(base, part ?? '') : null;
  if (!rect) return null;
  return {
    meridian: Number(meridian),
    range: Number(range),
    township: Number(township),
    section: sec,
    rect,
  };
}

/** How a section is looked up: `5-06-042-25` for section 25-042-06W5. */
export function sectionKey(p: {
  meridian: number;
  range: number;
  township: number;
  section: number;
}): string {
  return `${String(p.meridian)}-${String(p.range)}-${String(p.township)}-${String(p.section)}`;
}

/** A section's four corners: south-west, south-east, north-east, north-west. */
export type SectionCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/** The four corners of a section's outline (its points farthest to each diagonal); or null. */
export function sectionCorners(ring: unknown): SectionCorners | null {
  if (!Array.isArray(ring) || ring.length < 4) return null;
  let sw: [number, number] | null = null;
  let se: [number, number] | null = null;
  let ne: [number, number] | null = null;
  let nw: [number, number] | null = null;
  // A degree of longitude is about 0.6 of a degree of latitude here: weighed so the corners
  // are those of the square on the ground.
  const k = 0.6;
  for (const point of ring) {
    if (!Array.isArray(point)) return null;
    const [x, y] = point as unknown[];
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    const sum = x * k + y;
    const diff = x * k - y;
    if (sw === null || sum < sw[0] * k + sw[1]) sw = [x, y];
    if (ne === null || sum > ne[0] * k + ne[1]) ne = [x, y];
    if (se === null || diff > se[0] * k - se[1]) se = [x, y];
    if (nw === null || diff < nw[0] * k - nw[1]) nw = [x, y];
  }
  return sw && se && ne && nw ? [sw, se, ne, nw] : null;
}

/** The outline of a part of a section, as a closed ring to five decimals (about a metre). */
export function sectionPartRing(corners: SectionCorners, rect: Rect): [number, number][] {
  const [sw, se, ne, nw] = corners;
  const at = (u: number, v: number): [number, number] => {
    const x = (1 - u) * (1 - v) * sw[0] + u * (1 - v) * se[0] + u * v * ne[0] + (1 - u) * v * nw[0];
    const y = (1 - u) * (1 - v) * sw[1] + u * (1 - v) * se[1] + u * v * ne[1] + (1 - u) * v * nw[1];
    return [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];
  };
  const [u0, v0, u1, v1] = rect;
  const first = at(u0, v0);
  return [first, at(u1, v0), at(u1, v1), at(u0, v1), first];
}

/** The text between a tag's opening and closing, entities read; null when the tag is absent. */
function tag(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  if (!m) return null;
  const text = (m[1] ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text === '' ? null : text;
}

function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map(
    (m) => m[1] ?? '',
  );
}

/** A decimal as text (`2296.32`), or null: money and areas are never read as floats. */
function decimal(text: string | null): string | null {
  return text !== null && /^\d{1,12}(\.\d{1,7})?$/.test(text) ? text : null;
}

export interface SaleNoticeParcel {
  /** The contract's number in its sale: A0001 (a lease), B0018 (a licence). */
  contractNo: string;
  contractType: string | null;
  region: string | null;
  hectares: string | null;
  /** The rights, as the province words the zones of agreements: "... FROM SURFACE TO ...". */
  zone: string | null;
  /** Every land key of the parcel, as published. */
  lands: string[];
  /** Whether any of its land is only a portion, or by metes and bounds. */
  portion: boolean;
}

export interface SaleNotice {
  saleDate: string;
  parcels: SaleNoticeParcel[];
}

/**
 * A sale's notice (its PON file): each contract with its land and rights. Null when the file
 * is not a notice of petroleum and natural gas rights with a sale date.
 */
export function parseSaleNotice(xml: string): SaleNotice | null {
  if (!/<PublicOfferingNotice[\s>]/.test(xml)) return null;
  // The addenda repeat contract numbers and land for each restriction: not parcels.
  const body = xml.split('<AddendaAndContacts>')[0] ?? '';
  const saleDate = tag(body, 'SaleDate');
  if (tag(body, 'MineralType') !== 'PETROLEUM AND NATURAL GAS') return null;
  if (!saleDate || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return null;
  const parcels: SaleNoticeParcel[] = [];
  for (const schedule of blocks(body, 'Schedule')) {
    const contractType = tag(schedule, 'ContractType');
    for (const region of blocks(schedule, 'Region')) {
      const regionName = tag(region, 'Name');
      for (const contract of blocks(region, 'Contract')) {
        const contractNo = tag(contract, 'ContractNo');
        if (!contractNo || !/^[A-Z]\d{4}$/.test(contractNo)) continue;
        const lands: string[] = [];
        let portion = false;
        for (const land of blocks(contract, 'Land')) {
          const key = tag(land, 'LandKey');
          if (key) lands.push(key);
          if (tag(land, 'Portion') || tag(land, 'MetesBoundsIndicator')) portion = true;
        }
        const clauses: string[] = [];
        for (const line of blocks(contract, 'Line')) {
          const words = [tag(line, 'Substance'), tag(line, 'Qualifier'), tag(line, 'ZoneName')]
            .filter((w): w is string => w !== null)
            .join(' ');
          if (words !== '') clauses.push(words);
        }
        parcels.push({
          contractNo,
          contractType,
          region: regionName,
          hectares: decimal(tag(contract, 'Hectares')),
          zone: clauses.length > 0 ? [...new Set(clauses)].join(' ').slice(0, 1000) : null,
          lands,
          portion,
        });
      }
    }
  }
  return { saleDate, parcels };
}

export interface SaleResultParcel {
  contractNo: string;
  /** ACCEPTED, NO OFFERS ... as published. */
  status: string;
  bonus: string | null;
  dollarsPerHectare: string | null;
  /** Each buyer with its share: "EXAMPLE LAND LTD. 100%". */
  buyers: string | null;
}

export interface SaleResults {
  saleDate: string;
  parcels: SaleResultParcel[];
}

/** A share as published (`100.0000000`) without its trailing zeros (`100`). */
function share(text: string | null): string | null {
  const value = decimal(text);
  return value === null ? null : value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** A sale's results (its PSR file); null when the file is not results with a sale date. */
export function parseSaleResults(xml: string): SaleResults | null {
  const head =
    /<MineralType>\s*PETROLEUM AND NATURAL GAS\s*<SaleDate>\s*(\d{4})\/(\d{2})\/(\d{2})/.exec(xml);
  if (!head) return null;
  const saleDate = `${String(head[1])}-${String(head[2])}-${String(head[3])}`;
  const parcels: SaleResultParcel[] = [];
  for (const parcel of blocks(xml, 'Parcel')) {
    const flag = tag(parcel, 'ContractFlag');
    const number = tag(parcel, 'ParcelNumber');
    const status = tag(parcel, 'Status');
    if (!flag || !number || !status || !/^[A-Z]$/.test(flag) || !/^\d{4}$/.test(number)) continue;
    const buyers = blocks(parcel, 'Clients')
      .map((client) => {
        const name = tag(client, 'ClientName');
        const percent = share(tag(client, 'Percentage'));
        return name ? `${name}${percent ? ` ${percent}%` : ''}` : null;
      })
      .filter((b): b is string => b !== null);
    parcels.push({
      contractNo: `${flag}${number}`,
      status: status.slice(0, 40),
      bonus: decimal(tag(parcel, 'Bonus')),
      dollarsPerHectare: decimal(tag(parcel, 'DollarPerHectare')),
      buyers: buyers.length > 0 ? buyers.join('; ').slice(0, 2000) : null,
    });
  }
  return { saleDate, parcels };
}

/** A parcel placed on the grid: its shape, the box around it, and how much of it was placed. */
export interface PlacedParcel {
  /** A GeoJSON MultiPolygon's coordinates: one polygon for each piece of land. */
  shape: [number, number][][][];
  /** West, south, east, north. */
  bounds: [number, number, number, number];
  /** How many of its land keys were placed, of how many. */
  placed: number;
  of: number;
}

/**
 * A parcel's land on the grid of sections given; null when none of its land is on it (the
 * parcel lies outside the area loaded, or its keys cannot be read).
 */
export function placeParcel(
  lands: readonly string[],
  sections: ReadonlyMap<string, SectionCorners>,
): PlacedParcel | null {
  const shape: [number, number][][][] = [];
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const key of lands) {
    const part = landKeyPart(key);
    const corners = part ? sections.get(sectionKey(part)) : undefined;
    if (!part || !corners) continue;
    const ring = sectionPartRing(corners, part.rect);
    for (const [x, y] of ring) {
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
    shape.push([ring]);
  }
  if (shape.length === 0) return null;
  return { shape, bounds: [west, south, east, north], placed: shape.length, of: lands.length };
}
