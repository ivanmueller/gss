import type { Member } from '@grain/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { TeamPage } from './TeamPage';

const V = '2026-10-28T14:05:09.123456Z';
const ME: Member = {
  id: '00000000-0000-4000-8000-00000000a0a1',
  userId: 'u1',
  email: 'adam@example.test',
  firstName: 'Adam',
  lastName: 'Synthetic',
  role: 'org_admin',
  status: 'active',
  joinedAt: '2026-10-27T00:00:00.000Z',
  version: V,
  isYou: true,
};
const OLIVIA: Member = {
  ...ME,
  id: '00000000-0000-4000-8000-00000000a0a2',
  userId: 'u2',
  email: 'olivia@example.test',
  firstName: null,
  lastName: null,
  role: 'operations',
  isYou: false,
};
const LIST = `GET /members?organization_id=${ORG.id}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TeamPage', () => {
  it('lists the team with roles and statuses', async () => {
    mockApi({ [LIST]: () => Response.json({ members: [ME, OLIVIA] }) });
    render(<TeamPage session={SESSION} />);
    const table = await screen.findByRole('table', { name: 'Team members' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Adam SyntheticYouadam@example.testAdminActive');
    expect(rows[2]).toHaveTextContent('No name yetolivia@example.testOperationsActive');
    expect(screen.queryByRole('button', { name: 'Suspend adam@example.test' })).toBeNull();
  });

  it('adds a person, and explains how to create a login when there is none', async () => {
    const calls = mockApi({
      [LIST]: () => Response.json({ members: [ME] }),
      'POST /members': (call) =>
        (call.body as { email: string }).email === 'new@example.test'
          ? Response.json({ id: 'm3' }, { status: 201 })
          : Response.json(
              { error: { code: 'NO_ACCOUNT', message: 'No one can sign in with this email yet.' } },
              { status: 404 },
            ),
    });
    render(<TeamPage session={SESSION} />);
    const form = await screen.findByRole('region', { name: 'Add a person' });

    await userEvent.type(
      within(form).getByLabelText('Email of their login'),
      'missing@example.test',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Add to team' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Authentication → Users → Add user',
    );

    await userEvent.clear(within(form).getByLabelText('Email of their login'));
    await userEvent.type(within(form).getByLabelText('Email of their login'), 'new@example.test');
    await userEvent.selectOptions(within(form).getByLabelText('Role'), 'trader');
    await userEvent.click(within(form).getByRole('button', { name: 'Add to team' }));
    expect(await within(form).findByRole('status')).toHaveTextContent(
      'new@example.test is on the team.',
    );
    expect(calls.filter((call) => call.method === 'POST').at(-1)?.body).toEqual({
      organizationId: ORG.id,
      email: 'new@example.test',
      role: 'trader',
    });
  });

  it('edits names and role, and suspends someone else', async () => {
    const calls = mockApi({
      [LIST]: () => Response.json({ members: [ME, OLIVIA] }),
      [`PATCH /members/${OLIVIA.id}`]: () => Response.json({ saved: true }),
    });
    render(<TeamPage session={SESSION} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit olivia@example.test' }));
    const form = screen.getByRole('form', { name: 'Edit olivia@example.test' });
    await userEvent.type(within(form).getByLabelText('First name'), 'Olivia');
    await userEvent.selectOptions(within(form).getByLabelText('Role'), 'trader');
    await userEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        organizationId: ORG.id,
        version: V,
        firstName: 'Olivia',
        lastName: '',
        role: 'trader',
      });
    });

    await userEvent.click(
      await screen.findByRole('button', { name: 'Suspend olivia@example.test' }),
    );
    await waitFor(() => {
      expect(calls.filter((call) => call.method === 'PATCH').at(-1)?.body).toEqual({
        organizationId: ORG.id,
        version: V,
        status: 'suspended',
      });
    });
  });

  it('does not let an admin change their own role', async () => {
    mockApi({ [LIST]: () => Response.json({ members: [ME] }) });
    render(<TeamPage session={SESSION} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit adam@example.test' }));
    const form = screen.getByRole('form', { name: 'Edit adam@example.test' });
    expect(within(form).getByLabelText('Role')).toBeDisabled();
    expect(within(form).getByText('Another admin changes your own role.')).toBeInTheDocument();
  });

  it('is for admins only', () => {
    const calls = mockApi({});
    render(<TeamPage session={{ ...SESSION, organization: { ...ORG, role: 'trader' } }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Only admins of Synthetic Org A manage the team. You are Trader',
    );
    expect(calls).toHaveLength(0);
  });
});
