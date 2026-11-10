// Tests of withdrawing the owner's approval once it no longer holds (F-156): node --test 'scripts/*.test.js'
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { rerunPolicy, withdrawStaleApprovals } from './review-withdraw-approval.js';

const REPO = 'o/r';
const OWNER = 'owner';
const HEAD = 'c'.repeat(40);
const quiet = () => undefined;
const LINE = `approve-merge ${HEAD.slice(0, 12)}`;

/** A fake gh: answers from the records given, and keeps every command it was asked to run. */
function fakeGh({
  comments = [],
  reviews = [],
  runs = [{ id: 7, status: 'completed' }],
  rerunFails = 0,
  autoMerge = true,
} = {}) {
  const calls = [];
  let rerunFailures = rerunFails;
  const pages = (value) => JSON.stringify([value]);
  const gh = (args) => {
    calls.push(args);
    const [cmd, sub] = args;
    if (cmd === 'api') {
      const path = args.at(-1);
      if (path.startsWith(`repos/${REPO}/pulls?state=open`))
        return pages([
          {
            number: 5,
            head: { sha: HEAD },
            labels: [{ name: 'owner-approved-merge' }],
            auto_merge: autoMerge ? {} : null,
          },
          { number: 6, head: { sha: 'd'.repeat(40) }, labels: [], auto_merge: {} },
        ]);
      if (path.includes('/actions/workflows/merge-policy.yml/runs'))
        return JSON.stringify({ workflow_runs: runs });
      if (path.includes('/actions/runs?'))
        return pages({ workflow_runs: [{ created_at: '2026-11-10T20:00:00Z' }] });
      if (path.endsWith('/labels?per_page=100')) return pages([{ name: 'owner-approved-merge' }]);
      if (path.includes('/timeline'))
        return pages([
          {
            event: 'labeled',
            label: { name: 'owner-approved-merge' },
            actor: { login: OWNER },
            created_at: '2026-11-10T20:10:00Z',
          },
        ]);
      if (path.includes('/comments')) return pages(comments);
      if (path.includes('/reviews')) return pages(reviews);
      throw new Error(`unexpected api ${path}`);
    }
    if (cmd === 'run' && sub === 'rerun' && rerunFailures > 0) {
      rerunFailures--;
      throw new Error('This workflow run cannot be rerun');
    }
    return '';
  };
  return { gh, calls };
}

const ran = (calls, ...prefix) =>
  calls.filter((args) => prefix.every((word, i) => args[i] === word));

describe("withdrawing the owner's approval (F-156-D1-01)", () => {
  test('an approval that still holds is left alone', () => {
    const { gh, calls } = fakeGh({ comments: [{ user: { login: OWNER }, body: LINE }] });
    assert.deepEqual(withdrawStaleApprovals({ gh, repo: REPO, owner: OWNER, log: quiet }), []);
    assert.equal(ran(calls, 'pr').length, 0);
    assert.equal(ran(calls, 'run').length, 0);
  });

  test('a dismissed approving review withdraws: automatic merging off, label off, Merge policy again', () => {
    const { gh, calls } = fakeGh({
      reviews: [{ user: { login: OWNER }, state: 'DISMISSED', body: LINE }],
    });
    assert.deepEqual(withdrawStaleApprovals({ gh, repo: REPO, owner: OWNER, log: quiet }), [5]);
    assert.deepEqual(ran(calls, 'pr', 'merge')[0], [
      'pr',
      'merge',
      '5',
      '--repo',
      REPO,
      '--disable-auto',
    ]);
    assert.deepEqual(ran(calls, 'pr', 'edit')[0], [
      'pr',
      'edit',
      '5',
      '--repo',
      REPO,
      '--remove-label',
      'owner-approved-merge',
    ]);
    assert.equal(ran(calls, 'pr', 'comment').length, 1);
    assert.deepEqual(ran(calls, 'run', 'rerun')[0], ['run', 'rerun', '7', '--repo', REPO]);
    // The label comes off before the Merge policy runs again, so the new run no longer finds it.
    const order = calls.map((args) => args.slice(0, 2).join(' '));
    assert.ok(order.indexOf('pr edit') < order.indexOf('run rerun'));
    // Pull requests without the label are not touched.
    assert.equal(
      calls.some((args) => args.includes('6')),
      false,
    );
  });

  test('an approval comment edited to remove the line withdraws', () => {
    const { gh } = fakeGh({ comments: [{ user: { login: OWNER }, body: 'looks fine' }] });
    assert.deepEqual(withdrawStaleApprovals({ gh, repo: REPO, owner: OWNER, log: quiet }), [5]);
  });

  test('automatic merging already off is not turned off again', () => {
    const { gh, calls } = fakeGh({ autoMerge: false });
    withdrawStaleApprovals({ gh, repo: REPO, owner: OWNER, log: quiet });
    assert.equal(ran(calls, 'pr', 'merge').length, 0);
  });
});

describe('running the Merge policy again (F-156-R2-01)', () => {
  test('a run still in progress, which may have read the approval as valid, is waited for, then run again', () => {
    const { gh, calls } = fakeGh({ runs: [{ id: 9, status: 'in_progress' }] });
    rerunPolicy(gh, REPO, HEAD);
    const order = calls
      .filter((args) => args[0] === 'run')
      .map((args) => args.slice(0, 3).join(' '));
    assert.deepEqual(order, ['run watch 9', 'run rerun 9']);
  });

  test('a refused re-run is tried again', () => {
    const { gh, calls } = fakeGh({ rerunFails: 2 });
    assert.match(rerunPolicy(gh, REPO, HEAD), /started again/);
    assert.equal(ran(calls, 'run', 'rerun').length, 3);
  });

  test('when the Merge policy cannot be run again, it fails loudly', () => {
    const { gh } = fakeGh({ rerunFails: 5 });
    assert.throws(() => rerunPolicy(gh, REPO, HEAD), /could not be run again/);
    const again = fakeGh({ rerunFails: 5 }).gh;
    assert.throws(
      () => withdrawStaleApprovals({ gh: again, repo: REPO, owner: OWNER, log: quiet }),
      /could not be run again/,
    );
  });

  test('no Merge policy run on the commit: nothing passed, nothing to run again', () => {
    const { gh, calls } = fakeGh({ runs: [] });
    assert.match(rerunPolicy(gh, REPO, HEAD), /nothing passed/);
    assert.equal(ran(calls, 'run').length, 0);
  });
});
