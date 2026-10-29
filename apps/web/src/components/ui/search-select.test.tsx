import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { matchOptions, SearchSelect, type SearchSelectOption } from './search-select';

// Synthetic, fictional companies only.
const OPTIONS: SearchSelectOption[] = [
  { value: 'a', label: 'Synthetic Prairie Mills', detail: 'Prairie Mills · MB, SK · Canada' },
  { value: 'b', label: 'Synthetic Buyer LLC', detail: 'ND · United States' },
  { value: 'c', label: 'Coopérative Synthétique', detail: 'QC · Canada' },
];

function Harness({ options = OPTIONS }: { options?: SearchSelectOption[] }) {
  const [value, setValue] = useState('');
  return (
    <>
      <label htmlFor="pick">Counterparty</label>
      <SearchSelect id="pick" value={value} onValueChange={setValue} options={options} />
      <p>Outside</p>
    </>
  );
}

describe('matchOptions', () => {
  it('keeps the choices containing every word typed, in any case and without accents', () => {
    expect(matchOptions(OPTIONS, '').map((option) => option.value)).toEqual(['a', 'b', 'c']);
    expect(matchOptions(OPTIONS, 'prairie').map((option) => option.value)).toEqual(['a']);
    // The details are searched too: the trading name, provinces and states, country.
    expect(matchOptions(OPTIONS, 'nd states').map((option) => option.value)).toEqual(['b']);
    expect(matchOptions(OPTIONS, 'canada').map((option) => option.value)).toEqual(['a', 'c']);
    expect(matchOptions(OPTIONS, 'cooperative synthetique').map((o) => o.value)).toEqual(['c']);
    expect(matchOptions(OPTIONS, 'mills llc')).toEqual([]);
  });
});

describe('SearchSelect', () => {
  it('narrows the list as the person types and chooses with a click', async () => {
    render(<Harness />);
    const button = screen.getByLabelText('Counterparty');
    expect(button).toHaveTextContent('Choose…');
    await userEvent.click(button);
    const search = screen.getByRole('combobox', { name: 'Search the list' });
    expect(search).toHaveFocus();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    await userEvent.type(search, 'buyer');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    // The second line (here the state and country) is searched but not part of the name.
    expect(screen.getByRole('option', { name: 'Synthetic Buyer LLC' })).toHaveTextContent(
      'ND · United States',
    );
    await userEvent.click(screen.getByRole('option', { name: 'Synthetic Buyer LLC' }));
    expect(button).toHaveTextContent('Synthetic Buyer LLC');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(button).toHaveFocus();
  });

  it('is used with the keyboard: a letter starts the search, arrows move, Enter chooses', async () => {
    render(<Harness />);
    const button = screen.getByLabelText('Counterparty');
    button.focus();
    await userEvent.keyboard('c');
    const search = screen.getByRole('combobox', { name: 'Search the list' });
    expect(search).toHaveValue('c');
    // "c" is in all three names; the first is highlighted, Down moves to the second.
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(button).toHaveTextContent('Synthetic Buyer LLC');

    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: 'Synthetic Buyer LLC' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(button).toHaveTextContent('Synthetic Buyer LLC');
  });

  it('says when nothing matches, and closes on a click outside', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByLabelText('Counterparty'));
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('No match.')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Outside'));
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows the first 50 of a long list and says how many more typing would reach', async () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      value: String(index),
      label: `Synthetic Company ${String(index).padStart(3, '0')}`,
    }));
    render(<Harness options={many} />);
    await userEvent.click(screen.getByLabelText('Counterparty'));
    expect(screen.getAllByRole('option')).toHaveLength(50);
    expect(screen.getByText('70 more; keep typing to narrow the list.')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('combobox'), '119');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Synthetic Company 119',
    ]);
  });
});
