import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CounterpartyDetail } from '../lib/api';
import { mockApi } from '../test/api';
import { CarrierLanes, isCrossBorder, laneChange } from './CarrierLanes';

// A fictional carrier; every record here is synthetic.
const ID = '00000000-0000-4000-8000-00000000ca01';

const DETAIL: CounterpartyDetail = {
  id: ID,
  organizationId: '00000000-0000-4000-8000-0000000000aa',
  legalName: 'Synthetic Prairie Hauling',
  tradingName: null,
  types: ['carrier'],
  primaryCountry: 'CA',
  verificationStatus: 'unverified',
  source: 'manual',
  createdAt: '2026-10-27T14:05:00.000Z',
  contactCount: 0,
  facilityCount: 0,
  regions: [],
  logoSha256: null,
  archivedAt: null,
  buys: [],
  sells: [],
  markets: [],
  tier: null,
  grainTypes: [],
  sellerKind: null,
  annualTonnes: null,
  organicCertifier: null,
  organicCertifiedUntil: null,
  equipment: [],
  lanes: [
    {
      origin: 'CA-AB',
      destination: 'US-ND',
      transport: 'truck',
      verifiedAt: '2026-10-30T12:00:00.000Z',
    },
    {
      origin: 'CA-AB',
      destination: 'US-MT',
      transport: 'truck',
      verifiedAt: '2026-10-30T12:00:00.000Z',
    },
    {
      origin: 'CA-AB',
      destination: 'CA-SK',
      transport: 'rail',
      verifiedAt: '2026-10-30T12:00:00.000Z',
    },
  ],
  quotedLanes: [
    { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
    { origin: 'CA-MB', destination: 'US-MN', transport: 'rail_and_truck' },
  ],
  website: null,
  phone: null,
  notes: null,
  version: '2026-10-27T14:05:00.000000Z',
  contacts: [],
  facilities: [],
  commodities: [],
};

const NO_MAP = { status: 'missing' } as const;

function show(role: string, detail: CounterpartyDetail = DETAIL) {
  const onSaved = vi.fn();
  render(
    <CarrierLanes
      token="synthetic-token"
      role={role}
      detail={detail}
      onSaved={onSaved}
      mapbox={NO_MAP}
    />,
  );
  return onSaved;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('laneChange', () => {
  it('adds every place chosen for new lanes', () => {
    expect(
      laneChange(null, { origin: 'CA-AB', destinations: ['US-MT', 'US-ND'], transport: 'truck' }),
    ).toEqual({
      add: [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck' },
        { origin: 'CA-AB', destination: 'US-ND', transport: 'truck' },
      ],
      remove: [],
    });
  });

  it('removes the places left out of an edited group', () => {
    const before = {
      origin: 'CA-AB',
      transport: 'truck' as const,
      destinations: ['US-MT', 'US-ND'],
    };
    expect(
      laneChange(before, { origin: 'CA-AB', destinations: ['US-MT'], transport: 'rail' }),
    ).toEqual({
      add: [{ origin: 'CA-AB', destination: 'US-MT', transport: 'rail' }],
      remove: [{ origin: 'CA-AB', destination: 'US-ND' }],
    });
  });

  it('removes every old lane when the starting place changes', () => {
    const before = { origin: 'CA-AB', transport: 'truck' as const, destinations: ['US-MT'] };
    expect(
      laneChange(before, { origin: 'CA-SK', destinations: ['US-MT'], transport: 'truck' }),
    ).toEqual({
      add: [{ origin: 'CA-SK', destination: 'US-MT', transport: 'truck' }],
      remove: [{ origin: 'CA-AB', destination: 'US-MT' }],
    });
  });
});

describe('isCrossBorder', () => {
  it('is true when a lane or a freight rate crosses the border', () => {
    expect(isCrossBorder(DETAIL)).toBe(true);
    expect(isCrossBorder({ lanes: [], quotedLanes: [] })).toBe(false);
    expect(
      isCrossBorder({
        lanes: [
          {
            origin: 'CA-AB',
            destination: 'CA-SK',
            transport: 'truck',
            verifiedAt: '2026-10-30T12:00:00.000Z',
          },
        ],
        quotedLanes: [{ origin: 'CA-MB', destination: 'US-MN', transport: 'rail' }],
      }),
    ).toBe(true);
  });
});

describe('CarrierLanes', () => {
  it('lists lanes by where they start and how, and the freight rates’ other lanes', () => {
    show('viewer');
    const lanes = screen.getByRole('list', { name: 'Lanes' });
    expect(
      within(lanes)
        .getAllByRole('listitem')
        .map((item) => item.textContent.replace(/\s+/g, ' ')),
    ).toEqual([
      'From Alberta to SaskatchewanRail',
      'From Alberta to Montana, North DakotaTruckCross-border',
    ]);
    // Alberta → Montana is already a lane; only Manitoba → Minnesota is added from the rates.
    const quoted = screen.getByRole('list', { name: 'Lanes from its freight rates' });
    expect(within(quoted).getAllByRole('listitem')).toHaveLength(1);
    expect(quoted).toHaveTextContent('Manitoba to Minnesota · Rail and truck');
    // A viewer only reads.
    expect(screen.queryByRole('button', { name: 'Add lanes' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add Manitoba/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit lanes/ })).toBeNull();
  });

  it('says so when there are none', () => {
    show('trader', { ...DETAIL, lanes: [], quotedLanes: [] });
    expect(screen.getByText(/No lanes yet\./)).toHaveTextContent(
      'No lanes yet. Add where this carrier loads and where it delivers.',
    );
  });

  it('adds lanes from one place to several, by truck, rail or both', async () => {
    const calls = mockApi({ [`PATCH /counterparties/${ID}/lanes`]: () => Response.json(DETAIL) });
    const onSaved = show('trader', { ...DETAIL, lanes: [], quotedLanes: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Add lanes' }));
    const form = screen.getByRole('form', { name: 'New lanes' });
    // Nothing chosen yet.
    await userEvent.click(within(form).getByRole('button', { name: 'Save lanes' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('Choose where the lanes start.');

    await userEvent.click(within(form).getByRole('button', { name: 'From' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search the list' }), 'alberta');
    await userEvent.click(screen.getByRole('option', { name: 'Alberta' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save lanes' }));
    expect(within(form).getByRole('alert')).toHaveTextContent(
      'Choose at least one place they go to.',
    );

    await userEvent.click(within(form).getByRole('button', { name: 'To: None' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Montana' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'North Dakota' }));
    await userEvent.keyboard('{Escape}');
    expect(form).toHaveTextContent('Montana, North Dakota');
    await userEvent.click(within(form).getByRole('button', { name: 'Rail and truck' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save lanes' }));

    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      add: [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'rail_and_truck' },
        { origin: 'CA-AB', destination: 'US-ND', transport: 'rail_and_truck' },
      ],
      remove: [],
    });
    expect(onSaved).toHaveBeenCalledWith('Lanes saved.');
  });

  it('leaves truck or rail out unless chosen, and shows no badge for it', async () => {
    const calls = mockApi({ [`PATCH /counterparties/${ID}/lanes`]: () => Response.json(DETAIL) });
    show('trader', {
      ...DETAIL,
      lanes: [
        {
          origin: 'CA-SK',
          destination: 'US-ND',
          transport: null,
          verifiedAt: '2026-10-30T12:00:00.000Z',
        },
      ],
      quotedLanes: [],
    });
    const list = screen.getByRole('list', { name: 'Lanes' });
    expect(list.textContent.replace(/\s+/g, ' ')).toBe(
      'From Saskatchewan to North DakotaCross-borderEditRemove',
    );
    expect(
      screen.getByRole('button', {
        name: 'Edit lanes from Saskatchewan, truck or rail not stated',
      }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add lanes' }));
    const form = screen.getByRole('form', { name: 'New lanes' });
    expect(within(form).getByRole('button', { name: 'Not stated' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'From' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Search the list' }), 'manitoba');
    await userEvent.click(screen.getByRole('option', { name: 'Manitoba' }));
    await userEvent.click(within(form).getByRole('button', { name: 'To: None' }));
    await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Minnesota' }));
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(form).getByRole('button', { name: 'Save lanes' }));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      add: [{ origin: 'CA-MB', destination: 'US-MN', transport: null }],
      remove: [],
    });
  });

  it('removes one starting place’s lanes after asking', async () => {
    const calls = mockApi({ [`PATCH /counterparties/${ID}/lanes`]: () => Response.json(DETAIL) });
    const onSaved = show('operations');
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove lanes from Alberta, by truck' }),
    );
    const confirm = screen.getByRole('group', { name: 'Remove lanes from Alberta' });
    expect(confirm).toHaveTextContent('Remove the lanes from Alberta to Montana, North Dakota?');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      add: [],
      remove: [
        { origin: 'CA-AB', destination: 'US-MT' },
        { origin: 'CA-AB', destination: 'US-ND' },
      ],
    });
    expect(onSaved).toHaveBeenCalledWith('Lanes removed.');
  });

  it('adds a lane from its freight rates with one click', async () => {
    const calls = mockApi({ [`PATCH /counterparties/${ID}/lanes`]: () => Response.json(DETAIL) });
    show('trader');
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Manitoba to Minnesota to its lanes' }),
    );
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      add: [{ origin: 'CA-MB', destination: 'US-MN', transport: 'rail_and_truck' }],
      remove: [],
    });
  });

  it('shows the API’s refusal', async () => {
    mockApi({
      [`PATCH /counterparties/${ID}/lanes`]: () =>
        Response.json(
          {
            error: {
              code: 'ARCHIVED',
              message: 'This counterparty is archived. Restore it before changing it.',
            },
          },
          { status: 409 },
        ),
    });
    const onSaved = show('trader');
    await userEvent.click(
      screen.getByRole('button', { name: 'Add Manitoba to Minnesota to its lanes' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('This counterparty is archived.');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('shows lanes from a spreadsheet unverified, and a rep verifies one after calling', async () => {
    const calls = mockApi({ [`PATCH /counterparties/${ID}/lanes`]: () => Response.json(DETAIL) });
    const onSaved = show('trader', {
      ...DETAIL,
      lanes: [
        { origin: 'CA-AB', destination: 'US-MT', transport: 'truck', verifiedAt: null },
        {
          origin: 'CA-AB',
          destination: 'US-ND',
          transport: 'truck',
          verifiedAt: '2026-10-30T12:00:00.000Z',
        },
      ],
      quotedLanes: [],
    });
    const places = screen.getByRole('list', { name: 'Places from Alberta' });
    expect(places).toHaveTextContent('MontanaNorth Dakota');
    await userEvent.click(
      within(places).getByRole('button', {
        name: 'Montana, not verified: verify Alberta to Montana',
      }),
    );
    // The verified one is not a button.
    expect(within(places).queryByRole('button', { name: /North Dakota/ })).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: 'Verify Alberta to Montana?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Verify' }));
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      add: [],
      remove: [],
      verify: [{ origin: 'CA-AB', destination: 'US-MT' }],
    });
    expect(onSaved).toHaveBeenCalledWith('Alberta to Montana verified.');
  });

  it('shows a viewer the unverified lanes without a way to verify them', () => {
    show('viewer', {
      ...DETAIL,
      lanes: [{ origin: 'CA-AB', destination: 'US-MT', transport: null, verifiedAt: null }],
      quotedLanes: [],
    });
    const places = screen.getByRole('list', { name: 'Places from Alberta' });
    expect(places).toHaveTextContent('Montana (not verified)');
    expect(within(places).queryByRole('button')).toBeNull();
  });

  it('cannot be changed on an archived carrier', () => {
    show('org_admin', { ...DETAIL, archivedAt: '2026-10-30T12:00:00.000Z' });
    expect(screen.queryByRole('button', { name: 'Add lanes' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove lanes/ })).toBeNull();
  });
});
