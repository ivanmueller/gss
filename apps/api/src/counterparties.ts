import {
  commodityChangeSchema,
  contactKey,
  COUNTERPARTY_TYPES,
  counterpartyKey,
  facilityKey,
  FACILITY_TYPE_LABELS,
  MARKET_LABELS,
  createContactSchema,
  createCounterpartySchema,
  createFacilitySchema,
  groupImportRows,
  importRequestSchema,
  inspectPng,
  mainContactSchema,
  MAX_LOGO_BYTES,
  normalizeCountry,
  parseContactFields,
  parseCounterpartyFields,
  parseFacilityFields,
  parseImportRow,
  parseNewCounterparty,
  updateContactSchema,
  updateCounterpartySchema,
  updateFacilitySchema,
  type ContactInput,
  type CounterpartyType,
  type FacilityInput,
  type FieldIssue,
  type ImportGroup,
  type Market,
  type ImportIssue,
  type ParsedImportRow,
} from '@grain/domain';
import { Hono } from 'hono';

import {
  LIST_LIMIT,
  type CounterpartyChanges,
  type CounterpartyHistory,
  type Database,
  type ExistingCounterparty,
  type ExistingFacility,
  type FacilityChanges,
  type ImportAddition,
  type ImportBatchInput,
  type RequestContext,
  type WriteResult,
} from './db';
import {
  apiError,
  isUuid,
  readJson,
  withDatabase,
  type ApiContext,
  type ApiEnv,
  type DatabaseFactory,
} from './respond';

/** Largest import request body accepted, in bytes. */
export const MAX_IMPORT_BODY_BYTES = 10 * 1024 * 1024;
/** Largest body of a form (add, edit) accepted, in bytes. */
const MAX_FORM_BODY_BYTES = 64 * 1024;

const FORBIDDEN_EDIT = 'Only operations and admin members can change counterparties.';

type RecordKind = 'counterparty' | 'contact' | 'location';

/** A schema refusal (zod's error, of which only the paths are used). */
function malformed(c: ApiContext, error: { issues: { path: PropertyKey[] }[] }) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'The request is malformed.', {
    fields: error.issues.slice(0, 20).map((issue) => issue.path.map(String).join('.')),
  });
}

/** A form with problems: each one with its field, so the form can show it in place. */
function invalid(c: ApiContext, issues: FieldIssue[]) {
  return apiError(c, 422, 'VALIDATION_FAILED', 'Some fields need fixing.', { issues });
}

function refused(
  c: ApiContext,
  result: Exclude<WriteResult, { status: 'saved' }>,
  what: RecordKind,
) {
  switch (result.status) {
    case 'not_found':
      return apiError(c, 404, 'NOT_FOUND', `No such ${what}.`);
    case 'forbidden':
      return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_EDIT);
    case 'changed':
      return apiError(
        c,
        409,
        'RECORD_CHANGED',
        `Someone changed this ${what} after you opened it. Reload the page to see their change, then make yours again.`,
      );
    case 'archived':
      return apiError(
        c,
        409,
        'ARCHIVED',
        'This counterparty is archived. Restore it before changing it.',
      );
  }
}

/** After a change: the counterparty as it now is, with its contacts and locations. */
async function savedDetail(
  c: ApiContext,
  db: Database,
  ctx: RequestContext,
  id: string,
  result: WriteResult,
  what: RecordKind,
  status: 200 | 201 = 200,
) {
  if (result.status !== 'saved') return refused(c, result, what);
  const counterparty = await db.getCounterparty(ctx, id);
  return counterparty
    ? c.json(counterparty, status)
    : apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function declaredLength(header: string | undefined): number | null {
  if (header === undefined || !/^\d+$/.test(header)) return null;
  return Number(header);
}

/** A name or place compared without case or extra spaces. */
function norm(value: string | null): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Whether a file's contact is one the company has: the same email when both have one, else
 * the same name. Its phone, email and role can then be updated.
 */
function sameContact(listed: ContactInput, contact: ContactInput): boolean {
  if (listed.email !== null && contact.email !== null) {
    return listed.email.toLowerCase() === contact.email.toLowerCase();
  }
  return norm(listed.name) === norm(contact.name);
}

/**
 * Whether a file's location is one the company has: the same name, city, province or state
 * and country, with an address and postal code that agree or are missing on one side (so a
 * file can fill them in). One given only by its coordinates matches by them (facilityKey).
 */
function sameLocation(listed: ExistingFacility, facility: FacilityInput): boolean {
  const words = (
    f: Pick<FacilityInput, 'name' | 'addressLine' | 'city' | 'region' | 'postalCode'>,
  ) => [f.name, f.addressLine, f.city, f.region, f.postalCode].map(norm);
  if (words(listed).every((word) => word === '') || words(facility).every((word) => word === '')) {
    return facilityKey(listed) === facilityKey(facility);
  }
  const fits = (a: string | null, b: string | null) =>
    norm(a) === '' || norm(b) === '' || norm(a) === norm(b);
  return (
    listed.country === facility.country &&
    norm(listed.name) === norm(facility.name) &&
    norm(listed.city) === norm(facility.city) &&
    norm(listed.region) === norm(facility.region) &&
    fits(listed.addressLine, facility.addressLine) &&
    fits(listed.postalCode, facility.postalCode)
  );
}

/**
 * Which listed record each of a file's records is, each listed one taken at most once
 * (Codex's review of ivanmueller/gss#95): exact matches first, then loose ones among those
 * left, in file order. A file record whose only match is taken is new.
 */
function assign<L, F>(
  listed: readonly L[],
  file: readonly F[],
  exact: (listed: L, item: F) => boolean,
  loose: (listed: L, item: F) => boolean,
): (L | undefined)[] {
  const taken = new Set<L>();
  const matched: (L | undefined)[] = file.map(() => undefined);
  for (const same of [exact, loose]) {
    file.forEach((item, index) => {
      if (matched[index] !== undefined) return;
      const found = listed.find((record) => !taken.has(record) && same(record, item));
      if (found !== undefined) {
        taken.add(found);
        matched[index] = found;
      }
    });
  }
  return matched;
}

const NOTES_MAX = 2000;

/** "Company phone: (403) 555-0100 → (403) 555-0199", or "… none → …". */
function changed(label: string, before: string | null, after: string): string {
  return `${label}: ${before ?? 'none'} → ${after}`;
}

/**
 * What a file changes on a company already in the list (owner's answers, 2026-10-30 and
 * 2026-10-31): new locations, contacts and commodities are added (unverified); a filled cell
 * replaces its detail and an empty one keeps it; types are only added; a verified company
 * stays verified; the file's notes go below the company's own. Commodities already listed,
 * verified or not, are left as they are. `changes` says it all in words for the Check step.
 */
function changesFor(
  company: ExistingCounterparty,
  group: ImportGroup,
): { addition: ImportAddition; changes: string[]; warnings: ImportIssue[] } {
  const changes: string[] = [];
  const warnings: ImportIssue[] = [];
  const file = group.counterparty;
  const details: CounterpartyChanges = {};

  const types = COUNTERPARTY_TYPES.filter(
    (type) => company.types.includes(type) || file.types.includes(type),
  );
  if (types.length > company.types.length) {
    details.types = types;
    changes.push(changed('Type', company.types.join(', '), types.join(', ')));
  }
  if (
    group.givenVerification &&
    company.verificationStatus !== 'verified' &&
    file.verificationStatus !== company.verificationStatus
  ) {
    details.verificationStatus = file.verificationStatus;
    changes.push(changed('Verification', company.verificationStatus, file.verificationStatus));
  }
  if (file.website !== null && file.website !== company.website) {
    details.website = file.website;
    changes.push(changed('Website', company.website, file.website));
  }
  if (file.phone !== null && file.phone !== company.phone) {
    details.phone = file.phone;
    changes.push(changed('Company phone', company.phone, file.phone));
  }
  if (file.markets.length > 0 && file.markets.join(',') !== company.markets.join(',')) {
    details.markets = file.markets;
    const names = (markets: readonly Market[]) =>
      markets.map((market) => MARKET_LABELS[market]).join(', ') || null;
    changes.push(changed('Markets', names(company.markets), names(file.markets) ?? ''));
  }
  if (file.tier !== null && file.tier !== company.tier) {
    details.tier = file.tier;
    changes.push(changed('Tier', company.tier, file.tier));
  }
  if (file.notes !== null && !(company.notes ?? '').includes(file.notes)) {
    const notes = company.notes === null ? file.notes : `${company.notes}\n\n${file.notes}`;
    if (notes.length > NOTES_MAX) {
      warnings.push({
        line: group.lines[0] ?? 0,
        field: 'notes',
        message: `not added to ${company.legalName}'s notes: together they would be longer than ${String(NOTES_MAX)} characters`,
      });
    } else {
      details.notes = notes;
      changes.push("Notes: the file's notes added below");
    }
  }

  const contacts: ContactInput[] = [];
  const contactUpdates: ImportAddition['contactUpdates'] = [];
  const contactMatches = assign(
    company.contacts,
    group.contacts,
    (listed, contact) => contactKey(listed) === contactKey(contact),
    sameContact,
  );
  for (const [index, contact] of group.contacts.entries()) {
    const listed = contactMatches[index];
    if (!listed) {
      contacts.push(contact);
      continue;
    }
    const update: ImportAddition['contactUpdates'][number]['changes'] = {};
    const said: string[] = [];
    for (const [field, label] of [
      ['phone', 'phone'],
      ['email', 'email'],
      ['role', 'role'],
    ] as const) {
      const value = contact[field];
      if (value !== null && value !== listed[field]) {
        update[field] = value;
        said.push(changed(label, listed[field], value));
      }
    }
    if (said.length > 0) {
      contactUpdates.push({ id: listed.id, changes: update });
      changes.push(`Contact ${listed.name}: ${said.join('; ')}`);
    }
  }

  const facilities: FacilityInput[] = [];
  const facilityUpdates: ImportAddition['facilityUpdates'] = [];
  const facilityMatches = assign(
    company.facilities,
    group.facilities,
    (listed, facility) => facilityKey(listed) === facilityKey(facility),
    sameLocation,
  );
  for (const [index, facility] of group.facilities.entries()) {
    const listed = facilityMatches[index];
    if (!listed) {
      facilities.push(facility);
      continue;
    }
    const update: FacilityChanges = {};
    const said: string[] = [];
    if (facility.facilityType !== null && facility.facilityType !== listed.facilityType) {
      update.facilityType = facility.facilityType;
      said.push(
        changed(
          'type',
          listed.facilityType && FACILITY_TYPE_LABELS[listed.facilityType],
          FACILITY_TYPE_LABELS[facility.facilityType],
        ),
      );
    }
    if (listed.addressLine === null && facility.addressLine !== null) {
      update.addressLine = facility.addressLine;
      said.push(changed('address', null, facility.addressLine));
    }
    if (listed.postalCode === null && facility.postalCode !== null) {
      update.postalCode = facility.postalCode;
      said.push(changed('postal code', null, facility.postalCode));
    }
    const at = (value: string | null) => (value === null ? null : Number(value).toFixed(6));
    if (
      facility.latitude !== null &&
      facility.longitude !== null &&
      (at(facility.latitude) !== at(listed.latitude) ||
        at(facility.longitude) !== at(listed.longitude))
    ) {
      update.coordinates = {
        latitude: facility.latitude,
        longitude: facility.longitude,
        locationPrecision: facility.locationPrecision ?? 'approximate',
      };
      said.push(
        changed(
          'coordinates',
          listed.latitude === null
            ? null
            : `${String(at(listed.latitude))}, ${String(at(listed.longitude))}`,
          `${String(at(facility.latitude))}, ${String(at(facility.longitude))}`,
        ),
      );
    }
    if (said.length > 0) {
      facilityUpdates.push({ id: listed.id, changes: update });
      const where = [listed.name, listed.city, listed.region].filter(Boolean).join(', ');
      changes.push(`Location ${where || 'without a name'}: ${said.join('; ')}`);
    }
  }

  const commodities = new Set(company.commodities.map((k) => `${k.direction}:${k.commodity}`));
  return {
    addition: {
      counterpartyId: company.id,
      details: Object.keys(details).length > 0 ? details : null,
      contacts,
      facilities,
      commodities: group.commodities.filter(
        (k) => !commodities.has(`${k.direction}:${k.commodity}`),
      ),
      contactUpdates,
      facilityUpdates,
    },
    changes,
    warnings,
  };
}

/** Whether a file adds anything to a listed company or changes anything on it. */
function hasAny(addition: ImportAddition): boolean {
  return (
    addition.details !== null ||
    addition.facilities.length +
      addition.contacts.length +
      addition.commodities.length +
      addition.contactUpdates.length +
      addition.facilityUpdates.length >
      0
  );
}

export interface ImportPlan {
  parsed: ParsedImportRow[];
  emptyRows: number;
  issues: ImportIssue[];
  warnings: ImportIssue[];
  groups: ImportGroup[];
}

/** A file's rows read and grouped into companies, before matching them to the list. */
export function planImport(
  rows: { line: number; values: Record<string, string | undefined> }[],
  defaultTypes: readonly CounterpartyType[] | undefined,
): ImportPlan {
  const parsed: ParsedImportRow[] = [];
  const issues: ImportIssue[] = [];
  let emptyRows = 0;
  for (const row of rows) {
    const result = parseImportRow(row.line, row.values, defaultTypes ? { defaultTypes } : {});
    if (result.status === 'ok') parsed.push(result.row);
    else if (result.status === 'empty') emptyRows += 1;
    else issues.push(...result.issues);
  }
  const { groups, warnings } = groupImportRows(parsed);
  return { parsed, emptyRows, issues, warnings, groups };
}

/** A file's companies matched against the list as it is: which are new, what others get. */
export function matchImport(
  plan: ImportPlan,
  rowCount: number,
  companies: readonly ExistingCounterparty[],
) {
  // Companies already in the list, matched as the file's rows are (counterpartyKey).
  const existing = new Map<string, ExistingCounterparty>();
  for (const company of companies) {
    const key = counterpartyKey(company.primaryCountry, company.legalName);
    if (!existing.has(key)) existing.set(key, company);
  }
  const fresh = plan.groups.filter((group) => !existing.has(group.key));
  const additions = plan.groups.flatMap((group) => {
    const company = existing.get(group.key);
    return company && !company.archived ? [{ group, ...changesFor(company, group) }] : [];
  });
  const adding = additions.filter(({ addition }) => hasAny(addition));
  const updating = additions.filter(
    ({ addition }) =>
      addition.details !== null ||
      addition.contactUpdates.length + addition.facilityUpdates.length > 0,
  );
  const result = {
    committed: false,
    importBatchId: null as string | null,
    summary: {
      rows: rowCount,
      emptyRows: plan.emptyRows,
      invalidRows: new Set(plan.issues.map((issue) => issue.line)).size,
      counterparties: plan.groups.length,
      newCounterparties: fresh.length,
      existingCounterparties: plan.groups.length - fresh.length,
      contacts: fresh.reduce((sum, group) => sum + group.contacts.length, 0),
      facilities: fresh.reduce((sum, group) => sum + group.facilities.length, 0),
      // What the file adds to companies already in the list (owner's answer, 2026-10-30).
      existingWithAdditions: adding.length,
      addedContacts: adding.reduce((sum, { addition }) => sum + addition.contacts.length, 0),
      addedFacilities: adding.reduce((sum, { addition }) => sum + addition.facilities.length, 0),
      addedCommodities: adding.reduce((sum, { addition }) => sum + addition.commodities.length, 0),
      // Listed companies whose own details, contacts or locations the file changes (owner's
      // answer, 2026-10-31).
      existingUpdated: updating.length,
    },
    counterparties: plan.groups.map((group) => {
      const company = existing.get(group.key);
      const match = additions.find((item) => item.group === group);
      const addition = match?.addition;
      return {
        legalName: group.counterparty.legalName,
        country: group.counterparty.primaryCountry,
        lines: group.lines,
        contacts: addition ? addition.contacts.length : group.contacts.length,
        facilities: addition ? addition.facilities.length : group.facilities.length,
        status: !company ? 'new' : company.archived ? 'archived' : 'existing',
        changes: match?.changes ?? [],
      };
    }),
    issues: plan.issues,
    warnings: [...plan.warnings, ...additions.flatMap((item) => item.warnings)],
  };
  return { result, fresh, adding };
}

type ImportMatch = ReturnType<typeof matchImport>;

/** What an import writes, given how its file matched the list; null when nothing is new. */
export function importBatchFor(
  plan: ImportPlan,
  match: ImportMatch,
  file: Pick<ImportBatchInput, 'organizationId' | 'fileName' | 'contentSha256' | 'rowCount'>,
): ImportBatchInput | null {
  if (match.fresh.length === 0 && match.adding.length === 0) return null;
  return {
    ...file,
    skippedCount: plan.groups.length - match.fresh.length,
    counterparties: match.fresh.map(({ counterparty, contacts, facilities, commodities }) => ({
      counterparty,
      contacts,
      facilities,
      commodities,
    })),
    additions: match.adding.map(({ addition }) => addition),
  };
}

/** What keeps a counterparty from being deleted, as the answer names it. */
const HISTORY_NAMES: Record<CounterpartyHistory, string> = {
  quotes: 'bids or offers',
  freight: 'freight rates',
  contact_log: 'a contact history',
  follow_ups: 'follow-ups',
};

/** "a", "a and b", "a, b and c". */
function listed(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}

/**
 * What an import would write and what it would replace, as a SHA-256 (null when nothing): the
 * Check step's answer carries it, and the import writes only when its own plan has the same.
 * The review's changes hold the values replaced ("Tier: B → A"), so a company changed since
 * the check changes it even when the file's values stay the same (Codex's reviews of
 * ivanmueller/gss#95).
 */
function fingerprintOf(
  batch: ImportBatchInput | null,
  review: ImportMatch['result'],
): Promise<string | null> {
  if (batch === null) return Promise.resolve(null);
  return sha256Hex(
    JSON.stringify({
      skipped: batch.skippedCount,
      counterparties: batch.counterparties,
      additions: batch.additions,
      review: review.counterparties.map(({ status, changes }) => ({ status, changes })),
    }),
  );
}

/** Thrown when an import's plan is no longer what its Check step showed. */
class PlanChanged extends Error {
  constructor(readonly fingerprint: string | null) {
    super('the plan changed since it was checked');
  }
}

/** /api/v1/counterparties. Mounted after requireUser, so every route needs a signed-in user. */
export function counterpartyRoutes(openDatabase: DatabaseFactory) {
  const routes = new Hono<ApiEnv>();

  routes.get('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const organizationId = c.req.query('organization_id') ?? null;
    if (organizationId !== null && !isUuid(organizationId)) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'organization_id must be a UUID.');
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const rows = await db.listCounterparties(ctx, organizationId);
      return c.json({
        counterparties: rows.slice(0, LIST_LIMIT),
        truncated: rows.length > LIST_LIMIT,
      });
    });
  });

  routes.post('/import', async (c) => {
    c.header('Cache-Control', 'no-store');
    const declared = declaredLength(c.req.header('content-length'));
    if (declared !== null && declared > MAX_IMPORT_BODY_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'The import is larger than 10 MB.');
    }
    const text = await c.req.text();
    if (text.length > MAX_IMPORT_BODY_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'The import is larger than 10 MB.');
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The request body is not JSON.');
    }
    const request = importRequestSchema.safeParse(body);
    if (!request.success) {
      return apiError(c, 422, 'VALIDATION_FAILED', 'The import request is malformed.', {
        fields: request.error.issues.slice(0, 20).map((issue) => issue.path.join('.')),
      });
    }
    const { organizationId, fileName, commit, rows, defaultTypes, reviewed } = request.data;
    const plan = planImport(rows, defaultTypes);

    return withDatabase(c, openDatabase, async (db, ctx) => {
      if (!(await db.canEditDirectory(ctx, organizationId))) {
        return apiError(
          c,
          403,
          'FORBIDDEN',
          'Only operations and admin members can import counterparties.',
        );
      }
      if (!commit || plan.issues.length > 0) {
        const match = matchImport(
          plan,
          rows.length,
          await db.existingCounterparties(ctx, organizationId),
        );
        const fingerprint = await fingerprintOf(
          importBatchFor(plan, match, { organizationId, fileName, contentSha256: '', rowCount: 0 }),
          match.result,
        );
        const result = { ...match.result, fingerprint };
        if (!commit) return c.json(result);
        return apiError(c, 422, 'VALIDATION_FAILED', 'Fix the rows with problems first.', result);
      }
      if (reviewed === undefined) {
        return apiError(c, 422, 'NOT_CHECKED', 'Check the file before importing it.');
      }

      const contentSha256 = await sha256Hex(
        JSON.stringify(
          // Without commodities, a company phone, markets or a tier, the same as before they
          // could be imported.
          plan.groups.map(
            ({
              counterparty: { phone, markets, tier, ...counterparty },
              contacts,
              facilities,
              commodities,
            }) => ({
              counterparty: {
                ...counterparty,
                ...(phone !== null && { phone }),
                ...(markets.length > 0 && { markets }),
                ...(tier !== null && { tier }),
              },
              contacts,
              facilities,
              ...(commodities.length > 0 && { commodities }),
            }),
          ),
        ),
      );
      // Matched again under the organization's import lock, against the list as it is then,
      // so two files imported at once never create the same company twice and the answer says
      // what was written (Codex's review of ivanmueller/gss#88).
      let result: ImportMatch['result'] | undefined;
      let importBatchId: string | null;
      try {
        importBatchId = await db.importCounterparties(
          ctx,
          organizationId,
          (companies) => {
            const match = matchImport(plan, rows.length, companies);
            result = match.result;
            return importBatchFor(plan, match, {
              organizationId,
              fileName,
              contentSha256,
              rowCount: rows.length,
            });
          },
          // Only what the Check step showed is written: the list may have changed since
          // (Codex's review of ivanmueller/gss#95).
          // Also when nothing is left to write, so a stale Check step is replaced.
          async (batch) => {
            if (result === undefined) throw new Error('the import was not planned');
            const fingerprint = await fingerprintOf(batch, result);
            if (fingerprint !== reviewed) throw new PlanChanged(fingerprint);
          },
        );
      } catch (error) {
        if (!(error instanceof PlanChanged) || result === undefined) throw error;
        return apiError(
          c,
          409,
          'PLAN_CHANGED',
          'The list changed since this file was checked. Look over the changes again, then import.',
          { ...result, fingerprint: error.fingerprint },
        );
      }
      if (result === undefined) throw new Error('the import was not planned');
      if (importBatchId === null) {
        return apiError(
          c,
          409,
          'NOTHING_TO_IMPORT',
          'Every company in this file is already in the list, with nothing new to add.',
          result,
        );
      }
      return c.json({ ...result, fingerprint: reviewed, committed: true, importBatchId }, 201);
    });
  });

  routes.get('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const counterparty = await db.getCounterparty(ctx, id);
      return counterparty
        ? c.json(counterparty)
        : apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    });
  });

  routes.get('/:id/logo', async (c) => {
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No logo.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const logo = await db.getLogo(ctx, id);
      if (!logo) return apiError(c, 404, 'NOT_FOUND', 'No logo.');
      const etag = `"${logo.sha256}"`;
      // Asked for by its checksum (?v=), the logo never changes at that address: a new logo
      // has a new checksum. So the browser keeps it, and switching pages does not fetch it
      // again (owner's request, 2026-10-30). Without it, the browser checks each time.
      c.header(
        'Cache-Control',
        c.req.query('v') === logo.sha256
          ? 'private, max-age=31536000, immutable'
          : 'private, no-cache',
      );
      // Kept per sign-in: a browser never hands one person's kept logo to another login on the
      // same computer, which the server would have refused (Codex's review of ivanmueller/gss#85).
      c.header('Vary', 'Authorization');
      c.header('ETag', etag);
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('Content-Security-Policy', "default-src 'none'; sandbox");
      c.header('Cross-Origin-Resource-Policy', 'same-origin');
      if (c.req.header('if-none-match') === etag) return c.body(null, 304);
      c.header('Content-Type', 'image/png');
      return c.body(logo.data as Uint8Array<ArrayBuffer>, 200);
    });
  });

  routes.put('/:id/logo', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const type = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (type !== 'image/png') {
      return apiError(c, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Logos must be uploaded as image/png.');
    }
    const declared = declaredLength(c.req.header('content-length'));
    if (declared !== null && declared > MAX_LOGO_BYTES) {
      return apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'Logos must be 512 KB or smaller.');
    }
    const data = new Uint8Array(await c.req.arrayBuffer());
    const check = await inspectPng(data);
    if (!check.ok) {
      return check.reason === 'TOO_LARGE'
        ? apiError(c, 413, 'PAYLOAD_TOO_LARGE', 'Logos must be 512 KB or smaller.')
        : apiError(
            c,
            422,
            check.reason,
            check.reason === 'NOT_PNG'
              ? 'The file is not a PNG image.'
              : 'Logos must be between 1 and 4096 pixels wide and high.',
          );
    }
    return withDatabase(c, openDatabase, async (db, ctx) => {
      // Store the rebuilt copy: validated chunks only, no hidden text or trailing data.
      const saved = await db.putLogo(ctx, id, check.png);
      if (saved.status === 'not_found')
        return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
      if (saved.status === 'forbidden') {
        return apiError(c, 403, 'FORBIDDEN', 'Only operations and admin members can change logos.');
      }
      return c.json({
        sha256: saved.sha256,
        width: check.width,
        height: check.height,
        bytes: check.png.byteLength,
      });
    });
  });

  // One counterparty entered by hand, with an optional first contact and location (GT-020).
  routes.post('/', async (c) => {
    c.header('Cache-Control', 'no-store');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createCounterpartySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseNewCounterparty(request.data.values);
    if (parsed.status === 'empty')
      return invalid(c, [{ field: null, message: 'The form is empty.' }]);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    const { counterparty, contact, facility, commodities } = parsed.record;
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const created = await db.createCounterparty(ctx, request.data.organizationId, {
        counterparty,
        contacts: contact ? [contact] : [],
        facilities: facility
          ? [{ ...facility, transportAccess: request.data.transportAccess ?? null }]
          : [],
        commodities,
      });
      if (created.status === 'forbidden') return apiError(c, 403, 'FORBIDDEN', FORBIDDEN_EDIT);
      return c.json({ id: created.id }, 201);
    });
  });

  routes.patch('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateCounterpartySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseCounterpartyFields(request.data.values);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.updateCounterparty(ctx, id, request.data.version, parsed.value);
      return savedDetail(c, db, ctx, id, result, 'counterparty');
    });
  });

  // Archiving hides a counterparty from the list and the map; an admin may then delete it.
  for (const [action, archived] of [
    ['archive', true],
    ['restore', false],
  ] as const) {
    routes.post(`/:id/${action}`, async (c) => {
      c.header('Cache-Control', 'no-store');
      const id = c.req.param('id');
      if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
      return withDatabase(c, openDatabase, async (db, ctx) => {
        const result = await db.setArchived(ctx, id, archived);
        return savedDetail(c, db, ctx, id, result, 'counterparty');
      });
    });
  }

  // Admins delete an archived counterparty with no history (owner's request, 2026-10-31).
  routes.delete('/:id', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.deleteCounterparty(ctx, id);
      switch (result.status) {
        case 'deleted':
          return c.body(null, 204);
        case 'not_found':
          return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
        case 'forbidden':
          return apiError(c, 403, 'FORBIDDEN', 'Only admins can delete counterparties.');
        case 'not_archived':
          return apiError(c, 409, 'NOT_ARCHIVED', 'Archive this counterparty before deleting it.');
        case 'has_history':
          return apiError(
            c,
            409,
            'HAS_HISTORY',
            `It has ${listed(result.history.map((what) => HISTORY_NAMES[what]))}, which are kept for the record, so it cannot be deleted. It stays archived.`,
            { history: result.history },
          );
      }
    });
  });

  routes.post('/:id/contacts', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createContactSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseContactFields(request.data.values);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.addContact(ctx, id, parsed.value);
      return savedDetail(c, db, ctx, id, result, 'counterparty', 201);
    });
  });

  routes.patch('/:id/contacts/:contactId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, contactId } = c.req.param();
    if (!isUuid(id) || !isUuid(contactId)) return apiError(c, 404, 'NOT_FOUND', 'No such contact.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateContactSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    const parsed = parseContactFields(request.data.values);
    if (parsed.status === 'invalid') return invalid(c, parsed.issues);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.updateContact(ctx, id, contactId, request.data.version, parsed.value);
      return savedDetail(c, db, ctx, id, result, 'contact');
    });
  });

  routes.delete('/:id/contacts/:contactId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, contactId } = c.req.param();
    if (!isUuid(id) || !isUuid(contactId)) return apiError(c, 404, 'NOT_FOUND', 'No such contact.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.removeContact(ctx, id, contactId);
      return savedDetail(c, db, ctx, id, result, 'contact');
    });
  });

  // What it buys and sells: anyone on the team may change it (owner's answer, 2026-10-30).
  routes.patch('/:id/commodities', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = commodityChangeSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.changeCommodities(ctx, id, request.data);
      return savedDetail(c, db, ctx, id, result, 'counterparty');
    });
  });

  routes.put('/:id/main-contact', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = mainContactSchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.setMainContact(ctx, id, request.data.contactId);
      return savedDetail(c, db, ctx, id, result, 'contact');
    });
  });

  // A location's country defaults to its counterparty's, so the counterparty is read first.
  routes.post('/:id/facilities', async (c) => {
    c.header('Cache-Control', 'no-store');
    const id = c.req.param('id');
    if (!isUuid(id)) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = createFacilitySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const counterparty = await db.getCounterparty(ctx, id);
      if (!counterparty) return apiError(c, 404, 'NOT_FOUND', 'No such counterparty.');
      const parsed = parseFacilityFields(
        request.data.values,
        normalizeCountry(counterparty.primaryCountry) ?? 'CA',
      );
      if (parsed.status === 'invalid') return invalid(c, parsed.issues);
      const result = await db.addFacility(ctx, id, {
        ...parsed.value,
        transportAccess: request.data.transportAccess ?? null,
      });
      return savedDetail(c, db, ctx, id, result, 'counterparty', 201);
    });
  });

  routes.patch('/:id/facilities/:facilityId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, facilityId } = c.req.param();
    if (!isUuid(id) || !isUuid(facilityId))
      return apiError(c, 404, 'NOT_FOUND', 'No such location.');
    const body = await readJson(c, MAX_FORM_BODY_BYTES);
    if (!body.ok) return body.response;
    const request = updateFacilitySchema.safeParse(body.value);
    if (!request.success) return malformed(c, request.error);
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const counterparty = await db.getCounterparty(ctx, id);
      if (!counterparty) return apiError(c, 404, 'NOT_FOUND', 'No such location.');
      const parsed = parseFacilityFields(
        request.data.values,
        normalizeCountry(counterparty.primaryCountry) ?? 'CA',
      );
      if (parsed.status === 'invalid') return invalid(c, parsed.issues);
      const result = await db.updateFacility(ctx, id, facilityId, request.data.version, {
        ...parsed.value,
        transportAccess: request.data.transportAccess,
      });
      return savedDetail(c, db, ctx, id, result, 'location');
    });
  });

  routes.delete('/:id/facilities/:facilityId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const { id, facilityId } = c.req.param();
    if (!isUuid(id) || !isUuid(facilityId))
      return apiError(c, 404, 'NOT_FOUND', 'No such location.');
    return withDatabase(c, openDatabase, async (db, ctx) => {
      const result = await db.removeFacility(ctx, id, facilityId);
      return savedDetail(c, db, ctx, id, result, 'location');
    });
  });

  return routes;
}
