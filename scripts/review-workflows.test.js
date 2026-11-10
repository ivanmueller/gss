// Structure of the merge workflows (F-150): node --test 'scripts/*.test.js'
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { RULE_PATHS } from './review-register.js';

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
    const text = workflows['merge-policy.yml'];
    assert.doesNotMatch(text, /ref:[^\n]*pull_request\.base\.(sha|ref)/);
    assert.match(text, /ref:[^\n]*github\.event\.repository\.default_branch/);
  });

  test('the Merge policy runs again when a pull request is pointed at another base', () => {
    assert.match(workflows['merge-policy.yml'], /types:\s*\[[^\]]*\bedited\b[^\]]*\]/);
  });

  // F-151-D1-02, R1-01: a change of the rules withdraws automatic merging from the other open pull
  // requests before it merges (the Merge policy of the approved change), and again after it reaches
  // main (policy-refresh.yml), so a pass under the old rules cannot merge anything.
  test('a change of the merge rules turns automatic merging off on open pull requests, before and after', () => {
    const refresh = workflows['policy-refresh.yml'] ?? '';
    assert.match(refresh, /^on:\n {2}push:\n {4}branches: \[main\]/m);
    for (const path of RULE_PATHS) assert.ok(refresh.includes(`'${path}`), path);
    assert.match(refresh, /scripts\/review-withdraw-auto\.sh/);
    assert.match(workflows['merge-policy.yml'], /rulesChanged[\s\S]*review-withdraw-auto\.sh/);
  });

  // F-152: GitHub refuses to turn automatic merging off without contents: write
  // ("Resource not accessible by integration (disablePullRequestAutoMerge)"). Granted to the two
  // jobs that turn it off, never to a whole workflow.
  test('the jobs that turn automatic merging off may do so, and no workflow-wide write', () => {
    const jobPermissions = (text, job) => {
      const start = text.indexOf(`\n  ${job}:\n`);
      assert.ok(start >= 0, job);
      const rest = text.slice(start + 1);
      const end = rest.slice(1).search(/\n {2}\S/);
      const block = end < 0 ? rest : rest.slice(0, end + 2);
      const lines = /\n {4}permissions:\n((?: {6}.*\n)+)/.exec(block)?.[1] ?? '';
      return Object.fromEntries(
        [...lines.matchAll(/^ {6}([\w-]+): (\w+)/gm)].map((m) => [m[1], m[2]]),
      );
    };
    assert.deepEqual(jobPermissions(workflows['policy-refresh.yml'], 'refresh'), {
      contents: 'write',
      'pull-requests': 'write',
      issues: 'write',
    });
    const policy = jobPermissions(workflows['merge-policy.yml'], 'policy');
    assert.equal(policy.contents, 'write');
    assert.equal(policy['pull-requests'], 'write');
    for (const [name, text] of Object.entries(workflows)) {
      const top = /^permissions:\n((?: {2}.*\n)+)/m.exec(text)?.[1] ?? '';
      assert.doesNotMatch(top, /write/, `${name}: workflow-wide permissions stay read-only`);
    }
  });

  // F-152: two workflows per ordinary push (CI and Merge policy). The gate's tests run in CI, and no
  // other workflow runs on pull_request_target (which acts with the base repository's token).
  test('CI runs the merge gate tests, and only the Merge policy runs on pull_request_target', () => {
    assert.match(workflows['ci.yml'], /run: node --test 'scripts\/\*\.test\.js'/);
    const target = Object.entries(workflows)
      .filter(([, text]) => /^ {2}pull_request_target:/m.test(text))
      .map(([name]) => name);
    assert.deepEqual(target, ['merge-policy.yml']);
  });

  // F-156-D1-01: editing, deleting or dismissing one of the owner's comments or reviews on a labelled
  // pull request withdraws the approval: label off, automatic merging off, the Merge policy re-run.
  // R2-02: review events run the pull request's copy with a read-only token for Dependabot and fork
  // pull requests, so the withdrawal itself always runs main's copy (issue_comment, workflow_run).
  test("editing or dismissing the owner's comment or review withdraws the approval, from main's copy", () => {
    const events = (text) =>
      [...(/^on:\n((?:[ \t].*\n|\n)*)/m.exec(text)?.[1] ?? '').matchAll(/^ {2}(\w+):/gm)].map(
        (m) => m[1],
      );
    const withdraw = workflows['approval-withdrawn.yml'] ?? '';
    assert.deepEqual(events(withdraw), ['issue_comment', 'workflow_run']);
    assert.match(withdraw, /^ {2}issue_comment:\n {4}types: \[edited, deleted\]/m);
    assert.match(withdraw, /^ {2}workflow_run:\n {4}workflows: \[Review changed\]/m);
    assert.match(withdraw, /github\.event\.comment\.user\.login == github\.repository_owner/);
    assert.match(withdraw, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(withdraw, /persist-credentials: false/);
    assert.match(withdraw, /run: node scripts\/review-withdraw-approval\.js "\$REPO" "\$OWNER"/);
    // R3-01: the changed pull request is named; a review's only when its signal job ran.
    assert.match(
      withdraw,
      /AFFECTED_PR: \$\{\{ github\.event_name == 'issue_comment' && github\.event\.issue\.number/,
    );
    assert.match(
      withdraw,
      /AFFECTED_HEAD: [^\n]*workflow_run\.conclusion == 'success'[^\n]*workflow_run\.head_sha/,
    );
    // It only cancels: it never adds the label, approves or turns automatic merging on.
    assert.doesNotMatch(withdraw, /--add-label|--auto\b|gh pr review|pnpm|npm /);

    const signal = workflows['review-changed.yml'] ?? '';
    assert.match(signal, /^name: Review changed$/m);
    assert.deepEqual(events(signal), ['pull_request_review']);
    assert.match(signal, /types: \[edited, dismissed\]/);
    assert.match(signal, /^permissions: \{\}$/m);
    assert.doesNotMatch(signal, /uses:|GH_TOKEN|\bgh (api|pr|run) /);
  });

  // F-151-R1-02: every open pull request, not only the first page of 30.
  test('the withdrawal reads every page of open pull requests', () => {
    const script = readFileSync(new URL('review-withdraw-auto.sh', import.meta.url), 'utf8');
    assert.match(
      script,
      /gh api --paginate "repos\/\$repo\/pulls\?state=open&base=main&per_page=100"/,
    );
    assert.match(script, /auto_merge != null/);
    assert.match(script, /--disable-auto/);
  });
});
