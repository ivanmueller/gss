import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The staging Worker's Hyperdrive bindings, read from wrangler.jsonc itself. Since the oil and gas
// side moved out (switch-over step d), the Worker has grain's database only.

interface HyperdriveBinding {
  binding: string;
  id: string;
  localConnectionString?: string;
}

function stagingHyperdrive(): HyperdriveBinding[] {
  const path = new URL('../wrangler.jsonc', import.meta.url);
  const parsed = ts.parseConfigFileTextToJson('wrangler.jsonc', readFileSync(path, 'utf8'));
  expect(parsed.error).toBeUndefined();
  const config = parsed.config as { env: { staging: { hyperdrive: HyperdriveBinding[] } } };
  return config.env.staging.hyperdrive;
}

describe('apps/api/wrangler.jsonc, env.staging', () => {
  it("binds grain's database only: no oil and gas connection", () => {
    const bindings = stagingHyperdrive();
    expect(bindings.map((b) => b.binding)).toEqual(['HYPERDRIVE']);
    expect(bindings[0]?.id).toBe('bbc915879c6848abaa08605ff7d7825c');
  });
});
