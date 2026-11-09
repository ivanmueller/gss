// Claude Code PreToolUse hook (F-150, docs/AI_WORKFLOW.md §11.6): the only merge Claude may start is
// `gh pr merge <n> --auto --squash`, which GitHub carries out once every required check passes, and
// only once GitHub requires the "Merge policy" check on main. Never --admin (it bypasses the rules).
// Blocks (exit code 2, the reason on stderr) any other `gh pr merge`; lets every other command through.
// A guardrail for Claude Code, not a security boundary: GitHub's required checks are the boundary.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
// Only where a command starts (the line's start, or after && ; | or a parenthesis), so text that
// merely mentions the command, such as a document written by a heredoc, is not taken for it.
if (!/(^|[;&|(]\s*|\n\s*)(sudo\s+)?gh(\.exe)?\s+pr\s+merge\b/.test(command)) process.exit(0);

if (/(^|\s)(--admin|-A)\b/.test(command))
  block('--admin bypasses the branch rules; Claude never uses it.');
// Turning automatic merging off is always allowed.
if (/(^|\s)--disable-auto\b/.test(command)) process.exit(0);
if (!/(^|\s)--auto\b/.test(command))
  block(
    'Claude only enables automatic merging (`gh pr merge <n> --auto --squash`); GitHub merges once every required check passes.',
  );

// Automatic merging only once GitHub enforces the Merge policy on main.
function requiredChecks() {
  const gh = (args) => {
    try {
      return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };
  const repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
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
process.exit(0);
