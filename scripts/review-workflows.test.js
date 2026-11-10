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

  // F-151: the trusted gate is always protected main's current copy: never the pull request's fork
  // point (on #194 it predated the scripts; an older one means older, weaker rules), and never the
  // pull request's base branch, which may be an unprotected branch (F-151-D1-01).
  test('the trusted gate is checked out from the default branch, not the base commit or base branch', () => {
    for (const name of ['merge-policy.yml', 'review-evidence.yml']) {
      const text = workflows[name];
      assert.doesNotMatch(text, /ref:[^\n]*pull_request\.base\.(sha|ref)/, name);
      assert.match(text, /ref:[^\n]*github\.event\.repository\.default_branch/, name);
    }
  });

  test('the Merge policy runs again when a pull request is pointed at another base', () => {
    assert.match(workflows['merge-policy.yml'], /types:\s*\[[^\]]*\bedited\b[^\]]*\]/);
  });

  // F-151-D1-02: a change of the rules on main withdraws automatic merging from every open pull
  // request, so a pass under the old rules cannot merge it.
  test('a change of the merge rules on main turns automatic merging off on open pull requests', () => {
    const text = workflows['policy-refresh.yml'] ?? '';
    assert.match(text, /^on:\n {2}push:\n {4}branches: \[main\]/m);
    for (const path of ['scripts/review-', '.github/workflows/merge-policy.yml'])
      assert.ok(text.includes(path), path);
    assert.match(text, /--disable-auto/);
  });
});
