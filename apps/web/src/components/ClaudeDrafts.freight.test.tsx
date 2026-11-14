import type { OpenDraftView } from '@grain/domain';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { ClaudeDraftList, type DraftPlace } from './ClaudeDrafts';

// Claude's drafts of freight rates (F-235 part 2): the owner's made-up example wording, with
// synthetic companies. The clock is fixed at 10 am in Alberta (UTC−6), 14 November 2026.
const COMPANY = '00000000-0000-4000-8000-00000000c001';
const ME = '00000000-0000-4000-8000-0000000044aa';
const DRAFT = '00000000-0000-4000-8000-0000000dd0f1';
const RATE_ID = '00000000-0000-4000-8000-0000000e0f01';

const MATCH = {
  latitude: '49.354000',
  longitude: '-97.365000',
  precision: 'approximate',
  expiresAt: '2099-01-01T00:00:00.000Z',
  signature: 'a'.repeat(64),
};

const RATE: OpenDraftView = {
  id: DRAFT,
  kind: 'freight',
  counterpartyId: COMPANY,
  counterpartyName: 'Synthetic Logistics',
  source: 'email',
  callId: null,
  emailId: '00000000-0000-4000-8000-0000000e3a11',
  emailSubject: 'Rates',
  calledAt: '2026-11-14T15:00:00.000Z',
  callerId: null,
  callerName: 'Sam Dispatcher',
  contactName: 'Sam Dispatcher',
  contactId: null,
  fields: {
    mode: 'truck',
    origin: { text: 'Morris MB', region: 'CA-MB' },
    destination: { text: 'Muncie IN', region: 'US-IN' },
    values: {
      firmness: 'firm',
      rate: '335',
      currency: 'CAD',
      rateUnit: 'MT',
      quotedAt: '2026-11-14T15:00:00.000Z',
      sourceType: 'email',
    },
    checks: {
      rate: { said: '335/CMT', line: 1, doubt: 'The line also says “182/CMT”.' },
    },
  },
  lines: [1],
  sourceLines: [
    { line: 1, text: 'Morris MB to Muncie IN 335/CMT, Morris MB to Lacrosse WI 182/CMT' },
  ],
};

/** The same rate without the province of its first end: finished in the form. */
const NO_REGION: OpenDraftView = {
  ...RATE,
  fields: {
    ...(RATE.fields as object),
    origin: { text: 'Morris', region: null },
  } as OpenDraftView['fields'],
};

function show(drafts: OpenDraftView[], role = 'trader') {
  const onChanged = vi.fn<DraftPlace['onChanged']>();
  render(
    <ClaudeDraftList
      drafts={drafts}
      place={{
        session: { ...SESSION, userId: ME, organization: { ...ORG, role } },
        team: null,
        onChanged,
      }}
    />,
  );
  return onChanged;
}

const card = () => screen.getByRole('listitem', { name: /Freight · / });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-14T16:00:00.000Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Claude's freight rate drafts", () => {
  it('shows the route, rate and why to look twice, and verifies it in one click', async () => {
    const calls = mockApi({
      [`POST /calls/drafts/${DRAFT}/verify`]: () =>
        Response.json({ verified: true, kind: 'freight', resultId: RATE_ID }),
    });
    const onChanged = show([RATE]);
    const rate = card();
    expect(rate).toHaveAccessibleName('Drafted by Claude: Freight · Morris MB → Muncie IN');
    expect(rate).toHaveTextContent('CAD 335/MT · Truck · no end date');
    expect(rate).toHaveTextContent('Check this');

    await userEvent.click(within(rate).getByRole('button', { name: 'Show details' }));
    expect(rate).toHaveTextContent('Rate from the email:');
    expect(within(rate).getByText('335/CMT', { selector: 'mark' })).toBeInTheDocument();
    expect(rate).toHaveTextContent(
      'Verify places each town on the map only when the lookup is sure',
    );

    await userEvent.click(within(rate).getByRole('button', { name: 'Verify' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('Verified: freight rate saved.', 'freight');
    });
    expect(calls.map((call) => [`${call.method} ${call.path}`, call.body])).toEqual([
      [`POST /calls/drafts/${DRAFT}/verify`, {}],
    ]);
  });

  it('shows a viewer or analyst the draft and who verifies it, with no buttons', () => {
    mockApi({});
    show([RATE], 'analyst');
    const rate = card();
    expect(rate).toHaveTextContent('Traders, operations and admins verify freight rates.');
    expect(within(rate).queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(within(rate).queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('lets operations verify freight rates', () => {
    mockApi({});
    show([RATE], 'operations');
    expect(within(card()).getByRole('button', { name: 'Verify' })).toBeInTheDocument();
  });

  it('finishes a rate without a province in the form, sending a point only once ticked', async () => {
    const calls = mockApi({
      [`GET /counterparties?organization_id=${ORG.id}`]: () =>
        Response.json({ counterparties: [], truncated: false }),
      'POST /freight-quotes/places': () =>
        Response.json({
          status: 'found',
          sure: false,
          formattedAddress: 'Morris, MB, Canada',
          match: MATCH,
        }),
      [`POST /calls/drafts/${DRAFT}/verify`]: () =>
        Response.json({ verified: true, kind: 'freight', resultId: RATE_ID }),
    });
    const onChanged = show([NO_REGION]);
    const rate = card();
    expect(rate).toHaveAccessibleName('Drafted by Claude: Freight · Morris → Muncie IN');
    expect(within(rate).queryByRole('button', { name: 'Verify' })).toBeNull();
    expect(rate).toHaveTextContent('Not in the email: from (town and province or state)');

    await userEvent.click(within(rate).getByRole('button', { name: 'Finish in the form' }));
    expect(within(rate).getByLabelText(/^From: town or area/)).toHaveValue('Morris');
    expect(within(rate).getByLabelText(/^To: town or area/)).toHaveValue('Muncie IN');
    expect(within(rate).getByLabelText(/^Rate/)).toHaveValue('335');

    // Saving without a province is stopped before anything is sent.
    await userEvent.click(within(rate).getByRole('button', { name: 'Save freight rate' }));
    expect(within(rate).getByRole('alert')).toHaveTextContent(
      'Choose the province or state the freight leaves from.',
    );
    await choose(within(rate).getByLabelText(/^From: province or state/), 'Manitoba (MB)');

    // A doubtful match is not ticked by itself; ticked, its signed match is sent.
    const [find] = within(rate).getAllByRole('button', { name: 'Find on the map' });
    if (!find) throw new Error('no Find on the map');
    await userEvent.click(find);
    const tick = await within(rate).findByRole('checkbox', { name: /That’s the place/ });
    expect(tick).not.toBeChecked();
    await userEvent.click(tick);
    await userEvent.click(within(rate).getByRole('button', { name: 'Save freight rate' }));
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('Verified: freight rate saved.', 'freight');
    });
    const verify = calls.find((call) => call.path === `/calls/drafts/${DRAFT}/verify`);
    expect(verify?.body).toMatchObject({
      edited: {
        values: { rate: '335', currency: 'CAD', rateUnit: 'MT', firmness: 'firm' },
        freight: {
          mode: 'truck',
          origin: { area: { text: 'Morris', region: 'CA-MB', match: MATCH } },
          destination: { area: { text: 'Muncie IN', region: 'US-IN' } },
        },
      },
    });
    const destination = (verify?.body as { edited: { freight: { destination: { area: object } } } })
      .edited.freight.destination.area;
    expect(destination).not.toHaveProperty('match');
  });

  it('shows why a place match was refused, and keeps the form', async () => {
    mockApi({
      [`GET /counterparties?organization_id=${ORG.id}`]: () =>
        Response.json({ counterparties: [], truncated: false }),
      [`POST /calls/drafts/${DRAFT}/verify`]: () =>
        Response.json(
          {
            error: {
              code: 'BAD_PLACE_MATCH',
              message:
                'The place found on the map is no longer valid. Click Find again, then save.',
            },
          },
          { status: 422 },
        ),
    });
    const onChanged = show([RATE]);
    const rate = card();
    await userEvent.click(within(rate).getByRole('button', { name: 'Edit' }));
    await userEvent.click(within(rate).getByRole('button', { name: 'Save freight rate' }));
    expect(await within(rate).findByRole('alert')).toHaveTextContent(
      'The place found on the map is no longer valid.',
    );
    expect(onChanged).not.toHaveBeenCalled();
    expect(within(rate).getByRole('button', { name: 'Save freight rate' })).toBeEnabled();
  });
});
