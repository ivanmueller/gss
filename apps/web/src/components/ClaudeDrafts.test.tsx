import type { OpenDraftView } from '@grain/domain';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Contact } from '../lib/api';
import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { ClaudeDraftList, type DraftPlace } from './ClaudeDrafts';
import { CounterpartyCrm } from './CounterpartyCrm';

// Claude's drafts shown in their sections and verified in one click (F-115). Synthetic values
// only. The clock is fixed at 10 am in Alberta (UTC−6), 5 November 2026.
const COMPANY = '00000000-0000-4000-8000-00000000c001';
const ME = '00000000-0000-4000-8000-0000000044aa';
const PAT = '00000000-0000-4000-8000-00000000d1aa';
const BID_DRAFT = '00000000-0000-4000-8000-0000000dd001';
const FOLLOW_UP_DRAFT = '00000000-0000-4000-8000-0000000dd002';
const CONTACT_DRAFT = '00000000-0000-4000-8000-0000000dd003';
const QUOTE_ID = '00000000-0000-4000-8000-0000000e0e01';

const CALL = {
  counterpartyId: COMPANY,
  counterpartyName: 'Synthetic Prairie Mills',
  source: 'call' as const,
  callId: '00000000-0000-4000-8000-0000000ca111',
  emailId: null,
  emailSubject: null,
  calledAt: '2026-11-05T15:00:00.000Z',
  callerId: ME,
  callerName: 'Tess Trader',
  contactName: 'Pat Buyer',
  contactId: null,
};

const COMPLETE_BID: OpenDraftView = {
  ...CALL,
  id: BID_DRAFT,
  kind: 'quote',
  fields: {
    side: 'bid',
    commodity: 'flaxseed',
    values: {
      firmness: 'indicative',
      price: '725.00',
      currency: 'CAD',
      priceUnit: 'MT',
      deliveryBasis: 'delivered',
      quantityMax: '84',
      quotedAt: '2026-11-05T15:00:00.000Z',
      validUntil: '2026-11-12T15:00:00.000Z',
      sourceType: 'phone',
    },
    checks: {
      price: { said: '725', line: 1, doubt: null },
      quantityMax: { said: '84', line: 2, doubt: 'The line also says “minus freight”.' },
    },
  },
  lines: [1, 2],
  sourceLines: [
    { line: 1, text: 'I can pay 725 a tonne.' },
    { line: 2, text: 'Up to 84 tonnes, minus freight.' },
  ],
};

const fieldsOf = (draft: OpenDraftView) =>
  draft.fields as { side: 'bid'; commodity: 'flaxseed'; values: Record<string, string> };

/** The same bid without a valid-until time or delivery basis: not savable as it is. */
const values = { ...fieldsOf(COMPLETE_BID).values };
delete values.validUntil;
delete values.deliveryBasis;
const INCOMPLETE_BID: OpenDraftView = {
  ...COMPLETE_BID,
  fields: { ...fieldsOf(COMPLETE_BID), values },
};

const FOLLOW_UP: OpenDraftView = {
  ...CALL,
  id: FOLLOW_UP_DRAFT,
  kind: 'follow_up',
  fields: {
    values: { task: 'Call Pat back about flax', assignedTo: ME, dueAt: '2026-11-06T16:00:00.000Z' },
  },
  lines: [3],
  sourceLines: [{ line: 3, text: 'I will call you back tomorrow.' }],
};

const PATS_ROLE: OpenDraftView = {
  ...CALL,
  id: CONTACT_DRAFT,
  kind: 'contact',
  contactId: PAT,
  fields: { values: { contactRole: 'Head buyer' }, checks: {} },
  lines: [0],
  sourceLines: [{ line: 0, text: 'I am the head buyer now.' }],
};

const PAT_LISTED: Contact = {
  id: PAT,
  name: 'Pat Buyer',
  role: null,
  email: null,
  phone: '(403) 555-0100',
  isMain: true,
  version: '2026-11-01T00:00:00.000000Z',
};

function show(
  drafts: OpenDraftView[],
  { role = 'trader', showCompany = false, contacts = [] as Contact[] } = {},
) {
  const onChanged = vi.fn<DraftPlace['onChanged']>();
  render(
    <ClaudeDraftList
      drafts={drafts}
      showCompany={showCompany}
      place={{
        session: { ...SESSION, userId: ME, organization: { ...ORG, role } },
        contacts,
        team: [{ userId: ME, name: 'Tess Trader' }],
        onChanged,
      }}
    />,
  );
  return onChanged;
}

const card = (name: RegExp) => screen.getByRole('listitem', { name });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T16:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Claude's drafts in their sections", () => {
  it("rests folded to its main information, marked as Claude's, with Check this still shown", async () => {
    mockApi({});
    show([COMPLETE_BID]);
    expect(screen.getByRole('list', { name: "Claude's drafts to verify (1)" })).toBeInTheDocument();
    const bid = card(/Bid · Flaxseed/);
    expect(bid).toHaveAccessibleName('Drafted by Claude: Bid · Flaxseed');
    expect(bid).toHaveTextContent('Drafted by Claude · CAD 725.00 /MT · 84 MT · delivered');
    // Why to look twice is seen before Verify, even folded.
    expect(bid).toHaveTextContent('Check this');
    expect(bid).not.toHaveTextContent('Price from the call');
    expect(bid).not.toHaveTextContent('From Tess Trader’s call');

    await userEvent.click(within(bid).getByRole('button', { name: 'Show details' }));
    expect(within(bid).getByRole('button', { name: 'Hide details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(bid).toHaveTextContent('From Tess Trader’s call with Pat Buyer, 5 Nov 2026, 9:00 am MT');
    expect(bid).toHaveTextContent('Price from the call: I can pay 725 a tonne.');
    expect(within(bid).getByText('725', { selector: 'mark' })).toBeInTheDocument();
    expect(within(bid).getByRole('note')).toHaveTextContent(
      'Check this: The line also says “minus freight”.',
    );
  });

  it('says a draft came from an email, with its subject and lines (F-114 step 5a)', async () => {
    mockApi({});
    show([
      {
        ...COMPLETE_BID,
        source: 'email',
        callId: null,
        emailId: '00000000-0000-4000-8000-0000000e3a11',
        emailSubject: 'Re: Flax',
        callerId: null,
        callerName: 'Pat Buyer',
      },
    ]);
    const bid = card(/Bid · Flaxseed/);
    await userEvent.click(within(bid).getByRole('button', { name: 'Show details' }));
    expect(bid).toHaveTextContent(
      'From an email from Pat Buyer, 5 Nov 2026, 9:00 am MT — Re: Flax',
    );
    expect(bid).toHaveTextContent('Price from the email: I can pay 725 a tonne.');
    expect(bid).not.toHaveTextContent('call');
  });

  it('verifies a complete draft in one click, saving it as it is on the server', async () => {
    const calls = mockApi({
      [`POST /calls/drafts/${BID_DRAFT}/verify`]: () =>
        Response.json({ verified: true, kind: 'quote', resultId: QUOTE_ID }),
    });
    const onChanged = show([COMPLETE_BID]);
    await userEvent.click(within(card(/Bid · Flaxseed/)).getByRole('button', { name: 'Verify' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('Verified: saved as a bid or offer.', 'quote');
    });
    expect(calls.map((call) => [`${call.method} ${call.path}`, call.body])).toEqual([
      [`POST /calls/drafts/${BID_DRAFT}/verify`, {}],
    ]);
  });

  it('says why a verify was refused and keeps the draft', async () => {
    mockApi({
      [`POST /calls/drafts/${BID_DRAFT}/verify`]: () =>
        Response.json(
          {
            error: {
              code: 'ALREADY_DECIDED',
              message: 'Someone already saved or dismissed this draft.',
            },
          },
          { status: 409 },
        ),
    });
    const onChanged = show([COMPLETE_BID]);
    await userEvent.click(within(card(/Bid · Flaxseed/)).getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Someone already saved or dismissed this draft.',
    );
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('offers the form, not Verify, for a draft missing what a bid needs, and verifies what is saved there', async () => {
    const calls = mockApi({
      [`POST /calls/drafts/${BID_DRAFT}/verify`]: () =>
        Response.json({ verified: true, kind: 'quote', resultId: QUOTE_ID }),
    });
    const onChanged = show([INCOMPLETE_BID]);
    const bid = card(/Bid · Flaxseed/);
    expect(within(bid).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(bid).toHaveTextContent('Not heard on the call:');
    expect(bid).toHaveTextContent('delivery basis');
    expect(bid).toHaveTextContent('valid until');
    await userEvent.click(within(bid).getByRole('button', { name: 'Finish in the form' }));
    expect(within(bid).getByLabelText(/^Price/)).toHaveValue('725.00');
    await choose(within(bid).getByRole('combobox', { name: /^Delivery basis/ }), 'Delivered');
    await userEvent.type(within(bid).getByLabelText(/^Valid until/), '2026-11-12T10:00');
    await userEvent.click(within(bid).getByRole('button', { name: 'Save bid' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('Verified: saved as a bid or offer.', 'quote');
    });
    // One request: saved and marked together, never through the ordinary route first.
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      `POST /calls/drafts/${BID_DRAFT}/verify`,
    ]);
    expect(calls[0]?.body).toMatchObject({
      edited: {
        commodity: 'flaxseed',
        values: {
          price: '725.00',
          deliveryBasis: 'delivered',
          validUntil: '2026-11-12T16:00:00.000Z',
        },
      },
    });
  });

  it('never adds a unit that was not said (Codex, 88e09df, finding 1)', () => {
    mockApi({});
    const noUnit = { ...fieldsOf(COMPLETE_BID).values };
    delete noUnit.priceUnit;
    show([{ ...COMPLETE_BID, fields: { ...fieldsOf(COMPLETE_BID), values: noUnit } }]);
    const bid = card(/Bid · Flaxseed/);
    expect(within(bid).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(bid).toHaveTextContent('Not heard on the call: price unit');
  });

  it('dismisses a draft without saving anything', async () => {
    const calls = mockApi({
      [`POST /calls/drafts/${BID_DRAFT}/decision`]: () => Response.json({ decided: true }),
    });
    const onChanged = show([COMPLETE_BID]);
    await userEvent.click(within(card(/Bid · Flaxseed/)).getByRole('button', { name: 'Dismiss' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('Draft dismissed.', 'quote');
    });
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      [`/calls/drafts/${BID_DRAFT}/decision`, { decision: 'dismissed' }],
    ]);
  });

  it('shows a viewer the draft and who verifies it, with no buttons', () => {
    mockApi({});
    show([COMPLETE_BID, PATS_ROLE], { role: 'viewer', contacts: [PAT_LISTED] });
    expect(
      screen.queryByRole('button', { name: /Verify|Edit|Dismiss|Finish/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Show details' })).toHaveLength(2);
    expect(screen.getByText('Traders and admins verify bids and offers.')).toBeInTheDocument();
    expect(screen.getByText('Operations and admins verify contacts.')).toBeInTheDocument();
  });

  it("verifies a listed contact's new details for operations, not for a trader", async () => {
    const calls = mockApi({
      [`POST /calls/drafts/${CONTACT_DRAFT}/verify`]: () =>
        Response.json({ verified: true, kind: 'contact', resultId: PAT }),
    });
    show([PATS_ROLE], { role: 'trader', contacts: [PAT_LISTED] });
    expect(card(/New details for Pat Buyer/)).toHaveTextContent('Head buyer');
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    cleanup();
    const onChanged = show([PATS_ROLE], { role: 'operations', contacts: [PAT_LISTED] });
    await userEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('Verified: contact saved.', 'contact');
    });
    // The version shown on the card goes with it (Codex's review of 88e09df, finding 2).
    expect(calls.map((call) => [call.path, call.body])).toEqual([
      [`/calls/drafts/${CONTACT_DRAFT}/verify`, { contactVersion: PAT_LISTED.version }],
    ]);
  });

  it('cannot verify new details of a contact no longer listed', () => {
    mockApi({});
    show([PATS_ROLE], { role: 'operations', contacts: [] });
    const draft = card(/New details for a listed contact/);
    expect(within(draft).queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(within(draft).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(draft).toHaveTextContent('Contact no longer listed');
  });

  it('names the company on the main pages, linking to it', () => {
    mockApi({});
    show([FOLLOW_UP], { showCompany: true });
    const link = within(card(/Follow-up: Call Pat back about flax/)).getByRole('link', {
      name: 'Synthetic Prairie Mills',
    });
    expect(link).toHaveAttribute('href', `/counterparties/${COMPANY}`);
    expect(card(/Follow-up/)).toHaveTextContent('Due Fri 6 Nov 2026, 10:00 am MT');
  });
});

describe("Claude's follow-up drafts on a company's page", () => {
  it('are shown in Follow-ups, not under the call, and Verify plans one', async () => {
    const calls = mockApi({
      [`GET /contact-log?counterparty_id=${COMPANY}`]: () =>
        Response.json({ entries: [], truncated: false }),
      [`GET /follow-ups?counterparty_id=${COMPANY}&status=all`]: () =>
        Response.json({ followUps: [], truncated: false }),
      [`GET /follow-ups/team?organization_id=${ORG.id}`]: () =>
        Response.json({ members: [{ userId: ME, name: 'Tess Trader' }] }),
      [`GET /calls/recordings?counterparty_id=${COMPANY}`]: () => Response.json({ recordings: [] }),
      [`GET /calls/drafts?organization_id=${ORG.id}&counterparty_id=${COMPANY}`]: () =>
        Response.json({ drafts: [FOLLOW_UP] }),
      [`POST /calls/drafts/${FOLLOW_UP_DRAFT}/verify`]: () =>
        Response.json({ verified: true, kind: 'follow_up', resultId: QUOTE_ID }),
    });
    render(
      <CounterpartyCrm
        session={{ ...SESSION, userId: ME, organization: { ...ORG, role: 'trader' } }}
        counterparty={{ id: COMPANY, archived: false, contactNames: ['Pat Buyer'], contacts: [] }}
      />,
    );
    const followUps = await screen.findByRole('region', { name: /^Follow-ups/ });
    const draft = await within(followUps).findByRole('listitem', {
      name: /Follow-up: Call Pat back about flax/,
    });
    await userEvent.click(within(draft).getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Verified: follow-up planned.')).toBeInTheDocument();
    expect(calls.some((call) => call.path === `/calls/drafts/${FOLLOW_UP_DRAFT}/verify`)).toBe(
      true,
    );
  });
});
