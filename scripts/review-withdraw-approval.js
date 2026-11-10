// Withdraws the owner's approval of a governance pull request once it no longer holds (F-156-D1-01,
// R2-01, R2-02). Run by .github/workflows/approval-withdrawn.yml from main's copy only, after one of
// the owner's comments was edited or deleted or one of the owner's reviews was edited or dismissed.
//
// For every open pull request into main carrying the label owner-approved-merge, it reads GitHub's
// records afresh (as the Merge policy does) and asks scripts/review-approval.js whether the owner
// still approves the head commit. Where not: automatic merging off, the label off, a comment saying
// why, and the Merge policy run again on the head commit, after any run still in progress has
// finished (one in progress may already have read the approval as valid). It never grants anything.
// If the Merge policy cannot be run again, it fails loudly so the run shows red.
//
//   node scripts/review-withdraw-approval.js <owner/repo> <owner login>
import { execFileSync } from 'node:child_process';
import { APPROVAL_LABEL, ownerApprovedHead } from './review-approval.js';

const POLICY_WORKFLOW = 'merge-policy.yml';

/** gh with arguments, its output as text (throws when gh fails). */
export const runGh = (args) => execFileSync('gh', args, { encoding: 'utf8' });

const json = (gh, path) => JSON.parse(gh(['api', '--paginate', '--slurp', path]) || '[]').flat();

/** The same records the Merge policy reads (merge-policy.yml, "Did the owner approve…"). */
export function approvalInput(gh, repo, owner, pr, headSha) {
  const runs = json(
    gh,
    `repos/${repo}/actions/runs?head_sha=${headSha}&event=pull_request_target&per_page=100`,
  ).flatMap((page) => page.workflow_runs ?? []);
  const firstSeen = runs.map((run) => run.created_at).sort()[0] ?? '';
  const labels = json(gh, `repos/${repo}/issues/${pr}/labels?per_page=100`);
  return {
    owner,
    headSha,
    firstSeen,
    labelPresent: labels.some((label) => label.name === APPROVAL_LABEL),
    timeline: json(gh, `repos/${repo}/issues/${pr}/timeline?per_page=100`),
    comments: json(gh, `repos/${repo}/issues/${pr}/comments?per_page=100`),
    reviews: json(gh, `repos/${repo}/pulls/${pr}/reviews?per_page=100`),
  };
}

/** Runs the Merge policy again on the head commit, waiting for a run in progress first. */
export function rerunPolicy(gh, repo, headSha, { attempts = 3 } = {}) {
  const latest = () =>
    JSON.parse(
      gh([
        'api',
        `repos/${repo}/actions/workflows/${POLICY_WORKFLOW}/runs?head_sha=${headSha}&event=pull_request_target&per_page=1`,
      ]),
    ).workflow_runs?.[0];
  let failure;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const run = latest();
    if (!run) return 'no Merge policy run on this commit: nothing passed to undo';
    // A run in progress may already have read the approval as valid: let it finish, then run it again.
    if (run.status !== 'completed') gh(['run', 'watch', String(run.id), '--repo', repo]);
    try {
      gh(['run', 'rerun', String(run.id), '--repo', repo]);
      return `Merge policy run ${run.id} started again`;
    } catch (error) {
      failure = error;
    }
  }
  throw new Error(
    `The Merge policy could not be run again on ${headSha.slice(0, 7)}: ${failure?.message ?? failure}`,
  );
}

/**
 * `affected`: the pull request whose owner's comment or review was just edited, deleted or dismissed,
 * by number (a comment's event) or head commit (a review's, read through workflow_run, which names no
 * pull request for forks). Its approval is withdrawn outright, even if another copy of the line still
 * matches (F-156-R3-01): the owner changed something in the approval, so it must be given afresh. The
 * other labelled pull requests are re-checked and withdrawn only where the approval no longer holds.
 */
export function withdrawStaleApprovals({
  gh = runGh,
  repo,
  owner,
  affected = {},
  log = console.log,
}) {
  const open = json(gh, `repos/${repo}/pulls?state=open&base=main&per_page=100`).filter((pr) =>
    (pr.labels ?? []).some((label) => label.name === APPROVAL_LABEL),
  );
  const isAffected = (pr) =>
    (affected.pr !== undefined && String(pr.number) === String(affected.pr)) ||
    (affected.head !== undefined && pr.head?.sha === affected.head);
  const withdrawn = [];
  for (const pr of open) {
    const headSha = pr.head?.sha;
    if (!isAffected(pr) && ownerApprovedHead(approvalInput(gh, repo, owner, pr.number, headSha))) {
      log(`#${pr.number}: the owner still approves ${headSha.slice(0, 7)}.`);
      continue;
    }
    // Safe to repeat (several withdrawals may run at once, F-156-R5-01): automatic merging turned off
    // by another run meanwhile is fine; still on after a refusal is not.
    if (pr.auto_merge) {
      try {
        gh(['pr', 'merge', String(pr.number), '--repo', repo, '--disable-auto']);
      } catch (error) {
        const now = JSON.parse(gh(['api', `repos/${repo}/pulls/${pr.number}`]));
        if (now.auto_merge) throw error;
      }
    }
    gh(['pr', 'edit', String(pr.number), '--repo', repo, '--remove-label', APPROVAL_LABEL]);
    gh([
      'pr',
      'comment',
      String(pr.number),
      '--repo',
      repo,
      '--body',
      "One of the owner's comments or reviews here was edited, deleted or dismissed, so the approval of this commit is withdrawn: the label **owner-approved-merge** is off and automatic merging is off. To approve again, comment the `approve-merge` line for the current commit, then add the label.",
    ]);
    log(`#${pr.number}: approval withdrawn; ${rerunPolicy(gh, repo, headSha)}.`);
    withdrawn.push(pr.number);
  }
  return withdrawn;
}

if (process.argv[1]?.endsWith('review-withdraw-approval.js')) {
  const [repo, owner] = process.argv.slice(2);
  if (!repo || !owner) throw new Error('usage: review-withdraw-approval.js <owner/repo> <owner>');
  // From the workflow's environment: the pull request (a comment's event) or the head commit (a
  // review's, when review-changed.yml ran its job for one of the owner's reviews).
  const { AFFECTED_PR, AFFECTED_HEAD } = process.env;
  withdrawStaleApprovals({
    repo,
    owner,
    affected: {
      pr: /^\d+$/.test(AFFECTED_PR ?? '') ? AFFECTED_PR : undefined,
      head: /^[0-9a-f]{40}$/.test(AFFECTED_HEAD ?? '') ? AFFECTED_HEAD : undefined,
    },
  });
}
