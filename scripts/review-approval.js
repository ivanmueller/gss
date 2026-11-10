// The owner's approval of a governance pull request at one exact commit (F-150, docs/AI_WORKFLOW.md
// §11.6). Used by the Merge policy workflow, which runs only from main's copy.
//
// The owner approves by (1) commenting the line the workflow gives for the head commit,
// `approve-merge <commit>`, and (2) adding the label owner-approved-merge. Both must be the repository
// owner's own actions, read from GitHub's records (comments, the pull request's timeline), never from an
// event's payload, commit statuses or anything a workflow can write (F-150-D1-01, R1-02). The comment
// names the commit the owner inspected, so a push just before the label approves nothing (D1-02); the
// label must come after GitHub first saw the head commit, and still be on the pull request.
//
//   node scripts/review-approval.js <input.json>   prints "yes" or "no"
//   input: { owner, headSha, firstSeen, labelPresent, timeline: [...], comments: [...] }
import { readFileSync } from 'node:fs';

export const APPROVAL_LABEL = 'owner-approved-merge';

/** The exact line the owner comments to approve a commit. */
export const approvalLine = (sha) => `approve-merge ${sha.slice(0, 12)}`;

export function ownerApprovedHead({ owner, headSha, firstSeen, labelPresent, timeline, comments }) {
  if (!owner || !headSha || !firstSeen || !labelPresent) return false;
  const named = comments.some((comment) => {
    if (comment.user?.login !== owner) return false;
    return String(comment.body ?? '')
      .split(/\r?\n/)
      .some((line) => {
        const sha = /^\s*approve-merge\s+([0-9a-f]{7,40})\s*$/.exec(line)?.[1];
        return Boolean(sha) && headSha.startsWith(sha);
      });
  });
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
