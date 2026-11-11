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
    unverifiedSender: false,
    automatic: false,
    parseFailed: false,
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

  it('stays locked after a lost answer even when a retry is refused for an expired sign-in (R2-02)', async () => {
    let answer = 0;
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [`POST /emails?organization_id=${ORG.id}`]: () => {
        answer += 1;
        if (answer === 1) return Promise.reject(new TypeError('network'));
        if (answer === 2) {
          return Response.json(
            { error: { code: 'UNAUTHORIZED', message: 'Sign in again.' } },
            { status: 401 },
          );
        }
        return Response.json({ email: email() }, { status: 200 });
      },
    });
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await within(dialog).findByText('The server could not be reached.');
    await user.click(within(dialog).getByRole('button', { name: 'Send again' }));
    await within(dialog).findByText('Sign in again.');
    expect(within(dialog).getByLabelText('Message')).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Send again' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent.');
    const posts = calls.filter((call) => call.method === 'POST').map((call) => call.body);
    expect(posts).toHaveLength(3);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[2]).toEqual(posts[0]);
  });

  it('cannot be closed while sending, and keeps an uncertain email across closing (R4-01)', async () => {
    let answer = 0;
    let release: (response: Response) => void = () => undefined;
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [`POST /emails?organization_id=${ORG.id}`]: () => {
        answer += 1;
        if (answer === 1) {
          // Held until the test lets it go, then lost.
          return new Promise<Response>((resolve) => {
            release = resolve;
          }).then(() => Promise.reject(new TypeError('network')));
        }
        return Response.json({ email: email() }, { status: 200 });
      },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'New email' })).toBeInTheDocument();
    release(new Response());
    await within(dialog).findByText('The server could not be reached.');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('may already have been sent'));
    expect(screen.queryByRole('dialog')).toBeNull();

    // Opened again: the same email, locked, under the same key.
    await user.click(screen.getByRole('button', { name: 'Email Pat Buyer' }));
    const again = await screen.findByRole('dialog', { name: 'New email' });
    await within(again).findByLabelText('Message');
    expect(within(again).getByLabelText('Message')).toHaveValue('Hello Pat');
    expect(within(again).getByLabelText('Message')).toBeDisabled();
    await user.click(within(again).getByRole('button', { name: 'Send again' }));
    expect(await within(again).findByRole('status')).toHaveTextContent('Sent.');
    const posts = calls.filter((call) => call.method === 'POST').map((call) => call.body);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });

  it('unlocks a first attempt refused before anything was kept', async () => {
    mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [`POST /emails?organization_id=${ORG.id}`]: () =>
        Response.json(
          { error: { code: 'ARCHIVED', message: 'This counterparty is archived.' } },
          { status: 409 },
        ),
    });
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await within(dialog).findByText('This counterparty is archived.');
    expect(within(dialog).getByLabelText('Message')).toBeEnabled();
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
    const older = `${LIST_PATH}&before_id=${last?.id ?? ''}`;
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

  it('warns on received mail whose sender is not verified, and tags automatic mail (D1-04)', async () => {
    mockApi({
      [LIST_PATH]: () =>
        Response.json({
          emails: [
            email({
              id: '00000000-0000-4000-8000-0000000e1b01',
              direction: 'incoming',
              state: 'received',
              subject: 'Re: Feed oats',
              fromAddress: 'pat@buyer.example.test',
              unverifiedSender: true,
            }),
            email({
              id: '00000000-0000-4000-8000-0000000e1b02',
              direction: 'incoming',
              state: 'received',
              subject: 'Out of office',
              automatic: true,
            }),
          ],
        }),
    });
    show();
    expect(await screen.findByText('Re: Feed oats')).toBeInTheDocument();
    expect(screen.getAllByText(/Sender not verified/)).toHaveLength(1);
    expect(screen.getAllByText('Automatic')).toHaveLength(1);
  });
});
