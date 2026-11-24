import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockApi } from '../test/api';
import type { FracAnswer } from '../lib/wellRoyalty';
import { clearFrac, WellFrac } from './WellFrac';

// A well's fracs on its panel (F-288). Made-up wells only.

const PATH = 'GET /petroleum/frac/licence?organization_id=org-a&licence=0999999';
const SOURCE = {
  name: 'Alberta Energy Regulator',
  page: 'https://www.aer.ca/',
  loadedAt: '2026-11-20T00:00:00.000Z',
  sourceDate: '2026-11-16',
};
const LEG = {
  uwi: '00/11-23-030-27W4/0',
  firstFracDate: '2023-10-01',
  lastFracDate: '2023-10-10',
  fracs: 1,
  stages: 30,
  waterM3: '40000.5',
  proppantT: '4000.25',
  upgradeHintT: '1000',
  refracProppantT: '0',
  maxTvdM: '2233',
  suspect: false,
};
const props = { organizationId: 'org-a', token: 't', licence: '0999999' };

afterEach(() => {
  clearFrac();
  vi.unstubAllGlobals();
});

describe('the frac section', () => {
  it("shows the licence's legs together, and names the AER", async () => {
    const answer: FracAnswer = {
      source: SOURCE,
      wells: [
        LEG,
        {
          ...LEG,
          uwi: '00/11-23-030-27W4/2',
          firstFracDate: '2023-09-20',
          stages: 10,
          proppantT: '1000',
          upgradeHintT: '0',
          refracProppantT: '250',
          waterM3: '9999.5',
        },
      ],
    };
    mockApi({ [PATH]: () => Response.json(answer) });
    render(<WellFrac {...props} />);
    expect(screen.getByText('Frac: loading…')).toBeInTheDocument();
    expect(await screen.findByText('2023-09-20')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('5,000 t')).toBeInTheDocument();
    expect(
      screen.getByText('Water 50,000 m³ · re-fractured later with 250 t · 2 legs reported.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/1,000 t of it is named as coated or ceramic/)).toBeInTheDocument();
    // The source is behind More info, closed at first.
    const source = screen.getByText(/^Source: Alberta Energy Regulator/);
    expect(source.closest('details')).not.toHaveAttribute('open');
    expect(source.closest('details')?.querySelector('summary')).toHaveTextContent('More info');
  });

  it('says when nothing was reported, when the data is not loaded, and a likely error', async () => {
    mockApi({ [PATH]: () => Response.json({ source: SOURCE, wells: [] }) });
    const first = render(<WellFrac {...props} />);
    expect(await screen.findByText(/^No frac reported to the AER/)).toBeInTheDocument();
    first.unmount();
    clearFrac();
    mockApi({
      [PATH]: () => Response.json({ source: { ...SOURCE, loadedAt: null }, wells: [] }),
    });
    const second = render(<WellFrac {...props} />);
    expect(await screen.findByText(/is not loaded yet/)).toBeInTheDocument();
    second.unmount();
    clearFrac();
    mockApi({
      [PATH]: () => Response.json({ source: SOURCE, wells: [{ ...LEG, suspect: true }] }),
    });
    render(<WellFrac {...props} />);
    expect(await screen.findByText(/reads as a reporting error/)).toBeInTheDocument();
  });

  it('says when the frac data cannot be read', async () => {
    mockApi({});
    render(<WellFrac {...props} />);
    expect(await screen.findByText('The frac data could not be loaded.')).toBeInTheDocument();
  });
});
