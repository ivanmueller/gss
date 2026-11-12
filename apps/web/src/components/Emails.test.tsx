import type { EmailAutoDraftView, EmailSettingsView, EmailView } from '@grain/domain';
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
  claudeConfigured: false,
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
    counterpartyId: COMPANY,
    sentTo: null,
    attachmentCount: 0,
    replyToAddress: null,
    inReplyToSubject: null,
    draftedByClaude: false,
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

describe('Reply and Draft with Claude (F-114 step 5b)', () => {
  const RECEIVED = email({
    id: '00000000-0000-4000-8000-0000000e1bb1',
    direction: 'incoming',
    state: 'received',
    fromAddress: 'pat@buyer.example.test',
    fromName: 'Pat Buyer',
    to: ['tom@gss.example.test'],
    subject: 'RE: Barley',
    sentByName: null,
  });
  const DRAFT_PATH = `POST /emails/draft?organization_id=${ORG.id}`;
  const SEND_PATH = `POST /emails?organization_id=${ORG.id}`;
  const OPEN_PATH = `GET /emails/${RECEIVED.id}?organization_id=${ORG.id}`;
  const DRAFT_ID = '00000000-0000-4000-8000-00000000d0d0';

  async function openReply(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /^RE: Barley/ }));
    await user.click(await screen.findByRole('button', { name: 'Reply' }));
    return screen.findByRole('dialog', { name: 'Reply' });
  }

  it('replies to the sender with a draft, blocks Send until the placeholder is filled, and sends both links', async () => {
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: { ...SETTINGS, claudeConfigured: true } }),
      [LIST_PATH]: () => Response.json({ emails: [RECEIVED] }),
      [OPEN_PATH]: () => Response.json({ email: { ...RECEIVED, body: 'Can you do 2 loads?' } }),
      [DRAFT_PATH]: () =>
        Response.json({
          draft: {
            draftId: DRAFT_ID,
            subject: 'Re: Barley',
            message: 'Hi Pat,\n\nYes, 2 loads at $310 for [delivery date].',
            checkThis: ['310'],
            placeholders: ['[delivery date]'],
          },
        }),
      [SEND_PATH]: () => Response.json({ email: email() }, { status: 201 }),
    });
    show();
    const user = userEvent.setup();
    const dialog = await openReply(user);
    await within(dialog).findByLabelText('Subject');
    expect(within(dialog).getByLabelText('To')).toHaveValue('pat@buyer.example.test');
    expect(within(dialog).getByLabelText('Subject')).toHaveValue('Re: Barley');

    await user.type(within(dialog).getByLabelText(/Draft with Claude/), 'the loads');
    await user.click(within(dialog).getByRole('button', { name: 'Draft with Claude' }));
    await waitFor(() => {
      expect(within(dialog).getByLabelText('Message')).toHaveValue(
        'Hi Pat,\n\nYes, 2 loads at $310 for [delivery date].',
      );
    });
    const draftCall = calls.find((call) => call.path.startsWith('/emails/draft'));
    expect(draftCall?.body).toMatchObject({
      counterpartyId: COMPANY,
      replyToEmailId: RECEIVED.id,
      about: 'the loads',
      to: ['pat@buyer.example.test'],
    });
    expect(within(dialog).getByText('Check this before sending')).toBeInTheDocument();
    expect(within(dialog).getByText('310')).toBeInTheDocument();
    expect(within(dialog).getByText(/Fill in \[delivery date\]/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();

    const box = within(dialog).getByLabelText('Message');
    await user.clear(box);
    await user.type(box, 'Hi Pat, yes, 2 loads in December.');
    expect(within(dialog).queryByText('Check this before sending')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent.');
    const sendCall = calls.find(
      (call) => call.method === 'POST' && call.path.startsWith('/emails?'),
    );
    expect(sendCall?.body).toMatchObject({
      replyToEmailId: RECEIVED.id,
      claudeDraftId: DRAFT_ID,
      subject: 'Re: Barley',
    });
  });

  it('warns about a capitalised number word Claude did not have (R1-02)', async () => {
    mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: { ...SETTINGS, claudeConfigured: true } }),
      [DRAFT_PATH]: () =>
        Response.json({
          draft: {
            draftId: DRAFT_ID,
            subject: 'Barley',
            message: 'Twelve loads available.',
            checkThis: ['Twelve'],
            placeholders: [],
          },
        }),
    });
    show();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Email Pat Buyer' }));
    const dialog = await screen.findByRole('dialog', { name: 'New email' });
    await user.click(await within(dialog).findByRole('button', { name: 'Draft with Claude' }));
    expect(await within(dialog).findByText('Check this before sending')).toBeInTheDocument();
    expect(within(dialog).getByText('Twelve')).toBeInTheDocument();
    // Still listed when only its case is changed.
    const box = within(dialog).getByLabelText('Message');
    await user.clear(box);
    await user.type(box, 'twelve loads available.');
    expect(within(dialog).getByText('Twelve')).toBeInTheDocument();
  });

  it('replies to the Reply-To address when the email named one (R2-02)', async () => {
    const named = {
      ...RECEIVED,
      fromAddress: 'notifications@buyer.example.test',
      replyToAddress: 'pat@buyer.example.test',
    };
    mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [LIST_PATH]: () => Response.json({ emails: [named] }),
      [OPEN_PATH]: () => Response.json({ email: { ...named, body: 'Hello' } }),
    });
    show();
    const user = userEvent.setup();
    const dialog = await openReply(user);
    expect(await within(dialog).findByLabelText('To')).toHaveValue('pat@buyer.example.test');
  });

  it('offers no Draft with Claude when Claude is not set up', async () => {
    mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [LIST_PATH]: () => Response.json({ emails: [RECEIVED] }),
      [OPEN_PATH]: () => Response.json({ email: { ...RECEIVED, body: 'Hello' } }),
    });
    show();
    const user = userEvent.setup();
    const dialog = await openReply(user);
    await within(dialog).findByLabelText('Subject');
    expect(within(dialog).queryByRole('button', { name: 'Draft with Claude' })).toBeNull();
  });

  it('keeps what was written when the person declines the replacement', async () => {
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: { ...SETTINGS, claudeConfigured: true } }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    show();
    const user = userEvent.setup();
    const dialog = await write(user);
    await user.click(within(dialog).getByRole('button', { name: 'Draft with Claude' }));
    expect(within(dialog).getByLabelText('Message')).toHaveValue('Hello Pat');
    expect(calls.some((call) => call.path.startsWith('/emails/draft'))).toBe(false);
  });

  it('offers to send as a new email when the answered email was deleted', async () => {
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [LIST_PATH]: () => Response.json({ emails: [RECEIVED] }),
      [OPEN_PATH]: () => Response.json({ email: { ...RECEIVED, body: 'Hello' } }),
      [SEND_PATH]: (call) =>
        (call.body as { replyToEmailId: string | null }).replyToEmailId === null
          ? Response.json({ email: email() }, { status: 201 })
          : Response.json(
              { error: { code: 'REPLY_NOT_FOUND', message: 'The email was deleted.' } },
              { status: 409 },
            ),
    });
    show();
    const user = userEvent.setup();
    const dialog = await openReply(user);
    await user.type(await within(dialog).findByLabelText('Message'), 'Thanks');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Send as a new email' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent.');
    const sends = calls.filter(
      (call) => call.method === 'POST' && call.path.startsWith('/emails?'),
    );
    expect(sends).toHaveLength(2);
  });

  it('shows how a sent email started', async () => {
    mockApi({
      [LIST_PATH]: () =>
        Response.json({
          emails: [email({ inReplyToSubject: 'RE: Barley', draftedByClaude: true })],
        }),
    });
    show();
    expect(await screen.findByText('In reply to “RE: Barley”')).toBeInTheDocument();
    expect(screen.getByText('Drafted with Claude')).toBeInTheDocument();
  });
});

describe('Claude’s email drafts on the Emails card (F-114 step 5c)', () => {
  const DRAFTS_PATH = `GET /email-auto-drafts?organization_id=${ORG.id}&counterparty_id=${COMPANY}`;
  const RECEIVED = '00000000-0000-4000-8000-0000000e1aa9';
  const DRAFT: EmailAutoDraftView = {
    id: '00000000-0000-4000-8000-0000000a0d01',
    counterpartyId: COMPANY,
    counterpartyName: 'Synthetic Buyer',
    source: 'email',
    about: 'The barley GSS has',
    callAt: null,
    callContactName: null,
    callBy: null,
    emailId: RECEIVED,
    emailFrom: 'Pat Buyer',
    emailSubject: 'Barley?',
    emailAt: '2026-11-10T21:00:00.000Z',
    assignedTo: null,
    assignedToName: null,
    fromChoice: 'shared',
    to: ['orders@buyer.example.test'],
    subject: 'Re: Barley?',
    message: 'Hi Pat, we have 500 MT of barley at [price].',
    checkThis: [],
    placeholders: ['[price]'],
    draftedAt: '2026-11-09T21:00:00.000Z',
    answeredSince: null,
  };

  it('lists a draft with its age, opens it filled in, and sends it with its id once the blank is filled', async () => {
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [DRAFTS_PATH]: () => Response.json({ drafts: [DRAFT], truncated: false }),
      [`POST /emails?organization_id=${ORG.id}`]: () =>
        Response.json({ email: email() }, { status: 201 }),
    });
    show();
    const user = userEvent.setup();
    expect(await screen.findByText('Reply to Pat Buyer’s email “Barley?”')).toBeInTheDocument();
    expect(screen.getByText(/for anyone · \d+ days old/)).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Open Claude’s draft: Reply to Pat Buyer’s email “Barley?”',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Claude’s draft' });
    await within(dialog).findByLabelText('Subject');
    expect(within(dialog).getByLabelText('To')).toHaveValue('orders@buyer.example.test');
    expect(within(dialog).getByLabelText('From')).toHaveValue('shared');
    expect(within(dialog).getByLabelText('Subject')).toHaveValue('Re: Barley?');
    // The blank keeps Send off until it is filled.
    expect(within(dialog).getByRole('button', { name: 'Send' })).toBeDisabled();
    const message = within(dialog).getByLabelText('Message');
    await user.clear(message);
    await user.type(message, 'Hi Pat, we have 500 MT of barley at 300.');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent.');
    const post = calls.find((call) => call.method === 'POST');
    expect(post?.body).toMatchObject({
      from: 'shared',
      to: ['orders@buyer.example.test'],
      replyToEmailId: RECEIVED,
      claudeDraftId: null,
      autoDraftId: DRAFT.id,
    });
  });

  it('offers to send as a new email when someone else sent or dismissed the draft', async () => {
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [DRAFTS_PATH]: () =>
        Response.json({ drafts: [{ ...DRAFT, placeholders: [] }], truncated: false }),
      [`POST /emails?organization_id=${ORG.id}`]: (call) =>
        (call.body as { autoDraftId: string | null }).autoDraftId === null
          ? Response.json({ email: email() }, { status: 201 })
          : Response.json(
              { error: { code: 'AUTO_DRAFT_USED', message: 'Claude’s draft was already sent.' } },
              { status: 409 },
            ),
    });
    show();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Open Claude’s draft: Reply to Pat Buyer’s email “Barley?”',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Claude’s draft' });
    await within(dialog).findByLabelText('Subject');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(
      await within(dialog).findByText('Claude’s draft was sent or dismissed by someone else.'),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send as a new email' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Sent.');
    const posts = calls.filter((call) => call.method === 'POST' && call.path.startsWith('/emails'));
    expect(posts.map((call) => (call.body as { autoDraftId: string | null }).autoDraftId)).toEqual([
      DRAFT.id,
      null,
    ]);
  });

  it('opens the draft named in the address (Open on Follow-ups), once', async () => {
    window.history.replaceState(null, '', `/counterparties/${COMPANY}?email_draft=${DRAFT.id}`);
    mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [DRAFTS_PATH]: () => Response.json({ drafts: [DRAFT], truncated: false }),
    });
    show();
    expect(await screen.findByRole('dialog', { name: 'Claude’s draft' })).toBeInTheDocument();
    expect(window.location.search).toBe('');
  });

  it('says so when the draft named in the address is no longer waiting', async () => {
    window.history.replaceState(null, '', `/counterparties/${COMPANY}?email_draft=${DRAFT.id}`);
    mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [DRAFTS_PATH]: () => Response.json({ drafts: [], truncated: false }),
    });
    show();
    expect(
      await screen.findByText(
        'That draft of Claude’s is no longer waiting: it was sent or dismissed.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('dismisses a draft after asking', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const calls = mockApi({
      [SETTINGS_PATH]: () => Response.json({ settings: SETTINGS }),
      [DRAFTS_PATH]: () => Response.json({ drafts: [DRAFT], truncated: false }),
      [`POST /email-auto-drafts/${DRAFT.id}/dismiss?organization_id=${ORG.id}`]: () =>
        Response.json({ dismissed: true }),
    });
    show();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', {
        name: 'Dismiss Claude’s draft: Reply to Pat Buyer’s email “Barley?”',
      }),
    );
    await waitFor(() => {
      expect(calls.filter((call) => call.path.startsWith('/email-auto-drafts?'))).toHaveLength(2);
    });
  });
});
