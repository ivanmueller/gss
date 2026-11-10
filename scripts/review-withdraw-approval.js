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

export function withdrawStaleApprovals({ gh = runGh, repo, owner, log = console.log }) {
  const open = json(gh, `repos/${repo}/pulls?state=open&base=main&per_page=100`).filter((pr) =>
    (pr.labels ?? []).some((label) => label.name === APPROVAL_LABEL),
  );
  const withdrawn = [];
  for (const pr of open) {
    const headSha = pr.head?.sha;
    if (ownerApprovedHead(approvalInput(gh, repo, owner, pr.number, headSha))) {
      log(`#${pr.number}: the owner still approves ${headSha.slice(0, 7)}.`);
      continue;
    }
    if (pr.auto_merge) gh(['pr', 'merge', String(pr.number), '--repo', repo, '--disable-auto']);
    gh(['pr', 'edit', String(pr.number), '--repo', repo, '--remove-label', APPROVAL_LABEL]);
    gh([
      'pr',
      'comment',
      String(pr.number),
      '--repo',
      repo,
      '--body',
      "The owner's approval of this commit no longer holds (an approval comment or review was edited, deleted or dismissed), so it is withdrawn: the label **owner-approved-merge** is off and automatic merging is off. To approve again, comment the `approve-merge` line for the current commit, then add the label.",
    ]);
    log(`#${pr.number}: approval withdrawn; ${rerunPolicy(gh, repo, headSha)}.`);
    withdrawn.push(pr.number);
  }
  return withdrawn;
}

if (process.argv[1]?.endsWith('review-withdraw-approval.js')) {
  const [repo, owner] = process.argv.slice(2);
  if (!repo || !owner) throw new Error('usage: review-withdraw-approval.js <owner/repo> <owner>');
  withdrawStaleApprovals({ repo, owner });
}
