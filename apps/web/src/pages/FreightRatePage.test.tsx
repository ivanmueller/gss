import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { choose } from '../test/select';
import { FREIGHT, FREIGHT_ID, FREIGHT_REVISION_1 } from '../test/freight';
import { FreightRatePage } from './FreightRatePage';

const PATH = `/freight-quotes/${FREIGHT_ID}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FreightRatePage', () => {
  it('shows the route, the current terms and every revision, older ones as superseded', async () => {
    mockApi({ [`GET ${PATH}`]: () => Response.json(FREIGHT) });
    render(<FreightRatePage session={SESSION} id={FREIGHT_ID} />);
    expect(
      await screen.findByRole('heading', { name: /Rail rate · Synthetic Carrier/ }),
    ).toBeInTheDocument();
    const route = screen.getByRole('region', { name: 'Route' });
    expect(route).toHaveTextContent('FromSynthetic SellerSynthetic Elevator, Synthetic City, SK');
    expect(route).toHaveTextContent('ToSynthetic BuyerSynthetic Mill, Synthetic Town, MN');
    expect(within(route).getByRole('link', { name: 'Synthetic Buyer' })).toHaveAttribute(
      'href',
      `/counterparties/${FREIGHT.destination.counterparty.id}`,
    );
    const current = screen.getByRole('region', { name: 'Current terms' });
    expect(current).toHaveTextContent('Revision 2, recorded 2026-10-29 15:00 UTC by Tess Trader');
    expect(current).toHaveTextContent('RateCAD 105.00/MT');
    expect(current).toHaveTextContent('Firm or indicativeIndicative');
    expect(current).toHaveTextContent('What the rate includesNot stated');

    const history = screen.getByRole('table', { name: 'Revision history' });
    const rows = within(history).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('2CAD 105.00/MTIndicative');
    // A rate per load keeps the payload it was quoted with.
    expect(rows[2]).toHaveTextContent(
      '1USD 4200.00/loadFirm · 90.5 MT a loadFuel surcharge included',
    );
    expect(rows[2]).toHaveTextContent('Superseded');
  });

  it('records new terms on the revision on screen, asking for the payload of a rate per load', async () => {
    const calls = mockApi({
      [`GET ${PATH}`]: () => Response.json(FREIGHT),
      [`POST ${PATH}/revisions`]: () => Response.json(FREIGHT, { status: 201 }),
    });
    render(<FreightRatePage session={SESSION} id={FREIGHT_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record new terms' }));
    const form = screen.getByRole('region', { name: 'New terms (revision 3)' });
    const rate = within(form).getByLabelText(/^Rate/);
    expect(rate).toHaveValue('105.00');
    expect(within(form).queryByLabelText(/^Payload of one load/)).toBeNull();
    await userEvent.clear(rate);
    await userEvent.type(rate, '3900');
    await choose(within(form).getByLabelText(/^Unit/), 'per load (truckload or railcar)');
    await userEvent.click(within(form).getByRole('button', { name: 'Save new terms' }));
    expect(
      await within(form).findByText('Payload of one load is required for a rate per load.'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    await userEvent.type(within(form).getByLabelText(/^Payload of one load/), '48000');
    await choose(within(form).getByLabelText(/^Payload unit/), 'pounds');
    await userEvent.click(within(form).getByRole('button', { name: 'Save new terms' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({
        basedOnRevision: 2,
        values: {
          rate: '3900',
          currency: 'CAD',
          rateUnit: 'LOAD',
          payload: '48000',
          payloadUnit: 'LB',
          firmness: 'indicative',
          validUntil: '2099-11-05T22:00:00.000Z',
          quotedAt: '',
          sourceType: 'email',
        },
      });
    });
    expect(
      await screen.findByText('New terms saved. The earlier terms are kept below.'),
    ).toBeInTheDocument();
  });

  it('offers the latest terms when someone recorded newer ones meanwhile', async () => {
    mockApi({
      [`GET ${PATH}`]: () => Response.json(FREIGHT),
      [`POST ${PATH}/revisions`]: () =>
        Response.json(
          {
            error: { code: 'QUOTE_CHANGED', message: 'Someone recorded new terms.' },
            currentRevision: 3,
          },
          { status: 409 },
        ),
    });
    render(<FreightRatePage session={SESSION} id={FREIGHT_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Record new terms' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save new terms' }));
    expect(await screen.findByText('Someone recorded new terms.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Load the latest terms' }));
    expect(await screen.findByRole('region', { name: 'Current terms' })).toBeInTheDocument();
  });

  it('withdraws after a confirmation', async () => {
    let withdrawn = false;
    const calls = mockApi({
      [`GET ${PATH}`]: () =>
        Response.json(
          withdrawn
            ? {
                ...FREIGHT,
                status: 'withdrawn',
                withdrawnAt: '2026-10-29T17:00:00.000Z',
                withdrawnByName: 'Olivia Operations',
              }
            : FREIGHT,
        ),
      [`POST ${PATH}/withdraw`]: () => {
        withdrawn = true;
        return Response.json(FREIGHT);
      },
    });
    render(
      <FreightRatePage
        session={{ ...SESSION, organization: { ...ORG, role: 'operations' } }}
        id={FREIGHT_ID}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const confirm = screen.getByRole('group', { name: 'Withdraw this freight rate' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Withdraw' }));
    expect(
      await screen.findByText(/on 2026-10-29 17:00 UTC by Olivia Operations/),
    ).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Record new terms' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Last terms' })).toBeInTheDocument();
  });

  it('says when a rate expired, and offers no changes to viewers or analysts', async () => {
    mockApi({
      [`GET ${PATH}`]: () =>
        Response.json({
          ...FREIGHT,
          status: 'expired',
          current: { ...FREIGHT_REVISION_1, validUntil: '2026-10-29T15:00:00.000Z' },
        }),
    });
    render(
      <FreightRatePage
        session={{ ...SESSION, organization: { ...ORG, role: 'analyst' } }}
        id={FREIGHT_ID}
      />,
    );
    expect(await screen.findByText(/at 2026-10-29 15:00 UTC\. It is not live/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record new terms' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('says when the carrier is archived and offers no changes', async () => {
    mockApi({
      [`GET ${PATH}`]: () =>
        Response.json({ ...FREIGHT, carrier: { ...FREIGHT.carrier, archived: true } }),
    });
    render(<FreightRatePage session={SESSION} id={FREIGHT_ID} />);
    expect(await screen.findByText(/The carrier is archived/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record new terms' })).toBeNull();
  });

  it('says when the rate does not exist', async () => {
    mockApi({});
    render(<FreightRatePage session={SESSION} id={FREIGHT_ID} />);
    expect(await screen.findByText('This freight rate does not exist.')).toBeInTheDocument();
  });
});
