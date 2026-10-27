import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      '**/dist/',
      '**/.wrangler/',
      '**/coverage/',
      '**/playwright-report/',
      '**/test-results/',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Node scripts run by CI workflows.
    files: ['scripts/**/*.js'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', fetch: 'readonly', URL: 'readonly' },
    },
  },
);
