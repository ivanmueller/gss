import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SYNTHETIC_FACILITIES } from '../data/synthetic';
import type { Price, Quote } from '../data/types';
import { CadPrice } from './CadPrice';

const FX = { cadPerUsd: '1.360000', source: 'test rate' };

function quoteAt(price: Price): Quote {
  const template = SYNTHETIC_FACILITIES[0]?.quotes[0];
  if (!template) throw new Error('fixture changed');
  return { ...template, price };
}

describe('CadPrice', () => {
  it('shows a negative converted price, with the original in the FX note', () => {
    // USD −12.50 × 1.360000 = CAD −17.00 (a basis quote).
    render(<CadPrice quote={quoteAt({ amount: '-12.50', currency: 'USD', unit: 'MT' })} fx={FX} />);
    expect(screen.getByText('CAD \u221217.00/MT')).toBeInTheDocument();
    expect(screen.getByText('FX')).toHaveAttribute(
      'title',
      'Converted from USD \u221212.50/MT at 1.360000 CAD per USD, test rate',
    );
  });

  it('shows a negative USD price as is when there is no rate', () => {
    render(
      <CadPrice quote={quoteAt({ amount: '-12.50', currency: 'USD', unit: 'MT' })} fx={null} />,
    );
    expect(screen.getByText('USD \u221212.50/MT')).toBeInTheDocument();
    expect(screen.getByText('no CAD/USD rate')).toBeInTheDocument();
  });

  it('rounds a converted price with many decimal places to cents', () => {
    // USD 725.0000000 × 1.360000 = CAD 986.0000000000000.
    render(
      <CadPrice quote={quoteAt({ amount: '725.0000000', currency: 'USD', unit: 'MT' })} fx={FX} />,
    );
    expect(screen.getByText('CAD 986.00/MT')).toBeInTheDocument();
  });
});
