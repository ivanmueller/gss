import type { EmailSettingsView, EmailView } from '@grain/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { ContactEmail, EmailProvider, EmailsCard } from './Emails';

// Email sent by hand from a company's page (F-114 step 3). Synthetic values only.
const COMPANY = '00000000-0000-4000-8000-00000000c1aa';
const PAT = {
  id: '00000000-0000-4000-8000-00000000d1aa',
  name: 'Pat Buyer',
  email: 'pat@buyer.example.test',
  phone: null,
  role: null,
  isMain: true,
} as unknown as Contact;
const DANA = {
  ...PAT,
  id: '00000000-0000-4000-8000-00000000d2aa',
  name: 'Dana Buyer',
  email: 'dana@buyer.example.test',
  isMain: false,
} as unknown as Contact;
const ME = {
  userId: '00000000-0000-4000-8000-0000000044aa',
  name: 'Tom Trader',
  localPart: 'tom',
  title: 'Grain trader',
  phone: null,
};
const SETTINGS: EmailSettingsView = {
  configured: true,
  domain: 'gss.example.test',
  sharedLocalPart: 'info',
  signature: '{name}\n{title}\nPhone: {phone}\n{email}',
  ownLocalPart: 'tom',
  you: ME,
  members: [ME],
  updatedByName: 'Adam',
  updatedAt: '2026-11-10T20:00:00.000Z',
};
const SETTINGS_PATH = `GET /emails/settings?organization_id=${ORG.id}`;
const LIST_PATH = `GET /emails?organization_id=${ORG.id}&counterparty_id=${COMPANY}`;

function email(overrides: Partial<EmailView> = {}): EmailView {
  return {
    id: '00000000-0000-4000-8000-0000000e1aa1',
    direction: 'outgoing',
    state: 'sent',
    fromAddress: 'tom@gss.example.test',
    fromName: 'Tom Trader',
    to: ['pat@buyer.example.test'],
    cc: [],
    subject: 'Feed oats',
    sentByName: 'Tom Trader',
    contactName: 'Pat Buyer',
    failure: null,
    occurredAt: '2026-11-10T21:00:00.000Z',
    cursorAt: '2026-11-10T21:00:00.123456Z',
    ...overrides,
  };
}

function show(enabled = true) {
  render(
    <EmailProvider
      session={SESSION}
      counterpartyId={COMPANY}
      contacts={[PAT, DANA]}
      enabled={enabled}
    >
      <ContactEmail contact={PAT} />
      <EmailsCard session={SESSION} counterpartyId={COMPANY} />
    </EmailProvider>,
  );
}

async function write(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Email Pat Buyer' }));
  const dialog = await screen.findByRole('dialog', { name: 'New email' });
  await within(dialog).findByLabelText('Subject');
  await user.type(within(dialog).getByLabelText('Subject'), 'Feed oats');
  await user.type(within(dialog).getByLabelText('Message'), 'Hello Pat');
  return dialog;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the email form', () => {
  it('writes to the contact from their own address, shows the signature, and sends once', async () => {
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [`POST /emails?organization_id=${ORG.id}`]: () =>
        Response.json({ email: email() }, { status: 201 }),
    });
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    expect(within(dialog).getByLabelText('To')).toHaveValue('pat@buyer.example.test');
    expect(within(dialog).getByLabelText('From')).toHaveValue('own');
    // The signature as it will be sent: the empty phone line is left out.
    expect(within(dialog).getByText(/Grain trader/)).toHaveTextContent(
      /^-- Tom Trader Grain trader tom@gss\.example\.test$/,
    );
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent.');
    const posts = calls.filter((call) => call.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toMatchObject({
      counterpartyId: COMPANY,
      contactId: PAT.id,
      from: 'own',
      to: ['pat@buyer.example.test'],
      cc: [],
      subject: 'Feed oats',
      message: 'Hello Pat',
    });
    expect(within(dialog).queryByRole('button', { name: 'Send' })).toBeNull();
    // The card is loaded again with the new email.
    await waitFor(() => {
      expect(
        calls.filter((call) => call.path.startsWith('/emails?')).length,
      ).toBeGreaterThanOrEqual(2);
    });
  });

  it('adds another contact and refuses a bad address before sending', async () => {
    mockApi({ [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }) });
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    await user.click(within(dialog).getByRole('button', { name: 'Dana Buyer' }));
    expect(within(dialog).getByLabelText('To')).toHaveValue(
      'pat@buyer.example.test, dana@buyer.example.test',
    );
    await user.type(within(dialog).getByLabelText('Cc'), 'not-an-address');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Not an email address: not-an-address',
    );
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('after a refusal, sends again as a new attempt (D1-02)', async () => {
    let answer = 0;
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [`POST /emails?organization_id=${ORG.id}`]: () => {
        answer += 1;
        return answer === 1
          ? Response.json(
              {
                error: {
                  code: 'EMAIL_REFUSED',
                  message: 'Not sent. A recipient is on the suppression list.',
                },
              },
              { status: 502 },
            )
          : Response.json({ email: email() }, { status: 201 });
      },
    });
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('suppression list');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent.');
    const keys = calls
      .filter((call) => call.method === 'POST')
      .map((call) => (call.body as { sendKey: string }).sendKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('keeps the same key after a lost answer, and offers nothing more once unconfirmed', async () => {
    let answer = 0;
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [`POST /emails?organization_id=${ORG.id}`]: () => {
        answer += 1;
        return answer === 1
          ? Response.json(
              { error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is unavailable.' } },
              { status: 503 },
            )
          : Response.json(
              {
                error: {
                  code: 'EMAIL_UNCONFIRMED',
                  message: 'Cloudflare did not confirm the email.',
                },
              },
              { status: 504 },
            );
      },
    });
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await within(dialog).findByText('The database is unavailable.');
    // It may have gone: what was submitted cannot be changed before it is sent again (R1-02).
    for (const label of ['To', 'Cc', 'Subject', 'Message', 'From']) {
      expect(within(dialog).getByLabelText(label)).toBeDisabled();
    }
    await user.click(within(dialog).getByRole('button', { name: 'Send again' }));
    await within(dialog).findByText('Cloudflare did not confirm the email.');
    const posts = calls.filter((call) => call.method === 'POST').map((call) => call.body);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(within(dialog).queryByRole('button', { name: /^Send/ })).toBeNull();
  });

  it('says so when email is not set up, and offers no Email on an archived company', async () => {
    mockApi({
      [SETTINGS_PATH]: () =>
        Response.json({ settings: { ...SETTINGS, configured: false, domain: null } }),
    });
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Email Pat Buyer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email is not set up yet');
  });

  it('offers no Email where it cannot be written', () => {
    mockApi({});
    show(false);
    expect(screen.getByText('pat@buyer.example.test')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Email Pat Buyer' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New email' })).toBeNull();
  });
});

describe('the Emails card', () => {
  it('lists emails with their state, opens one, and loads older ones (D1-03)', async () => {
    const page = Array.from({ length: 200 }, (_, i) =>
      email({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        subject: `Subject ${String(i)}`,
        state: i === 0 ? 'failed' : 'sent',
        failure: i === 0 ? 'E_RECIPIENT_SUPPRESSED: A recipient is on the suppression list.' : null,
      }),
    );
    const last = page[199];
    const older = `${LIST_PATH}&before_at=${encodeURIComponent(last?.cursorAt ?? '')}&before_id=${last?.id ?? ''}`;
    mockApi({
      [LIST_PATH]: () => Response.json({ emails: page }),
      [older]: () =>
        Response.json({
          emails: [email({ id: '00000000-0000-4000-8000-0000000e1d00', subject: 'Oldest' })],
        }),
      [`GET /emails/${page[1]?.id ?? ''}?organization_id=${ORG.id}`]: () =>
        Response.json({
          email: { ...page[1], body: 'Hello Pat\n\n-- \nTom', bodyTruncated: false },
        }),
    });
    show();
    const user = userEvent.setup();
    expect(await screen.findByText('Subject 0')).toBeInTheDocument();
    expect(screen.getByText(/suppression list/)).toBeInTheDocument();
    expect(screen.getAllByText('Not sent')[0]).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Subject 1Sent/ }));
    expect(await screen.findByText(/Hello Pat/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load older' }));
    expect(await screen.findByText('Oldest')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
  });
});
