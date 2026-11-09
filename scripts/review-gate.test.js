// Tests of the review evidence check: node --test scripts/
// Each test builds a throwaway git repository in the system's temporary folder.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { eligibility, evaluate, mergeDecision } from './review-gate.js';
import {
  changeTier,
  documentsOnly,
  fileTier,
  nextReviewBase,
  parseRegister,
  registerBlockers,
  roundAllowed,
  roundOutcome,
} from './review-register.js';

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
function register({ reviews, findings = [], status = 'complete' }) {
  return [
    '# Review register: F-900 — test',
    '',
    `- Status: ${status}`,
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

  // The owner's decision of 2026-11-09: high risk merges automatically, after stronger checks.
  test('high risk needs a design review, a final full review and tested, added migrations', () => {
    branch('highweak');
    const c1 = commit({ 'supabase/migrations/1_x.sql': 'select 1;\n' }, 'migration');
    const weak = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'approve' },
          ],
        }),
      },
      'register',
    );
    const blockers = evaluate({ base: main, head: weak }).blockers;
    assert.ok(
      blockers.some((b) => /no design review/.test(b)),
      blockers.join('\n'),
    );
    assert.ok(
      blockers.some((b) => /must be a final review/.test(b)),
      blockers.join('\n'),
    );
    assert.ok(
      blockers.some((b) => /new migration without pgTAP/.test(b)),
      blockers.join('\n'),
    );

    branch('highstrong');
    const d1 = commit({ 'docs/plan.md': 'plan\n' }, 'plan');
    const c2 = commit(
      {
        'supabase/migrations/1_x.sql': 'select 1;\n',
        'supabase/tests/database/x.test.sql': 'select 1;\n',
      },
      'migration with tests',
    );
    const strong = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: 'D1', mode: 'design', reviewed: d1, result: 'needs-attention' },
            { round: '1', mode: 'checkpoint', base: main, reviewed: c2, result: 'needs-attention' },
            { round: '2', mode: 'final', base: main, reviewed: c2, result: 'approve' },
          ],
          findings: [{ id: 'F-900-R1-01', sev: 'P3', status: 'rejected', evidence: 'cosmetic' }],
        }),
      },
      'register',
    );
    const outcome = evaluate({ base: main, head: strong });
    assert.deepEqual(outcome.blockers, []);
    assert.equal(outcome.tier, 'high');
    assert.equal(mergeDecision(outcome).merge, true);
    assert.equal(eligibility(outcome), 'yes (high risk)');
  });

  // F-150-R4-01: git quotes non-ASCII paths by default; a quoted path matched no tier rule.
  test('a file name with accents is classified like any other', () => {
    branch('accents');
    const head = commit({ '.github/workflows/é.yml': 'name: x\n' }, 'workflow with an accent');
    const outcome = evaluate({ base: main, head });
    assert.equal(outcome.tier, 'governance');
    assert.deepEqual(outcome.because, ['.github/workflows/é.yml']);
    const migration = commit({ 'supabase/migrations/2_é.sql': 'select 1;\n' }, 'migration');
    assert.ok(
      evaluate({ base: main, head: migration }).blockers.some((b) =>
        /new migration without pgTAP/.test(b),
      ),
    );
  });

  test('a migration already on the base branch is never changed or removed', () => {
    git('switch', '-q', '-c', 'basewithmigration', main);
    const withMigration = commit({ 'supabase/migrations/0_old.sql': 'select 0;\n' }, 'old');
    git('switch', '-q', '-c', 'editsmigration', withMigration);
    const head = commit({ 'supabase/migrations/0_old.sql': 'select 2;\n' }, 'edit');
    const blockers = evaluate({ base: withMigration, head }).blockers;
    assert.ok(
      blockers.some((b) => /Migration supabase\/migrations\/0_old\.sql is changed/.test(b)),
      blockers.join('\n'),
    );
  });

  // F-150-R2-02: the final review must approve, even when it raised only P3 findings.
  test('a high-risk final review that needs attention does not pass, even with only P3', () => {
    branch('highfinalp3');
    const d1 = commit({ 'docs/plan.md': 'plan\n' }, 'plan');
    const c1 = commit({ 'apps/api/src/telnyx.ts': 'export const t = 1;\n' }, 'code');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: 'D1', mode: 'design', reviewed: d1, result: 'approve' },
            { round: '1', mode: 'final', base: main, reviewed: c1, result: 'needs-attention' },
          ],
          findings: [{ id: 'F-900-R1-01', sev: 'P3', status: 'rejected', evidence: 'cosmetic' }],
        }),
      },
      'register',
    );
    const outcome = evaluate({ base: main, head });
    assert.ok(
      outcome.blockers.some((b) => /final review .* must approve/.test(b)),
      outcome.blockers.join('\n'),
    );
    assert.equal(mergeDecision(outcome).merge, false);
  });

  test('a serious finding cannot be left as an accepted limitation in high risk', () => {
    branch('highaccepted');
    const d1 = commit({ 'docs/plan.md': 'plan\n' }, 'plan');
    const c1 = commit({ 'apps/api/src/telnyx.ts': 'export {};\n' }, 'code');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: 'D1', mode: 'design', reviewed: d1, result: 'approve' },
            { round: '1', mode: 'final', base: main, reviewed: c1, result: 'approve' },
          ],
          findings: [
            { id: 'F-900-D1-01', sev: 'P2', status: 'accepted-limitation', evidence: 'later' },
          ],
        }),
      },
      'register',
    );
    assert.ok(
      evaluate({ base: main, head }).blockers.some((b) =>
        /F-900-D1-01 \(P2\) is an accepted limitation/.test(b),
      ),
    );
  });

  // F-150-R1-02: the owner's approval is bound to the exact head commit (a commit status posted by
  // the trusted workflow), never inferred from labels in an event.
  test('governance merges only with the owner approval of the exact head', () => {
    const governance = { evidence: 'complete', tier: 'governance' };
    assert.equal(mergeDecision(governance).merge, false);
    assert.equal(
      mergeDecision(governance, { labels: ['owner-approved-merge'], action: 'labeled' }).merge,
      false,
    );
    assert.equal(mergeDecision(governance, { ownerApprovedHead: true }).merge, true);
    assert.equal(
      mergeDecision({ ...governance, evidence: 'incomplete' }, { ownerApprovedHead: true }).merge,
      false,
    );
  });

  test('the merge policy never passes incomplete evidence', () => {
    const incomplete = { evidence: 'incomplete', tier: 'normal' };
    assert.equal(mergeDecision(incomplete).merge, false);
    assert.equal(mergeDecision({ ...incomplete, tier: 'high' }).merge, false);
    assert.equal(mergeDecision({ evidence: 'not-needed', tier: 'low' }).merge, true);
    assert.equal(mergeDecision({ evidence: 'complete', tier: 'normal' }).merge, true);
  });

  // The owner's rule of 2026-11-09: 5 rounds; 6 to 8 only while issues fall; more only with
  // the owner's label. `counts` are each round's issue counts (the Findings column).
  function chainOf(name, counts) {
    branch(name);
    const commits = [main];
    for (let i = 0; i < counts.length; i += 1)
      commits.push(commit({ 'apps/web/src/a.ts': `export const a = ${100 + i};\n` }, `c${i}`));
    const reviews = counts.map((findings, i) => ({
      round: String(i + 1),
      mode: i === 0 ? 'checkpoint' : 'rereview',
      base: commits[i],
      reviewed: commits[i + 1],
      result: i === counts.length - 1 ? 'approve' : 'needs-attention',
      findings,
    }));
    return commit({ 'docs/reviews/F-900.md': register({ reviews }) }, 'register');
  }

  test('five rounds need no progress', () => {
    const head = chainOf('five', [2, 2, 2, 2, 0]);
    assert.deepEqual(evaluate({ base: main, head }).blockers, []);
  });

  test('rounds 6 to 8 need falling issue counts', () => {
    const stuck = chainOf('stuck', [3, 3, 3, 3, 3, 0]);
    assert.ok(
      evaluate({ base: main, head: stuck }).blockers.some((b) =>
        /Review 6 should not have run: .*measurable progress/.test(b),
      ),
    );
    const falling = chainOf('falling', [6, 5, 5, 4, 3, 2, 1, 0]);
    assert.deepEqual(evaluate({ base: main, head: falling }).blockers, []);
  });

  test("a ninth round needs the owner's label, even with progress", () => {
    const head = chainOf('nine', [9, 8, 7, 6, 5, 4, 3, 2, 0]);
    assert.ok(
      evaluate({ base: main, head }).blockers.some((b) =>
        /Review 9 should not have run: 8 rounds ran/.test(b),
      ),
    );
    assert.deepEqual(
      evaluate({ base: main, head, labels: ['owner-approved-extra-review-round'] }).blockers,
      [],
    );
  });

  test('reaching a limit is never approval: an escalated register blocks', () => {
    branch('escalated');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 70;\n' }, 'code');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          status: 'escalated',
          reviews: [
            { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'approve' },
          ],
        }),
      },
      'register',
    );
    assert.ok(
      evaluate({ base: main, head }).blockers.some((b) => /escalated to the owner/.test(b)),
    );
  });

  test('the last review must approve unless it raised only P3 findings', () => {
    branch('lastreview');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 80;\n' }, 'code');
    const reviews = [
      { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'needs-attention' },
    ];
    // A P2 Claude rejected in the last round is a disagreement for the owner, not a pass.
    const disputed = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews,
          findings: [{ id: 'F-900-R1-01', sev: 'P2', status: 'rejected', evidence: 'disagree' }],
        }),
      },
      'register',
    );
    assert.ok(
      evaluate({ base: main, head: disputed }).blockers.some((b) =>
        /round 1\) did not approve and raised F-900-R1-01/.test(b),
      ),
    );
    const minor = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews,
          findings: [{ id: 'F-900-R1-01', sev: 'P3', status: 'rejected', evidence: 'cosmetic' }],
        }),
      },
      'register only P3',
    );
    assert.deepEqual(evaluate({ base: main, head: minor }).blockers, []);
  });

  // F-149-R1-03: a failed attempt is not a round.
  test('a failed attempt does not count toward the limit', () => {
    branch('failedattempt');
    const commits = [main];
    for (let i = 0; i < 3; i += 1)
      commits.push(commit({ 'apps/web/src/a.ts': `export const a = ${40 + i};\n` }, `c${i}`));
    const reviews = [
      { round: '1', mode: 'checkpoint', base: main, reviewed: commits[1], result: 'failed' },
      ...[1, 2, 3].map((n) => ({
        round: String(n),
        mode: n === 1 ? 'checkpoint' : 'rereview',
        base: commits[n - 1],
        reviewed: commits[n],
        result: 'approve',
      })),
    ];
    const head = commit({ 'docs/reviews/F-900.md': register({ reviews }) }, 'register');
    assert.deepEqual(evaluate({ base: main, head }).blockers, []);
  });

  // F-149-D1-02 / R1-01: a fix counts only when a later code review saw it.
  test('a fix verified by a review that did not include the fix commit is incomplete', () => {
    branch('prefix');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 50;\n' }, 'code');
    const c2 = commit({ 'apps/web/src/a.ts': 'export const a = 51;\n' }, 'fix');
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'needs-attention' },
            { round: '2', mode: 'rereview', base: c1, reviewed: c2, result: 'approve' },
          ],
          findings: [
            {
              id: 'F-900-R1-01',
              sev: 'P2',
              status: 'fixed',
              fix: 'deadbee',
              test: 'a.test.ts',
              verified: 'R2',
            },
            // Claims a fix made after the review that verified it.
            { id: 'F-900-R1-02', sev: 'P2', status: 'fixed', fix: c2, test: 't', verified: 'R1' },
          ],
        }),
      },
      'register',
    );
    const blockers = evaluate({ base: main, head }).blockers;
    assert.ok(blockers.some((b) => /F-900-R1-01.*fix commit deadbee/.test(b)));
    assert.ok(blockers.some((b) => /F-900-R1-02.*verified in round 1/.test(b)));
  });

  // F-149-D1-02, Codex round 2: a Fix cell that is not a commit must not skip the check.
  test('a fix cell that is not a bare commit hash is incomplete', () => {
    branch('badfix');
    const c1 = commit({ 'apps/web/src/a.ts': 'export const a = 60;\n' }, 'code');
    const c2 = commit({ 'apps/web/src/a.ts': 'export const a = 61;\n' }, 'fix');
    const fixed = (id, fix) => ({ id, sev: 'P2', status: 'fixed', fix, test: 't', verified: 'R2' });
    const head = commit(
      {
        'docs/reviews/F-900.md': register({
          reviews: [
            { round: '1', mode: 'checkpoint', base: main, reviewed: c1, result: 'needs-attention' },
            { round: '2', mode: 'rereview', base: c1, reviewed: c2, result: 'approve' },
          ],
          findings: [
            fixed('F-900-R1-01', `${c2.slice(0, 7)} (fix)`),
            fixed('F-900-R1-02', 'not-a-commit'),
            fixed('F-900-R1-03', `\`${c2.slice(0, 7)}\``),
          ],
        }),
      },
      'register',
    );
    const blockers = evaluate({ base: main, head }).blockers;
    assert.ok(
      blockers.some((b) => /F-900-R1-01.*not a commit hash/.test(b)),
      blockers.join('\n'),
    );
    assert.ok(
      blockers.some((b) => /F-900-R1-02.*not a commit hash/.test(b)),
      blockers.join('\n'),
    );
    assert.ok(!blockers.some((b) => /F-900-R1-03/.test(b)), blockers.join('\n'));
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
  // F-149-D1-02 / R1-01: only a successful code review after the finding can verify it.
  test('a fix verified by a design review, a failed review or its own round is not verified', () => {
    const blockers = registerBlockers({
      id: 'F-900',
      problems: [],
      reviews: [
        { round: 'D1', mode: 'design', base: null, reviewed: 'a', result: 'needs-attention' },
        { round: '1', mode: 'checkpoint', base: 'a', reviewed: 'b', result: 'needs-attention' },
        { round: '2', mode: 'rereview', base: 'b', reviewed: 'c', result: 'failed' },
        { round: '2', mode: 'rereview', base: 'b', reviewed: 'd', result: 'approve' },
      ],
      findings: [
        { id: 'F-900-D1-01', severity: 'P2', status: 'fixed', fix: 'x', test: 't', verified: 'D1' },
        { id: 'F-900-R1-01', severity: 'P2', status: 'fixed', fix: 'x', test: 't', verified: 'R1' },
        { id: 'F-900-R1-02', severity: 'P2', status: 'fixed', fix: 'x', test: 't', verified: 'R2' },
        { id: 'F-900-D1-02', severity: 'P2', status: 'fixed', fix: 'x', test: 't', verified: 'R1' },
      ],
    });
    assert.ok(blockers.some((b) => /F-900-D1-01 .*verified in round D1/.test(b)));
    assert.ok(blockers.some((b) => /F-900-R1-01 .*verified in round 1/.test(b)));
    assert.ok(!blockers.some((b) => /F-900-R1-02/.test(b)), blockers.join('\n'));
    assert.ok(!blockers.some((b) => /F-900-D1-02/.test(b)), blockers.join('\n'));
  });

  // F-149-R1-02: successive checkpoints continue the chain.
  test('the next review starts where the last completed code review stopped', () => {
    assert.equal(nextReviewBase([], 'checkpoint'), null);
    const rounds = [
      { mode: 'design', status: 'completed', reviewed: 'd' },
      { mode: 'checkpoint', status: 'completed', reviewed: 'b' },
      { mode: 'checkpoint', status: 'failed', reviewed: 'c' },
    ];
    assert.equal(nextReviewBase(rounds, 'checkpoint'), 'b');
    assert.equal(nextReviewBase(rounds, 'rereview'), 'b');
  });

  test('which rounds may run', () => {
    assert.equal(roundAllowed(5, [9, 9, 9, 9]).allowed, true);
    assert.equal(roundAllowed(6, [9, 9, 9, 9, 9]).allowed, false);
    assert.equal(roundAllowed(6, [9, 9, 9, 9, 4]).allowed, true);
    assert.equal(roundAllowed(8, [7, 6, 5, 4, 3, 2, 1]).allowed, true);
    assert.equal(roundAllowed(9, [8, 7, 6, 5, 4, 3, 2, 1]).allowed, false);
    assert.equal(roundAllowed(9, [8, 7, 6, 5, 4, 3, 2, 1], { ownerApproved: true }).allowed, true);
    assert.equal(roundAllowed(2, [1], { escalated: true }).allowed, false);
  });

  test('a round counts each problem once, and stops on recurrence or disagreement', () => {
    // Codex's own duplicate_of; the runner copies it, or a nearby known finding, into
    // probable_duplicate_of.
    const finding = (severity, dup = null) => ({
      severity,
      duplicate_of: dup,
      probable_duplicate_of: dup,
    });
    // F-149-R4-01: a finding the runner only matched by nearness (Codex: duplicate_of null) is
    // advisory; it neither escalates nor merges issues.
    const nearby = { severity: 'P2', duplicate_of: null, probable_duplicate_of: 'X-R1-02' };
    const unconfirmed = roundOutcome({
      findings: [nearby],
      verifiedFixes: [],
      previous: null,
      known: [{ id: 'X-R1-02', severity: 'P2', status: 'rejected' }],
    });
    assert.equal(unconfirmed.escalation, null);
    assert.equal(
      roundOutcome({
        findings: [{ ...nearby, probable_duplicate_of: 'X-R1-01' }],
        verifiedFixes: [{ id: 'X-R1-01', status: 'not-fixed', note: '' }],
        previous: null,
        known: [],
      }).issues,
      2,
    );
    const notFixed = (id) => ({ id, status: 'not-fixed', note: '' });
    const known = [
      { id: 'X-R1-01', severity: 'P2', status: 'fixed' },
      { id: 'X-R1-02', severity: 'P2', status: 'rejected' },
    ];
    // A not-fixed fix that a new finding repeats is one issue, not two.
    const repeated = roundOutcome({
      findings: [finding('P2', 'X-R1-01')],
      verifiedFixes: [notFixed('X-R1-01')],
      previous: null,
      known,
    });
    assert.equal(repeated.issues, 1);
    assert.equal(repeated.escalation, null);
    // Not fixed again with no fall in issues: recurring without progress.
    const recurring = roundOutcome({
      findings: [],
      verifiedFixes: [notFixed('X-R1-01')],
      previous: { issues: 1, notFixed: ['X-R1-01'] },
      known,
    });
    assert.match(recurring.escalation ?? '', /recurring without progress: X-R1-01/);
    // Not fixed again but issues fell: progress, keep going.
    const progressing = roundOutcome({
      findings: [],
      verifiedFixes: [notFixed('X-R1-01')],
      previous: { issues: 3, notFixed: ['X-R1-01'] },
      known,
    });
    assert.equal(progressing.escalation, null);
    // Codex raising again a P2 Claude rejected: a disagreement for the owner; a P3 is not.
    assert.match(
      roundOutcome({
        findings: [finding('P2', 'X-R1-02')],
        verifiedFixes: [],
        previous: null,
        known,
      }).escalation ?? '',
      /disagreement: Codex raises again X-R1-02 as P2/,
    );
    assert.equal(
      roundOutcome({
        findings: [finding('P3', 'X-R1-02')],
        verifiedFixes: [],
        previous: null,
        known,
      }).escalation,
      null,
    );
    // A design review never escalates.
    assert.equal(
      roundOutcome({
        findings: [finding('P2', 'X-R1-02')],
        verifiedFixes: [],
        previous: undefined,
        known,
      }).escalation,
      null,
    );
  });

  test('malformed registers are reported', () => {
    const parsed = parseRegister('# Something else\n');
    assert.ok(parsed.problems.length >= 3);
  });
  test('risk tiers follow the paths', () => {
    assert.equal(fileTier('supabase/migrations/2026_x.sql'), 'high');
    assert.equal(fileTier('apps/api/src/telnyx.ts'), 'high');
    assert.equal(fileTier('packages/domain/src/money.ts'), 'high');
    assert.equal(fileTier('docs/DECISIONS.md'), 'normal');
    assert.equal(fileTier('apps/web/src/components/MapLayers.tsx'), 'normal');
    assert.equal(fileTier('tests/e2e/specs/counterparties.spec.ts'), 'low');
    assert.equal(fileTier('docs/FEATURES.md'), 'low');
    assert.deepEqual(changeTier(['docs/FEATURES.md', 'apps/web/src/x.tsx']).tier, 'normal');
  });

  // The owner's decision of 2026-11-09: the rules and machinery of merging are governance.
  test('governance covers the merge machinery and the rule documents', () => {
    for (const path of [
      '.github/workflows/ci.yml',
      '.github/workflows/merge-policy.yml',
      '.claude/hooks/guard-merge.js',
      '.claude/settings.json',
      'scripts/review-gate.js',
      'scripts/guard-merge.test.js',
      'AGENTS.md',
      'docs/AI_WORKFLOW.md',
      'docs/TRADING_RULES.md',
      'docs/reviews/ACCEPTED.md',
    ])
      assert.equal(fileTier(path), 'governance', path);
    assert.equal(changeTier(['supabase/migrations/x.sql', 'AGENTS.md']).tier, 'governance');
  });

  // F-150-R1-03: existing authentication, routing and FX entry points are high risk.
  test('authentication, routing and FX entry points are high risk', () => {
    for (const path of [
      'apps/api/src/index.ts',
      'apps/web/src/auth/AuthGate.tsx',
      'apps/web/src/auth/MfaChallenge.tsx',
      'apps/web/src/lib/fx.ts',
      'apps/web/src/lib/orderBook.ts',
      'apps/web/src/lib/workspaceQuotes.ts',
      'apps/web/src/lib/quotes.ts',
      'apps/web/src/lib/freight.ts',
      'apps/web/src/lib/api.ts',
      'apps/web/src/lib/supabase.ts',
      // F-150-D1-03: the authenticated database user, and the domain package's exports.
      'apps/api/src/respond.ts',
      'packages/domain/src/index.ts',
      // F-150-R3-01: every API module (database access, organization scoping, admin writes), and
      // the shared validation of prices, quantities and validity, and of uploaded logos.
      'apps/api/src/map-layers-db.ts',
      'apps/api/src/counterparties.ts',
      'apps/api/src/crm-db.ts',
      'apps/api/src/geocoding.ts',
      'packages/domain/src/terms.ts',
      'packages/domain/src/png.ts',
    ])
      assert.equal(fileTier(path), 'high', path);
    // Tests of the API are still tests.
    assert.equal(fileTier('apps/api/src/crm.test.ts'), 'low');
    assert.equal(fileTier('apps/api/src/crm.db.test.ts'), 'low');
  });

  // F-150-D1-04: agent instructions and configuration at any depth are governance, never documents.
  test('nested agent instructions and configuration are governance', () => {
    for (const path of [
      'apps/web/CLAUDE.md',
      'apps/api/AGENTS.md',
      'packages/domain/GEMINI.md',
      'apps/web/.claude/settings.json',
      '.gemini/settings.json',
      'apps/api/.codex/config.toml',
    ])
      assert.equal(fileTier(path), 'governance', path);
    assert.equal(documentsOnly(['apps/web/CLAUDE.md']), false);
  });
});
