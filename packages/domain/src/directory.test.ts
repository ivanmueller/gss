import { describe, expect, it } from 'vitest';

import {
  groupImportRows,
  importRequestSchema,
  parseImportRow,
  suggestMapping,
  type ImportRowValues,
  type ParsedImportRow,
} from './directory';
import { normalizeCountry, normalizeRegion } from './regions';

// Synthetic, fictional companies only.
function ok(values: ImportRowValues, line = 2): ParsedImportRow {
  const result = parseImportRow(line, values);
  if (result.status !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.row;
}

function issues(values: ImportRowValues) {
  const result = parseImportRow(2, values);
  if (result.status !== 'invalid')
    throw new Error(`expected invalid, got ${JSON.stringify(result)}`);
  return result.issues.map((issue) => `${issue.field ?? '-'}: ${issue.message}`);
}

describe('normalizeCountry and normalizeRegion', () => {
  it('accepts codes and names for Canada and the United States', () => {
    expect(['Canada', 'CAN', ' ca ', 'USA', 'U.S.', 'united states'].map(normalizeCountry)).toEqual(
      ['CA', 'CA', 'CA', 'US', 'US', 'US'],
    );
    expect(normalizeCountry('Mexico')).toBeNull();
  });

  it('accepts province and state codes and names for the right country only', () => {
    expect(normalizeRegion('CA', 'Saskatchewan')).toBe('SK');
    expect(normalizeRegion('CA', 'sk')).toBe('SK');
    expect(normalizeRegion('US', 'North  Dakota')).toBe('ND');
    expect(normalizeRegion('US', 'N.D.')).toBe('ND');
    expect(normalizeRegion('US', 'Saskatchewan')).toBeNull();
    expect(normalizeRegion('CA', 'MN')).toBeNull();
  });
});

describe('parseImportRow', () => {
  it('normalizes a full row', () => {
    expect(
      ok({
        legalName: '  Synthetic   Prairie Mills Inc. ',
        tradingName: 'Prairie Mills',
        country: 'Canada',
        types: 'Buyer; seller',
        verificationStatus: 'Verified',
        notes: 'Prefers rail.\r\nCall mornings.',
        contactName: 'Synthetic Merchandiser',
        contactRole: 'Grain buyer',
        contactEmail: 'merch@example.test',
        contactPhone: '+1 (306) 555-0100 ext. 12',
        facilityName: 'Synthetic Elevator',
        facilityType: 'Grain elevator',
        addressLine: '1 Synthetic Road',
        city: 'Synthetic Town',
        region: 'Saskatchewan',
        postalCode: 's4p3y2',
        latitude: '52.1332144',
        longitude: '-106.6700458',
        locationPrecision: 'Exact',
      }),
    ).toEqual({
      line: 2,
      counterparty: {
        legalName: 'Synthetic Prairie Mills Inc.',
        tradingName: 'Prairie Mills',
        types: ['buyer', 'seller'],
        primaryCountry: 'CA',
        verificationStatus: 'verified',
        notes: 'Prefers rail. Call mornings.',
      },
      contact: {
        name: 'Synthetic Merchandiser',
        role: 'Grain buyer',
        email: 'merch@example.test',
        phone: '+1 (306) 555-0100 x12',
      },
      facility: {
        name: 'Synthetic Elevator',
        facilityType: 'elevator',
        addressLine: '1 Synthetic Road',
        city: 'Synthetic Town',
        region: 'SK',
        postalCode: 'S4P 3Y2',
        country: 'CA',
        latitude: '52.133214',
        longitude: '-106.670046',
        locationPrecision: 'exact',
      },
    });
  });

  it('defaults to an unverified buyer with no contact or location', () => {
    expect(ok({ legalName: 'Synthetic Buyer LLC', country: 'US' })).toEqual({
      line: 2,
      counterparty: {
        legalName: 'Synthetic Buyer LLC',
        tradingName: null,
        types: ['buyer'],
        primaryCountry: 'US',
        verificationStatus: 'unverified',
        notes: null,
      },
      contact: null,
      facility: null,
    });
  });

  it('marks coordinates approximate unless the row says exact', () => {
    const row = ok({
      legalName: 'Synthetic Buyer LLC',
      country: 'US',
      latitude: '47',
      longitude: '-97',
    });
    expect(row.facility).toMatchObject({
      latitude: '47.000000',
      longitude: '-97.000000',
      locationPrecision: 'approximate',
      country: 'US',
    });
  });

  it('puts a location in its own country when the row gives one', () => {
    const row = ok({
      legalName: 'Synthetic Buyer LLC',
      country: 'US',
      facilityCountry: 'Canada',
      region: 'MB',
    });
    expect(row.facility).toMatchObject({ country: 'CA', region: 'MB' });
  });

  it('skips a row with nothing in it', () => {
    expect(parseImportRow(7, { legalName: '  ', city: '' })).toEqual({ status: 'empty' });
  });

  it('reports every problem in a row, by field', () => {
    expect(
      issues({
        country: 'Mexico',
        types: 'buyer, grower',
        verificationStatus: 'yes',
        contactEmail: 'not-an-email',
        contactPhone: 'call me',
        facilityType: 'silo',
        latitude: '95',
        locationPrecision: 'exact',
      }),
    ).toEqual([
      'legalName: is required',
      'country: "Mexico" is not Canada or the United States',
      'types: "buyer, grower" must be buyer, seller, broker or carrier',
      'verificationStatus: "yes" must be unverified, pending or verified',
      'contactName: is required when other contact details are given',
      'contactEmail: "not-an-email" is not an email address',
      'contactPhone: "call me" is not a phone number',
      'facilityType: "silo" is not a known location type (Elevator, Terminal, Processor, Feed mill, Port, Farm, Warehouse, Office, Other)',
      'latitude: "95" is not a latitude between -90 and 90',
      'longitude: latitude and longitude must be given together',
    ]);
  });

  it('checks postal and ZIP codes for the location country', () => {
    expect(issues({ legalName: 'A', country: 'US', postalCode: '2134' })).toEqual([
      'postalCode: "2134" is not a 5-digit ZIP code (spreadsheets sometimes drop a leading zero)',
    ]);
    expect(issues({ legalName: 'A', country: 'CA', postalCode: '12345' })).toEqual([
      'postalCode: "12345" is not a postal code like S4P 3Y2',
    ]);
    expect(
      ok({ legalName: 'A', country: 'US', postalCode: '58102-1234' }).facility?.postalCode,
    ).toBe('58102-1234');
  });

  it('checks a region belongs to the location country', () => {
    expect(issues({ legalName: 'A', country: 'US', region: 'Alberta' })).toEqual([
      'region: "Alberta" is not a province or state of US',
    ]);
  });

  it('refuses precision without coordinates and names that are too long', () => {
    expect(issues({ legalName: 'A', country: 'US', locationPrecision: 'exact' })).toEqual([
      'locationPrecision: needs a latitude and longitude',
    ]);
    expect(
      issues({ legalName: 'x'.repeat(201), country: 'US', tradingName: 'y'.repeat(201) }),
    ).toEqual([
      'legalName: is longer than 200 characters',
      'tradingName: is longer than 200 characters',
    ]);
  });
});

describe('groupImportRows', () => {
  it('merges rows for the same company, keeping each contact and location once', () => {
    const rows = [
      ok(
        {
          legalName: 'Synthetic Mills',
          country: 'CA',
          contactName: 'Ana',
          contactEmail: 'ana@example.test',
          city: 'Alpha',
          region: 'SK',
        },
        2,
      ),
      ok(
        {
          legalName: 'SYNTHETIC MILLS',
          country: 'Canada',
          contactName: 'Ana B',
          contactEmail: 'ANA@example.test',
          city: 'Beta',
          region: 'MB',
        },
        3,
      ),
      ok(
        {
          legalName: 'Synthetic Mills',
          country: 'CA',
          contactName: 'Ben',
          city: 'Alpha',
          region: 'SK',
        },
        4,
      ),
      ok({ legalName: 'Synthetic Mills', country: 'US', city: 'Gamma', region: 'ND' }, 5),
    ];
    const { groups, warnings } = groupImportRows(rows);
    expect(warnings).toEqual([]);
    expect(
      groups.map((group) => [
        group.key,
        group.lines,
        group.contacts.map((c) => c.name),
        group.facilities.map((f) => f.city),
      ]),
    ).toEqual([
      ['CA:synthetic mills', [2, 3, 4], ['Ana', 'Ben'], ['Alpha', 'Beta']],
      ['US:synthetic mills', [5], [], ['Gamma']],
    ]);
    expect(groups[0]?.counterparty.legalName).toBe('Synthetic Mills');
  });

  it('warns when a later row disagrees about the company', () => {
    const rows = [
      ok({ legalName: 'Synthetic Mills', country: 'CA', tradingName: 'Mills One' }, 2),
      ok(
        {
          legalName: 'Synthetic Mills',
          country: 'CA',
          tradingName: 'Mills Two',
          verificationStatus: 'verified',
        },
        3,
      ),
      ok({ legalName: 'Synthetic Mills', country: 'CA' }, 4),
    ];
    expect(groupImportRows(rows).warnings).toEqual([
      {
        line: 3,
        field: 'tradingName',
        message: "differs from line 2 for the same company; line 2's value is used",
      },
      {
        line: 3,
        field: 'verificationStatus',
        message: "differs from line 2 for the same company; line 2's value is used",
      },
    ]);
  });
});

describe('suggestMapping', () => {
  it('matches common header names once each', () => {
    expect(
      suggestMapping([
        'Company Name',
        'DBA',
        'Country',
        'Contact',
        'E-mail',
        'Phone',
        'Address',
        'City',
        'Prov',
        'ZIP',
        'Lat',
        'Long',
        'Mystery',
      ]),
    ).toEqual({
      legalName: 'Company Name',
      tradingName: 'DBA',
      country: 'Country',
      contactName: 'Contact',
      contactEmail: 'E-mail',
      contactPhone: 'Phone',
      addressLine: 'Address',
      city: 'City',
      region: 'Prov',
      postalCode: 'ZIP',
      latitude: 'Lat',
      longitude: 'Long',
    });
  });

  it('matches field labels too', () => {
    expect(suggestMapping(['legal_name', 'Province or state'])).toEqual({
      legalName: 'legal_name',
      region: 'Province or state',
    });
  });
});

describe('importRequestSchema', () => {
  const valid = {
    organizationId: '00000000-0000-4000-8000-0000000000aa',
    fileName: 'buyers.csv',
    commit: false,
    rows: [{ line: 2, values: { legalName: 'Synthetic Mills', country: 'CA' } }],
  };

  it('accepts a mapped import', () => {
    expect(importRequestSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects unknown fields, empty imports and control characters in file names', () => {
    expect(
      importRequestSchema.safeParse({ ...valid, rows: [{ line: 2, values: { password: 'x' } }] })
        .success,
    ).toBe(false);
    expect(importRequestSchema.safeParse({ ...valid, rows: [] }).success).toBe(false);
    expect(importRequestSchema.safeParse({ ...valid, fileName: 'a\u0000.csv' }).success).toBe(
      false,
    );
    expect(importRequestSchema.safeParse({ ...valid, organizationId: 'org-a' }).success).toBe(
      false,
    );
  });

  it('rejects more rows than the limit', () => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({
      line: index + 2,
      values: { legalName: 'A', country: 'CA' },
    }));
    expect(importRequestSchema.safeParse({ ...valid, rows }).success).toBe(false);
  });
});

describe('long values', () => {
  it('reports a value over 2000 characters instead of accepting a cut version', () => {
    const result = parseImportRow(4, { legalName: 'A', country: 'US', notes: 'n'.repeat(2001) });
    expect(result).toEqual({
      status: 'invalid',
      issues: [{ line: 4, field: 'notes', message: 'is longer than 2000 characters' }],
    });
  });
});
