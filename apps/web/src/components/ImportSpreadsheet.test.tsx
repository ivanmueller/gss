import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImportResult } from '../lib/api';
import { choose } from '../test/select';
import { mockApi, ORG, SESSION } from '../test/api';
import { ImportSpreadsheet } from './ImportSpreadsheet';

// Synthetic, fictional companies only.
const CSV = [
  'Company Name,Country,Contact,E-mail,City,Prov',
  'Synthetic Mills,Canada,Ana,ana@example.test,Alpha,SK',
  'Synthetic Mills,Canada,,,Beta,Manitoba',
  'Synthetic Buyer LLC,USA,,,Gamma,ND',
  '',
].join('\n');

function result(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    committed: false,
    importBatchId: null,
    fingerprint: 'f'.repeat(64),
    summary: {
      rows: 3,
      emptyRows: 0,
      invalidRows: 0,
      counterparties: 2,
      newCounterparties: 2,
      existingCounterparties: 0,
      contacts: 1,
      facilities: 3,
      existingWithAdditions: 0,
      addedContacts: 0,
      addedFacilities: 0,
      addedCommodities: 0,
      existingUpdated: 0,
    },
    counterparties: [
      {
        legalName: 'Synthetic Mills',
        country: 'CA',
        lines: [2, 3],
        contacts: 1,
        facilities: 2,
        status: 'new',
        changes: [],
      },
      {
        legalName: 'Synthetic Buyer LLC',
        country: 'US',
        lines: [4],
        contacts: 0,
        facilities: 1,
        status: 'new',
        changes: [],
      },
    ],
    issues: [],
    warnings: [],
    ...overrides,
  };
}

async function chooseFile(text: string, name = 'buyers.csv') {
  await userEvent.upload(
    screen.getByLabelText('Choose CSV file'),
    new File([text], name, { type: 'text/csv' }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function importer() {
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(<ImportSpreadsheet session={SESSION} onImported={onImported} onClose={onClose} />);
  return { onImported, onClose };
}

const BATCH = '00000000-0000-4000-8000-00000000ba7c';

/** A Geocodio result for one of the import's locations, as the API signs it. */
function proposal(n: number, city: string, match: Record<string, unknown> | null) {
  return {
    facilityId: `00000000-0000-4000-8000-00000000fac${String(n)}`,
    counterpartyId: '00000000-0000-4000-8000-00000000c001',
    legalName: 'Synthetic Mills',
    facilityName: null,
    address: { addressLine: null, city, region: 'SK', postalCode: null, country: 'CA' },
    match: match && {
      latitude: '52.133214',
      longitude: '-106.670046',
      precision: 'approximate',
      accuracyType: 'place',
      confidence: '0.97',
      formattedAddress: `${city}, SK`,
      regionMatches: true,
      facilityVersion: '2026-10-30T18:00:00.000000Z',
      expiresAt: '2026-10-30T19:00:00.000Z',
      signature: String(n).repeat(64),
      ...match,
    },
    miss: match ? null : 'NOT_FOUND',
  };
}

describe('ImportSpreadsheet', () => {
  it('imports a file of sellers and lists the columns that are not used', async () => {
    const calls = mockApi({ 'POST /counterparties/import': () => Response.json(result()) });
    importer();
    await chooseFile(
      ['Grower,Country,Bushels,Notes', 'Synthetic Grower,Canada,5000,Synthetic', ''].join('\n'),
    );

    expect(await screen.findByLabelText('Legal name (required)')).toHaveTextContent('Grower');
    expect(screen.getByRole('list', { name: 'Columns not used' })).toHaveTextContent('Bushels');
    expect(screen.getByText(/1 column in your file is not used/)).toBeInTheDocument();

    const side = screen.getByRole('group', { name: 'The companies in this file are' });
    await userEvent.click(within(side).getByRole('button', { name: 'Sellers' }));
    // Choosing the column for a field takes it off the unused list.
    await choose(screen.getByLabelText('Counterparty type'), 'Bushels');
    expect(screen.getByText('Every column in your file is used.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Rows with an empty type are' })).toBeInTheDocument();
    await choose(screen.getByLabelText('Counterparty type'), '— not in my file —');

    await userEvent.click(screen.getByRole('button', { name: 'Review import' }));
    const review = calls.find((call) => call.method === 'POST');
    expect(review?.body).toMatchObject({ defaultTypes: ['seller'] });
  });

  it('matches columns, reviews with the server and imports', async () => {
    const calls = mockApi({
      'POST /counterparties/import': (call) => {
        const { commit } = call.body as { commit: boolean };
        return commit
          ? Response.json(result({ committed: true, importBatchId: BATCH }), { status: 201 })
          : Response.json(result());
      },
      'POST /facilities/geocode': () =>
        Response.json({
          truncated: false,
          proposals: [
            proposal(1, 'Alpha', {}),
            proposal(2, 'Beta', { regionMatches: false, formattedAddress: 'Beta, MB' }),
            proposal(3, 'Gamma', null),
          ],
        }),
      'POST /facilities/coordinates': (call) =>
        Response.json({
          saved: (call.body as { matches: unknown[] }).matches.length,
          skipped: 0,
        }),
    });
    const { onImported, onClose } = importer();
    await chooseFile(CSV);

    expect(await screen.findByText(/3 rows, 6 columns/)).toBeInTheDocument();
    expect(screen.getByLabelText('Legal name (required)')).toHaveTextContent('Company Name');
    expect(screen.getByLabelText('Province or state')).toHaveTextContent('Prov');
    expect(screen.getByLabelText('Contact email')).toHaveTextContent('E-mail');
    // The trading name is no longer collected; Market and Tier are (2026-10-30).
    expect(screen.queryByLabelText('Trading name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Market')).toHaveTextContent('— not in my file —');
    expect(screen.getByLabelText('Tier')).toHaveTextContent('— not in my file —');
    expect(screen.getByRole('status')).toHaveTextContent('3 rows ready.');

    await userEvent.click(screen.getByRole('button', { name: 'Review import' }));
    const review = calls.find((call) => call.method === 'POST');
    expect(review?.headers.get('Authorization')).toBe('Bearer synthetic-token');
    expect(review?.body).toEqual({
      organizationId: ORG.id,
      fileName: 'buyers.csv',
      commit: false,
      defaultTypes: ['buyer'],
      rows: [
        {
          line: 2,
          values: {
            legalName: 'Synthetic Mills',
            country: 'Canada',
            contactName: 'Ana',
            contactEmail: 'ana@example.test',
            city: 'Alpha',
            region: 'SK',
          },
        },
        {
          line: 3,
          values: {
            legalName: 'Synthetic Mills',
            country: 'Canada',
            contactName: '',
            contactEmail: '',
            city: 'Beta',
            region: 'Manitoba',
          },
        },
        {
          line: 4,
          values: {
            legalName: 'Synthetic Buyer LLC',
            country: 'USA',
            contactName: '',
            contactEmail: '',
            city: 'Gamma',
            region: 'ND',
          },
        },
      ],
    });

    const table = await screen.findByRole('table', { name: 'Counterparties in this import' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('2, 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 new counterparties' }));
    expect(
      await screen.findByText('Imported 2 counterparties with 1 contacts and 3 locations.'),
    ).toBeInTheDocument();
    expect(
      calls
        .filter((call) => call.path === '/counterparties/import')
        .map((call) => (call.body as { commit: boolean }).commit),
    ).toEqual([false, true]);
    expect(onImported).toHaveBeenCalledTimes(1);

    // Coordinates for this import's locations: the sure one saved, the doubtful one asked.
    const results = await screen.findByRole('list', { name: 'Results to check' });
    expect(
      within(results).getByText('In another province or state than your address.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Coordinates found and saved for 1 location\./)).toBeInTheDocument();
    const lookups = calls.filter((call) => call.path.startsWith('/facilities/'));
    expect(lookups.map((call) => call.path)).toEqual([
      '/facilities/geocode',
      '/facilities/coordinates',
    ]);
    expect(lookups[0]?.body).toEqual({ organizationId: ORG.id, importBatchId: BATCH });
    expect(
      (lookups[1]?.body as { matches: { facilityId: string }[] }).matches.map((m) => m.facilityId),
    ).toEqual(['00000000-0000-4000-8000-00000000fac1']);

    await userEvent.click(screen.getByRole('button', { name: 'Skip it' }));
    // Skipped and not found: listed, with what to do.
    const without = screen.getByRole('list', { name: 'Locations without coordinates' });
    expect(within(without).getAllByRole('listitem')).toHaveLength(2);
    expect(calls.filter((call) => call.path === '/facilities/coordinates')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows row problems before sending anything', async () => {
    const calls = mockApi({});
    importer();
    await chooseFile('Company,Country,Prov\nSynthetic Mills,Mexico,SK\n,Canada,SK\n');

    expect(await screen.findByRole('status')).toHaveTextContent(
      '0 rows ready · 2 rows with problems.',
    );
    expect(
      screen.getByText('Row 2, Country: "Mexico" is not Canada or the United States'),
    ).toBeInTheDocument();
    expect(screen.getByText('Row 3, Legal name: is required')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('asks for the required columns', async () => {
    mockApi({});
    importer();
    await chooseFile('Firm,Nation\nSynthetic Mills,Canada\n');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Choose a column for Legal name and Country.',
    );
    expect(screen.getByRole('button', { name: 'Review import' })).toBeDisabled();
    await choose(screen.getByLabelText('Legal name (required)'), 'Firm');
    await choose(screen.getByLabelText('Country (required)'), 'Nation');
    expect(screen.getByRole('status')).toHaveTextContent('1 rows ready.');
    expect(screen.getByRole('button', { name: 'Review import' })).toBeEnabled();
  });

  it('refuses a file that is not UTF-8', async () => {
    mockApi({});
    importer();
    await userEvent.upload(
      screen.getByLabelText('Choose CSV file'),
      new File(
        [Uint8Array.from([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a])],
        'latin1.csv',
        {
          type: 'text/csv',
        },
      ),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'save it as "CSV UTF-8 (Comma delimited)"',
    );
  });

  it('refuses a file with no data rows', async () => {
    mockApi({});
    importer();
    await chooseFile('Company,Country\n');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file has a header row but no data rows.',
    );
  });

  // The owner's answer of 2026-10-31.
  it('lists what a file changes on a company already in the list', async () => {
    const updating = result({
      summary: {
        ...result().summary,
        newCounterparties: 0,
        existingCounterparties: 1,
        contacts: 0,
        facilities: 0,
        existingWithAdditions: 1,
        existingUpdated: 1,
      },
      counterparties: [
        {
          legalName: 'Synthetic Mills',
          country: 'CA',
          lines: [2],
          contacts: 0,
          facilities: 0,
          status: 'existing',
          changes: ['Company phone: (306) 555-0100 → (306) 555-0199', 'Tier: B → A'],
        },
      ],
    });
    mockApi({
      'POST /counterparties/import': (call) =>
        (call.body as { commit: boolean }).commit
          ? Response.json({ ...updating, committed: true, importBatchId: BATCH }, { status: 201 })
          : Response.json(updating),
    });
    importer();
    await chooseFile(CSV);
    await userEvent.click(await screen.findByRole('button', { name: 'Review import' }));
    const table = await screen.findByRole('table', { name: 'Counterparties in this import' });
    expect(within(table).getByText('Already in the list; updated')).toBeInTheDocument();
    expect(
      within(within(table).getByRole('list', { name: 'Changes to Synthetic Mills' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['Company phone: (306) 555-0100 → (306) 555-0199', 'Tier: B → A']);
    expect(screen.getByText(/updates to 1 company already in the list/)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add to the companies already in the list' }),
    );
    expect(await screen.findByText('Updated 1 company from the file.')).toBeInTheDocument();
  });

  // Codex's review of ivanmueller/gss#95.
  it('imports what was checked, and shows the new plan when the list changed meanwhile', async () => {
    const changed = result({
      fingerprint: 'e'.repeat(64),
      counterparties: [
        {
          legalName: 'Synthetic Mills',
          country: 'CA',
          lines: [2, 3],
          contacts: 0,
          facilities: 0,
          status: 'existing',
          changes: ['Tier: B → A'],
        },
      ],
    });
    const calls = mockApi({
      'POST /counterparties/import': (call) =>
        (call.body as { commit: boolean }).commit
          ? Response.json(
              {
                error: {
                  code: 'PLAN_CHANGED',
                  message:
                    'The list changed since this file was checked. Look over the changes again, then import.',
                },
                ...changed,
              },
              { status: 409 },
            )
          : Response.json(result()),
    });
    importer();
    await chooseFile(CSV);
    await userEvent.click(await screen.findByRole('button', { name: 'Review import' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 new counterparties' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The list changed since this file was checked',
    );
    expect(screen.getByRole('list', { name: 'Changes to Synthetic Mills' })).toHaveTextContent(
      'Tier: B → A',
    );
    const commits = calls.filter((call) => (call.body as { commit: boolean }).commit);
    expect(commits.map((call) => (call.body as { reviewed: string }).reviewed)).toEqual([
      'f'.repeat(64),
    ]);
  });

  // Codex's second review of ivanmueller/gss#95.
  it('stops offering the import when the list changed and nothing is left to write', async () => {
    const empty = result({
      fingerprint: null,
      summary: {
        ...result().summary,
        newCounterparties: 0,
        existingCounterparties: 2,
        contacts: 0,
        facilities: 0,
      },
      counterparties: [],
    });
    mockApi({
      'POST /counterparties/import': (call) =>
        (call.body as { commit: boolean }).commit
          ? Response.json(
              {
                error: {
                  code: 'PLAN_CHANGED',
                  message:
                    'The list changed since this file was checked. Look over the changes again, then import.',
                },
                ...empty,
              },
              { status: 409 },
            )
          : Response.json(result()),
    });
    importer();
    await chooseFile(CSV);
    await userEvent.click(await screen.findByRole('button', { name: 'Review import' }));
    await userEvent.click(screen.getByRole('button', { name: 'Import 2 new counterparties' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
    expect(screen.getByRole('button', { name: /^Import 0/ })).toBeDisabled();
  });

  it('adds new locations to companies already in the list when nothing else is new', async () => {
    const adding = result({
      summary: {
        ...result().summary,
        newCounterparties: 0,
        existingCounterparties: 2,
        contacts: 0,
        facilities: 0,
        existingWithAdditions: 1,
        addedContacts: 1,
        addedFacilities: 2,
        addedCommodities: 0,
      },
      counterparties: [
        {
          legalName: 'Synthetic Mills',
          country: 'CA',
          lines: [2, 3],
          contacts: 1,
          facilities: 2,
          status: 'existing',
          changes: [],
        },
        {
          legalName: 'Synthetic Buyer LLC',
          country: 'US',
          lines: [4],
          contacts: 0,
          facilities: 0,
          status: 'archived',
          changes: [],
        },
      ],
    });
    mockApi({
      'POST /counterparties/import': (call) =>
        (call.body as { commit: boolean }).commit
          ? Response.json({ ...adding, committed: true, importBatchId: BATCH }, { status: 201 })
          : Response.json(adding),
      'POST /facilities/geocode': () => Response.json({ truncated: false, proposals: [] }),
    });
    importer();
    await chooseFile(CSV);
    await userEvent.click(await screen.findByRole('button', { name: 'Review import' }));
    const table = await screen.findByRole('table', { name: 'Counterparties in this import' });
    expect(
      within(table).getByText('Already in the list; adds 2 locations and 1 contact'),
    ).toBeInTheDocument();
    expect(within(table).getByText('Archived; skipped')).toBeInTheDocument();
    expect(
      screen.getByText(/2 new locations and 1 new contact for 1 company already in the list/),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Add to the companies already in the list' }),
    );
    const done = await screen.findByText(/^Added /);
    expect(done).toHaveTextContent(
      'Added 2 new locations and 1 new contact for 1 company already in the list.',
    );
    expect(screen.queryByText(/^Imported 0/)).not.toBeInTheDocument();
    // The added locations get coordinates too.
    expect(await screen.findByText('No location is waiting for coordinates.')).toBeInTheDocument();
  });

  it('keeps the import blocked while the server reports problems and shows its message on failure', async () => {
    mockApi({
      'POST /counterparties/import': (call) =>
        (call.body as { commit: boolean }).commit
          ? Response.json(
              {
                error: {
                  code: 'NOTHING_TO_IMPORT',
                  message:
                    'Every company in this file is already in the list, with nothing new to add.',
                },
              },
              { status: 409 },
            )
          : Response.json(
              result({
                warnings: [{ line: 3, field: 'tradingName', message: 'differs from line 2' }],
              }),
            ),
    });
    importer();
    await chooseFile(CSV);
    await userEvent.click(await screen.findByRole('button', { name: 'Review import' }));
    expect(await screen.findByText('Row 3, Trading name: differs from line 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 new counterparties' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Every company in this file is already in the list, with nothing new to add.',
    );
  });
});
