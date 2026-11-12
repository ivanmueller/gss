import type { EmailView, UnmatchedEmailsView } from '@grain/domain';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { contactForSender, UnmatchedEmails } from './UnmatchedEmails';

// Received email on no company (F-114 step 4b). Synthetic values only.
const COMPANY = '00000000-0000-4000-8000-00000000c1aa';
const PAT = '00000000-0000-4000-8000-00000000d1aa';
const DANA = '00000000-0000-4000-8000-00000000d2aa';
const FIRST = '00000000-0000-4000-8000-0000000e1aa1';
const SECOND = '00000000-0000-4000-8000-0000000e1aa2';
const LIST = `GET /emails/unmatched?organization_id=${ORG.id}`;

function email(overrides: Partial<EmailView> = {}): EmailView {
  return {
    id: FIRST,
    direction: 'incoming',
    state: 'received',
    fromAddress: 'pat@buyer.example.test',
    fromName: 'Pat Buyer',
    to: ['nobody@gss.example.test'],
    cc: [],
    subject: 'Oats offer',
    sentByName: null,
    contactName: null,
    failure: null,
    occurredAt: '2026-11-11T18:00:00.000Z',
    unverifiedSender: false,
    automatic: false,
    parseFailed: false,
    counterpartyId: null,
    sentTo: 'nobody@gss.example.test',
    attachmentCount: 0,
    ...overrides,
  };
}

function page(emails: EmailView[], more = false, total = emails.length): UnmatchedEmailsView {
  return { emails, more, total };
}

const COMPANIES = {
  [`GET /counterparties?organization_id=${ORG.id}`]: () =>
    Response.json({
      counterparties: [
        {
          id: COMPANY,
          legalName: 'Synthetic A Buyer',
          tradingName: null,
          regions: ['AB'],
          primaryCountry: 'CA',
          archivedAt: null,
          types: ['buyer'],
        },
      ],
      truncated: false,
    }),
  [`GET /counterparties/${COMPANY}`]: () =>
    Response.json({
      id: COMPANY,
      legalName: 'Synthetic A Buyer',
      contacts: [
        { id: DANA, name: 'Dana Buyer', email: 'dana@buyer.example.test' },
        { id: PAT, name: 'Pat Buyer', email: 'Pat@Buyer.example.test' },
      ],
    }),
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('email on no company', () => {
  it('shows nothing when there is none', async () => {
    const calls = mockApi({ [LIST]: () => Response.json(page([])) });
    const { container } = render(<UnmatchedEmails session={SESSION} />);
    await waitFor(() => {
      expect(calls.some((call) => call.path.startsWith('/emails/unmatched'))).toBe(true);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('lists each email with where it was sent, its warnings and its attachments', async () => {
    mockApi({
      [LIST]: () =>
        Response.json(
          page(
            [
              email({ unverifiedSender: true, attachmentCount: 2 }),
              email({ id: SECOND, automatic: true, parseFailed: true, subject: '' }),
            ],
            false,
            1000,
          ),
        ),
    });
    render(<UnmatchedEmails session={SESSION} />);
    const section = await screen.findByRole('region', { name: /Email on no company/ });
    expect(within(section).getByRole('heading')).toHaveTextContent('(1,000+)');
    expect(section).toHaveTextContent(
      'Pat Buyer <pat@buyer.example.test> to nobody@gss.example.test',
    );
    expect(section).toHaveTextContent('2 attachments');
    expect(section).toHaveTextContent('Sender not verified');
    expect(section).toHaveTextContent('Automatic');
    expect(section).toHaveTextContent('This email could not be read');
  });

  it('links an email to a company, its sender’s contact chosen, and reads the list again', async () => {
    let listed = [email()];
    const calls = mockApi({
      [LIST]: () => Response.json(page(listed)),
      ...COMPANIES,
      [`POST /emails/${FIRST}/link?organization_id=${ORG.id}`]: () => {
        listed = [];
        return Response.json({ email: email({ counterpartyId: COMPANY }) });
      },
    });
    render(<UnmatchedEmails session={SESSION} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Link to a company' }));
    await choose(await screen.findByRole('button', { name: 'Company' }), 'Synthetic A Buyer');
    // The contact whose address is the sender's, whatever its case.
    await vi.waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Contact' })).toHaveTextContent('Pat Buyer');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Link to this company' }));
    await vi.waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toEqual({
        counterpartyId: COMPANY,
        contactId: PAT,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /Email on no company/ })).toBeNull();
    });
  });

  it('says so and reads the list again when someone linked it first', async () => {
    let listed = [email()];
    mockApi({
      [LIST]: () => Response.json(page(listed)),
      ...COMPANIES,
      [`POST /emails/${FIRST}/link?organization_id=${ORG.id}`]: () => {
        listed = [];
        return Response.json(
          { error: { code: 'ALREADY_LINKED', message: 'Someone linked this email already.' } },
          { status: 409 },
        );
      },
    });
    render(<UnmatchedEmails session={SESSION} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Link to a company' }));
    await choose(await screen.findByRole('button', { name: 'Company' }), 'Synthetic A Buyer');
    await userEvent.click(screen.getByRole('button', { name: 'Link to this company' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Someone linked this email already.',
    );
    expect(screen.queryByRole('button', { name: 'Link to a company' })).toBeNull();
  });

  it('keeps the form open with the reason when the company cannot take it', async () => {
    mockApi({
      [LIST]: () => Response.json(page([email()])),
      ...COMPANIES,
      [`POST /emails/${FIRST}/link?organization_id=${ORG.id}`]: () =>
        Response.json(
          { error: { code: 'COMPANY_UNAVAILABLE', message: 'That company is archived.' } },
          { status: 409 },
        ),
    });
    render(<UnmatchedEmails session={SESSION} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Link to a company' }));
    await choose(await screen.findByRole('button', { name: 'Company' }), 'Synthetic A Buyer');
    await userEvent.click(screen.getByRole('button', { name: 'Link to this company' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That company is archived.');
    expect(screen.getByRole('button', { name: 'Link to this company' })).toBeEnabled();
  });

  it('deletes an email only once confirmed', async () => {
    let listed = [email(), email({ id: SECOND, subject: 'Second' })];
    const calls = mockApi({
      [LIST]: () => Response.json(page(listed)),
      [`POST /emails/${FIRST}/remove?organization_id=${ORG.id}`]: () => {
        listed = listed.filter((e) => e.id !== FIRST);
        return Response.json({ removed: true });
      },
    });
    const confirm = vi
      .spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<UnmatchedEmails session={SESSION} />);
    const [first] = await screen.findAllByRole('button', { name: 'Delete' });
    if (first === undefined) throw new Error('No Delete button');
    await userEvent.click(first);
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await userEvent.click(first);
    expect(confirm).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    });
    expect(screen.queryByText('Oats offer')).toBeNull();
  });

  it('shows older email after the last one, each once', async () => {
    const calls = mockApi({
      [LIST]: () => Response.json(page([email()], true, 2)),
      [`${LIST}&before_id=${FIRST}`]: () =>
        Response.json(page([email(), email({ id: SECOND, subject: 'Older one' })], false, 2)),
    });
    render(<UnmatchedEmails session={SESSION} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Show older' }));
    expect(await screen.findByText('Older one')).toBeInTheDocument();
    expect(screen.getAllByText('Oats offer')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show older' })).toBeNull();
    expect(calls.map((call) => call.path)).toContain(
      `/emails/unmatched?organization_id=${ORG.id}&before_id=${FIRST}`,
    );
  });

  it('downloads an attachment as plain bytes under its own name, never opened', async () => {
    mockApi({
      [LIST]: () => Response.json(page([email({ attachmentCount: 1 })])),
      [`GET /emails/${FIRST}?organization_id=${ORG.id}`]: () =>
        Response.json({
          email: email({
            body: 'See attached.',
            attachments: [
              {
                position: 0,
                fileName: 'page.html',
                contentType: 'text/html',
                sizeBytes: 2048,
                disposition: 'attachment',
              },
            ],
          }),
        }),
      [`GET /emails/${FIRST}/attachments/0?organization_id=${ORG.id}`]: () =>
        new Response('<script>alert(1)</script>', {
          headers: { 'Content-Type': 'application/octet-stream' },
        }),
    });
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return 'blob:synthetic';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });
    render(<UnmatchedEmails session={SESSION} />);
    await userEvent.click(await screen.findByRole('button', { name: /Oats offer/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'page.html' }));
    await waitFor(() => {
      expect(clicked).toHaveLength(1);
    });
    expect(clicked[0]?.download).toBe('page.html');
    expect(blobs[0]?.type).toBe('application/octet-stream');
    expect(screen.getByText(/2 KB/)).toBeInTheDocument();
  });
});

describe('contactForSender', () => {
  it('chooses the one contact with the sender’s address, else none', () => {
    const contacts = [
      { id: PAT, email: 'pat@buyer.example.test' },
      { id: DANA, email: null },
    ] as Parameters<typeof contactForSender>[0];
    expect(contactForSender(contacts, 'pat@buyer.example.test')).toBe(PAT);
    expect(contactForSender(contacts, 'other@buyer.example.test')).toBe('');
    expect(contactForSender([...contacts, ...contacts], 'pat@buyer.example.test')).toBe('');
  });
});
