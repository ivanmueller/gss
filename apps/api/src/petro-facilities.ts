import { FACILITY_LOCATED, facilityGroupOf, type FacilityGroup } from '@grain/domain';

import type { FacilityDbRow, FacilityLoad } from './petro-facilities-db';

/** The Worker's facilities route needs this oil and gas schema (20261202010000). */
export const FACILITIES_SCHEMA_VERSION = 15;

/**
 * One facility in the answer, as a short list to keep the answer small (72,631 facilities in the
 * Duvernay's area): its ID, name, longitude, latitude, then indexes into the answer's lists of
 * subtypes, statuses and companies (operator, licensee; -1 for none), its licence ("F 6422",
 * "W 0123456" or null) and the index of where its point comes from in `located` (-1 for none).
 */
export type FacilityTuple = [
  id: string,
  name: string | null,
  longitude: number,
  latitude: number,
  subtype: number,
  status: number,
  operator: number,
  licensee: number,
  licence: string | null,
  located: number,
];

export interface FacilitiesAnswer {
  load: FacilityLoad | null;
  /** Each subtype once: its code, name and the group the map colours it by. */
  subtypes: { code: number | null; name: string | null; group: FacilityGroup }[];
  statuses: (string | null)[];
  /** Each company once, by its business associate code and name as the AER writes them. */
  companies: { code: string | null; name: string | null }[];
  located: readonly string[];
  facilities: FacilityTuple[];
}

/** Builds the answer: each subtype, status and company written once and pointed to. */
export function facilitiesAnswer(
  load: FacilityLoad | null,
  rows: FacilityDbRow[],
): FacilitiesAnswer {
  const subtypes: FacilitiesAnswer['subtypes'] = [];
  const subtypeAt = new Map<string, number>();
  const statuses: (string | null)[] = [];
  const statusAt = new Map<string | null, number>();
  const companies: FacilitiesAnswer['companies'] = [];
  const companyAt = new Map<string, number>();

  const subtypeOf = (code: number | null, name: string | null) => {
    const key = `${String(code)}|${name ?? ''}`;
    let at = subtypeAt.get(key);
    if (at === undefined) {
      at = subtypes.push({ code, name, group: facilityGroupOf(code) }) - 1;
      subtypeAt.set(key, at);
    }
    return at;
  };
  const statusOf = (status: string | null) => {
    let at = statusAt.get(status);
    if (at === undefined) {
      at = statuses.push(status) - 1;
      statusAt.set(status, at);
    }
    return at;
  };
  const companyOf = (code: string | null, name: string | null) => {
    if (code === null && name === null) return -1;
    const key = `${code ?? ''}|${name ?? ''}`;
    let at = companyAt.get(key);
    if (at === undefined) {
      at = companies.push({ code, name }) - 1;
      companyAt.set(key, at);
    }
    return at;
  };

  const facilities = rows.map((r): FacilityTuple => [
    r.facility_id,
    r.name,
    Number(r.longitude),
    Number(r.latitude),
    subtypeOf(r.sub_code, r.sub_type),
    statusOf(r.status),
    companyOf(r.operator_code, r.operator),
    companyOf(r.licensee_code, r.licensee),
    r.licence_number === null ? null : `${r.licence_type ?? ''} ${r.licence_number}`.trim(),
    r.location_source === null ? -1 : FACILITY_LOCATED.findIndex((l) => l === r.location_source),
  ]);
  return { load, subtypes, statuses, companies, located: FACILITY_LOCATED, facilities };
}
