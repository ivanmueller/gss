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
      <PinDetailsBox
        details={DETAILS}
        anchor={{ x: 40, y: 80, height: 240, up: false }}
        onClose={vi.fn()}
      />,
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
    expect(box.style.getPropertyValue('--pin-top')).toBe('48px');
    expect(box).not.toHaveAttribute('data-up');
  });

  it('opens upward for a pin in the map’s lower half, and shows a title without a page as text', () => {
    render(
      <PinDetailsBox
        details={{ title: 'Town on the route', lines: [] }}
        anchor={{ x: 900, y: 200, height: 240, up: true }}
        onClose={vi.fn()}
      />,
    );
    const box = screen.getByRole('region', { name: 'Selected location' });
    expect(box).toHaveAttribute('data-up', 'true');
    // Its bottom just below the pin, so it never runs past the map's bottom edge.
    expect(box.style.getPropertyValue('--pin-bottom')).toBe('32px');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('keeps the box 8px inside the map’s top and bottom edges', () => {
    const { rerender } = render(
      <PinDetailsBox
        details={DETAILS}
        anchor={{ x: 40, y: 16, height: 240, up: false }}
        onClose={vi.fn()}
      />,
    );
    const top = screen.getByRole('region', { name: 'Selected location' });
    expect(top.style.getPropertyValue('--pin-top')).toBe('8px');
    rerender(
      <PinDetailsBox
        details={DETAILS}
        anchor={{ x: 40, y: 236, height: 240, up: true }}
        onClose={vi.fn()}
      />,
    );
    expect(
      screen
        .getByRole('region', { name: 'Selected location' })
        .style.getPropertyValue('--pin-bottom'),
    ).toBe('8px');
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
