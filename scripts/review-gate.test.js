// Tests of the review evidence check: node --test scripts/
// Each test builds a throwaway git repository in the system's temporary folder.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { eligibility, evaluate } from './review-gate.js';
import { changeTier, fileTier, parseRegister, registerBlockers } from './review-register.js';

let repo;
const cwd = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
function commit(files, message) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}
function register({ reviews, findings = [] }) {
  return [
    '# Review register: F-900 — test',
    '',
    '## Reviews',
    '',
    '| Round | Mode | Base | Reviewed commit | Result | Findings |',
    '|---|---|---|---|---|---|',
    ...reviews.map(
      (r) =>
        `| ${r.round} | ${r.mode} | ${r.base ?? '—'} | ${r.reviewed} | ${r.result} | ${r.findings ?? 0} |`,
    ),
    '',
    '## Findings',
    '',
    '| ID | Sev | Status | Round | Commit | Where | Summary | Evidence | Fix | Test | Verified |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...findings.map(
      (f) =>
        `| ${f.id} | ${f.sev} | ${f.status} | ${f.round ?? 1} | — | a.ts:1 | ${f.summary ?? 's'} | ${f.evidence ?? '—'} | ${f.fix ?? '—'} | ${f.test ?? '—'} | ${f.verified ?? '—'} |`,
    ),
    '',
  ].join('\n');
}

describe('review evidence check', () => {
  let main;
  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'review-gate-test-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.invalid');
    git('config', 'user.name', 'Test');
    git('config', 'commit.gpgsign', 'false');
    main = commit({ 'README.md': 'hello\n', 'apps/web/src/a.ts': 'export const a = 1;\n' }, 'main');
    process.chdir(repo);
  });
  after(() => {
    process.chdir(cwd);
    rmSync(repo, { recursive: true, force: true });
  });
  const branch = (name) => {
    git('switch', '-q', '-c', name, main);
  };

  test('documents only need no review', () => {
    branch('docs');
    const head = commit({ 'docs/NOTES.md': 'x\n' }, 'docs');
    const outcome = evaluate({ base: main, head });
    assert.equal(outcome.evidence, 'not-needed');
    assert.equal(outcome.tier, 'low');
  });

  test('code without a register is incomplete', () => {
    branch('noregister');
    const head = commit({ 'apps/web/src/a.ts': 'export const a = 2;\n' }, 'code');
    const outcome = evaluate({ base: main, head });
    assert.equal(outcome.evidence, 'incomplete');
    assert.match(outcome.blockers[0], /No review register/);
    assert.equal(eligibility(outcome), 'no: review evidence incomplete');
  });

  test('a complete chain with only the register changed after it is complete and eligible', () => {
    branch('complete');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 3;\n' }, 'code 1');
    const c2 = commit({ 'apps/web/src/a.ts': 'export const a = 4;\n' }, 'fix');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: 'D1', mode: 'design', reviewed: main, result: 'needs-attention' },
            { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'needs-attention' },
            { round: '2', mode: 'rereview', base: c1, reviewed: c2, result: 'approve' },
          ],
          findings: [
            {
              id: 'F-900-R1-01',
              sev: 'P2',
              status: 'fixed',
              fix: c2.slice(0, 7),
              test: 'a.test.ts',
              verified: 'R2',
            },
            { id: 'F-900-R1-02', sev: 'P3', status: 'rejected', evidence: 'the caller checks it' },
          ],
        }),
      },
      'register',
    );
    const outcome = evaluate({ base: main, head });
    assert.deepEqual(outcome.blockers, []);
    assert.equal(outcome.evidence, 'complete');
    assert.equal(outcome.tier, 'normal');
    assert.match(eligibility(outcome), /^yes/);
  });

  test('code changed after the last review is incomplete', () => {
    branch('late');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 5;\n' }, 'code');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'approve' },
          ],
        }),
        'apps/web/src/b.ts': 'export const b = 1;\n',
      },
      'register and more code',
    );
    const outcome = evaluate({ base: main, head });
    assert.equal(outcome.evidence, 'incomplete');
    assert.ok(
      outcome.blockers.some((b) => /Changed after the last review.*apps\/web\/src\/b\.ts/.test(b)),
    );
  });

  test('a design review alone does not count', () => {
    branch('designonly');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 6;\n' }, 'code');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [{ round: 'D1', mode: 'design', reviewed: c1, result: 'approve' }],
        }),
      },
      'register',
    );
    const outcome = evaluate({ base: main, head });
    assert.ok(outcome.blockers.includes('No code review (checkpoint or rereview) is recorded.'));
  });

  test('a review that does not start on the base branch, or a broken chain, is incomplete', () => {
    branch('chain');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 7;\n' }, 'code 1');
    const c2 = commit({ 'apps/web/src/a.ts': 'export const a = 8;\n' }, 'code 2');
    const c3 = commit({ 'apps/web/src/a.ts': 'export const a = 9;\n' }, 'code 3');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: '1', mode: 'checkpoint', base: c1, reviewed: c2, result: 'approve' },
            { round: '2', mode: 'rereview', base: c1, reviewed: c3, result: 'approve' },
          ],
        }),
      },
      'register',
    );
    const outcome = evaluate({ base: main, head });
    assert.ok(outcome.blockers.some((b) => /not on the base branch/.test(b)));
    assert.ok(outcome.blockers.some((b) => /not where review 1 stopped/.test(b)));
  });

  test('high risk is never eligible, even with complete evidence', () => {
    branch('high');
    const c1 = commit({ 'supabase/migrations/1_x.sql': 'select 1;\n' }, 'migration');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'approve' },
          ],
        }),
      },
      'register',
    );
    const outcome = evaluate({ base: main, head });
    assert.equal(outcome.evidence, 'complete');
    assert.equal(outcome.tier, 'high');
    assert.equal(eligibility(outcome), 'no: high risk, held for qualified approval');
  });

  test("a fourth round needs the owner's label", () => {
    branch('rounds');
    const commits = [main];
    for (let i = 0; i < 4; i += 1)
      commits.push(commit({ 'apps/web/src/a.ts': `export const a = ${20 + i};\n` }, `c${i}`));
    const reviews = [1, 2, 3, 4].map((n) => ({
      round: String(n),
      mode: n === 1 ? 'checkpoint' : 'rereview',
      base: commits[n - 1],
      reviewed: commits[n],
      result: 'approve',
    }));
    const head = commit({ 'docs/reviews/F-900.md': register({ reviews }) }, 'register');
    assert.ok(evaluate({ base: main, head }).blockers.some((b) => /4 code review rounds/.test(b)));
    assert.deepEqual(
      evaluate({ base: main, head, labels: ['owner-approved-extra-review-round'] }).blockers,
      [],
    );
  });
});

describe('register rules', () => {
  const base = {
    id: 'F-900',
    problems: [],
    reviews: [{ round: '1', mode: 'checkpoint', base: 'a', reviewed: 'b', result: 'approve' }],
  };
  test('blocking statuses, unverified fixes and missing tests are reported', () => {
    const blockers = registerBlockers({
      ...base,
      findings: [
        { id: 'F-900-R1-01', severity: 'P1', status: 'confirmed' },
        { id: 'F-900-R1-02', severity: 'P2', status: 'requires-decision' },
        {
          id: 'F-900-R1-03',
          severity: 'P2',
          status: 'fixed',
          fix: 'abc1234',
          test: '—',
          verified: '—',
        },
        { id: 'F-900-R1-04', severity: 'P3', status: 'rejected', evidence: '—' },
      ],
    });
    assert.ok(blockers.includes('Finding F-900-R1-01 is confirmed.'));
    assert.ok(blockers.includes('Finding F-900-R1-02 is requires-decision.'));
    assert.ok(blockers.some((b) => /R1-03 is fixed but no Codex re-review verified it/.test(b)));
    assert.ok(blockers.some((b) => /R1-03 \(P2\) is fixed without a regression test/.test(b)));
    assert.ok(blockers.includes('Finding F-900-R1-04 is rejected without evidence.'));
  });
  test('malformed registers are reported', () => {
    const parsed = parseRegister('# Something else\n');
    assert.ok(parsed.problems.length >= 3);
  });
  test('risk tiers follow the paths', () => {
    assert.equal(fileTier('supabase/migrations/2026_x.sql'), 'high');
    assert.equal(fileTier('apps/api/src/telnyx.ts'), 'high');
    assert.equal(fileTier('packages/domain/src/money.ts'), 'high');
    assert.equal(fileTier('.github/workflows/ci.yml'), 'high');
    assert.equal(fileTier('docs/AI_WORKFLOW.md'), 'high');
    assert.equal(fileTier('docs/DECISIONS.md'), 'normal');
    assert.equal(fileTier('apps/web/src/components/MapLayers.tsx'), 'normal');
    assert.equal(fileTier('tests/e2e/specs/counterparties.spec.ts'), 'low');
    assert.equal(fileTier('docs/FEATURES.md'), 'low');
    assert.deepEqual(changeTier(['docs/FEATURES.md', 'apps/web/src/x.tsx']).tier, 'normal');
  });
});
