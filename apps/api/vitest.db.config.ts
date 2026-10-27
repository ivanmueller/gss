import { defineConfig } from 'vitest/config';

// Runs against a real database with the migrations applied (CI: local Supabase).
export default defineConfig({
  test: { include: ['src/**/*.db.test.ts'] },
});
