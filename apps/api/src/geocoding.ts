import {
  normalizeCountry,
  normalizeRegion,
  type GeocodeMatch,
  type GeocodeMiss,
  type GeocodeProposal,
  type LocationPrecision,
  type SignedMatch,
} from '@grain/domain';

// Looking facility addresses up with Geocodio (docs/DECISIONS.md, geocoding). Only the
// address goes to Geocodio, never a company's name or contacts. The key is the Worker
// secret GEOCODIO_API_KEY and is sent as a header, so it is never part of a URL.

const GEOCODIO_URL = 'https://api.geocod.io/v2/geocode?limit=1';
const TIMEOUT_MS = 30_000;
/** How long a looked-up match can be saved. */
export const MATCH_LIFETIME_MS = 60 * 60 * 1000;

// Geocodio's accuracy types: https://www.geocod.io/guides/accuracy-types-scores
const EXACT = new Set(['rooftop', 'point', 'range_interpolation', 'nearest_rooftop_match']);
const TOO_VAGUE = new Set(['state', 'county']);
// Geocodio's names for the countries it takes as input.
const GEOCODIO_COUNTRY: Record<string, string> = { CA: 'Canada', US: 'USA' };

export interface FacilityAddress {
  facilityId: string;
  counterpartyId: string;
  legalName: string;
  facilityName: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  /** The facility's version (its last change time), signed into each match. */
  version: string;
}

/** A Geocodio failure for the whole request; `refused` covers a bad key and a used-up allowance. */
export class GeocoderError extends Error {
  constructor(
    readonly kind: 'refused' | 'unavailable',
    readonly status: number,
  ) {
    super(`Geocodio ${kind} (${String(status)})`);
    this.name = 'GeocoderError';
  }
}

export interface GeocodioResult {
  latitude: number;
  longitude: number;
  accuracyType: string;
  confidence: number;
  formattedAddress: string;
  country: string | null;
  region: string | null;
}

/** Geocodio's address components for a facility, or null when there is nothing to look up. */
export function geocodioQuery(facility: FacilityAddress): Record<string, string> | null {
  if (!facility.addressLine && !facility.city && !facility.postalCode) return null;
  const parts: Record<string, string | null | undefined> = {
    street: facility.addressLine,
    city: facility.city,
    state_province: facility.region,
    postal_code: facility.postalCode,
    country: GEOCODIO_COUNTRY[facility.country],
  };
  return Object.fromEntries(
    Object.entries(parts).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** The best result Geocodio gave for one address, read defensively. */
function bestResult(entry: unknown): GeocodioResult | null {
  const results = record(record(entry)?.response)?.results;
  const first = record(Array.isArray(results) ? results[0] : null);
  const location = record(first?.location);
  const components = record(first?.address_components);
  const { lat, lng } = location ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || !first) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : null);
  const confidence = typeof first.accuracy === 'number' ? first.accuracy : 0;
  return {
    latitude: lat,
    longitude: lng,
    accuracyType: text(first.accuracy_type) ?? 'unknown',
    confidence: Math.min(1, Math.max(0, confidence)),
    formattedAddress: text(first.formatted_address) ?? '',
    country: text(components?.country),
    region: text(components?.state_province),
  };
}

/**
 * Looks addresses up in one batch request. Returns the best result per key, or null when
 * Geocodio found nothing for that address.
 */
export async function geocodeAddresses(
  apiKey: string,
  queries: Map<string, Record<string, string>>,
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, GeocodioResult | null>> {
  if (queries.size === 0) return new Map();
  let res: Response;
  try {
    res = await fetchImpl(GEOCODIO_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(queries)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new GeocoderError('unavailable', 0);
  }
  if ([401, 402, 403, 429].includes(res.status)) throw new GeocoderError('refused', res.status);
  if (!res.ok) throw new GeocoderError('unavailable', res.status);
  const results = record(record(await res.json().catch(() => null))?.results);
  if (!results) throw new GeocoderError('unavailable', res.status);
  return new Map([...queries.keys()].map((key) => [key, bestResult(results[key])]));
}

function precisionOf(accuracyType: string): LocationPrecision {
  return EXACT.has(accuracyType) ? 'exact' : 'approximate';
}

type UnsignedMatch = Omit<GeocodeMatch, 'signature'>;

/** The match to offer for a facility, or why there is none. */
export function matchFor(
  facility: FacilityAddress,
  result: GeocodioResult | null,
  now: Date,
): { match: UnsignedMatch; miss: null } | { match: null; miss: GeocodeMiss } {
  if (!result) return { match: null, miss: 'NOT_FOUND' };
  if (TOO_VAGUE.has(result.accuracyType)) return { match: null, miss: 'TOO_VAGUE' };
  const country = result.country ? normalizeCountry(result.country) : null;
  if (!country || country !== facility.country) return { match: null, miss: 'OTHER_COUNTRY' };
  const region = result.region ? normalizeRegion(country, result.region) : null;
  return {
    miss: null,
    match: {
      latitude: result.latitude.toFixed(6),
      longitude: result.longitude.toFixed(6),
      precision: precisionOf(result.accuracyType),
      accuracyType: result.accuracyType,
      confidence: result.confidence.toFixed(2),
      formattedAddress: result.formattedAddress,
      regionMatches: facility.region === null || region === facility.region,
      facilityVersion: facility.version,
      expiresAt: new Date(now.getTime() + MATCH_LIFETIME_MS).toISOString(),
    },
  };
}

// Matches are signed so that only what this API looked up can be saved as Geocodio's,
// for that facility (as it was when looked up) and organization, within the hour. The signing key is derived from
// the Geocodio key, so no second secret is needed; replacing that key voids unsaved matches.
type Signed = Pick<
  SignedMatch,
  | 'facilityId'
  | 'latitude'
  | 'longitude'
  | 'precision'
  | 'accuracyType'
  | 'confidence'
  | 'facilityVersion'
  | 'expiresAt'
>;

function signedText(organizationId: string, match: Signed) {
  return new TextEncoder().encode(
    [
      'v2',
      organizationId,
      match.facilityId,
      match.latitude,
      match.longitude,
      match.precision,
      match.accuracyType,
      match.confidence,
      match.facilityVersion,
      match.expiresAt,
    ].join('\n'),
  );
}

export interface MatchSigner {
  sign: (organizationId: string, match: Signed) => Promise<string>;
  /** True when the match is exactly as this API signed it for this organization. */
  verify: (organizationId: string, match: SignedMatch) => Promise<boolean>;
}

export async function matchSigner(apiKey: string): Promise<MatchSigner> {
  const material = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`grain-trading geocode match signing v1\n${apiKey}`),
  );
  const key = await crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  return {
    async sign(organizationId, match) {
      const signature = await crypto.subtle.sign('HMAC', key, signedText(organizationId, match));
      return [...new Uint8Array(signature)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    },
    verify(organizationId, match) {
      const signature = Uint8Array.from(match.signature.match(/../g) ?? [], (pair) =>
        parseInt(pair, 16),
      );
      return crypto.subtle.verify('HMAC', key, signature, signedText(organizationId, match));
    },
  };
}

/** Looks the facilities up and returns them with signed matches, in the given order. */
export async function proposeCoordinates(
  apiKey: string,
  organizationId: string,
  facilities: FacilityAddress[],
  now: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeProposal[]> {
  const queries = new Map<string, Record<string, string>>();
  for (const facility of facilities) {
    const query = geocodioQuery(facility);
    if (query) queries.set(facility.facilityId, query);
  }
  const results = await geocodeAddresses(apiKey, queries, fetchImpl);
  const signer = await matchSigner(apiKey);
  return Promise.all(
    facilities.map(async (facility): Promise<GeocodeProposal> => {
      const base = {
        facilityId: facility.facilityId,
        counterpartyId: facility.counterpartyId,
        legalName: facility.legalName,
        facilityName: facility.facilityName,
        address: {
          addressLine: facility.addressLine,
          city: facility.city,
          region: facility.region,
          postalCode: facility.postalCode,
          country: facility.country,
        },
      };
      if (!queries.has(facility.facilityId)) return { ...base, match: null, miss: 'NO_ADDRESS' };
      const found = matchFor(facility, results.get(facility.facilityId) ?? null, now);
      if (!found.match) return { ...base, match: null, miss: found.miss };
      const signature = await signer.sign(organizationId, {
        facilityId: facility.facilityId,
        ...found.match,
      });
      return { ...base, match: { ...found.match, signature }, miss: null };
    }),
  );
}
