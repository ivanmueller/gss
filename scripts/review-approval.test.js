// Tests of the owner's approval of a governance pull request (F-150): node --test 'scripts/*.test.js'
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { approvalLine, ownerApprovedHead } from './review-approval.js';

const OWNER = 'owner';
const HEAD = 'b'.repeat(40);
const OLD = 'a'.repeat(40);
const base = {
  owner: OWNER,
  headSha: HEAD,
  firstSeen: '2026-11-09T20:00:00Z',
  labelPresent: true,
  timeline: [
    {
      event: 'labeled',
      label: { name: 'owner-approved-merge' },
      actor: { login: OWNER },
      created_at: '2026-11-09T20:10:00Z',
    },
  ],
  comments: [
    {
      user: { login: OWNER },
      body: `approve-merge ${HEAD.slice(0, 7)}`,
      created_at: '2026-11-09T20:09:00Z',
    },
  ],
};

describe("owner's approval of a governance pull request", () => {
  test('the line to copy names the exact head commit', () => {
    assert.equal(approvalLine(HEAD), `approve-merge ${HEAD.slice(0, 12)}`);
  });

  test('approved: the owner named this commit and labelled after it arrived', () => {
    assert.equal(ownerApprovedHead(base), true);
  });

  // F-150-D1-02: the owner inspected an earlier commit; a push landed just before the label.
  test('a comment naming another commit does not approve the head', () => {
    const comments = [{ ...base.comments[0], body: `approve-merge ${OLD.slice(0, 7)}` }];
    assert.equal(ownerApprovedHead({ ...base, comments }), false);
  });

  test('a label from before the commit arrived does not approve it', () => {
    assert.equal(ownerApprovedHead({ ...base, firstSeen: '2026-11-09T20:30:00Z' }), false);
  });

  test('a label that was removed does not approve', () => {
    assert.equal(ownerApprovedHead({ ...base, labelPresent: false }), false);
  });

  // F-150-D1-01 / R1-02: only the owner's own actions count; a workflow (github-actions[bot]) or
  // anyone else adding the label or the comment approves nothing, and statuses are never read.
  test("someone else's label or comment approves nothing", () => {
    const bot = { login: 'github-actions[bot]' };
    assert.equal(
      ownerApprovedHead({ ...base, timeline: [{ ...base.timeline[0], actor: bot }] }),
      false,
    );
    assert.equal(
      ownerApprovedHead({ ...base, comments: [{ ...base.comments[0], user: bot }] }),
      false,
    );
  });

  // F-150-R2-01: only the latest change of the label counts.
  test('an approval the owner withdrew cannot be restored by someone else re-adding the label', () => {
    const at = (event, login, time) => ({
      event,
      label: { name: 'owner-approved-merge' },
      actor: { login },
      created_at: time,
    });
    const timeline = [
      at('labeled', OWNER, '2026-11-09T20:10:00Z'),
      at('unlabeled', OWNER, '2026-11-09T20:20:00Z'),
      at('labeled', 'github-actions[bot]', '2026-11-09T20:30:00Z'),
    ];
    assert.equal(ownerApprovedHead({ ...base, timeline }), false);
    // The owner labelling again afterwards approves.
    assert.equal(
      ownerApprovedHead({
        ...base,
        timeline: [...timeline, at('labeled', OWNER, '2026-11-09T20:40:00Z')],
      }),
      true,
    );
  });

  // F-156: GitHub may save the owner's line as a pull request review instead of a comment.
  describe('the line in a review (F-156)', () => {
    const review = (fields = {}) => ({
      user: { login: OWNER },
      state: 'COMMENTED',
      body: `approve-merge ${HEAD.slice(0, 12)}`,
      submitted_at: '2026-11-09T20:09:00Z',
      ...fields,
    });
    const viaReview = (reviews, extra = {}) =>
      ownerApprovedHead({ ...base, comments: [], reviews, ...extra });

    test("the owner's submitted review naming the head approves, without a comment", () => {
      assert.equal(viaReview([review()]), true);
      assert.equal(viaReview([review({ state: 'APPROVED' })]), true);
    });

    test('a draft, dismissed or changes-requested review approves nothing', () => {
      for (const state of ['PENDING', 'DISMISSED', 'CHANGES_REQUESTED', undefined])
        assert.equal(viaReview([review({ state })]), false, String(state));
    });

    test("someone else's review approves nothing", () => {
      assert.equal(viaReview([review({ user: { login: 'github-actions[bot]' } })]), false);
      assert.equal(viaReview([review({ user: undefined })]), false);
    });

    test('a review naming another commit, a short name or the line inside other text approves nothing', () => {
      for (const body of [
        `approve-merge ${OLD.slice(0, 12)}`,
        `approve-merge ${HEAD.slice(0, 6)}`,
        `please do not approve-merge ${HEAD.slice(0, 7)}`,
        '',
        undefined,
      ])
        assert.equal(viaReview([review({ body })]), false, String(body));
    });

    test('the label rules still apply to an approval by review', () => {
      assert.equal(viaReview([review()], { labelPresent: false }), false);
      assert.equal(viaReview([review()], { firstSeen: '2026-11-09T20:15:00Z' }), false);
      assert.equal(
        viaReview([review()], {
          timeline: [
            ...base.timeline,
            { ...base.timeline[0], event: 'unlabeled', created_at: '2026-11-09T20:20:00Z' },
          ],
        }),
        false,
      );
    });

    test('an input without reviews still reads comments', () => {
      assert.equal('reviews' in base, false);
      assert.equal(ownerApprovedHead(base), true);
    });
  });

  test('a short or partial commit name, or a mention inside other text, approves nothing', () => {
    for (const body of [
      `approve-merge ${HEAD.slice(0, 6)}`,
      `please do not approve-merge ${HEAD.slice(0, 7)}`,
      `approve-merge ${HEAD.slice(0, 7)}x`,
    ])
      assert.equal(
        ownerApprovedHead({ ...base, comments: [{ ...base.comments[0], body }] }),
        false,
        body,
      );
  });
});
