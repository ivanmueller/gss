import { z } from 'zod';

import { LOCATION_PRECISIONS, type LocationPrecision } from './directory';

// Finding coordinates for facilities from their addresses (docs/DECISIONS.md, geocoding
// with Geocodio). Shared by the API, which looks addresses up and saves the chosen
// results, and the web app, which shows them for review.

/** Most facilities looked up, or saved, in one request. */
export const GEOCODE_LIMIT = 1000;

/** Below this confidence a result is shown for review but not selected by default. */
export const LOW_CONFIDENCE = 0.8;

/** Why a facility has no result to save. */
export type GeocodeMiss =
  | 'NO_ADDRESS' // neither street, city nor postal code to look up
  | 'NOT_FOUND' // Geocodio found nothing
  | 'TOO_VAGUE' // only the province or state was found
  | 'OTHER_COUNTRY'; // the result is in a different country

/** A location Geocodio found, signed by the API so it can be saved unchanged. */
export interface GeocodeMatch {
  latitude: string;
  longitude: string;
  precision: LocationPrecision;
  /** Geocodio's accuracy type, e.g. rooftop, range_interpolation, place. */
  accuracyType: string;
  /** Geocodio's confidence, 0 to 1, two decimals. */
  confidence: string;
  /** The address Geocodio matched, for the reviewer. */
  formattedAddress: string;
  /** False when the result is in another province or state than the facility's. */
  regionMatches: boolean;
  expiresAt: string;
  signature: string;
}

export interface GeocodeProposal {
  facilityId: string;
  counterpartyId: string;
  legalName: string;
  facilityName: string | null;
  address: {
    addressLine: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
    country: string;
  };
  match: GeocodeMatch | null;
  miss: GeocodeMiss | null;
}

export interface GeocodeLookup {
  proposals: GeocodeProposal[];
  /** More facilities without coordinates are waiting than one lookup covers. */
  truncated: boolean;
}

const decimal = (integerDigits: number, decimals: number) =>
  z.string().regex(new RegExp(`^-?\\d{1,${String(integerDigits)}}\\.\\d{${String(decimals)}}$`));

/** What the browser sends back to save: the chosen matches exactly as the API signed them. */
export const saveCoordinatesRequestSchema = z.object({
  organizationId: z.uuid(),
  matches: z
    .array(
      z.object({
        facilityId: z.uuid(),
        latitude: decimal(2, 6),
        longitude: decimal(3, 6),
        precision: z.enum(LOCATION_PRECISIONS),
        accuracyType: z.string().regex(/^[a-z_]{1,40}$/),
        confidence: z.string().regex(/^(0\.\d\d|1\.00)$/),
        expiresAt: z.iso.datetime(),
        signature: z.string().regex(/^[0-9a-f]{64}$/),
      }),
    )
    .min(1)
    .max(GEOCODE_LIMIT),
});

export type SaveCoordinatesRequest = z.infer<typeof saveCoordinatesRequestSchema>;
export type SignedMatch = SaveCoordinatesRequest['matches'][number];

/** Asks the API to look up the organization's facilities without coordinates. */
export const geocodeRequestSchema = z.object({ organizationId: z.uuid() });

export interface SaveCoordinatesResult {
  saved: number;
  /** Matches not saved because the facility has coordinates by now or is not the organization's. */
  skipped: number;
}

/** What to send back to save a match: the signed fields only. */
export function signedMatchOf(facilityId: string, match: GeocodeMatch): SignedMatch {
  return {
    facilityId,
    latitude: match.latitude,
    longitude: match.longitude,
    precision: match.precision,
    accuracyType: match.accuracyType,
    confidence: match.confidence,
    expiresAt: match.expiresAt,
    signature: match.signature,
  };
}
