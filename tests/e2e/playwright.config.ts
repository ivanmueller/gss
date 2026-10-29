import { defineConfig, devices } from '@playwright/test';

import { AUTH_STATE } from './specs/supabase';

const PORT = 8787;
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './specs',
  forbidOnly: CI,
  reporter: CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Signs a synthetic user in with password + TOTP and saves the session.
    { name: 'setup', testMatch: ['auth.setup.ts'] },
    {
      name: 'desktop',
      testMatch: [
        'desktop.spec.ts',
        'routing.spec.ts',
        'auth.spec.ts',
        'counterparties.spec.ts',
        'crm.spec.ts',
        'team.spec.ts',
      ],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        storageState: AUTH_STATE,
      },
    },
    {
      name: 'phone',
      testMatch: ['phone.spec.ts'],
      dependencies: ['setup'],
      use: { ...devices['Pixel 7'], storageState: AUTH_STATE },
    },
  ],
  // The built web app (`pnpm build`) served by the staging Worker config, as deployed.
  // Point both at a local Supabase first: see README "Browser tests".
  webServer: {
    command: `pnpm --filter @grain/api exec wrangler dev --env staging --ip 127.0.0.1 --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/api/v1/health`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
