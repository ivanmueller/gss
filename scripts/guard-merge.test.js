// Tests of the merge guard hook (.claude/hooks/guard-merge.js, F-150): node --test 'scripts/*.test.js'
// Only the decisions made before the hook asks GitHub anything; the GitHub part is checked by hand.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const HOOK = fileURLToPath(new URL('../.claude/hooks/guard-merge.js', import.meta.url));
const run = (command) =>
  spawnSync('node', [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
    encoding: 'utf8',
  });

describe('merge guard hook', () => {
  test('lets every other command through', () => {
    for (const command of [
      'git status',
      'gh pr view 194',
      'gh pr checks 194',
      'echo merge',
      // Text that only mentions the command (a document written through a heredoc).
      "cat > notes.md <<'EOF'\nClaude runs only `gh pr merge <n> --auto --squash`.\nEOF",
    ])
      assert.equal(run(command).status, 0, command);
  });

  test('never lets --admin through', () => {
    for (const command of [
      'gh pr merge 194 --auto --squash --admin',
      'cd x && gh pr merge 194 --admin',
      'gh pr merge 194 -A',
    ]) {
      const result = run(command);
      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /--admin bypasses/);
    }
  });

  test('blocks a merge that is not automatic', () => {
    for (const command of [
      'gh pr merge 194 --squash',
      'gh pr merge 194',
      'gh.exe pr merge 1 -s',
      // F-150-R1-04: leading spaces and command prefixes are still a merge.
      '  gh pr merge 194 --squash',
      '\tgh pr merge 194',
      'GH_DEBUG=1 gh pr merge 194',
      'env GH_DEBUG=1 gh pr merge 194',
      'command gh pr merge 194',
      'echo ok;   gh pr merge 194',
      // F-150-R3-02: a flag of another command does not excuse this one.
      'gh pr merge 194 --squash; gh pr merge 195 --disable-auto',
      'gh pr merge 195 --disable-auto && gh pr merge 194',
    ]) {
      const result = run(command);
      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /only enables automatic merging/);
    }
  });

  test('always lets automatic merging be turned off', () => {
    assert.equal(run('gh pr merge 194 --disable-auto').status, 0);
  });

  // F-151-R2-01: while a change of the merge rules is open, no other pull request gets automatic
  // merging, so none can merge under the old rules between the rules change's approval and merge.
  const withData = (command, data) =>
    spawnSync('node', [HOOK], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }),
      encoding: 'utf8',
      env: { ...process.env, GSS_GUARD_TEST_DATA: JSON.stringify(data) },
    });
  const enforced = ['check', 'Merge policy'];
  test('no automatic merging of another pull request while a rules change is open', () => {
    const open = [
      { number: 194, files: [{ path: 'apps/web/src/pages/QuotePage.tsx' }] },
      { number: 198, files: [{ path: '.github/workflows/merge-policy.yml' }] },
    ];
    const blocked = withData('gh pr merge 194 --auto --squash', {
      requiredChecks: enforced,
      openPullRequests: open,
    });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /change of the merge rules \(#198\) is open/);
    // The rules change itself may be set to merge (it still waits for the owner's approval).
    assert.equal(
      withData('gh pr merge 198 --auto --squash', {
        requiredChecks: enforced,
        openPullRequests: open,
      }).status,
      0,
    );
    // With no rules change open, automatic merging is allowed once the policy is required.
    assert.equal(
      withData('gh pr merge 194 --auto --squash', {
        requiredChecks: enforced,
        openPullRequests: [open[0]],
      }).status,
      0,
    );
    assert.equal(
      withData('gh pr merge 194 --auto --squash', {
        requiredChecks: ['check'],
        openPullRequests: [],
      }).status,
      2,
    );
  });
});
