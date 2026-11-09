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
  fileTier,
  codeReviewChain,
  documentsOnly,
  isRegisterPath,
  OWNER_APPROVAL_LABEL,
  OWNER_MERGE_LABEL,
  STRONG_TIERS,
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
// Exact paths, NUL-separated: by default git quotes and escapes non-ASCII paths, which then matched
// no tier rule (F-150-R4-01).
const changedFiles = (from, to) =>
  git(['diff', '--name-only', '-z', '--no-renames', from, to]).split('\0').filter(Boolean);

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

  // Automated database checks (AGENTS.md, "Database rules"): a migration is never edited or removed
  // once it is on the base branch, and a new migration comes with pgTAP tests.
  // With -z, git writes status and path as separate NUL-terminated fields (F-150-R4-01).
  const fields = git([
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    mergeBase,
    head,
    '--',
    'supabase/migrations',
  ]).split('\0');
  const migrations = [];
  for (let i = 0; i + 1 < fields.length; i += 2)
    if (fields[i]) migrations.push([fields[i], fields[i + 1]]);
  for (const [status, path] of migrations)
    if (status !== 'A')
      result.blockers.push(
        `Migration ${path} is ${status === 'D' ? 'removed' : 'changed'}: migrations are only ever added (a new file).`,
      );
  // Only an added or changed pgTAP test (*.test.sql) counts; a deleted test or another file does
  // not (F-150-R5-02).
  const testFields = git([
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    mergeBase,
    head,
    '--',
    'supabase/tests/database',
  ]).split('\0');
  let testAdded = false;
  for (let i = 0; i + 1 < testFields.length; i += 2)
    if (/^[AM]$/.test(testFields[i]) && /\.test\.sql$/.test(testFields[i + 1])) testAdded = true;
  if (migrations.some(([status]) => status === 'A') && !testAdded)
    result.blockers.push(
      'A new migration without pgTAP tests: add or change a test in supabase/tests/database/.',
    );

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

  // The chain of code reviews must cover every change from the base branch to the head. Coverage
  // starts at the latest review that starts on the base branch (a full review of the whole pull
  // request, such as a high-risk final review); each review after it continues where the previous
  // one stopped.
  const chain = codeReviewChain(register);
  const onBase = (review) => known(review.base) && isAncestor(review.base, mergeBase);
  let start = -1;
  for (let i = chain.length - 1; i >= 0; i -= 1)
    if (onBase(chain[i])) {
      start = i;
      break;
    }
  if (chain.length && start < 0)
    result.blockers.push(
      `Review ${chain[0].round} starts at ${chain[0].base}, which is not on the base branch: no review covers the whole pull request.`,
    );
  for (const [i, review] of chain.entries()) {
    if (!known(review.reviewed) || (review.base && !known(review.base))) {
      result.blockers.push(`Review ${review.round}: its commits are not in this repository.`);
      continue;
    }
    if (
      i > start &&
      i > 0 &&
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

  // Stronger requirements for high risk and governance (the owner's decision, 2026-11-09).
  if (STRONG_TIERS.includes(tier)) {
    if (!last || last.mode !== 'final' || start !== chain.length - 1)
      result.blockers.push(
        `${tier} risk: the last code review must be a final review of the whole pull request from the base branch (run-review.js --mode final).`,
      );
    // No P3-only exception here (F-150-R2-02).
    else if (last.result !== 'approve')
      result.blockers.push(
        `${tier} risk: the final review (round ${last.round}) must approve; it says ${last.result}.`,
      );
    const designs = register.reviews.filter(
      (review) => review.mode === 'design' && review.result !== 'failed',
    );
    if (designs.length === 0)
      result.blockers.push(`${tier} risk: no design review (D round) of the plan is recorded.`);
    else if (
      last &&
      !designs.some((d) => {
        if (!known(d.reviewed) || !isAncestor(d.reviewed, last.reviewed)) return false;
        // Before the code (F-150-R6-01, R7-01): measured from the design snapshot's own fork point
        // from the base branch (so a later update from the base branch changes nothing), at most
        // the plan changed: ordinary documents, never code and never governance documents such as
        // AGENTS.md. A snapshot already on the base branch is before the code too.
        const fork = git(['merge-base', d.reviewed, base]);
        return changedFiles(fork, d.reviewed).every(
          (path) => path.endsWith('.md') && fileTier(path) === 'low',
        );
      })
    )
      result.blockers.push(
        `${tier} risk: the design review must come before the code: it must review a commit in this history with no change but Markdown since the base branch (${last.reviewed} is the last reviewed).`,
      );
    for (const finding of register.findings)
      if (finding.severity !== 'P3' && finding.status === 'accepted-limitation')
        result.blockers.push(
          `${tier} risk: ${finding.id} (${finding.severity}) is an accepted limitation; a serious finding left unfixed needs the owner's decision (requires-decision).`,
        );
  }
  return { ...result, evidence: result.blockers.length ? 'incomplete' : 'complete' };
}

/**
 * The merge policy (F-150; the owner's decisions of 2026-11-09): low, normal and high risk merge
 * automatically once the review evidence is complete (or not needed); high risk's evidence already
 * includes its stronger requirements (evaluate). Governance, the rules and machinery of merging,
 * also needs the owner's approval of this exact head commit: `ownerApprovedHead`, which the trusted
 * Merge policy workflow sets only when it finds its own `owner-approved-merge` commit status on the
 * head SHA (posted when the owner labels the pull request). Labels in an event are never trusted
 * (F-150-R1-02): a new push is a new commit without approval. Required checks (CI) are GitHub's to
 * enforce beside this one.
 */
export function mergeDecision(outcome, { ownerApprovedHead = false } = {}) {
  if (outcome.evidence === 'incomplete')
    return { merge: false, reason: 'no: review evidence incomplete' };
  if (outcome.tier !== 'governance') return { merge: true, reason: `yes (${outcome.tier} risk)` };
  if (ownerApprovedHead)
    return { merge: true, reason: 'yes (governance, the owner approved this exact commit)' };
  return {
    merge: false,
    reason: `no: governance change, held for the owner's approval of this commit (label ${OWNER_MERGE_LABEL})`,
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
      'Usage: node scripts/review-gate.js --base <ref> --head <sha> [--labels a,b] [--policy] [--owner-approved-head] [--json]',
    );
    return 2;
  }
  const labels = (option('labels') ?? '').split(',').filter(Boolean);
  const options = { ownerApprovedHead: argv.includes('--owner-approved-head') };
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
