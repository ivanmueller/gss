import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Chooses an option in a dropdown (components/ui/select.tsx) as a person does: opens it,
 * then clicks the option by its visible name.
 */
export async function choose(trigger: HTMLElement, option: string | RegExp): Promise<void> {
  const user = userEvent.setup();
  await user.click(trigger);
  await user.click(await screen.findByRole('option', { name: option }));
}
