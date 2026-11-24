import { gzipSync } from 'node:zlib';

import { GEOLOGY_GRID_ABSENT, encodeGeologyGrid, fromMercator, toMercator } from '@grain/domain';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  geologyTip,
  gridBytes,
  sampleFeatures,
  sampleTip,
  useGeologyMaps,
  type PlaySample,
  type PlaySamplesAnswer,
} from './GeologyMaps';

// The Geology section (F-287 parts 3 and 4): the Duvernay's depth or thickness from the Survey's model,
// or its samples by maturity window, off when the map opens. A made-up grid of two squares and
// made-up samples only.

const [WEST, NORTH] = toMercator(-116, 54);
const GRID = {
  columns: 2,
  rows: 1,
  west: WEST,
  north: NORTH,
  cell: 1770,
  depth: Int16Array.from([3093, GEOLOGY_GRID_ABSENT]),
  thickness: Int16Array.from([573, GEOLOGY_GRID_ABSENT]),
};
const LINES = { type: 'FeatureCollection', features: [] };
/** A place inside the first square. */
const [LON, LAT] = fromMercator(WEST + 100, NORTH - 100);

const ORG = '00000000-0000-4000-8000-000000000001';

const SAMPLE: PlaySample = {
  sampleId: 4321,
  run: 1,
  uwi: '00/01-01-060-20W5/0',
  site: 'well',
  longitude: -116.8,
  latitude: 54.4,
  unit: 'Duvernay',
  lithology: 'shale',
  depthM: '3050.20',
  collectedOn: null,
  tmaxC: '450',
  tocPct: '3.10',
  hydrogenIndex: '120',
  ro: 0.94,
  window: 'oil',
  note: null,
};
const SAMPLES: PlaySamplesAnswer = {
  source: { name: 'Digital Dataset 2013-0003', loadedAt: null, sourceDate: null },
  play: { key: 'duvernay', name: 'Duvernay / Muskwa' },
  samples: [
    SAMPLE,
    {
      ...SAMPLE,
      sampleId: 4322,
      uwi: null,
      site: 'outcrop',
      depthM: null,
      ro: null,
      window: null,
      note: 'no-tmax',
      tmaxC: null,
      tocPct: null,
      hydrogenIndex: null,
    },
  ],
};

function Harness() {
  const geology = useGeologyMaps(ORG, 'token');
  return (
    <div>
      {geology.section({ open: true, onToggle: () => undefined })}
      <output data-testid="tip">{geology.tipAt?.(LON, LAT) ?? 'none'}</output>
      <output data-testid="view">
        {geology.view
          ? (geology.view.shading?.measure ??
            `dots ${String(geology.view.samples?.features.length)}`)
          : 'off'}
      </output>
      <div data-testid="legend">{geology.legend()}</div>
      {geology.about()}
    </div>
  );
}

function answer(url: string): Response {
  if (url === '/geology/duvernay-grid.bin') {
    return new Response(gzipSync(encodeGeologyGrid(GRID)));
  }
  if (url.startsWith('/geology/duvernay-')) return Response.json(LINES);
  if (url === `/api/v1/petroleum/geology/samples?play=duvernay&organization_id=${ORG}`) {
    return Response.json(SAMPLES);
  }
  return new Response(null, { status: 404 });
}

beforeEach(() => {
  // jsdom draws no pictures: a stand-in canvas that keeps nothing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
        putImageData: () => undefined,
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the words at the pointer', () => {
  it('gives the depth and the thickness, or what there is', () => {
    expect(geologyTip('Duvernay / Muskwa', { depthM: 3093, thicknessM: 57.3 })).toBe(
      'Duvernay / Muskwa top 3,093 m deep, 57 m thick',
    );
    expect(geologyTip('D', { depthM: 3093, thicknessM: null })).toBe('D top 3,093 m deep');
    expect(geologyTip('D', { depthM: null, thicknessM: null })).toBeNull();
    expect(geologyTip('D', null)).toBeNull();
  });
});

describe('the grid file', () => {
  it('is gunzipped, or taken as it is when a server already has', async () => {
    const plain = encodeGeologyGrid(GRID);
    expect(await gridBytes(new Response(gzipSync(plain)))).toEqual(plain);
    expect(await gridBytes(new Response(plain))).toEqual(plain);
  });
});

describe('the Geology section', () => {
  it('asks for nothing until switched on, then shades the depth with its scale', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(answer(url)));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('view')).toHaveTextContent('off');

    await userEvent.click(screen.getByRole('switch', { name: 'Geology' }));
    expect(screen.getByText('Duvernay / Muskwa')).toBeInTheDocument();
    await screen.findByText(/contour lines every 250 m/);
    expect(screen.getByTestId('view')).toHaveTextContent('depth');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/geology/duvernay-grid.bin',
      '/geology/duvernay-depth.geojson',
    ]);
    expect(
      screen.getByText('Depth from the ground to the top, contour lines every 250 m'),
    ).toBeInTheDocument();
    // 3,093 m widened to whole steps of 250 m.
    expect(screen.getAllByText('3,000 m').length).toBeGreaterThan(0);
    expect(screen.getAllByText('3,250 m').length).toBeGreaterThan(0);
    expect(screen.getByTestId('legend')).toHaveTextContent('Duvernay / Muskwa depth');
    expect(screen.getByTestId('tip')).toHaveTextContent(
      'Duvernay / Muskwa top 3,093 m deep, 57 m thick',
    );
    expect(screen.getByText(/Geological Framework of Alberta, Version 4/)).toBeInTheDocument();
  });

  it('shows the thickness with its own lines, the grid asked for once', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(answer(url)));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);
    await userEvent.click(screen.getByRole('switch', { name: 'Geology' }));
    await screen.findByText(/contour lines every 250 m/);
    await userEvent.click(screen.getByRole('button', { name: 'Thickness' }));
    expect(
      await screen.findByText('Vertical thickness, contour lines every 25 m'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('view')).toHaveTextContent('thickness');
    expect(screen.getByTestId('legend')).toHaveTextContent('Duvernay / Muskwa thickness');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/geology/duvernay-grid.bin',
      '/geology/duvernay-depth.geojson',
      '/geology/duvernay-thickness.geojson',
    ]);
  });

  it('says so when the map cannot be loaded, and draws nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    );
    render(<Harness />);
    await userEvent.click(screen.getByRole('switch', { name: 'Geology' }));
    expect(
      await screen.findByText('The map could not be loaded. Try again later.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('view')).toHaveTextContent('off');
    expect(screen.getByTestId('tip')).toHaveTextContent('none');
  });
});

describe('the samples (F-287 part 4)', () => {
  it('gives each sample its box and its colour', () => {
    expect(sampleTip(SAMPLE)).toBe(
      'Sample 4321 · Duvernay · 3,050 m\nOil window · Ro 0.94% · Tmax 450 °C\nTOC 3.1% · HI 120\n00/01-01-060-20W5/0',
    );
    const none = SAMPLES.samples[1];
    if (!none) throw new Error('no sample');
    expect(sampleTip(none)).toBe('Sample 4322 · Duvernay · outcrop\nNo window: no Tmax');
    expect(sampleTip({ ...none, note: 'small-s2', ro: 0.94, tmaxC: '450' })).toBe(
      'Sample 4322 · Duvernay · outcrop\nNo window: S2 too small to read Tmax · Ro 0.94% · Tmax 450 °C',
    );
    const dots = sampleFeatures(SAMPLES.samples);
    expect(dots.features.map((f) => f.properties?.colour as unknown)).toEqual([
      '#15803d',
      '#e5e7eb',
    ]);
    expect(dots.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [-116.8, 54.4] });
  });

  it('asks for the samples only on Maturity, then shows them by window', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(answer(url)));
    vi.stubGlobal('fetch', fetchMock);
    render(<Harness />);
    await userEvent.click(screen.getByRole('switch', { name: 'Geology' }));
    await screen.findByText(/contour lines every 250 m/);
    expect(fetchMock.mock.calls.map(([url]) => url)).not.toContain(
      `/api/v1/petroleum/geology/samples?play=duvernay&organization_id=${ORG}`,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Maturity' }));
    expect(
      await screen.findByText(
        '2 measured samples of the Duvernay and the Muskwa, by maturity window',
      ),
    ).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/geology/duvernay-grid.bin',
      '/geology/duvernay-depth.geojson',
      `/api/v1/petroleum/geology/samples?play=duvernay&organization_id=${ORG}`,
    ]);
    expect(screen.getByTestId('view')).toHaveTextContent('dots 2');
    // No squares' words on Maturity: a dot's own box answers.
    expect(screen.getByTestId('tip')).toHaveTextContent('none');
    expect(screen.getByTestId('legend')).toHaveTextContent('Duvernay / Muskwa maturity');
    expect(screen.getByTestId('legend')).toHaveTextContent('Oil window');
    expect(screen.getByText(/Digital Dataset 2013-0003/)).toBeInTheDocument();
  });

  it('says so when the samples cannot be loaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    );
    render(<Harness />);
    await userEvent.click(screen.getByRole('switch', { name: 'Geology' }));
    await userEvent.click(screen.getByRole('button', { name: 'Maturity' }));
    expect(
      await screen.findByText('The samples could not be loaded. Try again later.'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('view')).toHaveTextContent('off');
  });
});
