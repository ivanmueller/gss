import { z } from 'zod';

/**
 * Places by name for the oil and gas map's Ask bar (F-254 part 3): a legal land location typed
 * as Alberta writes it ("Twp 62 Rge 22 W5", "62-22W5", "SE 12-62-22W5", "10-12-062-22W5"), read
 * here by plain code, never by Claude, and found by the Worker on the province's township grid;
 * or a town, named by Claude as typed and found by the Worker with Geocodio. Either way the page
 * is sent the place's name and box, and moves the map there.
 */

/** A legal land location: a township, or a section, quarter section or legal subdivision in it. */
export interface LegalLand {
  meridian: number;
  range: number;
  township: number;
  section: number | null;
  quarter: 'NE' | 'NW' | 'SE' | 'SW' | null;
  lsd: number | null;
}

const within = (n: number, low: number, high: number) =>
  Number.isInteger(n) && n >= low && n <= high;

function checked(land: LegalLand): LegalLand | null {
  // Alberta lies west of the 4th, 5th and 6th meridians, townships 1 to 126.
  if (
    !within(land.meridian, 4, 6) ||
    !within(land.range, 1, 34) ||
    !within(land.township, 1, 126)
  ) {
    return null;
  }
  if (land.section !== null && !within(land.section, 1, 36)) return null;
  if (land.lsd !== null && !within(land.lsd, 1, 16)) return null;
  if ((land.lsd !== null || land.quarter !== null) && land.section === null) return null;
  return land;
}

const num = (s: string | undefined) => (s === undefined ? null : Number(s));

/** The legal land location in a request, or null when it holds none (or one outside Alberta). */
export function parseLegalLand(text: string): LegalLand | null {
  const t = ` ${text.toLowerCase().replace(/\s+/g, ' ')} `;

  // Dashed: "62-22W5" (township-range), "12-62-22W5" (section-township-range),
  // "10-12-062-22W5" (LSD-section-township-range), with an optional quarter before a section.
  const dashed =
    /(?:\b(ne|nw|se|sw)[ -]+)?\b(\d{1,3})(?:-(\d{1,3}))?(?:-(\d{1,3}))?-(\d{1,2}) ?-? ?w ?([4-6])(?:th)? ?m?\b/.exec(
      t,
    );
  if (dashed) {
    const parts = [dashed[2], dashed[3], dashed[4]].filter((p): p is string => p !== undefined);
    const quarter = (dashed[1]?.toUpperCase() ?? null) as LegalLand['quarter'];
    const [a, b, c] = parts.map(Number) as [number, number | undefined, number | undefined];
    const range = Number(dashed[5]);
    const meridian = Number(dashed[6]);
    const land =
      parts.length === 1
        ? { township: a, section: null, lsd: null }
        : parts.length === 2
          ? { township: b ?? 0, section: a, lsd: null }
          : { township: c ?? 0, section: b ?? null, lsd: a };
    if (parts.length === 1 && quarter !== null) return null;
    return checked({ meridian, range, quarter: parts.length === 3 ? null : quarter, ...land });
  }

  // In words: "lsd 10 section 12 twp 62 rge 22 w5", "township 62 range 22 west of the 5th".
  const twp = /\b(?:twp|township|tp|t) ?(\d{1,3})\b/.exec(t);
  const rge = /\b(?:rge|range|rg|r) ?(\d{1,2})\b/.exec(t);
  const mer = /\b(?:w ?([4-6])(?:th)? ?m?|west of (?:the )?([4-6])(?:th)?(?: meridian)?)\b/.exec(t);
  if (!twp || !rge || !mer) return null;
  const sec = /\b(?:sec|section|s) ?(\d{1,2})\b/.exec(t);
  const lsd = /\b(?:lsd|ls) ?(\d{1,2})\b/.exec(t);
  const quarter = /\b(ne|nw|se|sw)(?: quarter)?(?: of)? (?:sec|section|s) ?\d/.exec(t);
  return checked({
    meridian: Number(mer[1] ?? mer[2]),
    range: Number(rge[1]),
    township: Number(twp[1]),
    section: num(sec?.[1]),
    quarter: (quarter?.[1]?.toUpperCase() ?? null) as LegalLand['quarter'],
    lsd: lsd ? Number(lsd[1]) : null,
  });
}

/** The location as Alberta writes it: "T62 R22 W5", "Sec 12-062-22W5", "SE 12-062-22W5", "10-12-062-22W5". */
export function legalLandLabel(land: LegalLand): string {
  const pad = (n: number, width: number) => String(n).padStart(width, '0');
  const trr = `${pad(land.township, 3)}-${pad(land.range, 2)}W${String(land.meridian)}`;
  if (land.section === null) {
    return `T${String(land.township)} R${String(land.range)} W${String(land.meridian)}`;
  }
  if (land.lsd !== null) return `${pad(land.lsd, 2)}-${pad(land.section, 2)}-${trr}`;
  if (land.quarter !== null) return `${land.quarter} ${pad(land.section, 2)}-${trr}`;
  return `Sec ${pad(land.section, 2)}-${trr}`;
}

/** The province's township grid query for the location: its layer level and where clause. */
export function legalLandQuery(land: LegalLand): {
  level: 'township' | 'section' | 'quarter' | 'lsd';
  where: string;
} {
  const parts = [
    `M=${String(land.meridian)}`,
    `RGE=${String(land.range)}`,
    `TWP=${String(land.township)}`,
  ];
  if (land.section === null) return { level: 'township', where: parts.join(' AND ') };
  parts.push(`SEC=${String(land.section)}`);
  if (land.lsd !== null) {
    return { level: 'lsd', where: [...parts, `LS=${String(land.lsd)}`].join(' AND ') };
  }
  if (land.quarter !== null) {
    return { level: 'quarter', where: [...parts, `QS='${land.quarter}'`].join(' AND ') };
  }
  return { level: 'section', where: parts.join(' AND ') };
}

/** A place found for a request: its name and the box the map moves to [west, south, east, north]. */
export const mapPlaceSchema = z
  .object({
    label: z.string().min(1).max(120),
    bounds: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  })
  .strict();
export type MapPlace = z.infer<typeof mapPlaceSchema>;

/** The box shown around a town: about 25 km across. */
export function townBounds(latitude: number, longitude: number): MapPlace['bounds'] {
  const dLat = 0.11;
  const dLon = dLat / Math.cos((latitude * Math.PI) / 180);
  const round = (n: number) => Math.round(n * 1e5) / 1e5;
  return [
    round(longitude - dLon),
    round(latitude - dLat),
    round(longitude + dLon),
    round(latitude + dLat),
  ];
}

/** The box around every point of GeoJSON features' geometries; null when there are none. */
export function featuresBounds(features: readonly unknown[]): MapPlace['bounds'] | null {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      const [lon, lat] = value as [number, number];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      box[0] = Math.min(box[0] ?? Infinity, lon);
      box[1] = Math.min(box[1] ?? Infinity, lat);
      box[2] = Math.max(box[2] ?? -Infinity, lon);
      box[3] = Math.max(box[3] ?? -Infinity, lat);
      return;
    }
    for (const item of value) visit(item);
  };
  for (const feature of features) {
    const geometry =
      typeof feature === 'object' && feature !== null
        ? (feature as { geometry?: { coordinates?: unknown } }).geometry
        : undefined;
    visit(geometry?.coordinates);
  }
  const [west, south, east, north] = box as [number, number, number, number];
  return west <= east && south <= north ? [west, south, east, north] : null;
}
