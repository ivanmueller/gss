import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OpenDraftView } from '@grain/domain';

import { mockApi, ORG, SESSION } from '../test/api';
import { CARRIER_ID, FREIGHT } from '../test/freight';
import { FreightPage } from './FreightPage';

const COUNTERPARTIES = {
  counterparties: [
    {
      id: CARRIER_ID,
      organizationId: ORG.id,
      legalName: 'Synthetic Carrier',
      tradingName: null,
      types: ['carrier'],
      primaryCountry: 'CA',
      verificationStatus: 'verified',
      source: 'manual',
      createdAt: '2026-10-29T14:05:00.000Z',
      contactCount: 0,
      facilityCount: 0,
      regions: [],
      logoSha256: null,
      archivedAt: null,
    },
  ],
  truncated: false,
};

beforeEach(() => {
  window.history.replaceState(null, '', '/freight');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FreightPage', () => {
  it('lists live freight rates with their route, carrier, mode and rate as quoted', async () => {
    mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}`]: () =>
        Response.json({ freight: [FREIGHT], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () => Response.json(COUNTERPARTIES),
    });
    render(<FreightPage session={SESSION} />);
    expect(await screen.findByText('1 live freight rates')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: 'Freight rates' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent(
      'Synthetic SellerSynthetic Elevator, Synthetic City, SKSynthetic BuyerSynthetic Mill, Synthetic Town, MN',
    );
    expect(row).toHaveTextContent('Synthetic CarrierRailCAD 105.00/MT');
    expect(row).toHaveTextContent('Indicative');
    expect(
      within(table).getByRole('link', {
        name: 'Synthetic Seller, Synthetic Elevator, Synthetic City, SK to Synthetic Buyer, Synthetic Mill, Synthetic Town, MN',
      }),
    ).toHaveAttribute('href', `/freight/${FREIGHT.id}`);
    expect(screen.getByRole('link', { name: 'New freight rate' })).toHaveAttribute(
      'href',
      '/freight/new',
    );
  });

  it('filters by mode and asks for withdrawn and expired rates only when wanted', async () => {
    const calls = mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /freight-quotes?organization_id=${ORG.id}&mode=truck`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /freight-quotes?organization_id=${ORG.id}&mode=truck&status=all`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () => Response.json(COUNTERPARTIES),
    });
    render(<FreightPage session={SESSION} />);
    expect(await screen.findByText('No live freight rates here.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Truck' }));
    await userEvent.click(screen.getByLabelText('Include withdrawn and expired'));
    await waitFor(() => {
      expect(calls.map((call) => call.path)).toContain(
        `/freight-quotes?organization_id=${ORG.id}&mode=truck&status=all`,
      );
    });
    expect(window.location.search).toBe('?mode=truck&status=all');
  });

  it('points to Counterparties when there are no carriers yet, and offers viewers no new rate', async () => {
    mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () =>
        Response.json({ counterparties: [], truncated: false }),
    });
    const { unmount } = render(<FreightPage session={SESSION} />);
    expect(
      await screen.findByText(/First add your carriers under Counterparties/),
    ).toBeInTheDocument();
    unmount();
    render(<FreightPage session={{ ...SESSION, organization: { ...ORG, role: 'viewer' } }} />);
    expect(
      await screen.findByText('Traders, operations and admins enter them.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'New freight rate' })).toBeNull();
  });

  it("lists Claude's freight drafts under the mode filter, naming the company, and reloads after Verify (F-235 part 2)", async () => {
    let verified = false;
    const calls = mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}`]: () =>
        Response.json({ freight: verified ? [FREIGHT] : [], truncated: false }),
      [`GET /freight-quotes?organization_id=${ORG.id}&mode=rail`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () => Response.json(COUNTERPARTIES),
      [`GET /calls/drafts?organization_id=${ORG.id}&kind=freight`]: () =>
        Response.json({ drafts: verified ? [] : [DRAFT] }),
      [`POST /calls/drafts/${DRAFT.id}/verify`]: () => {
        verified = true;
        return Response.json({ verified: true, kind: 'freight', resultId: FREIGHT.id });
      },
    });
    render(<FreightPage session={SESSION} />);
    const drafts = await screen.findByRole('region', { name: 'Claude’s drafts to verify (1)' });
    const card = within(drafts).getByRole('listitem', {
      name: 'Drafted by Claude: Freight · Morris MB → Muncie IN',
    });
    expect(within(card).getByRole('link', { name: 'Synthetic Carrier' })).toHaveAttribute(
      'href',
      `/counterparties/${CARRIER_ID}`,
    );
    await userEvent.click(within(card).getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText('Verified: freight rate saved.')).toBeInTheDocument();
    expect(await screen.findByText('1 live freight rates')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Claude’s drafts/ })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('leaves out a truck rate draft when Rail is chosen', async () => {
    window.history.replaceState(null, '', '/freight?mode=rail');
    mockApi({
      [`GET /freight-quotes?organization_id=${ORG.id}&mode=rail`]: () =>
        Response.json({ freight: [], truncated: false }),
      [`GET /counterparties?organization_id=${ORG.id}`]: () => Response.json(COUNTERPARTIES),
      [`GET /calls/drafts?organization_id=${ORG.id}&kind=freight`]: () =>
        Response.json({ drafts: [DRAFT] }),
    });
    render(<FreightPage session={SESSION} />);
    expect(await screen.findByText('No live freight rates here.')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Claude’s drafts/ })).toBeNull();
  });
});

const DRAFT: OpenDraftView = {
  id: '00000000-0000-4000-8000-0000000dd0f1',
  kind: 'freight',
  counterpartyId: CARRIER_ID,
  counterpartyName: 'Synthetic Carrier',
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
    checks: {},
  },
  lines: [1],
  sourceLines: [{ line: 1, text: 'Morris MB to Muncie IN 335/CMT' }],
};
