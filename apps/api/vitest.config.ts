import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only; database tests (*.db.test.ts) need Postgres: `pnpm test:db`.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '**/*.db.test.ts'] },
});
