import type { Locator } from '@playwright/test';

/**
 * Chooses an option in one of the app's dropdowns (apps/web/src/components/ui/select.tsx) as
 * a person does: opens it, then clicks the option by its visible name.
 */
export async function choose(field: Locator, option: string): Promise<void> {
  await field.click();
  await field.page().getByRole('option', { name: option, exact: true }).click();
}
