// Review evidence check (docs/AI_WORKFLOW.md §11.6). For a pull request it says:
//   - its risk tier (low, normal, high) from the files it changes;
//   - whether its review register (docs/reviews/<ID>.md) is complete for the exact head commit:
//     every code review round chained from a commit on the base branch to a commit after which only
//     docs/reviews/ changed, no blocking finding, fixes verified by Codex, the last review
//     approving, not escalated, and every round within the limits (5; up to 8 with progress;
//     more only with the owner's label);
//   - whether it may merge (mergeDecision, F-150): low and normal risk with complete evidence; high
//     risk only with the owner's label owner-approved-merge on this head. With --policy this is the
//     exit code: the Merge policy check, which GitHub can require before any merge.
// It reads git data only and never runs code from the pull request.
//
//   node scripts/review-gate.js --base <base sha or ref> --head <head sha> [--labels a,b] [--json]
//
// Exit code 0: evidence complete, or not needed (documents only). 1: evidence missing or incomplete.
// 2: usage or git error.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import {
  changeTier,
  codeReviewChain,
  documentsOnly,
  isRegisterPath,
  OWNER_APPROVAL_LABEL,
  OWNER_MERGE_LABEL,
  parseRegister,
  registerBlockers,
  verifyingReview,
} from './review-register.js';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
}
const isAncestor = (a, b) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', a, b]);
    return true;
  } catch {
    return false;
  }
};
const changedFiles = (from, to) =>
  git(['diff', '--name-only', '--no-renames', from, to]).split('\n').filter(Boolean);

export function evaluate({ base, head, labels = [] }) {
  const mergeBase = git(['merge-base', base, head]);
  const files = changedFiles(mergeBase, head);
  const { tier, because } = changeTier(files);
  const result = {
    head,
    mergeBase,
    files: files.length,
    tier,
    because,
    blockers: [],
    register: null,
  };

  if (files.length === 0) return { ...result, evidence: 'not-needed', note: 'No changed files.' };
  if (documentsOnly(files))
    return { ...result, evidence: 'not-needed', note: 'Documents only: no Codex review needed.' };

  const registers = files.filter(isRegisterPath);
  if (registers.length !== 1) {
    result.blockers.push(
      registers.length === 0
        ? 'No review register (docs/reviews/<ID>.md) is added or changed by this pull request.'
        : `Several review registers changed (${registers.join(', ')}); a pull request has exactly one.`,
    );
    return { ...result, evidence: 'incomplete' };
  }
  result.register = registers[0];
  const register = parseRegister(git(['show', `${head}:${registers[0]}`]));
  const ownerApproved = labels.includes(OWNER_APPROVAL_LABEL);
  result.blockers.push(...registerBlockers(register, { ownerApproved }));

  const known = (sha) => {
    try {
      git(['cat-file', '-e', `${sha}^{commit}`]);
      return true;
    } catch {
      return false;
    }
  };

  // A fix counts only if the review that verified it saw the fix commit (F-149-D1-02).
  for (const finding of register.findings.filter((f) => f.status === 'fixed')) {
    const review = verifyingReview(register, finding);
    const fix = (finding.fix ?? '').replace(/`/g, '').trim();
    if (!review || fix === '' || fix === '—' || fix === '-') continue; // reported elsewhere
    // Anything but a bare commit hash would skip the check below (Codex, F-149 round 2).
    if (!/^[0-9a-f]{7,40}$/.test(fix)) {
      result.blockers.push(
        `Finding ${finding.id}: its Fix cell "${fix}" is not a commit hash (write the commit alone).`,
      );
      continue;
    }
    if (!known(fix) || !known(review.reviewed) || !isAncestor(fix, review.reviewed))
      result.blockers.push(
        `Finding ${finding.id}: fix commit ${fix} is not in the commit review ${review.round} saw (${review.reviewed}).`,
      );
  }

  // The chain of code reviews must cover every change from the base branch to the head.
  const chain = codeReviewChain(register);
  for (const [i, review] of chain.entries()) {
    if (!known(review.reviewed) || (review.base && !known(review.base))) {
      result.blockers.push(`Review ${review.round}: its commits are not in this repository.`);
      continue;
    }
    if (i === 0) {
      if (!isAncestor(review.base, mergeBase))
        result.blockers.push(
          `Review ${review.round} starts at ${review.base}, which is not on the base branch: it does not cover the whole pull request.`,
        );
    } else if (
      !chain[i - 1].reviewed.startsWith(review.base) &&
      !review.base.startsWith(chain[i - 1].reviewed)
    ) {
      result.blockers.push(
        `Review ${review.round} starts at ${review.base}, not where review ${chain[i - 1].round} stopped (${chain[i - 1].reviewed}).`,
      );
    }
    if (!isAncestor(review.reviewed, head))
      result.blockers.push(
        `Review ${review.round}'s commit ${review.reviewed} is not in this pull request's history.`,
      );
  }
  const last = chain.at(-1);
  if (last && isAncestor(last.reviewed, head)) {
    const after = changedFiles(last.reviewed, head).filter(
      (path) => !path.startsWith('docs/reviews/'),
    );
    if (after.length)
      result.blockers.push(
        `Changed after the last review (${last.reviewed}), outside docs/reviews/: ${after.join(', ')}. A re-review must cover them.`,
      );
  }
  return { ...result, evidence: result.blockers.length ? 'incomplete' : 'complete' };
}

/**
 * The merge policy (F-150, the owner's authorization of 2026-11-09): low and normal risk may merge
 * once the review evidence is complete (or not needed); high risk only with the owner's label
 * `owner-approved-merge` on this head commit (a push removes it, so on `synchronize` it never
 * counts). Required checks (CI) are GitHub's to enforce beside this one.
 */
export function mergeDecision(outcome, { labels = [], action = '' } = {}) {
  if (outcome.evidence === 'incomplete')
    return { merge: false, reason: 'no: review evidence incomplete' };
  if (outcome.tier !== 'high') return { merge: true, reason: `yes (${outcome.tier} risk)` };
  if (labels.includes(OWNER_MERGE_LABEL) && action !== 'synchronize')
    return { merge: true, reason: `yes (high risk, approved by the owner: ${OWNER_MERGE_LABEL})` };
  return {
    merge: false,
    reason: `no: high risk, held for the owner's approval (label ${OWNER_MERGE_LABEL})`,
  };
}

export const eligibility = (outcome, options) => mergeDecision(outcome, options).reason;

function report(outcome, options) {
  const lines = [
    `Risk tier: ${outcome.tier}${outcome.because.length ? ` (${outcome.because.slice(0, 8).join(', ')}${outcome.because.length > 8 ? ', …' : ''})` : ''}`,
    `Head commit: ${outcome.head}`,
    `Review evidence: ${outcome.evidence}${outcome.note ? ` (${outcome.note})` : ''}`,
    ...(outcome.register ? [`Register: ${outcome.register}`] : []),
    ...outcome.blockers.map((blocker) => `  - ${blocker}`),
    `May merge: ${eligibility(outcome, options)}`,
  ];
  return lines.join('\n');
}

function main(argv) {
  const option = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = option('base');
  const head = option('head');
  if (!base || !head) {
    console.error(
      'Usage: node scripts/review-gate.js --base <ref> --head <sha> [--labels a,b] [--action <pull request event action>] [--policy] [--json]',
    );
    return 2;
  }
  const labels = (option('labels') ?? '').split(',').filter(Boolean);
  const options = { labels, action: option('action') ?? '' };
  let outcome;
  try {
    outcome = evaluate({ base, head: git(['rev-parse', `${head}^{commit}`]), labels });
  } catch (error) {
    console.error(`Git error: ${error.message}`);
    return 2;
  }
  const text = report(outcome, options);
  const decision = mergeDecision(outcome, options);
  console.log(
    argv.includes('--json')
      ? JSON.stringify({ ...outcome, merge: decision.merge, reason: decision.reason }, null, 2)
      : text,
  );
  const policy = argv.includes('--policy');
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## ${policy ? 'Merge policy' : 'Review evidence'}\n\n\`\`\`\n${text}\n\`\`\`\n`,
    );
  // --policy (the Merge policy check): pass only when this pull request may merge.
  if (policy) return decision.merge ? 0 : 1;
  return outcome.evidence === 'incomplete' ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('review-gate.js'))
  process.exitCode = main(process.argv.slice(2));
