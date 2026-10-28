import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ImportResult } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { ImportPage } from './ImportPage';

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
    summary: {
      rows: 3,
      emptyRows: 0,
      invalidRows: 0,
      counterparties: 2,
      newCounterparties: 2,
      existingCounterparties: 0,
      contacts: 1,
      facilities: 3,
    },
    counterparties: [
      {
        legalName: 'Synthetic Mills',
        country: 'CA',
        lines: [2, 3],
        contacts: 1,
        facilities: 2,
        status: 'new',
      },
      {
        legalName: 'Synthetic Buyer LLC',
        country: 'US',
        lines: [4],
        contacts: 0,
        facilities: 1,
        status: 'new',
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

describe('ImportPage', () => {
  it('imports a file of sellers and lists the columns that are not used', async () => {
    const calls = mockApi({ 'POST /counterparties/import': () => Response.json(result()) });
    render(<ImportPage session={SESSION} />);
    await chooseFile(
      ['Grower,Country,Bushels,Notes', 'Synthetic Grower,Canada,5000,Synthetic', ''].join('\n'),
    );

    expect(await screen.findByLabelText('Legal name (required)')).toHaveValue('Grower');
    expect(screen.getByRole('list', { name: 'Columns not used' })).toHaveTextContent('Bushels');
    expect(screen.getByText(/1 column in your file is not used/)).toBeInTheDocument();

    const side = screen.getByRole('group', { name: 'The companies in this file are' });
    await userEvent.click(within(side).getByRole('button', { name: 'Sellers' }));
    // Choosing the column for a field takes it off the unused list.
    await userEvent.selectOptions(screen.getByLabelText('Counterparty type'), 'Bushels');
    expect(screen.getByText('Every column in your file is used.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Rows with an empty type are' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Counterparty type'), '');

    await userEvent.click(screen.getByRole('button', { name: 'Review import' }));
    const review = calls.find((call) => call.method === 'POST');
    expect(review?.body).toMatchObject({ defaultTypes: ['seller'] });
  });

  it('matches columns, reviews with the server and imports', async () => {
    const calls = mockApi({
      'POST /counterparties/import': (call) => {
        const { commit } = call.body as { commit: boolean };
        return commit
          ? Response.json(result({ committed: true, importBatchId: 'batch-1' }), { status: 201 })
          : Response.json(result());
      },
    });
    render(<ImportPage session={SESSION} />);
    await chooseFile(CSV);

    expect(await screen.findByText(/3 rows, 6 columns/)).toBeInTheDocument();
    expect(screen.getByLabelText('Legal name (required)')).toHaveValue('Company Name');
    expect(screen.getByLabelText('Province or state')).toHaveValue('Prov');
    expect(screen.getByLabelText('Contact email')).toHaveValue('E-mail');
    expect(screen.getByLabelText('Trading name')).toHaveValue('');
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
        .filter((call) => call.method === 'POST')
        .map((call) => (call.body as { commit: boolean }).commit),
    ).toEqual([false, true]);
  });

  it('shows row problems before sending anything', async () => {
    const calls = mockApi({});
    render(<ImportPage session={SESSION} />);
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
    render(<ImportPage session={SESSION} />);
    await chooseFile('Firm,Nation\nSynthetic Mills,Canada\n');

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Choose a column for Legal name and Country.',
    );
    expect(screen.getByRole('button', { name: 'Review import' })).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText('Legal name (required)'), 'Firm');
    await userEvent.selectOptions(screen.getByLabelText('Country (required)'), 'Nation');
    expect(screen.getByRole('status')).toHaveTextContent('1 rows ready.');
    expect(screen.getByRole('button', { name: 'Review import' })).toBeEnabled();
  });

  it('refuses a file that is not UTF-8', async () => {
    mockApi({});
    render(<ImportPage session={SESSION} />);
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
    render(<ImportPage session={SESSION} />);
    await chooseFile('Company,Country\n');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The file has a header row but no data rows.',
    );
  });

  it('keeps the import blocked while the server reports problems and shows its message on failure', async () => {
    mockApi({
      'POST /counterparties/import': (call) =>
        (call.body as { commit: boolean }).commit
          ? Response.json(
              {
                error: {
                  code: 'ALREADY_IMPORTED',
                  message: 'This file has already been imported.',
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
    render(<ImportPage session={SESSION} />);
    await chooseFile(CSV);
    await userEvent.click(await screen.findByRole('button', { name: 'Review import' }));
    expect(await screen.findByText('Row 3, Trading name: differs from line 2')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Import 2 new counterparties' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This file has already been imported.',
    );
  });

  it('is only for editors', () => {
    render(<ImportPage session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only operations and admin members of Synthetic Org A can import counterparties.',
    );
  });
});
