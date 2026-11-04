import type { ImportSummary, UndoImportPlan } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { AddCounterpartiesDialog } from './AddCounterpartiesDialog';
import { UndoImport } from './UndoImport';

// Synthetic imports and companies only.
const BATCH: ImportSummary = {
  id: '00000000-0000-4000-8000-00000000ba7c',
  fileName: 'synthetic-sellers.csv',
  createdAt: '2026-11-04T01:00:00.000Z',
  companies: 2,
  undoneAt: null,
};
const PLAN: UndoImportPlan = {
  fileName: 'synthetic-sellers.csv',
  createdAt: '2026-11-04T01:00:00.000Z',
  recordsAdditions: true,
  companies: 2,
  locations: 3,
  kept: [],
  listed: [
    {
      id: '00000000-0000-4000-8000-00000000c001',
      name: 'Synthetic Feeds',
      locations: 1,
      grains: 1,
      removedTypes: ['seller'],
      sellerDetails: true,
      check: ['Tier'],
    },
  ],
};
const LIST = `GET /counterparties/imports?organization_id=${ORG.id}`;
const UNDO = `POST /counterparties/imports/${BATCH.id}/undo`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('UndoImport', () => {
  it('shows what undoing removes, and undoes only once the count is typed', async () => {
    const calls = mockApi({
      [LIST]: () => Response.json({ imports: [BATCH] }),
      [UNDO]: (call) =>
        Response.json({ committed: (call.body as { commit: boolean }).commit, plan: PLAN }),
    });
    const onUndone = vi.fn();
    render(<UndoImport session={SESSION} onUndone={onUndone} onClose={vi.fn()} />);
    const list = await screen.findByRole('list', { name: 'Imports' });
    expect(list).toHaveTextContent('synthetic-sellers.csv');
    expect(list).toHaveTextContent('2 companies still listed');
    await userEvent.click(within(list).getByRole('button', { name: 'Undo synthetic-sellers.csv' }));

    expect(
      await screen.findByText(/Deletes 2 companies this import created, with 3 locations/),
    ).toBeInTheDocument();
    const listed = screen.getByRole('list', { name: 'Companies already listed' });
    expect(listed).toHaveTextContent(
      'Removes 1 location, 1 grain, the Seller type, its seller details.',
    );
    expect(listed).toHaveTextContent('Check by hand, as the import changed it: Tier.');
    // Nothing is removed until the count is typed.
    const undo = screen.getByRole('button', { name: 'Undo this import' });
    expect(undo).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox'), '3');
    expect(undo).toBeDisabled();
    await userEvent.clear(screen.getByRole('textbox'));
    await userEvent.type(screen.getByRole('textbox'), '2');
    await userEvent.click(undo);
    expect(await screen.findByText('Import undone: 2 companies deleted.')).toBeInTheDocument();
    expect(onUndone).toHaveBeenCalled();
    expect(calls.filter((call) => call.path.endsWith('/undo')).map((call) => call.body)).toEqual([
      { commit: false },
      { commit: true, expected: 2 },
    ]);
  });

  it('shows the new plan when the list changed since the preview, removing nothing', async () => {
    let previews = 0;
    mockApi({
      [LIST]: () => Response.json({ imports: [BATCH] }),
      [UNDO]: (call) => {
        if (!(call.body as { commit: boolean }).commit) {
          previews += 1;
          return Response.json({ committed: false, plan: PLAN });
        }
        return Response.json(
          {
            error: { code: 'PLAN_CHANGED', message: 'The list changed since the preview.' },
            plan: { ...PLAN, companies: 1 },
          },
          { status: 409 },
        );
      },
    });
    render(<UndoImport session={SESSION} onUndone={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Undo synthetic-sellers.csv' }),
    );
    await userEvent.type(await screen.findByRole('textbox'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Undo this import' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The list changed');
    expect(screen.getByText(/Deletes 1 company this import created/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(previews).toBe(1);
  });

  // Codex's re-review of c4d4808: an older import's unrecorded changes are always mentioned.
  it('warns that an import made before the record may leave changes on listed companies', async () => {
    mockApi({
      [LIST]: () => Response.json({ imports: [BATCH] }),
      [UNDO]: () =>
        Response.json({ committed: false, plan: { ...PLAN, recordsAdditions: false, listed: [] } }),
    });
    render(<UndoImport session={SESSION} onUndone={vi.fn()} onClose={vi.fn()} />);
    await userEvent.click(
      await screen.findByRole('button', { name: 'Undo synthetic-sellers.csv' }),
    );
    expect(
      await screen.findByText(/made before imports kept a record of what they add/),
    ).toBeInTheDocument();
  });

  it('marks an import already undone', async () => {
    mockApi({
      [LIST]: () => Response.json({ imports: [{ ...BATCH, undoneAt: BATCH.createdAt }] }),
    });
    render(<UndoImport session={SESSION} onUndone={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText('Undone')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Undo / })).toBeNull();
  });

  it('is offered in the + window to admins only', async () => {
    const { unmount } = render(
      <AddCounterpartiesDialog session={SESSION} initialTab={null} onImported={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparties' }));
    expect(screen.getByRole('button', { name: /Undo an import/ })).toBeInTheDocument();
    unmount();
    render(
      <AddCounterpartiesDialog
        session={{ ...SESSION, organization: { ...ORG, role: 'operations' } }}
        initialTab={null}
        onImported={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add counterparties' }));
    expect(screen.queryByRole('button', { name: /Undo an import/ })).toBeNull();
  });
});
