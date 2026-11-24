import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import { clearGeology, WellGeology, type GeologyAnswer } from './WellGeology';

// A well's Geology section (F-287 part 2). Made-up wells, picks and samples only.

const UWI = '00/11-23-030-27W4/0';
const PATH = `GET /petroleum/geology/well?organization_id=org-a&uwi=${encodeURIComponent(UWI)}`;
const props = { organizationId: 'org-a', token: 't', uwi: UWI };

const pick = (name: string, zone: number, tvdM: number, source: 'Survey' | 'AER' = 'Survey') => ({
  name,
  zone,
  tvdM,
  elevationM: null,
  source,
});

const ANSWER: GeologyAnswer = {
  source: {
    picks: { name: 'Survey picks', loadedAt: '2030-01-02T00:00:00.000Z', sourceDate: '2026-10-31' },
    samples: { name: 'Survey samples', loadedAt: '2030-01-02T00:00:00.000Z', sourceDate: null },
    model: { name: 'Survey model', loadedAt: '2030-01-01T00:00:00.000Z' },
  },
  play: { key: 'duvernay', zone: 68, name: 'Duvernay / Muskwa' },
  zoneHere: { topDepthM: 3000, topElevationM: -2200, thicknessM: 57 },
  legs: [{ uwi: UWI, points: 4, inside: 3, belowTopM: 28, aboveBaseM: 26 }],
  picked: [
    {
      uwi: '00/01-24-030-27W4/0',
      own: false,
      distanceKm: 1.3,
      picks: [
        pick('Mannville Group top', 46, 1500),
        pick('Ireton Formation top', 67, 3010.5),
        pick('Duvernay Formation top', 68, 3030, 'AER'),
      ],
    },
  ],
  samples: [
    {
      sampleId: 7,
      run: 1,
      uwi: null,
      own: false,
      distanceKm: 12.4,
      unit: 'Duvernay',
      lithology: 'shale',
      depthM: '3050.00',
      collectedOn: null,
      tmaxC: '460',
      tocPct: '4.25',
      hydrogenIndex: '120',
      ro: 1.12,
      window: 'condensate',
      note: null,
    },
    {
      sampleId: 8,
      run: 1,
      uwi: UWI,
      own: true,
      distanceKm: 0,
      unit: 'Majeau Lake',
      lithology: 'shale',
      depthM: null,
      collectedOn: null,
      tmaxC: '455',
      tocPct: '1',
      hydrogenIndex: null,
      ro: 1.03,
      window: null,
      note: 'small-s2',
    },
  ],
  reach: { picksKm: 5, samplesKm: 50 },
};

afterEach(() => {
  clearGeology();
  vi.unstubAllGlobals();
});

describe('the geology section', () => {
  it("shows the play's depth, thickness and the lateral in it", async () => {
    mockApi({ [PATH]: () => Response.json(ANSWER) });
    render(<WellGeology {...props} />);
    expect(screen.getByText('Geology: loading…')).toBeInTheDocument();
    expect(await screen.findByText('3,000 m')).toBeInTheDocument();
    expect(screen.getByText('57 m')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Lateral on average 28 m under the top and 26 m over the base (1 of 4 points outside the zone).',
      ),
    ).toBeInTheDocument();
  });

  it('gives the nearest picked well when none was picked in this one, the play first', async () => {
    mockApi({ [PATH]: () => Response.json(ANSWER) });
    render(<WellGeology {...props} />);
    expect(
      await screen.findByText(/None in this well; in the nearest picked well/),
    ).toBeInTheDocument();
    expect(screen.getByText('1.3 km away:', { exact: false })).toBeInTheDocument();
    // The play's zone and its neighbours first; the Mannville only under All 3 tops.
    expect(screen.getAllByText('Duvernay Formation top')).toHaveLength(2);
    expect(screen.getAllByText('3,030 m TVD · AER', { exact: false })).toHaveLength(2);
    expect(screen.getByText('All 3 tops')).toBeInTheDocument();
    expect(screen.getAllByText('Mannville Group top')).toHaveLength(1);
  });

  it("shows each sample's window, and says when its Tmax cannot be read", async () => {
    mockApi({ [PATH]: () => Response.json(ANSWER) });
    render(<WellGeology {...props} />);
    expect(await screen.findByText('Wet gas and condensate')).toBeInTheDocument();
    expect(
      screen.getByText(/Duvernay · 12.4 km away · Tmax 460 °C · Ro 1.12% \(calc.\) · TOC 4.25%/),
    ).toBeInTheDocument();
    expect(screen.getByText('No window')).toBeInTheDocument();
    expect(screen.getByText(/in this well .* S2 too small to read Tmax/)).toBeInTheDocument();
  });

  it('says when nothing is loaded, and when the answer could not be read', async () => {
    mockApi({
      [PATH]: () =>
        Response.json({
          ...ANSWER,
          source: {
            ...ANSWER.source,
            picks: { ...ANSWER.source.picks, loadedAt: null },
            samples: { ...ANSWER.source.samples, loadedAt: null },
          },
        }),
    });
    const { unmount } = render(<WellGeology {...props} />);
    expect(
      await screen.findByText(/not loaded yet: GitHub → Actions → Load geology/),
    ).toBeInTheDocument();
    unmount();
    clearGeology();
    mockApi({ [PATH]: () => new Response('no', { status: 500 }) });
    render(<WellGeology {...props} />);
    expect(await screen.findByText('The geology could not be loaded.')).toBeInTheDocument();
  });
});
