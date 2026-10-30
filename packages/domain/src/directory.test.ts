import { describe, expect, it } from 'vitest';

import {
  companyNameKey,
  counterpartyKey,
  createCounterpartySchema,
  facilityKey,
  groupImportRows,
  importRequestSchema,
  mainContactSchema,
  parseContactFields,
  parseCounterpartyFields,
  parseDirectoryRecord,
  parseFacilityFields,
  parseImportRow,
  parseNewCounterparty,
  suggestMapping,
  updateCounterpartySchema,
  updateFacilitySchema,
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
        website: 'WWW.Example.com',
        notes: 'Prefers rail.\r\nCall mornings.',
        commodities: 'Canola; flax',
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
        website: 'https://www.example.com',
        phone: null,
        markets: [],
        tier: null,
        notes: 'Prefers rail.\nCall mornings.',
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
      // A buyer and seller: both ways.
      commodities: [
        { commodity: 'canola', direction: 'buys' },
        { commodity: 'flaxseed', direction: 'buys' },
        { commodity: 'canola', direction: 'sells' },
        { commodity: 'flaxseed', direction: 'sells' },
      ],
      notices: [],
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
        website: null,
        phone: null,
        markets: [],
        tier: null,
        notes: null,
      },
      contact: null,
      facility: null,
      commodities: [],
      notices: [],
    });
  });

  it('reads a Commodities column as what a buyer buys or a seller sells', () => {
    const row = (values: Record<string, string>, defaultTypes: ('buyer' | 'seller')[]) =>
      parseImportRow(
        2,
        { legalName: 'Synthetic Mills', country: 'CA', ...values },
        { defaultTypes },
      );
    expect(row({ commodities: 'Yellow Peas, Oats' }, ['buyer'])).toMatchObject({
      status: 'ok',
      row: {
        commodities: [
          { commodity: 'yellow_peas', direction: 'buys' },
          { commodity: 'oats', direction: 'buys' },
        ],
      },
    });
    expect(row({ commodities: 'durum' }, ['seller'])).toMatchObject({
      status: 'ok',
      row: { commodities: [{ commodity: 'durum_wheat', direction: 'sells' }] },
    });
  });

  it('refuses commodity names off the list, and commodities for a carrier', () => {
    expect(
      parseImportRow(5, {
        legalName: 'Synthetic Mills',
        country: 'CA',
        commodities: 'Wheat; Canola; Hemp',
      }),
    ).toEqual({
      status: 'invalid',
      issues: [
        {
          line: 5,
          field: 'commodities',
          message:
            '"Wheat", "Hemp" are not on the list of commodities (for example Spring wheat, Feed barley, Yellow peas)',
        },
      ],
    });
    expect(
      parseImportRow(6, {
        legalName: 'Synthetic Haulers',
        country: 'CA',
        types: 'carrier',
        commodities: 'Canola',
      }),
    ).toEqual({
      status: 'invalid',
      issues: [
        {
          line: 6,
          field: 'commodities',
          message: 'are for buyers, sellers and brokers, not carriers',
        },
      ],
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
  it("keeps every row's commodities for one company, each once", () => {
    const { groups } = groupImportRows([
      ok({ legalName: 'Synthetic Mills', country: 'CA', commodities: 'Canola; Oats' }, 2),
      ok({ legalName: 'Synthetic Mills', country: 'CA', commodities: 'oats, flax' }, 3),
    ]);
    expect(groups[0]?.commodities).toEqual([
      { commodity: 'canola', direction: 'buys' },
      { commodity: 'oats', direction: 'buys' },
      { commodity: 'flaxseed', direction: 'buys' },
    ]);
  });

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
          website: 'mills-two.example.com',
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
      {
        line: 3,
        field: 'website',
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

describe('mainContactSchema', () => {
  it('takes one contact id, or null for none', () => {
    expect(
      mainContactSchema.safeParse({ contactId: '00000000-0000-4000-8000-0000000000aa' }).success,
    ).toBe(true);
    expect(mainContactSchema.safeParse({ contactId: null }).success).toBe(true);
  });

  it('refuses anything else', () => {
    expect(mainContactSchema.safeParse({}).success).toBe(false);
    expect(mainContactSchema.safeParse({ contactId: 'k1' }).success).toBe(false);
    expect(mainContactSchema.safeParse({ contactId: 42 }).success).toBe(false);
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

describe('buyers and sellers in an import', () => {
  it('uses the chosen types for rows without one, and a row’s own type otherwise', () => {
    const seller = parseImportRow(
      2,
      { legalName: 'Synthetic Grower', country: 'CA' },
      { defaultTypes: ['seller'] },
    );
    expect(seller).toMatchObject({ status: 'ok', row: { counterparty: { types: ['seller'] } } });
    const own = parseImportRow(
      3,
      { legalName: 'Synthetic Mill', country: 'CA', types: 'buyer' },
      { defaultTypes: ['seller'] },
    );
    expect(own).toMatchObject({ status: 'ok', row: { counterparty: { types: ['buyer'] } } });
  });

  it('accepts the chosen types in the request, and only known types', () => {
    const valid = {
      organizationId: '00000000-0000-4000-8000-0000000000aa',
      fileName: 'sellers.csv',
      commit: false,
      rows: [{ line: 2, values: { legalName: 'Synthetic Grower', country: 'CA' } }],
    };
    expect(importRequestSchema.safeParse({ ...valid, defaultTypes: ['seller'] }).success).toBe(
      true,
    );
    expect(importRequestSchema.safeParse({ ...valid, defaultTypes: ['grower'] }).success).toBe(
      false,
    );
    expect(importRequestSchema.safeParse({ ...valid, defaultTypes: [] }).success).toBe(false);
  });

  it('matches seller-side column names to the legal name', () => {
    expect(suggestMapping(['Seller Name', 'Prov']).legalName).toBe('Seller Name');
    expect(suggestMapping(['Grower', 'Country']).legalName).toBe('Grower');
    expect(suggestMapping(['Farm Name']).legalName).toBe('Farm Name');
  });
});

describe('websites', () => {
  it('are tidied in a row and a form, and reported by field when they are not web addresses', () => {
    expect(
      ok({ legalName: 'Synthetic Mill', country: 'CA', website: 'example.com/grain' }),
    ).toMatchObject({ counterparty: { website: 'https://example.com/grain' } });
    expect(
      issues({ legalName: 'Synthetic Mill', country: 'CA', website: 'javascript:alert(1)' }),
    ).toEqual(['website: must be a web address such as example.com']);
    expect(
      parseCounterpartyFields({
        legalName: 'Synthetic Mill',
        country: 'CA',
        types: 'buyer',
        website: 'http://localhost',
      }),
    ).toEqual({
      status: 'invalid',
      issues: [{ field: 'website', message: 'needs a public site name such as example.com' }],
    });
  });

  it('are matched from website and homepage columns', () => {
    expect(suggestMapping(['Company', 'Country', 'Home Page'])).toMatchObject({
      website: 'Home Page',
    });
    expect(suggestMapping(['Company', 'Country', 'Web site'])).toMatchObject({
      website: 'Web site',
    });
  });
});

describe('company phones', () => {
  it('are read from a row and a form apart from the contact’s phone, and checked the same way', () => {
    expect(
      ok({
        legalName: 'Synthetic Mill',
        country: 'CA',
        companyPhone: '306-555-0100 extension 2',
        contactName: 'Synthetic Merchandiser',
        // "extension" was once read as "ext" and left "ension": a bug fix for contacts too.
        contactPhone: '306 555 0199 extension 3',
      }),
    ).toMatchObject({
      counterparty: { phone: '306-555-0100 x2' },
      contact: { phone: '306 555 0199 x3' },
    });
    expect(
      parseCounterpartyFields({
        legalName: 'Synthetic Mill',
        country: 'CA',
        types: 'buyer',
        companyPhone: 'reception',
      }),
    ).toEqual({
      status: 'invalid',
      issues: [{ field: 'companyPhone', message: '"reception" is not a phone number' }],
    });
  });

  it('are matched from company phone columns, while a plain Phone column stays the contact’s', () => {
    expect(suggestMapping(['Company', 'Country', 'Phone', 'Main phone'])).toMatchObject({
      contactPhone: 'Phone',
      companyPhone: 'Main phone',
    });
    expect(suggestMapping(['Company', 'Company phone'])).toMatchObject({
      companyPhone: 'Company phone',
    });
  });

  it('warn when a later row of the same company disagrees', () => {
    const { warnings } = groupImportRows([
      ok({ legalName: 'Synthetic Mill', country: 'CA', companyPhone: '306 555 0100' }, 2),
      ok({ legalName: 'Synthetic Mill', country: 'CA', companyPhone: '306 555 0101' }, 3),
    ]);
    expect(warnings).toEqual([
      {
        line: 3,
        field: 'companyPhone',
        message: "differs from line 2 for the same company; line 2's value is used",
      },
    ]);
  });
});

describe('companies with several locations', () => {
  it('matches a company name without case, punctuation, spacing or the way its ending is written', () => {
    const same = [
      'Prairie Feeds Ltd.',
      'PRAIRIE FEEDS LIMITED',
      'Prairie  Feeds, Ltd',
      'Prairie-Feeds Ltd',
    ].map(companyNameKey);
    expect(new Set(same).size).toBe(1);
    expect(companyNameKey('Smith & Sons Inc.')).toBe(companyNameKey('Smith and Sons Incorporated'));
    expect(companyNameKey('Coop Grain Corp')).toBe(companyNameKey('Coop Grain Corporation'));
    // Different companies stay different.
    expect(companyNameKey('Prairie Feeds Ltd')).not.toBe(companyNameKey('Prairie Seeds Ltd'));
    // The same name in another country is another company.
    expect(counterpartyKey('CA', 'Prairie Feeds Ltd')).not.toBe(
      counterpartyKey('US', 'Prairie Feeds Ltd'),
    );
  });

  it('makes one company of rows spelled differently, each location once, and says so', () => {
    const { groups, warnings } = groupImportRows([
      ok({ legalName: 'Prairie Feeds Ltd.', country: 'CA', city: 'Lethbridge', region: 'AB' }, 2),
      ok({ legalName: 'PRAIRIE FEEDS LIMITED', country: 'CA', city: 'Brandon', region: 'MB' }, 3),
      ok({ legalName: 'Prairie Feeds Ltd.', country: 'CA', city: 'lethbridge ', region: 'AB' }, 4),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.counterparty.legalName).toBe('Prairie Feeds Ltd.');
    expect(groups[0]?.facilities.map((facility) => facility.city)).toEqual([
      'Lethbridge',
      'Brandon',
    ]);
    expect(warnings).toEqual([
      {
        line: 3,
        field: 'legalName',
        message: "differs from line 2 for the same company; line 2's value is used",
      },
    ]);
  });

  it('reads a City or Town column', () => {
    expect(suggestMapping(['Legal Name', 'Country', 'City or Town'])).toMatchObject({
      city: 'City or Town',
    });
  });

  it('keeps the first of two company phone numbers from a spreadsheet and puts the rest in the notes', () => {
    const row = ok({
      legalName: 'Synthetic Feeds',
      country: 'US',
      companyPhone: '555-010-0100; 555-010-0101',
      notes: 'Synthetic record.',
    });
    expect(row.counterparty).toMatchObject({
      phone: '555-010-0100',
      notes: 'Synthetic record.\nCompany phone also: 555-010-0101',
    });
    expect(row.notices).toEqual([
      {
        line: 2,
        field: 'companyPhone',
        message:
          'holds more than one number or a note: "555-010-0100" is the company phone, and "555-010-0101" is added to the notes',
      },
    ]);
    expect(
      ok({ legalName: 'Synthetic Feeds', country: 'US', companyPhone: '555-010-0100 (front desk)' })
        .counterparty,
    ).toMatchObject({ phone: '555-010-0100', notes: 'Company phone also: (front desk)' });
    // The notice reaches the check step as a warning.
    expect(groupImportRows([row]).warnings).toEqual(row.notices);
    // A form someone is filling in still refuses two numbers.
    expect(
      parseCounterpartyFields({
        legalName: 'Synthetic Feeds',
        country: 'US',
        types: 'buyer',
        companyPhone: '555-010-0100; 555-010-0101',
      }).status,
    ).toBe('invalid');
  });

  // Codex's review of ivanmueller/gss#88.
  it('keeps names in other scripts apart, while accents still do not count', () => {
    expect(companyNameKey('北京 Grain')).not.toBe(companyNameKey('上海 Grain'));
    expect(companyNameKey('Ελληνικά Grain')).not.toBe(companyNameKey('Grain'));
    expect(companyNameKey('Céréales Prairie Ltée')).toBe(companyNameKey('CEREALES PRAIRIE LTEE'));
    const { groups } = groupImportRows([
      ok({ legalName: '北京 Grain', country: 'US' }, 2),
      ok({ legalName: '上海 Grain', country: 'US' }, 3),
    ]);
    expect(groups.map((group) => group.counterparty.legalName)).toEqual([
      '北京 Grain',
      '上海 Grain',
    ]);
  });

  it('keeps locations given only by coordinates apart', () => {
    const { groups } = groupImportRows([
      ok({ legalName: 'Synthetic Feeds', country: 'CA', latitude: '52', longitude: '-106' }, 2),
      ok({ legalName: 'Synthetic Feeds', country: 'CA', latitude: '53', longitude: '-107' }, 3),
      ok({ legalName: 'Synthetic Feeds', country: 'CA', latitude: '52.0', longitude: '-106' }, 4),
    ]);
    expect(groups[0]?.facilities.map((f) => [f.latitude, f.longitude])).toEqual([
      ['52.000000', '-106.000000'],
      ['53.000000', '-107.000000'],
    ]);
    // A location with a name or address is the same place whether or not it has coordinates.
    const place = {
      name: null,
      addressLine: null,
      city: 'Alpha',
      region: 'SK',
      postalCode: null,
      country: 'CA' as const,
    };
    expect(facilityKey({ ...place, latitude: '50.45', longitude: '-104.6' })).toBe(
      facilityKey({ ...place, latitude: null, longitude: null }),
    );
  });

  it('refuses a row whose notes would be too long once the second phone number is added', () => {
    expect(
      issues({
        legalName: 'Synthetic Feeds',
        country: 'US',
        companyPhone: '555-010-0100; 555-010-0101',
        notes: 'x'.repeat(1990),
      }),
    ).toEqual([
      "notes: with the company phone's other numbers added, is longer than 2000 characters",
    ]);
  });

  it('splits two company phone numbers written with a slash, but not an area code', () => {
    const row = ok({
      legalName: 'Synthetic Feeds',
      country: 'US',
      companyPhone: '555-010-0100 / 555-010-0101',
    });
    expect(row.counterparty).toMatchObject({
      phone: '555-010-0100',
      notes: 'Company phone also: 555-010-0101',
    });
    expect(row.notices).toHaveLength(1);
    expect(
      ok({ legalName: 'Synthetic Feeds', country: 'US', companyPhone: '555/010-0100' })
        .counterparty,
    ).toMatchObject({ phone: '555/010-0100', notes: null });
    // Nor with a note or a second number after it (Codex's second review of ivanmueller/gss#88).
    expect(
      ok({ legalName: 'Synthetic Feeds', country: 'US', companyPhone: '555/010-0100 (front desk)' })
        .counterparty,
    ).toMatchObject({ phone: '555/010-0100', notes: 'Company phone also: (front desk)' });
    expect(
      ok({
        legalName: 'Synthetic Feeds',
        country: 'US',
        companyPhone: '555/010-0100; 555-010-0101',
      }).counterparty,
    ).toMatchObject({ phone: '555/010-0100', notes: 'Company phone also: 555-010-0101' });
  });
});

describe('markets and tier', () => {
  it('are read from Market and Tier columns, each market once in a fixed order', () => {
    expect(
      ok({
        legalName: 'Synthetic Feeds',
        country: 'CA',
        markets: 'Birds; small animals, PET / Aquatic and horse; Pet; Specialties',
        tier: 'tier b',
      }).counterparty,
    ).toMatchObject({
      markets: ['pet', 'bird', 'equine', 'specialty', 'small_animal', 'aqua'],
      tier: 'B',
    });
    expect(suggestMapping(['Company', 'Country', 'Type', 'Market', 'Tier'])).toMatchObject({
      types: 'Type',
      markets: 'Market',
      tier: 'Tier',
    });
  });

  it('refuses names off the list and tiers other than A, B or C', () => {
    expect(
      issues({ legalName: 'Synthetic Feeds', country: 'CA', markets: 'Pet; Cattle', tier: 'D' }),
    ).toEqual([
      'markets: "Cattle" must be Pet, Bird, Equine, Specialty, Small Animal, Exotic, Wildlife, Aqua',
      'tier: "D" must be A, B or C',
    ]);
  });

  it('are part of the company’s details, so edited under Edit details', () => {
    expect(
      parseCounterpartyFields({
        legalName: 'Synthetic Feeds',
        country: 'CA',
        types: 'buyer',
        markets: 'wildlife,exotic',
        tier: 'c',
      }),
    ).toMatchObject({ status: 'ok', value: { markets: ['exotic', 'wildlife'], tier: 'C' } });
  });
});

describe('a Grains column', () => {
  it('fills what a buyer buys, like a Commodities column', () => {
    const mapping = suggestMapping(['Company', 'Country', 'Grains']);
    expect(mapping).toMatchObject({ commodities: 'Grains' });
    expect(suggestMapping(['Company', 'Country', 'Grain'])).toMatchObject({ commodities: 'Grain' });
    expect(
      ok({ legalName: 'Synthetic Feeds', country: 'CA', commodities: 'Oats, canola' }).commodities,
    ).toEqual([
      { commodity: 'canola', direction: 'buys' },
      { commodity: 'oats', direction: 'buys' },
    ]);
  });
});

describe('rail and truck access', () => {
  it('is sent beside a location’s form values, never as a spreadsheet field', () => {
    expect(
      createCounterpartySchema.safeParse({
        organizationId: '00000000-0000-4000-8000-0000000000aa',
        values: { legalName: 'Synthetic Mill' },
        transportAccess: 'rail_and_truck',
      }).success,
    ).toBe(true);
    expect(
      updateFacilitySchema.safeParse({
        version: '2026-10-30T14:05:09.123456Z',
        values: { city: 'Synthetic Spur' },
        transportAccess: null,
      }).success,
    ).toBe(true);
    expect(
      updateFacilitySchema.safeParse({
        version: '2026-10-30T14:05:09.123456Z',
        values: { city: 'Synthetic Spur' },
        transportAccess: 'barge',
      }).success,
    ).toBe(false);
    expect(
      importRequestSchema.safeParse({
        organizationId: '00000000-0000-4000-8000-0000000000aa',
        fileName: 'synthetic.csv',
        commit: false,
        rows: [{ line: 2, values: { legalName: 'Synthetic Mill', transportAccess: 'rail' } }],
      }).success,
    ).toBe(false);
  });
});

describe('notes', () => {
  it('keep their line breaks, with at most one blank line between paragraphs', () => {
    expect(
      parseCounterpartyFields({
        legalName: 'A',
        country: 'CA',
        types: 'buyer',
        notes: '  First line  \r\n\r\n\r\nSecond   line\n',
      }),
    ).toMatchObject({ status: 'ok', value: { notes: 'First line\n\nSecond line' } });
  });
});

describe('the add form (parseDirectoryRecord)', () => {
  it('needs a type when none is chosen', () => {
    expect(parseDirectoryRecord({ legalName: 'Synthetic Grower', country: 'CA' })).toEqual({
      status: 'invalid',
      issues: [
        { field: 'types', message: 'choose at least one: buyer, seller, broker or carrier' },
      ],
    });
  });

  it('returns the counterparty with its first contact and location', () => {
    expect(
      parseDirectoryRecord({
        legalName: 'Synthetic Grower',
        country: 'CA',
        types: 'seller',
        contactName: 'Synthetic Farmer',
        city: 'Synthetic Town',
        region: 'SK',
      }),
    ).toMatchObject({
      status: 'ok',
      record: {
        counterparty: { legalName: 'Synthetic Grower', types: ['seller'], primaryCountry: 'CA' },
        contact: { name: 'Synthetic Farmer' },
        facility: { city: 'Synthetic Town', region: 'SK', country: 'CA' },
      },
    });
  });
});

describe('edit forms', () => {
  it('check a counterparty’s details, including its types', () => {
    expect(
      parseCounterpartyFields({
        legalName: ' Synthetic  Mill ',
        country: 'USA',
        types: 'seller,buyer',
      }),
    ).toEqual({
      status: 'ok',
      value: {
        legalName: 'Synthetic Mill',
        tradingName: null,
        types: ['seller', 'buyer'],
        primaryCountry: 'US',
        verificationStatus: 'unverified',
        website: null,
        phone: null,
        markets: [],
        tier: null,
        notes: null,
      },
    });
    expect(parseCounterpartyFields({ legalName: '', country: 'CA', types: '' })).toEqual({
      status: 'invalid',
      issues: [
        { field: 'legalName', message: 'is required' },
        { field: 'types', message: 'choose at least one: buyer, seller, broker or carrier' },
      ],
    });
  });

  it('need a contact’s name and check its email', () => {
    expect(parseContactFields({})).toEqual({
      status: 'invalid',
      issues: [{ field: 'contactName', message: 'is required' }],
    });
    expect(parseContactFields({ contactName: 'A', contactEmail: 'nope' })).toEqual({
      status: 'invalid',
      issues: [{ field: 'contactEmail', message: '"nope" is not an email address' }],
    });
    expect(parseContactFields({ contactName: ' Synthetic  Contact ' })).toEqual({
      status: 'ok',
      value: { name: 'Synthetic Contact', role: null, email: null, phone: null },
    });
  });

  it('need a location to say where it is, in the counterparty’s country unless given', () => {
    expect(parseFacilityFields({ facilityType: 'elevator' }, 'CA')).toEqual({
      status: 'invalid',
      issues: [
        {
          field: null,
          message:
            'Give the location at least a name, an address, a city, a province or state, or coordinates.',
        },
      ],
    });
    expect(parseFacilityFields({ city: 'Synthetic Town', region: 'MB' }, 'CA')).toMatchObject({
      status: 'ok',
      value: { city: 'Synthetic Town', region: 'MB', country: 'CA', latitude: null },
    });
    expect(parseFacilityFields({ region: 'Manitoba', facilityCountry: 'US' }, 'CA')).toEqual({
      status: 'invalid',
      issues: [{ field: 'region', message: '"Manitoba" is not a province or state of US' }],
    });
  });

  it('accept only their own fields and a version', () => {
    const v = '2026-10-28T14:05:09.123456Z';
    expect(
      updateCounterpartySchema.safeParse({ version: v, values: { legalName: 'A' } }).success,
    ).toBe(true);
    expect(
      updateCounterpartySchema.safeParse({ version: v, values: { contactName: 'A' } }).success,
    ).toBe(false);
    expect(updateCounterpartySchema.safeParse({ values: { legalName: 'A' } }).success).toBe(false);
    expect(
      updateCounterpartySchema.safeParse({ version: '2026-10-28', values: { legalName: 'A' } })
        .success,
    ).toBe(false);
    expect(updateFacilitySchema.safeParse({ version: v, values: { legalName: 'A' } }).success).toBe(
      false,
    );
    expect(
      createCounterpartySchema.safeParse({
        organizationId: '00000000-0000-4000-8000-0000000000aa',
        values: { legalName: 'A', city: 'B' },
      }).success,
    ).toBe(true);
  });
});

describe('the add form (parseNewCounterparty)', () => {
  const company = { legalName: 'Synthetic Grower', country: 'CA', types: 'seller' };

  it('ignores a location that has only the country filled in for the user', () => {
    expect(parseNewCounterparty({ ...company, facilityCountry: 'CA' })).toMatchObject({
      status: 'ok',
      record: { facility: null },
    });
  });

  it('needs a location with anything more to say where it is', () => {
    expect(
      parseNewCounterparty({ ...company, facilityCountry: 'CA', facilityType: 'farm' }),
    ).toEqual({
      status: 'invalid',
      issues: [
        {
          field: null,
          message:
            'Give the location at least a name, an address, a city, a province or state, or coordinates.',
        },
      ],
    });
    expect(
      parseNewCounterparty({ ...company, facilityCountry: 'US', city: 'Synthetic Falls' }),
    ).toMatchObject({
      status: 'ok',
      record: { facility: { country: 'US', city: 'Synthetic Falls' } },
    });
  });
});
