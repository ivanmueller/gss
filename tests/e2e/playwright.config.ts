import { defineConfig, devices } from '@playwright/test';

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
    {
      name: 'desktop',
      testMatch: ['desktop.spec.ts', 'routing.spec.ts'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'phone',
      testMatch: ['phone.spec.ts'],
      use: { ...devices['Pixel 7'] },
    },
  ],
  // The built web app (`pnpm build`) served by the staging Worker config, as deployed.
  webServer: {
    command: `pnpm --filter @grain/api exec wrangler dev --env staging --ip 127.0.0.1 --port ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/api/v1/health`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
