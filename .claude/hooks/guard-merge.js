// Claude Code PreToolUse hook (F-150, docs/AI_WORKFLOW.md §11.6): the only merge Claude may start is
// `gh pr merge <n> --auto --squash`, which GitHub carries out once every required check passes, and
// only once GitHub requires the "Merge policy" check on main. Never --admin (it bypasses the rules).
// Blocks (exit code 2, the reason on stderr) any other `gh pr merge`; lets every other command through.
// A guardrail for Claude Code, not a security boundary: GitHub's required checks are the boundary.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { changesRules } from '../../scripts/review-register.js';

const REQUIRED_CHECK = 'Merge policy';

function block(reason) {
  process.stderr.write(`Blocked by .claude/hooks/guard-merge.js: ${reason}\n`);
  process.exit(2);
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  process.exit(0);
}
const command = String(input.tool_input?.command ?? '');
// Each command on its own (F-150-R3-02): the input is split at && ; | parentheses and new lines, and
// a piece is a merge only when it starts with `gh pr merge` (after spaces and prefixes such as
// VAR=value, env, command, sudo, time: F-150-R1-04), so text that merely mentions the command, such
// as a document written by a heredoc, is not taken for it.
const MERGE = /^\s*((\w+=\S*|env|command|sudo|time|exec|nohup)\s+)*gh(\.exe)?\s+pr\s+merge\b/;
const merges = command.split(/[;&|()\n]+/).filter((piece) => MERGE.test(piece));
if (merges.length === 0) process.exit(0);

let needsEnforcement = false;
for (const merge of merges) {
  if (/(^|\s)(--admin|-A)\b/.test(merge))
    block('--admin bypasses the branch rules; Claude never uses it.');
  // Turning automatic merging off is always allowed, for that command only.
  if (/(^|\s)--disable-auto\b/.test(merge)) continue;
  if (!/(^|\s)--auto\b/.test(merge))
    block(
      'Claude only enables automatic merging (`gh pr merge <n> --auto --squash`); GitHub merges once every required check passes.',
    );
  needsEnforcement = true;
}
if (!needsEnforcement) process.exit(0);

// GitHub's data, or for the tests (scripts/guard-merge.test.js) the hook's own environment variable,
// which a command Claude runs cannot set (hooks run in Claude Code's environment).
const testData = process.env.GSS_GUARD_TEST_DATA
  ? JSON.parse(process.env.GSS_GUARD_TEST_DATA)
  : null;
const gh = (args) => {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};
const repo = testData
  ? 'test/test'
  : gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();

// Automatic merging only once GitHub enforces the Merge policy on main.
function requiredChecks() {
  if (testData) return testData.requiredChecks;
  if (!repo) return null;
  const classic = gh([
    'api',
    `repos/${repo}/branches/main/protection/required_status_checks`,
    '--jq',
    '.contexts[]',
  ]);
  const rules = gh([
    'api',
    `repos/${repo}/rules/branches/main`,
    '--jq',
    '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context',
  ]);
  return `${classic}\n${rules}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
const checks = requiredChecks();
if (!checks) block('could not read the repository with gh; not merging.');
if (!checks.includes(REQUIRED_CHECK))
  block(
    `GitHub does not yet require the "${REQUIRED_CHECK}" check on main, so automatic merging is not switched on (docs/AI_WORKFLOW.md §11.6).`,
  );

// While a change of the merge rules is open, no other pull request gets automatic merging, so none
// can merge under the old rules between the rules change's approval and its merge (F-151-R2-01).
const openPullRequests = testData
  ? testData.openPullRequests
  : JSON.parse(
      gh([
        'pr',
        'list',
        '--repo',
        repo,
        '--base',
        'main',
        '--state',
        'open',
        '--limit',
        '1000',
        '--json',
        'number,files',
      ]) || 'null',
    );
if (!Array.isArray(openPullRequests))
  block('could not list the open pull requests with gh; not merging.');
const rulesChanges = openPullRequests
  .filter((pr) => changesRules((pr.files ?? []).map((file) => file.path)))
  .map((pr) => String(pr.number));
for (const merge of merges) {
  if (/(^|\s)--disable-auto\b/.test(merge)) continue;
  const target = /\bpr\s+merge\s+#?(\d+)/.exec(merge)?.[1];
  const others = rulesChanges.filter((number) => number !== target);
  if (!target || others.length)
    block(
      target
        ? `a change of the merge rules (#${others.join(', #')}) is open: no automatic merging of other pull requests until it is merged or closed (docs/AI_WORKFLOW.md §11.6).`
        : 'name the pull request number in `gh pr merge <n> --auto --squash`.',
    );
}
process.exit(0);
