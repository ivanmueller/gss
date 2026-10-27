import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { QuoteStatus } from '../data/types';
import { QuoteStatusBadge } from './QuoteStatusBadge';

const CASES: [QuoteStatus, string][] = [
  ['firm', 'Firm'],
  ['indicative', 'Indicative'],
  ['withdrawn', 'Withdrawn'],
  ['expired', 'Expired'],
  ['superseded', 'Superseded'],
];

describe('QuoteStatusBadge', () => {
  it.each(CASES)('labels %s quotes in words', (status, text) => {
    render(<QuoteStatusBadge status={status} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });
});
