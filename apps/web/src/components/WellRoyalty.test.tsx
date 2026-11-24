import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import type { PricesAnswer } from './Prices';
import { clearProductionCache, type ProductionAnswer } from './Production';
import { clearFrac } from './WellFrac';
import { clearRoyaltyPrices, WellRoyalty } from './WellRoyalty';

// A well's estimated Crown royalty on its panel (F-285 part 4). Made-up wells and prices only.

const UWI = '00/11-23-030-27W4/2';
const WELL_PATH = `GET /petroleum/production/well?organization_id=org-a&uwi=${encodeURIComponent(UWI)}`;
const PRICES_PATH = 'GET /petroleum/prices?organization_id=org-a';

const PRODUCTION: ProductionAnswer = {
  source: {
    name: 'Petrinex',
    loadedAt: '2026-11-20T22:00:00.000Z',
    firstMonth: '2022-01',
    lastMonth: '2026-06',
  },
  months: [{ month: '2026-06', oil: 150, gas: null, water: 3, condensate: null, hours: 720 }],
};
const PRICES: PricesAnswer = {
  load: null,
  sources: ['https://www.alberta.ca/'],
  series: [
    {
      key: 'oil_light_par',
      name: 'Light oil par price',
      unit: '$/m3',
      points: [['2026-06', '389.61', 0]],
    },
  ],
};

afterEach(() => {
  clearProductionCache();
  clearRoyaltyPrices();
  clearFrac();
  vi.unstubAllGlobals();
});

const props = { uwis: [UWI], organizationId: 'org-a', token: 't', licence: '0999999' };
const FRAC_PATH = 'GET /petroleum/frac/licence?organization_id=org-a&licence=0999999';
const FRAC = {
  source: {
    name: 'Alberta Energy Regulator',
    page: 'https://www.aer.ca/',
    loadedAt: '2026-11-20T00:00:00.000Z',
    sourceDate: '2026-11-16',
  },
  wells: [
    {
      uwi: UWI,
      firstFracDate: '2023-10-01',
      lastFracDate: '2023-10-10',
      fracs: 1,
      stages: 30,
      waterM3: '40000',
      proppantT: '4000',
      upgradeHintT: '0',
      refracProppantT: '0',
      maxTvdM: '2233',
      suspect: false,
    },
  ],
};

describe('the royalty section', () => {
  it('shows the effective rate, the royalty and the rules of an older well', async () => {
    mockApi({
      [WELL_PATH]: () => Response.json(PRODUCTION),
      [PRICES_PATH]: () => Response.json(PRICES),
    });
    render(
      <WellRoyalty
        well={{ spudDate: '2012-05-01', totalDepthM: 1800, trueVerticalDepthM: 1700 }}
        {...props}
      />,
    );
    expect(screen.getByText('Royalty: loading…')).toBeInTheDocument();
    expect(await screen.findByText('21.9%')).toBeInTheDocument();
    expect(screen.getByText('Jun 2026: oil 21.9%.')).toBeInTheDocument();
    // The rules and what is assumed are behind More info, closed at first.
    for (const text of [/^Under the earlier rules/, /^An estimate, as if all Crown land/]) {
      const details = screen.getByText(text).closest('details');
      expect(details).not.toHaveAttribute('open');
      expect(details?.querySelector('summary')).toHaveTextContent('More info');
    }
    expect(screen.getByText(/37\.3 GJ per 10³ m³/)).toBeInTheDocument();
  });

  it('says a newer well is waiting on frac data', async () => {
    mockApi({
      [WELL_PATH]: () => Response.json(PRODUCTION),
      [PRICES_PATH]: () => Response.json(PRICES),
    });
    render(
      <WellRoyalty
        well={{ spudDate: '2023-09-03', totalDepthM: 5846, trueVerticalDepthM: 2233 }}
        {...props}
      />,
    );
    // With nothing estimated, the reason stays in view, not behind More info.
    const reason = await screen.findByText(/^Royalty estimate waiting on frac data/);
    expect(reason.closest('details')).toBeNull();
    expect(screen.queryByText('Effective rate')).not.toBeInTheDocument();
  });

  it('works out a newer well from its frac data: 5% while below its C*', async () => {
    mockApi({
      [WELL_PATH]: () => Response.json(PRODUCTION),
      [PRICES_PATH]: () => Response.json(PRICES),
      [FRAC_PATH]: () => Response.json(FRAC),
    });
    render(
      <WellRoyalty
        well={{ spudDate: '2023-09-03', totalDepthM: 5846, trueVerticalDepthM: 2233 }}
        {...props}
      />,
    );
    expect(await screen.findByText('5.0%')).toBeInTheDocument();
    expect(screen.getByText(/still paying 5% until its revenue reaches/)).toBeInTheDocument();
  });

  it('does not use a frac report that reads as a reporting error', async () => {
    mockApi({
      [WELL_PATH]: () => Response.json(PRODUCTION),
      [PRICES_PATH]: () => Response.json(PRICES),
      [FRAC_PATH]: () => Response.json({ ...FRAC, wells: [{ ...FRAC.wells[0], suspect: true }] }),
    });
    render(
      <WellRoyalty
        well={{ spudDate: '2023-09-03', totalDepthM: 5846, trueVerticalDepthM: 2233 }}
        {...props}
      />,
    );
    expect(await screen.findByText(/reads as a reporting error/)).toBeInTheDocument();
  });

  it('says when the prices cannot be read', async () => {
    mockApi({ [WELL_PATH]: () => Response.json(PRODUCTION) });
    render(
      <WellRoyalty
        well={{ spudDate: '2012-05-01', totalDepthM: 1800, trueVerticalDepthM: 1700 }}
        {...props}
      />,
    );
    expect(
      await screen.findByText('The royalty estimate could not be loaded.'),
    ).toBeInTheDocument();
  });
});
