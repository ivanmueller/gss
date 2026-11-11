import type { EmailSettingsView } from '@grain/domain';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { EmailSettings } from './EmailSettings';

// The Email card on Team (F-114 step 3): admins set the shared address, the signature, and each
// person's address, title and phone. Synthetic values only.
const TOM = {
  userId: '00000000-0000-4000-8000-0000000044aa',
  name: 'Tom Trader',
  localPart: null,
  title: null,
  phone: null,
};
const SETTINGS: EmailSettingsView = {
  configured: true,
  domain: 'gss.example.test',
  sharedLocalPart: 'info',
  signature: '{name}\n{title}\n{email}',
  ownLocalPart: null,
  you: TOM,
  members: [TOM],
  updatedByName: 'Adam',
  updatedAt: '2026-11-10T20:00:00.000Z',
};
const PATH = `/emails/settings?organization_id=${ORG.id}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EmailSettings', () => {
  it('saves the shared address and the signature, and previews it', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json({ settings: SETTINGS }),
      [`PUT ${PATH}`]: () => Response.json({ settings: SETTINGS }),
    });
    render(<EmailSettings session={SESSION} />);
    const card = await screen.findByRole('region', { name: 'Email' });
    expect(within(card).getByLabelText(/^Shared address/)).toHaveValue('info');
    expect(within(card).getByText(/Last set by Adam/)).toBeInTheDocument();
    const user = userEvent.setup();
    const signature = within(card).getByLabelText(/Team signature/);
    await user.clear(signature);
    await user.type(signature, 'Regards,{enter}{{name}');
    expect(within(card).getByText(/As Tom Trader’s emails end/).nextSibling).toHaveTextContent(
      'Regards, Tom Trader',
    );
    await user.click(within(card).getByRole('button', { name: 'Save' }));
    expect(await within(card).findByRole('status')).toHaveTextContent('Saved.');
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      sharedLocalPart: 'info',
      signature: 'Regards,\n{name}',
    });
  });

  it('saves a person’s address, title and phone together', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json({ settings: SETTINGS }),
      [`PUT /emails/members/${TOM.userId}?organization_id=${ORG.id}`]: () =>
        Response.json({ settings: SETTINGS }),
    });
    render(<EmailSettings session={SESSION} />);
    const card = await screen.findByRole('region', { name: 'Email' });
    const user = userEvent.setup();
    const save = within(card).getByRole('button', { name: 'Save Tom Trader' });
    expect(save).toBeDisabled();
    await user.type(within(card).getByLabelText(/^Address/), 'Tom');
    await user.type(within(card).getByLabelText('Title'), 'Grain trader');
    await user.type(within(card).getByLabelText('Phone in signature'), '403 555 0100');
    await user.click(save);
    await within(card).findByText('Saved.');
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      localPart: 'Tom',
      title: 'Grain trader',
      phone: '403 555 0100',
    });
    expect(within(card).getByLabelText(/^Address/)).toHaveValue('tom');
  });

  it('shows the API’s refusal', async () => {
    mockApi({
      [`GET ${PATH}`]: () => Response.json({ settings: SETTINGS }),
      [`PUT /emails/members/${TOM.userId}?organization_id=${ORG.id}`]: () =>
        Response.json(
          {
            error: {
              code: 'ADDRESS_TAKEN',
              message: 'That address is the shared address or another person’s.',
            },
          },
          { status: 409 },
        ),
    });
    render(<EmailSettings session={SESSION} />);
    const card = await screen.findByRole('region', { name: 'Email' });
    const user = userEvent.setup();
    await user.type(within(card).getByLabelText(/^Address/), 'info');
    await user.click(within(card).getByRole('button', { name: 'Save Tom Trader' }));
    expect(await within(card).findByRole('alert')).toHaveTextContent('shared address');
  });

  it('says so when email is not set up in Cloudflare', async () => {
    mockApi({
      [`GET ${PATH}`]: () =>
        Response.json({ settings: { ...SETTINGS, configured: false, domain: null } }),
    });
    render(<EmailSettings session={SESSION} />);
    expect(await screen.findByText(/Email is not set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
