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
    for (const command of ['gh pr merge 194 --squash', 'gh pr merge 194', 'gh.exe pr merge 1 -s']) {
      const result = run(command);
      assert.equal(result.status, 2, command);
      assert.match(result.stderr, /only enables automatic merging/);
    }
  });

  test('always lets automatic merging be turned off', () => {
    assert.equal(run('gh pr merge 194 --disable-auto').status, 0);
  });
});
