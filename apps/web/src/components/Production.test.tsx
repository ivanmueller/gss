import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import {
  clearProductionCache,
  FormationProduction,
  FormationProductionAbout,
  monthLabel,
  productSeries,
  seriesPath,
  volumeText,
  WellProduction,
  type ProductionAnswer,
} from './Production';

// Monthly production on the oil and gas map (F-252 step 3). Made-up volumes only.

const SOURCE = {
  name: 'Petrinex public data, Conventional Volumetric Data, © Government of Alberta',
  loadedAt: '2026-11-20T22:00:00.000Z',
  firstMonth: '2026-06',
  lastMonth: '2026-09',
};
const WELL: ProductionAnswer = {
  source: SOURCE,
  months: [
    { month: '2026-06', oil: 400, gas: 90.5, water: null, condensate: null, hours: 700 },
    // No line in July: the well reported nothing that month.
    { month: '2026-08', oil: 310.5, gas: 80, water: null, condensate: null, hours: 744 },
    { month: '2026-09', oil: 250, gas: 70, water: null, condensate: null, hours: 720 },
  ],
};
const UWI = '00/11-23-030-27W4/2';
const WELL_PATH = `GET /petroleum/production/well?organization_id=org-a&uwi=${encodeURIComponent(UWI)}`;
const FORMATION_PATH = 'GET /petroleum/production/formation?organization_id=org-a';

afterEach(() => {
  clearProductionCache();
  vi.unstubAllGlobals();
});

describe('reading the months', () => {
  it('lays a product over every month of the load, empty where there is no line', () => {
    const oil = productSeries(WELL, 'oil');
    expect(oil.months).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(oil.values).toEqual([400, null, 310.5, 250]);
    expect(oil.total).toBe(960.5);
    expect(oil.any).toBe(true);
    expect(productSeries(WELL, 'water').any).toBe(false);
  });

  it('breaks the line where a month has no value', () => {
    const path = seriesPath([400, null, 200, 0], 400);
    // Two pen-downs: before and after the empty month; the highest month near the top.
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path.startsWith('M0 2')).toBe(true);
    expect(path.endsWith('L260 39')).toBe(true);
  });

  it('draws a month alone between empty ones as a dot', () => {
    expect(seriesPath([null, 400, null, 200, 100], 400)).toBe('M65 2L65 2M195 20.5L260 29.8');
  });

  it('writes months and volumes for reading', () => {
    expect(monthLabel('2026-08')).toBe('Aug 2026');
    expect(volumeText(310.5)).toBe('311');
    expect(volumeText(12.345)).toBe('12.3');
    expect(volumeText(123456)).toBe('123,456');
  });
});

describe('WellProduction', () => {
  const props = { uwi: UWI, organizationId: 'org-a', token: 'token' };

  it("shows a chart per product the well has, its latest month, and Petrinex's credit", async () => {
    mockApi({ [WELL_PATH]: () => Response.json(WELL) });
    render(<WellProduction {...props} spudDate="2026-06-02" />);
    expect(screen.getByText('Production: loading…')).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: /^Oil, m³ a month, Jun 2026 to Sep 2026/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Gas, 10³ m³ a month/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /^Water/ })).not.toBeInTheDocument();
    expect(screen.getByText('250')).toBeInTheDocument();
    // The source is named in the panel's About this data, not on every card.
    expect(screen.queryByText(/Petrinex/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Incomplete/)).not.toBeInTheDocument();
  });

  it('says the history is incomplete for a well drilled before the first month loaded', async () => {
    mockApi({ [WELL_PATH]: () => Response.json(WELL) });
    render(<WellProduction {...props} spudDate="2019-03-10" />);
    expect(await screen.findByText(/Incomplete: only from Jun 2026/)).toBeInTheDocument();
  });

  it('says so when the well reported nothing, and shows nothing before any load', async () => {
    mockApi({ [WELL_PATH]: () => Response.json({ source: SOURCE, months: [] }) });
    const first = render(<WellProduction {...props} spudDate={null} />);
    expect(await screen.findByText('No production reported since Jun 2026.')).toBeInTheDocument();
    first.unmount();
    clearProductionCache();
    mockApi({
      [WELL_PATH]: () =>
        Response.json({ source: { ...SOURCE, loadedAt: null, firstMonth: null }, months: [] }),
    });
    const { container } = render(<WellProduction {...props} spudDate={null} />);
    await vi.waitFor(() => {
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('says so when it cannot be loaded', async () => {
    mockApi({});
    render(<WellProduction {...props} spudDate={null} />);
    expect(await screen.findByText('Production could not be loaded.')).toBeInTheDocument();
  });
});

describe('FormationProduction', () => {
  it('shows the total by month, and the month pointed at in every chart', async () => {
    mockApi({
      [FORMATION_PATH]: () =>
        Response.json({
          source: SOURCE,
          months: [
            { month: '2026-06', oil: 1000, gas: 5000, water: 300, condensate: 50, wells: 10 },
            { month: '2026-07', oil: 1100, gas: 5100, water: 310, condensate: 55, wells: 11 },
            { month: '2026-08', oil: 1200, gas: 5200, water: 320, condensate: 60, wells: 12 },
            { month: '2026-09', oil: 1300, gas: 5300, water: 330, condensate: 65, wells: 12 },
          ],
        }),
    });
    render(<FormationProduction name="Duvernay" organizationId="org-a" token="token" />);
    const oil = await screen.findByRole('img', { name: /^Oil, m³ a month/ });
    expect(screen.getByText('Duvernay production')).toBeInTheDocument();
    // What it shows and its source are in the panel's About this data.
    expect(screen.queryByText(/Petrinex/)).not.toBeInTheDocument();
    render(<FormationProductionAbout organizationId="org-a" token="token" />);
    expect(
      screen.getByText(
        /Production: the total of the wells loaded, by month, Jun 2026 to Sep 2026; 12 wells in the last month\. Point at a chart for a month\. Petrinex public data, Conventional Volumetric Data, © Government of Alberta\. Not an official record\./,
      ),
    ).toBeInTheDocument();
    // The latest month until a month is pointed at.
    expect(screen.getByText('1,300')).toBeInTheDocument();
    oil.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
    fireEvent.pointerMove(oil, { clientX: 100 });
    expect(screen.getByText('1,100')).toBeInTheDocument();
    expect(screen.getByText('5,100')).toBeInTheDocument();
    fireEvent.pointerLeave(oil);
    expect(screen.getByText('5,300')).toBeInTheDocument();
  });

  it('shows nothing until production is loaded', async () => {
    const calls = mockApi({
      [FORMATION_PATH]: () => Response.json({ source: { ...SOURCE, loadedAt: null }, months: [] }),
    });
    const { container } = render(
      <FormationProduction name="Duvernay" organizationId="org-a" token="token" />,
    );
    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(container).toBeEmptyDOMElement();
  });
});
