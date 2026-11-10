// The owner's approval of a governance pull request at one exact commit (F-150, docs/AI_WORKFLOW.md
// §11.6). Used by the Merge policy workflow, which runs only from main's copy.
//
// The owner approves by (1) commenting the line the workflow gives for the head commit,
// `approve-merge <commit>`, as an ordinary comment or in a submitted pull request review (F-156: GitHub
// may save what the owner types as a review), and (2) adding the label owner-approved-merge. Both must be
// the repository owner's own actions, read from GitHub's records (comments, reviews, the pull request's
// timeline), never from an event's payload, commit statuses or anything a workflow can write
// (F-150-D1-01, R1-02). The line names the commit the owner inspected, so a push just before the label
// approves nothing (D1-02); the label must come after GitHub first saw the head commit, and still be on
// the pull request. Removing the label withdraws an approval (the Merge policy runs again); so does
// editing, deleting or dismissing one of the owner's comments or reviews, through
// .github/workflows/approval-withdrawn.yml (F-156-D1-01).
//
//   node scripts/review-approval.js <input.json>   prints "yes" or "no"
//   input: { owner, headSha, firstSeen, labelPresent, timeline: [...], comments: [...], reviews: [...] }
import { readFileSync } from 'node:fs';

export const APPROVAL_LABEL = 'owner-approved-merge';

/** The exact line the owner comments to approve a commit. */
export const approvalLine = (sha) => `approve-merge ${sha.slice(0, 12)}`;

/** Whether a comment's or review's text has a line approving exactly this commit. */
const namesHead = (body, headSha) =>
  String(body ?? '')
    .split(/\r?\n/)
    .some((line) => {
      const sha = /^\s*approve-merge\s+([0-9a-f]{7,40})\s*$/.exec(line)?.[1];
      return Boolean(sha) && headSha.startsWith(sha);
    });

// A review counts once submitted as a comment or an approval: not a draft (PENDING), not dismissed
// (DISMISSED), and not one asking for changes (CHANGES_REQUESTED).
const SUBMITTED_REVIEW = new Set(['COMMENTED', 'APPROVED']);

export function ownerApprovedHead({
  owner,
  headSha,
  firstSeen,
  labelPresent,
  timeline,
  comments,
  reviews = [],
}) {
  if (!owner || !headSha || !firstSeen || !labelPresent) return false;
  const named =
    comments.some((comment) => comment.user?.login === owner && namesHead(comment.body, headSha)) ||
    reviews.some(
      (review) =>
        review.user?.login === owner &&
        SUBMITTED_REVIEW.has(review.state) &&
        namesHead(review.body, headSha),
    );
  if (!named) return false;
  // Only the latest change of the label counts (F-150-R2-01): an approval the owner withdrew
  // cannot be restored by anyone else adding the label again.
  const latest = timeline
    .filter(
      (event) =>
        (event.event === 'labeled' || event.event === 'unlabeled') &&
        event.label?.name === APPROVAL_LABEL,
    )
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
    .at(-1);
  return (
    latest?.event === 'labeled' &&
    latest.actor?.login === owner &&
    String(latest.created_at) > String(firstSeen)
  );
}

if (process.argv[1]?.endsWith('review-approval.js')) {
  const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log(ownerApprovedHead(input) ? 'yes' : 'no');
}
