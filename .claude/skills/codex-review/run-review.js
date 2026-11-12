// Runs one Codex review of a committed snapshot (docs/AI_WORKFLOW.md §11.5). Used by the codex-review
// skill; Claude runs it as a background command and is notified when it exits.
//
//   node .claude/skills/codex-review/run-review.js --id F-149 --mode checkpoint [--sha HEAD] [--base <ref>]
//   node .claude/skills/codex-review/run-review.js --id F-149 --mode rereview   [--sha HEAD] [--base <ref>]
//   node .claude/skills/codex-review/run-review.js --id F-149 --mode design --plan <file> [--sha <ref>]
//   node .claude/skills/codex-review/run-review.js --id F-149 --mode final [--sha HEAD]   (high risk: whole PR)
//   options: --owner-approved (only when the owner allowed rounds beyond the limits),
//            --dry-run (prompt only, no Codex)
//
// What it does:
//   1. Allocates the next round under a lock, so two reviews never share a round or an output
//      folder. Design reviews are D1, D2… and do not count. Code rounds 1 to 5 run; 6 to 8 only
//      when the last round's issue count fell (measurable progress); beyond 8, or after an
//      escalation, only with --owner-approved (the rule is roundAllowed in scripts/review-register.js,
//      shared with the GitHub check).
//   2. Adds a detached git worktree of the commit in ../gss-review/<unique>: Codex sees exactly that
//      commit (tracked files only), never the working tree Claude keeps editing.
//   3. Runs the Codex CLI (`codex exec`, installed by the official Codex plugin) with a read-only
//      sandbox, no connectors (`--disable apps`), the JSON output schema beside this file, and the
//      prompt built from prompt-template.md, the register's known findings and, for a re-review, the
//      findings to verify; at the reasoning effort EFFORT gives for the mode. The prompt sets a
//      reading budget (no handoff or feature documents, line ranges rather than whole files), and
//      each round's token count is recorded in the state and printed.
//   4. Keeps everything Codex wrote outside the repository, in ~/.gss-reviews/<ID>/<round>-<sha>-<n>/
//      (the repository is public: open security findings must not be committed in detail).
//   5. Removes only the worktree it created, and prints the findings with probable duplicates.
//   6. Records the round's issue count (new findings plus fixes Codex found not fixed, one problem
//      counted once) and stops the loop for the owner when the same fix is found not fixed two
//      rounds running without the count falling, or when Codex raises again a P1 or P2 that
//      Claude rejected or accepted (a disagreement on a significant issue).
//
// Exit code 0: review completed (any verdict). 2: usage. 3: round limit reached (escalate to the
// owner). 4: Codex failed or returned malformed output. 5: git error. 6: review completed, and the
// loop must stop and be escalated to the owner (recurring findings or a disagreement).
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nextReviewBase, roundAllowed, roundOutcome } from '../../../scripts/review-register.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA = join(HERE, 'review-output.schema.json');
const TEMPLATE = join(HERE, 'prompt-template.md');
const CODEX_TIMEOUT_MS = 45 * 60 * 1000;
// Reasoning effort by mode (the owner's decision of 2026-11-11, to cut Codex usage): medium for the
// plan and the final review of the whole pull request, low (the model's own default, as the reviews
// pasted by hand used) for checkpoint reviews and re-reviews of fixes.
const EFFORT = { design: 'medium', final: 'medium', checkpoint: 'low', rereview: 'low' };

const argv = process.argv.slice(2);
const option = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (name) => argv.includes(`--${name}`);

function fail(code, message) {
  console.error(message);
  process.exit(code);
}

const repoRoot = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return fail(5, 'Not inside a git repository.');
  }
})();
const git = (...args) =>
  execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

const id = option('id');
const mode = option('mode');
if (
  !id ||
  !/^[A-Za-z0-9-]+$/.test(id) ||
  !['design', 'checkpoint', 'rereview', 'final'].includes(mode)
)
  fail(
    2,
    'Usage: run-review.js --id <F-###> --mode design|checkpoint|rereview|final [--sha] [--base] [--plan]',
  );
if (mode === 'design' && !option('plan')) fail(2, 'A design review needs --plan <file>.');

const privateRoot = resolve(
  process.env.GSS_REVIEW_PRIVATE_DIR ?? join(homedir(), '.gss-reviews'),
  id,
);
mkdirSync(privateRoot, { recursive: true });
const statePath = join(privateRoot, 'state.json');

function withLock(fn) {
  const lockPath = join(privateRoot, 'lock');
  for (let attempt = 0; ; attempt += 1) {
    try {
      closeSync(openSync(lockPath, 'wx'));
      break;
    } catch {
      // A lock older than 2 minutes is left from a crash: allocation takes milliseconds.
      if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > 120_000)
        rmSync(lockPath, { force: true });
      else if (attempt > 200) fail(5, `Could not take the lock ${lockPath}.`);
      else Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    const state = existsSync(statePath)
      ? JSON.parse(readFileSync(statePath, 'utf8'))
      : { rounds: [] };
    const out = fn(state);
    writeFileSync(`${statePath}.tmp`, JSON.stringify(state, null, 2));
    renameSync(`${statePath}.tmp`, statePath);
    return out;
  } finally {
    rmSync(lockPath, { force: true });
  }
}

let sha;
try {
  sha = git('rev-parse', `${option('sha') ?? 'HEAD'}^{commit}`);
} catch {
  fail(5, `Unknown commit ${option('sha') ?? 'HEAD'}.`);
}

// Round allocation and the round limit, under the lock.
const allocation = withLock((state) => {
  // Rounds that count: completed ones, and ones still running (started within the Codex time limit).
  // Failed runs, dry runs and runs that crashed long ago do not count; their numbers are used again.
  const counts = (r) =>
    r.status === 'completed' ||
    (r.status === 'running' && Date.now() - Date.parse(r.startedAt) < CODEX_TIMEOUT_MS + 60_000);
  const code = state.rounds.filter((r) => r.mode !== 'design' && counts(r));
  const design = state.rounds.filter((r) => r.mode === 'design');
  let allowedBecause = null;
  if (mode !== 'design') {
    const completed = code.filter((r) => r.status === 'completed');
    const verdict = roundAllowed(
      code.length + 1,
      completed.map((r) => r.issues ?? r.findings ?? 0),
      { ownerApproved: flag('owner-approved'), escalated: Boolean(completed.at(-1)?.escalation) },
    );
    if (!verdict.allowed) return { refused: `${id}: ${verdict.reason}.`, limit: true };
    allowedBecause = verdict.reason;
  }
  // Each code review starts where the last completed one stopped, so the rounds form the chain
  // the evidence check requires (F-149-R1-02); the first starts at the merge base with main.
  // A final review (high risk and governance) always reads the whole pull request from the merge base.
  let base =
    option('base') ?? (mode === 'design' || mode === 'final' ? null : nextReviewBase(state.rounds));
  if (mode === 'rereview' && !base)
    return {
      refused: 'No completed code review to re-review from; run a checkpoint review first.',
    };
  if ((mode === 'checkpoint' || mode === 'final') && !base) {
    try {
      base = git('merge-base', 'origin/main', sha);
    } catch {
      base = git('merge-base', 'main', sha);
    }
  }
  if (base) base = git('rev-parse', `${base}^{commit}`);
  // A failed round (Codex error) does not count: its number is used again by the next attempt.
  const round = mode === 'design' ? `D${design.length + 1}` : String(code.length + 1);
  const dir = join(privateRoot, `${round}-${sha.slice(0, 7)}-${randomBytes(3).toString('hex')}`);
  state.rounds.push({
    round,
    mode,
    base: base ?? null,
    reviewed: sha,
    status: 'running',
    dir,
    startedAt: new Date().toISOString(),
  });
  return { round, base, dir, allowedBecause };
});
if (allocation.refused) {
  console.error(`${allocation.limit ? 'ROUND LIMIT' : 'REFUSED'}: ${allocation.refused}`);
  if (allocation.limit)
    console.error(
      'Stop here. Reaching the limit is not approval: unresolved P1 and P2 findings still block. ' +
        'Escalate to the owner in the pull request (docs/AI_WORKFLOW.md §11.5, step 7).',
    );
  process.exit(allocation.limit ? 3 : 2);
}
const { round, base, dir, allowedBecause } = allocation;
if (allowedBecause) console.log(`Allowed: ${allowedBecause}.`);
mkdirSync(dir, { recursive: true });

function finish(status, extra = {}) {
  withLock((state) => {
    const entry = state.rounds.find((r) => r.dir === dir);
    if (entry) Object.assign(entry, { status, finishedAt: new Date().toISOString(), ...extra });
  });
}

// Known findings and findings to verify, from the register in the working tree (Claude's latest triage).
const registerPath = join(repoRoot, 'docs', 'reviews', `${id}.md`);
const registerText = existsSync(registerPath) ? readFileSync(registerPath, 'utf8') : '';
const findingRows = registerText
  .split(/\r?\n/)
  .filter((line) => line.startsWith(`| ${id}-`))
  .map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  );
const accepted = existsSync(join(repoRoot, 'docs', 'reviews', 'ACCEPTED.md'))
  ? readFileSync(join(repoRoot, 'docs', 'reviews', 'ACCEPTED.md'), 'utf8')
      .split(/\r?\n/)
      .filter((line) => /^\| A-\d+/.test(line))
  : [];
const known = [
  // A finding Claude set aside carries its evidence, so Codex can weigh it rather than repeat it.
  ...findingRows.map(
    ([fid, sev, status, , , where, summary, evidence]) =>
      `- ${fid} [${sev}, ${status}] ${where}: ${summary}` +
      (['rejected', 'duplicate', 'accepted-limitation'].includes(status) && evidence
        ? ` (Claude's evidence: ${evidence})`
        : ''),
  ),
  ...accepted.map((line) => `- accepted limit ${line}`),
];
const toVerify = findingRows.filter(
  ([, , status, , , , , , , , verified]) => status === 'fixed' && (!verified || verified === '—'),
);
const reopened = findingRows.filter(([, , status]) => status === 'confirmed');

let scope;
if (mode === 'design') {
  scope =
    'Review this plan before it is implemented. Use file "PLAN" for findings about the plan itself. ' +
    'Open only the existing files the plan names or builds on, and only the parts it relies on.' +
    `\n\n${readFileSync(resolve(option('plan')), 'utf8')}`;
} else if (mode === 'checkpoint') {
  scope =
    `Review every change from ${base} to ${sha}: start with \`git diff ${base} ${sha}\`. ` +
    'Open a changed file beyond its diff only where the diff alone cannot settle a question.';
} else if (mode === 'final') {
  scope =
    `FINAL review of a high-risk or governance pull request, the last before it merges automatically. Review the WHOLE pull request, every change from ${base} (on the base branch) to ${sha}: start with \`git diff ${base} ${sha}\`, and read a changed file whole only where its diff leaves a question open. ` +
    'Challenge the design as well as the code: security, permissions and organization isolation, money and FX, migrations and data integrity, failure modes, missing tests. Earlier rounds do not vouch for anything: approve only if you would merge this exact commit yourself.';
} else {
  scope =
    `Targeted re-review. Review only what changed from ${base} (already reviewed) to ${sha}: run \`git diff ${base} ${sha}\`. ` +
    'Do not re-review unchanged code except to judge a fix, and then read only the lines around it. Open no documents.';
}
const verify =
  toVerify.length || reopened.length
    ? 'Verify each of these fixes against the code at this commit and report it in verified_fixes ' +
      '(fixed / not-fixed / cannot-tell, with a one-line note):\n' +
      [...toVerify, ...reopened]
        .map(
          ([fid, sev, , , , where, summary, , fix]) =>
            `- ${fid} [${sev}] ${where}: ${summary} (fix: ${fix || 'none yet'})`,
        )
        .join('\n')
    : 'verified_fixes must be an empty array.';
const prompt = readFileSync(TEMPLATE, 'utf8')
  .replaceAll('{{MODE}}', mode)
  .replaceAll('{{ROUND}}', round)
  .replaceAll('{{SHA}}', sha)
  .replaceAll('{{SCOPE}}', scope)
  .replaceAll('{{KNOWN}}', known.length ? known.join('\n') : '- (none yet)')
  .replaceAll('{{VERIFY}}', verify);
writeFileSync(join(dir, 'prompt.md'), prompt);

if (flag('dry-run')) {
  finish('dry-run');
  console.log(
    `DRY RUN: round ${round}, ${mode}, ${base ?? '—'}..${sha}\nPrompt: ${join(dir, 'prompt.md')}`,
  );
  process.exit(0);
}

// The snapshot: a detached worktree of the commit, beside the repository, unique to this run.
const worktree = join(
  dirname(repoRoot),
  'gss-review',
  `${id}-${round}-${randomBytes(3).toString('hex')}`,
);
let created = false;
let exitCode = 0;
try {
  git('worktree', 'add', '--detach', worktree, sha);
  created = true;
  const rawPath = join(dir, 'raw.json');
  const quote = (arg) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg);
  const args = [
    'exec',
    '--sandbox',
    'read-only',
    '--ephemeral',
    '--disable',
    'apps',
    '-c',
    `model_reasoning_effort=${EFFORT[mode]}`,
    ...(process.platform === 'win32' ? ['-c', 'windows.sandbox=unelevated'] : []),
    '--cd',
    worktree,
    '--output-schema',
    SCHEMA,
    '--output-last-message',
    rawPath,
    '-',
  ];
  // On Windows `codex` is an npm .cmd shim, which Node runs only through the shell: the arguments are
  // fixed strings and paths, quoted here; no text from the repository or the prompt reaches the shell.
  const windows = process.platform === 'win32';
  const run = spawnSync(
    windows ? ['codex', ...args].map(quote).join(' ') : 'codex',
    windows ? [] : args,
    {
      input: prompt,
      encoding: 'utf8',
      timeout: CODEX_TIMEOUT_MS,
      maxBuffer: 256 * 1024 * 1024,
      shell: windows,
    },
  );
  writeFileSync(join(dir, 'log.txt'), `${run.stdout ?? ''}\n${run.stderr ?? ''}`);
  // Codex prints "tokens used" and the count on the next line; kept per round to watch usage.
  const tokenMatch = /tokens used\s*\r?\n\s*([\d,]+)/.exec(
    `${run.stdout ?? ''}\n${run.stderr ?? ''}`,
  );
  const tokens = tokenMatch ? Number(tokenMatch[1].replaceAll(',', '')) : null;
  let review;
  try {
    review = JSON.parse(readFileSync(rawPath, 'utf8'));
    if (!['approve', 'needs-attention'].includes(review.verdict) || !Array.isArray(review.findings))
      throw new Error('shape');
  } catch {
    finish('failed', {
      note: `codex exit ${run.status}${run.error ? `, ${run.error.message}` : ''}`,
    });
    console.error(
      `Codex failed or returned malformed output (exit ${run.status}). Log: ${join(dir, 'log.txt')}`,
    );
    exitCode = 4;
  }
  if (review) {
    // Probable duplicates: Codex's own duplicate_of, or the same file within 10 lines of a known finding.
    for (const finding of review.findings) {
      const near = findingRows.find(([, , , , , where]) => {
        const [file, line] = (where ?? '').split(':');
        return (
          file === finding.file &&
          finding.line_start != null &&
          Math.abs(Number(line) - finding.line_start) <= 10
        );
      });
      finding.probable_duplicate_of = finding.duplicate_of ?? near?.[0] ?? null;
    }
    writeFileSync(
      join(dir, 'result.json.tmp'),
      JSON.stringify({ id, round, mode, base, reviewed: sha, ...review }, null, 2),
    );
    renameSync(join(dir, 'result.json.tmp'), join(dir, 'result.json'));

    // The round's issue count, and whether the loop must stop for the owner (roundOutcome).
    const previous =
      mode === 'design'
        ? null
        : withLock((state) =>
            state.rounds
              .filter((r) => r.mode !== 'design' && r.status === 'completed' && r.dir !== dir)
              .at(-1),
          );
    const { issues, notFixed, escalation } = roundOutcome({
      findings: review.findings,
      verifiedFixes: review.verified_fixes,
      previous: mode === 'design' ? undefined : (previous ?? null),
      known: findingRows.map(([fid, severity, status]) => ({ id: fid, severity, status })),
    });
    finish('completed', {
      verdict: review.verdict,
      findings: review.findings.length,
      issues,
      notFixed,
      escalation,
      effort: EFFORT[mode],
      tokens,
    });
    console.log(
      `Codex review ${id} round ${round} (${mode}) of ${sha.slice(0, 7)}${base ? ` from ${base.slice(0, 7)}` : ''}: ${review.verdict}`,
    );
    console.log(review.summary);
    review.findings.forEach((f, i) => {
      console.log(
        `\n${i + 1}. [${f.severity}/${f.category}${f.security_sensitive ? '/SECURITY' : ''}${f.needs_owner_decision ? '/OWNER' : ''}] ${f.title}`,
      );
      console.log(
        `   ${f.file}:${f.line_start ?? '?'}${f.probable_duplicate_of ? `  (probable duplicate of ${f.probable_duplicate_of})` : ''}`,
      );
      console.log(`   ${f.body}\n   → ${f.recommendation}`);
    });
    for (const v of review.verified_fixes)
      console.log(`\nVerified ${v.id}: ${v.status}. ${v.note}`);
    console.log(`\nIssues this round: ${issues} (the register's Findings column).`);
    console.log(
      `Codex usage: ${tokens === null ? 'not reported' : `${tokens.toLocaleString('en-US')} tokens`} at ${EFFORT[mode]} effort.`,
    );
    console.log(`Full result (private, outside the repository): ${join(dir, 'result.json')}`);
    if (escalation) {
      console.log(
        `\nESCALATE: ${escalation}. Stop the loop: record the findings, set the register's Status to escalated, and explain it to the owner in the pull request (docs/AI_WORKFLOW.md §11.5, step 7).`,
      );
      exitCode = 6;
    } else if (review.verdict === 'approve' && mode !== 'design') {
      console.log(
        '\nCodex approved: stop the loop. Record the round, then run the evidence check (node scripts/review-gate.js) and let CI run.',
      );
    }
  }
} catch (error) {
  finish('failed', { note: error.message });
  console.error(`Review failed: ${error.message}`);
  exitCode = 5;
} finally {
  if (created) {
    try {
      git('worktree', 'remove', '--force', worktree);
    } catch {
      console.error(
        `Could not remove the snapshot ${worktree}; remove it with: git worktree remove --force "${worktree}"`,
      );
    }
  }
}
process.exit(exitCode);
