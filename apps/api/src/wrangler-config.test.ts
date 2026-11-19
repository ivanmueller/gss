import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// F-247-1b-D1-01: the staging Worker's Hyperdrive bindings, read from wrangler.jsonc itself. CI's
// local Worker also has PETROLEUM_DATABASE_URL, so a browser test alone would pass with the
// PETROLEUM binding missing or outside env.staging; this test fails then.

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
  it("binds grain's database and the oil and gas database, each to its own configuration", () => {
    const bindings = stagingHyperdrive();
    expect(bindings.map((b) => b.binding).sort()).toEqual(['HYPERDRIVE', 'PETROLEUM']);
    const grain = bindings.find((b) => b.binding === 'HYPERDRIVE');
    const petroleum = bindings.find((b) => b.binding === 'PETROLEUM');
    expect(grain?.id).toBe('bbc915879c6848abaa08605ff7d7825c');
    // gss-petroleum-staging, as printed by "Set up Hyperdrive (staging)" for petroleum.
    expect(petroleum?.id).toBe('b78486b05a3e4a7bab6037599af5c97b');
    expect(petroleum?.id).not.toBe(grain?.id);
  });

  it('gives the oil and gas binding a local address on this machine only, as petro_api', () => {
    const petroleum = stagingHyperdrive().find((b) => b.binding === 'PETROLEUM');
    const local = new URL(petroleum?.localConnectionString ?? '');
    expect(local.hostname).toBe('127.0.0.1');
    expect(local.username).toBe('petro_api');
    expect(local.pathname).toBe('/petroleum');
  });
});
