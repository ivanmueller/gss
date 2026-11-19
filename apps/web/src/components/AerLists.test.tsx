import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi, ORG, SESSION } from '../test/api';
import { AER_LICENCES, AER_RIGS, AerPickedCard, useAerLists } from './AerLists';

// The AER's new licences and rigs on the oil and gas map (F-243 part 2): what is asked for and
// when, what is said about the source, and the card of a clicked dot. Made-up values only.

const ORGANIZATION = `organization_id=${encodeURIComponent(ORG.id)}`;
const LICENCES_30 = `/petroleum/aer/licences?days=30&${ORGANIZATION}`;
const LICENCES_90 = `/petroleum/aer/licences?days=90&${ORGANIZATION}`;
const RIGS_7 = `/petroleum/aer/rigs?days=7&${ORGANIZATION}`;

const source = (name: string) => ({
  name,
  preliminary: true,
  latestListDate: '2026-11-17',
  lastSeenAt: '2026-11-18T14:15:00.000Z',
});
const point = (properties: Record<string, unknown>) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-113.5, 53.5] },
  properties,
});
const licences = {
  source: source('Alberta Energy Regulator, ST1 Well Licences Issued – Daily List'),
  days: 30,
  located: {
    type: 'FeatureCollection',
    features: [point({ licenceNumber: '0526001', licensee: 'EXAMPLE ENERGY LTD.' })],
  },
  unlocated: 2,
  truncated: false,
};
const rigs = {
  source: source('Alberta Energy Regulator, ST49 Daily Drilling Activity List'),
  days: 7,
  located: { type: 'FeatureCollection', features: [point({ rigNumber: '11' })] },
  unlocated: [{ wellId: 'x' }],
  truncated: false,
};

/** Shows the hook's panel, its overlays and its card, as the map page does. */
function Harness() {
  const aer = useAerLists(ORG.id, SESSION.token);
  return (
    <div>
      {aer.panel}
      <p>{`Drawn: ${aer.overlays.map((o) => o.id).join(' ') || 'nothing'}`}</p>
      <button
        type="button"
        onClick={() => {
          aer.setPicked({
            layerId: AER_RIGS,
            properties: {
              rigNumber: '11',
              wellId: '02/02-27-017-13W4/0',
              activityType: 'Drill to LD',
              activityAt: '2026-11-16T02:30:15.000Z',
              listDate: '2026-11-17',
            },
          });
        }}
      >
        Click a rig
      </button>
      <button
        type="button"
        onClick={() => {
          aer.setPicked({
            layerId: AER_LICENCES,
            properties: { licenceNumber: '0526001', licensee: 'EXAMPLE ENERGY LTD.' },
          });
        }}
      >
        Click a licence
      </button>
      <AerPickedCard state={aer} />
    </div>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the AER lists on the oil and gas map', () => {
  it('asks for nothing until a switch is on, then draws what the Worker placed', async () => {
    const calls = mockApi({
      [`GET ${LICENCES_30}`]: () => Response.json(licences),
      [`GET ${RIGS_7}`]: () => Response.json(rigs),
    });
    render(<Harness />);
    expect(screen.getByText('Drawn: nothing')).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await userEvent.click(screen.getByRole('checkbox', { name: 'New licences' }));
    expect(await screen.findByText(`Drawn: ${AER_LICENCES}`)).toBeInTheDocument();
    expect(screen.getByText('1 on the map, 2 not placed yet')).toBeInTheDocument();
    // Always named, dated and marked preliminary, never offered as a download.
    expect(screen.getByText(/Source: Alberta Energy Regulator/)).toHaveTextContent(
      'preliminary. List of 2026-11-17. Not an official record.',
    );
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
    expect(calls.map((c) => c.path)).toEqual([LICENCES_30]);

    await userEvent.click(screen.getByRole('checkbox', { name: 'Rigs' }));
    expect(await screen.findByText(`Drawn: ${AER_LICENCES} ${AER_RIGS}`)).toBeInTheDocument();
    expect(screen.getByText('1 on the map, 1 not placed yet')).toBeInTheDocument();
  });

  it('asks again for another period, and stops drawing when switched off', async () => {
    mockApi({
      [`GET ${LICENCES_30}`]: () => Response.json(licences),
      [`GET ${LICENCES_90}`]: () =>
        Response.json({ ...licences, days: 90, unlocated: 0, truncated: true }),
    });
    render(<Harness />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'New licences' }));
    await screen.findByText(`Drawn: ${AER_LICENCES}`);
    await userEvent.click(screen.getByRole('button', { name: '90 days' }));
    expect(await screen.findByText('1 on the map, the newest 5,000 shown')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'New licences' }));
    expect(screen.getByText('Drawn: nothing')).toBeInTheDocument();
  });

  it('says plainly when a list could not be loaded', async () => {
    mockApi({
      [`GET ${LICENCES_30}`]: () =>
        Response.json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'x' } }, { status: 503 }),
    });
    render(<Harness />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'New licences' }));
    expect(
      await screen.findByText('Could not be loaded. Try again in a moment.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Drawn: nothing')).toBeInTheDocument();
  });

  it('shows a clicked rig in Alberta time with its source, and closes', async () => {
    mockApi({});
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Click a rig' }));
    expect(screen.getByText('Rig activity')).toBeInTheDocument();
    expect(screen.getByText('Drill to LD')).toBeInTheDocument();
    // 02:30:15 UTC on the 16th is 8:30 PM on the 15th in Alberta (UTC−6).
    expect(screen.getByText('2026-11-15T20:30')).toBeInTheDocument();
    expect(screen.getByText(/Alberta Energy Regulator, preliminary/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByText('Rig activity')).not.toBeInTheDocument();
    });
  });

  it('shows a clicked licence', async () => {
    mockApi({});
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Click a licence' }));
    expect(screen.getByText('New well licence')).toBeInTheDocument();
    expect(screen.getByText('EXAMPLE ENERGY LTD.')).toBeInTheDocument();
  });
});
