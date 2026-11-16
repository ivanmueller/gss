import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { PinDetailsBox } from './PinDetailsBox';

const DETAILS = {
  title: 'Synthetic Prairie Mills',
  href: '/counterparties/c1',
  lines: ['Buyer · Elevator', 'Synthetic Town, SK, Canada', 'Exact location'],
};

describe('PinDetailsBox (F-101)', () => {
  it('names the company as a link, then its type, place and how exact the location is', () => {
    render(
      <PinDetailsBox details={DETAILS} anchor={{ x: 40, y: 80, flip: false }} onClose={vi.fn()} />,
    );
    const box = screen.getByRole('region', { name: 'Selected location' });
    expect(box).toHaveTextContent(
      'Synthetic Prairie MillsBuyer · ElevatorSynthetic Town, SK, CanadaExact location',
    );
    expect(screen.getByRole('link', { name: 'Synthetic Prairie Mills' })).toHaveAttribute(
      'href',
      '/counterparties/c1',
    );
    // Placed beside the pin on a computer (the phone's panel ignores these).
    expect(box.style.getPropertyValue('--pin-x')).toBe('40px');
    expect(box.style.getPropertyValue('--pin-y')).toBe('80px');
    expect(box).not.toHaveAttribute('data-flip');
  });

  it('opens to the pin’s left near the map’s right edge, and shows a title without a page as text', () => {
    render(
      <PinDetailsBox
        details={{ title: 'Town on the route', lines: [] }}
        anchor={{ x: 900, y: 80, flip: true }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole('region', { name: 'Selected location' })).toHaveAttribute(
      'data-flip',
      'true',
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('closes with the ✕ button and with Escape', async () => {
    const onClose = vi.fn();
    render(<PinDetailsBox details={DETAILS} anchor={null} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
