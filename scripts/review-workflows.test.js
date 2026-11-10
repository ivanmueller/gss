// Structure of the merge workflows (F-150): node --test 'scripts/*.test.js'
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const DIR = new URL('../.github/workflows/', import.meta.url);
const workflows = Object.fromEntries(
  readdirSync(DIR)
    .filter((name) => /\.ya?ml$/.test(name))
    // Line endings normalized: Windows checkouts have CRLF (F-150-R2-03).
    .map((name) => [name, readFileSync(new URL(name, DIR), 'utf8').replace(/\r\n/g, '\n')]),
);

describe('merge workflows', () => {
  // F-150-R1-01: a skipped job counts as passing for GitHub's required checks, so no workflow that
  // a pull_request event runs may carry a job named "Merge policy".
  test('only merge-policy.yml defines the Merge policy check, and only pull_request_target runs it', () => {
    const defining = Object.entries(workflows)
      .filter(([, text]) => /^\s*name:\s*['"]?Merge policy['"]?\s*$/m.test(text))
      .map(([name]) => name);
    assert.deepEqual(defining, ['merge-policy.yml']);
    const text = workflows['merge-policy.yml'];
    const on = /^on:\n((?:[ \t].*\n|\n)*)/m.exec(text)?.[1] ?? '';
    const events = [...on.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
    assert.deepEqual(events, ['pull_request_target']);
    // Data only: the pull request's code is checked out without credentials and never run.
    assert.doesNotMatch(text, /pnpm install|npm (ci|install)|persist-credentials: true/);
  });
});
