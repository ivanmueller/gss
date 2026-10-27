import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  // Everything prefixed VITE_ is built into the public bundle. A Mapbox secret token (sk.)
  // must never be, so the build stops instead (docs/DECISIONS.md, map decision).
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (env.VITE_MAPBOX_TOKEN?.trim().startsWith('sk.')) {
    throw new Error(
      'VITE_MAPBOX_TOKEN is a Mapbox secret token (sk.); use a public token (pk.) instead.',
    );
  }
  return {
    plugins: [react(), tailwindcss()],
    server: {
      // `pnpm --filter @grain/api dev` serves the API on 8787; the browser stays same-origin.
      proxy: { '/api': 'http://127.0.0.1:8787' },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
    },
  };
});
