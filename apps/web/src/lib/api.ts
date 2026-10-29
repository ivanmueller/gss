import type { FieldIssue, ImportIssue } from '@grain/domain';

// Types of the API's responses (apps/api/src/db.ts and counterparties.ts).

export interface CounterpartySummary {
  id: string;
  organizationId: string;
  legalName: string;
  tradingName: string | null;
  types: string[];
  primaryCountry: string;
  verificationStatus: string;
  source: string;
  createdAt: string;
  contactCount: number;
  facilityCount: number;
  regions: string[];
  logoSha256: string | null;
  /** When it was archived (ISO 8601), or null. */
  archivedAt: string | null;
}

export interface Contact {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  /** Sent back with an edit; the API refuses an edit of a version that has changed. */
  version: string;
}

export interface Facility {
  id: string;
  name: string | null;
  facilityType: string | null;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string;
  latitude: string | null;
  longitude: string | null;
  locationPrecision: string | null;
  /** Where the coordinates came from: 'geocodio', 'manual' or 'file_import'. */
  geocodingSource: string | null;
  version: string;
}

export interface CounterpartyDetail extends CounterpartySummary {
  /** A public http or https address, or null. */
  website: string | null;
  notes: string | null;
  version: string;
  contacts: Contact[];
  facilities: Facility[];
}

/** GET /counterparties/{id}/website-preview: whether the site may be shown inside the app. */
export interface WebsitePreview {
  website: string;
  preview: 'allowed' | 'refused' | 'not_secure' | 'unreachable';
}

export interface CounterpartyList {
  counterparties: CounterpartySummary[];
  truncated: boolean;
}

/** A located facility for a map pin (GET /facilities). */
export interface MapFacility {
  id: string;
  counterpartyId: string;
  legalName: string;
  tradingName: string | null;
  counterpartyTypes: string[];
  name: string | null;
  facilityType: string | null;
  city: string | null;
  region: string | null;
  country: string;
  latitude: string;
  longitude: string;
  locationPrecision: 'exact' | 'approximate';
}

export interface MapFacilities {
  facilities: MapFacility[];
  truncated: boolean;
  /** The organization's facilities without coordinates, which no map can show. */
  withoutCoordinates: number;
}

export interface ImportResult {
  committed: boolean;
  importBatchId: string | null;
  summary: {
    rows: number;
    emptyRows: number;
    invalidRows: number;
    counterparties: number;
    newCounterparties: number;
    existingCounterparties: number;
    contacts: number;
    facilities: number;
  };
  counterparties: {
    legalName: string;
    country: string;
    lines: number[];
    contacts: number;
    facilities: number;
    status: 'new' | 'existing';
  }[];
  issues: ImportIssue[];
  warnings: ImportIssue[];
}

/** A refused or failed API call, with the API's error code when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function errorOf(body: unknown): { code: string; message: string } | null {
  if (typeof body !== 'object' || body === null || !('error' in body)) return null;
  const error: unknown = body.error;
  if (typeof error !== 'object' || error === null) return null;
  const { code, message } = error as Record<string, unknown>;
  return typeof code === 'string' && typeof message === 'string' ? { code, message } : null;
}

/** Calls the same-origin API with the user's token; throws ApiError unless the call succeeds. */
export async function apiFetch(
  path: string,
  token: string,
  init: RequestInit = {},
): Promise<Response> {
  let res: Response;
  try {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    res = await fetch(`/api/v1${path}`, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK', 'The server could not be reached.', null);
  }
  if (res.ok) return res;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON; fall through with the status alone.
  }
  const error = errorOf(body);
  throw new ApiError(
    res.status,
    error?.code ?? 'HTTP_ERROR',
    error?.message ?? `The server answered ${String(res.status)}.`,
    body,
  );
}

export async function apiJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, token, init);
  return (await res.json()) as T;
}

/** Sends a JSON body (or none) with the given method and returns the JSON answer. */
export function sendJson<T>(
  path: string,
  token: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return apiJson<T>(path, token, {
    method,
    ...(body !== undefined && {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
}

/** The field problems in a 422 answer to a form, if any. */
export function fieldIssues(error: unknown): FieldIssue[] {
  if (!(error instanceof ApiError) || typeof error.body !== 'object' || error.body === null) {
    return [];
  }
  const issues: unknown = (error.body as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as FieldIssue[]) : [];
}
