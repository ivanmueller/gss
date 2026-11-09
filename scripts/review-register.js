// The review findings register (docs/reviews/<ID>.md, docs/AI_WORKFLOW.md §11.5): reading it, and
// sorting a pull request's changed files into risk tiers (§11.6). Shared by the Codex review runner
// (.claude/skills/codex-review/run-review.js) and the GitHub check (scripts/review-gate.js).
// No dependencies: it runs from a bare checkout in GitHub Actions.

/** Finding statuses. `confirmed` and `requires-decision` block a merge; `fixed` needs Codex's check. */
export const STATUSES = [
  'confirmed',
  'fixed',
  'duplicate',
  'rejected',
  'accepted-limitation',
  'requires-decision',
];
export const BLOCKING_STATUSES = ['confirmed', 'requires-decision'];
export const SEVERITIES = ['P1', 'P2', 'P3'];
/** Code review rounds that run without condition (the owner's rule, 2026-11-09). */
export const AUTO_ROUNDS = 5;
/** Rounds 6 to 8 run only while the issues keep falling; beyond 8 only with the owner's approval. */
export const MAX_ROUNDS = 8;
/** The pull request label by which only the owner allows rounds beyond the limits. */
export const OWNER_APPROVAL_LABEL = 'owner-approved-extra-review-round';
/**
 * The pull request label by which only the owner approves merging a high-risk pull request (F-150).
 * It approves one head commit: a push after it removes it (the Merge policy workflow).
 */
export const OWNER_MERGE_LABEL = 'owner-approved-merge';

/**
 * Whether code review round `round` (1, 2, …) may run, given the issue count of every completed
 * round before it in order (each round's new findings plus fixes Codex found not fixed, counting
 * one problem once). Rounds 1 to 5 always; 6 to 8 only with measurable progress: the last round's
 * count lower than the one before it; beyond 8, or after an escalation, only with the owner's
 * approval. Reaching a limit is never approval: it stops the loop for the owner to decide.
 */
export function roundAllowed(round, issues, { ownerApproved = false, escalated = false } = {}) {
  if (ownerApproved) return { allowed: true, reason: 'the owner approved more rounds' };
  if (escalated)
    return {
      allowed: false,
      reason: 'the loop was escalated to the owner; only the owner can continue it',
    };
  if (round <= AUTO_ROUNDS) return { allowed: true, reason: `round ${round} of ${AUTO_ROUNDS}` };
  if (round > MAX_ROUNDS)
    return { allowed: false, reason: `${MAX_ROUNDS} rounds ran; more need the owner's approval` };
  const [before, last] = issues.slice(-2);
  if (last !== undefined && before !== undefined && last < before)
    return {
      allowed: true,
      reason: `round ${round} of ${MAX_ROUNDS}: issues fell from ${before} to ${last}`,
    };
  return {
    allowed: false,
    reason: `round ${round} needs measurable progress (issues ${before ?? '?'} then ${last ?? '?'}: not falling); escalate to the owner`,
  };
}

/** Files that are never a register: the folder's own guide and the project-wide accepted limits. */
export const REGISTER_EXCLUDED = ['docs/reviews/README.md', 'docs/reviews/ACCEPTED.md'];
export const isRegisterPath = (path) =>
  /^docs\/reviews\/[A-Za-z0-9._-]+\.md$/.test(path) && !REGISTER_EXCLUDED.includes(path);

// Governance (the owner's decision, 2026-11-09): the rules and machinery that decide merging, and the
// documents that set the project's rules. Held for the owner's approval of the exact commit, so the
// process can never loosen its own safeguards unattended; also meets every high-risk requirement.
const GOVERNANCE = [
  /^\.github\//,
  // Agent instructions and configuration at any depth (F-150-D1-04).
  /(^|\/)\.(claude|gemini|codex|cursor)\//,
  /(^|\/)(AGENTS|CLAUDE|GEMINI)\.md$/,
  /(^|\/)\.cursorrules$/,
  /^scripts\/(review-|guard-)/,
  /^MASTER_PROJECT_SPECIFICATION\.md$/,
  /^docs\/(AI_WORKFLOW|AI_CODING_SYSTEM|TRADING_RULES|ACCEPTANCE_TESTS)\.md$/,
  /^docs\/reviews\/(README|ACCEPTED)\.md$/,
];
// High risk (AGENTS.md: database, auth, money, phone and Claude integrations; dependencies and the
// Worker's configuration). Merged automatically only after the stronger checks (§11.6): a design
// review, a final full review that approves, append-only migrations with database tests.
const HIGH = [
  /^supabase\//,
  /^packages\/trading-engine\//,
  /^packages\/database\//,
  /^apps\/api\/src\/(anthropic|auth|callbacks|calls|call-steps|db|freight|fx|logins|members|quotes|readings|summaries|telnyx)[.-]/,
  /^packages\/domain\/src\/(callbacks|calls|drafts|freight|fx|members|money|quotes|readings|summaries)[.-]/,
  // The API's routing (which routes are public and which need sign-in), the web app's sign-in, and
  // its API, FX, freight and quote logic (F-150-R1-03).
  /^apps\/api\/src\/(index|respond)\.ts$/,
  /^packages\/domain\/src\/index\.ts$/,
  /^apps\/web\/src\/auth\//,
  /^apps\/web\/src\/lib\/(api|freight|fx|orderBook|quotes|supabase|workspaceQuotes)\./,
  /(^|\/)wrangler\.jsonc?$/,
  /(^|\/)package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^\.env\.example$/,
];
// Documents that record the owner's decisions: reviewed like code, never "documents only".
const NORMAL = [/^docs\/(DECISIONS|DATA_MODEL|API|ARCHITECTURE)\.md$/];
// Low risk: documents, tests and style sheets only.
const LOW = [/\.md$/, /^tests\/e2e\//, /\.test\.[cm]?[jt]sx?$/, /\.css$/];

export function fileTier(path) {
  if (GOVERNANCE.some((re) => re.test(path))) return 'governance';
  if (HIGH.some((re) => re.test(path))) return 'high';
  if (NORMAL.some((re) => re.test(path))) return 'normal';
  if (LOW.some((re) => re.test(path))) return 'low';
  return 'normal';
}

const TIER_ORDER = { low: 0, normal: 1, high: 2, governance: 3 };
/** Tiers that must meet the stronger high-risk requirements. */
export const STRONG_TIERS = ['high', 'governance'];

/** The highest tier among the changed files, with the files that set it. */
export function changeTier(paths) {
  let tier = 'low';
  for (const path of paths)
    if (TIER_ORDER[fileTier(path)] > TIER_ORDER[tier]) tier = fileTier(path);
  return { tier, because: paths.filter((path) => fileTier(path) === tier) };
}

/** Documents only (Markdown outside the governance files): no Codex review needed. */
export const documentsOnly = (paths) =>
  paths.length > 0 && paths.every((path) => path.endsWith('.md') && fileTier(path) === 'low');

function tableAfter(lines, heading) {
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  if (start < 0) return null;
  const rows = [];
  let header = null;
  for (const line of lines.slice(start + 1)) {
    const text = line.trim();
    if (text.startsWith('#')) break;
    if (!text.startsWith('|')) {
      if (header && text !== '') break;
      continue;
    }
    const cells = text
      .slice(1, text.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim());
    if (!header) header = cells.map((cell) => cell.toLowerCase());
    else if (!cells.every((cell) => /^:?-+:?$/.test(cell)))
      rows.push(Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ''])));
  }
  return rows;
}

const shaOf = (cell) =>
  /^[0-9a-f]{7,40}$/.test(cell.replace(/`/g, '')) ? cell.replace(/`/g, '') : null;

/**
 * Reads a register. Returns { id, reviews, findings, problems }: `problems` lists what is malformed.
 * Reviews: { round, mode, base, reviewed, result, findings }. Findings: the table's columns.
 */
export function parseRegister(text) {
  const lines = text.split(/\r?\n/);
  const problems = [];
  const id = /^# Review register: ([A-Za-z0-9-]+)/.exec(lines[0] ?? '')?.[1] ?? null;
  if (!id) problems.push('The first line must be "# Review register: <ID> …".');
  const status = /^- Status: (\w+)/m.exec(text)?.[1] ?? null;
  if (!['open', 'complete', 'escalated'].includes(status ?? ''))
    problems.push('No "- Status: open | complete | escalated" line.');

  const reviewRows = tableAfter(lines, '## Reviews');
  const findingRows = tableAfter(lines, '## Findings');
  if (!reviewRows) problems.push('No "## Reviews" table.');
  if (!findingRows) problems.push('No "## Findings" table.');

  const reviews = (reviewRows ?? []).map((row) => ({
    round: row.round,
    mode: row.mode,
    base: shaOf(row.base ?? ''),
    reviewed: shaOf(row['reviewed commit'] ?? ''),
    result: row.result,
    findings: row.findings,
  }));
  for (const review of reviews) {
    if (!/^(D\d+|\d+)$/.test(review.round))
      problems.push(`Review round "${review.round}" is not D<n> or <n>.`);
    if (!['design', 'checkpoint', 'rereview', 'final'].includes(review.mode))
      problems.push(
        `Review ${review.round}: mode "${review.mode}" is not design, checkpoint, rereview or final.`,
      );
    if (!review.reviewed) problems.push(`Review ${review.round}: no reviewed commit.`);
    if (review.mode !== 'design' && !review.base)
      problems.push(`Review ${review.round}: no base commit.`);
    if (!['approve', 'needs-attention', 'failed'].includes(review.result))
      problems.push(
        `Review ${review.round}: result "${review.result}" is not approve, needs-attention or failed.`,
      );
  }

  const findings = (findingRows ?? []).map((row) => ({
    id: row.id,
    severity: row.sev,
    status: row.status,
    round: row.round,
    where: row.where,
    summary: row.summary,
    evidence: row.evidence,
    fix: row.fix,
    test: row.test,
    verified: row.verified,
  }));
  const seen = new Set();
  for (const finding of findings) {
    if (seen.has(finding.id)) problems.push(`Finding ${finding.id} is listed twice.`);
    seen.add(finding.id);
    if (!finding.id?.startsWith(`${id}-`))
      problems.push(`Finding "${finding.id}" does not start with ${id}-.`);
    if (!SEVERITIES.includes(finding.severity))
      problems.push(`Finding ${finding.id}: severity "${finding.severity}" is not P1, P2 or P3.`);
    if (!STATUSES.includes(finding.status))
      problems.push(
        `Finding ${finding.id}: status "${finding.status}" is not one of ${STATUSES.join(', ')}.`,
      );
  }
  return { id, status, reviews, findings, problems };
}

const blank = (cell) => !cell || cell === '—' || cell === '-';

/**
 * The successful code review named in a fixed finding's Verified column (`R2` or `2`), if it is
 * one that can verify the finding: a code review (not a design review), not failed, and later
 * than the round that found it (F-149-D1-02). Null otherwise. Whether that review's commit
 * includes the fix is checked against git by review-gate.js.
 */
export function verifyingReview(register, finding) {
  const round = /^R?(\d+)$/.exec(finding.verified ?? '')?.[1];
  if (!round) return null;
  // The round that found it: from the ID (`…-R2-01`), else the Round column; design findings
  // (`…-D1-01`) can be verified by any code review.
  const fromId = /-R(\d+)-\d+$/.exec(finding.id ?? '')?.[1];
  const fromColumn = /^\d+$/.test(finding.round ?? '') ? finding.round : undefined;
  const foundIn = Number(fromId ?? fromColumn ?? 0);
  if (Number(round) <= foundIn) return null;
  return (
    register.reviews.find(
      (review) => review.round === round && review.mode !== 'design' && review.result !== 'failed',
    ) ?? null
  );
}

/**
 * What still stands between a register and a merge, apart from the git checks (review-gate.js).
 * `ownerApproved`: the owner's label allowing rounds beyond the limits is on the pull request.
 */
export function registerBlockers(register, { ownerApproved = false } = {}) {
  const blockers = [...register.problems];
  if (register.status === 'escalated')
    blockers.push("The review loop is escalated to the owner: it needs the owner's decision.");
  const attempts = register.reviews.filter((review) => review.mode !== 'design');
  // Failed attempts are not rounds (the runner uses their number again; F-149-R1-03).
  const code = attempts.filter((review) => review.result !== 'failed');
  if (code.length === 0) blockers.push('No code review (checkpoint or rereview) is recorded.');
  // Every round must have been allowed when it ran: 1 to 5 always, 6 to 8 only with progress,
  // beyond 8 only with the owner's approval. The Findings column is the round's issue count.
  const issues = code.map((review) => Number.parseInt(review.findings ?? '', 10));
  for (let n = AUTO_ROUNDS + 1; n <= code.length; n += 1) {
    if (Number.isNaN(issues[n - 2]) || Number.isNaN(issues[n - 3]))
      blockers.push(`Review ${n}: the Findings counts of the two rounds before it are needed.`);
    const verdict = roundAllowed(n, issues.slice(0, n - 1), { ownerApproved });
    if (!verdict.allowed) blockers.push(`Review ${n} should not have run: ${verdict.reason}.`);
  }
  if (attempts.at(-1)?.result === 'failed') blockers.push('The last code review failed.');
  // Reaching a limit is never approval: the last code review must approve, or have raised only
  // P3 findings. A P1 or P2 Claude rejected in that round is a disagreement for the owner.
  const last = code.at(-1);
  if (last && last.result !== 'approve') {
    const raised = register.findings.filter((f) => new RegExp(`-R${last.round}-\\d+$`).test(f.id));
    // A P1 or P2 raised again as a duplicate is also a disagreement, not a pass.
    const serious = raised.filter((f) => f.severity !== 'P3');
    if (raised.length === 0 || serious.length > 0)
      blockers.push(
        `The last code review (round ${last.round}) did not approve` +
          (serious.length ? ` and raised ${serious.map((f) => f.id).join(', ')}` : '') +
          ': fix and re-review, or escalate to the owner.',
      );
  }

  for (const finding of register.findings) {
    if (BLOCKING_STATUSES.includes(finding.status))
      blockers.push(`Finding ${finding.id} is ${finding.status}.`);
    if (finding.status === 'fixed') {
      if (blank(finding.verified))
        blockers.push(
          `Finding ${finding.id} is fixed but no Codex re-review verified it (Verified column).`,
        );
      else if (!verifyingReview(register, finding))
        blockers.push(
          `Finding ${finding.id} is fixed but verified in round ${finding.verified.replace(/^R/, '')}, which is not a successful code review after round ${finding.round}.`,
        );
      if (finding.severity !== 'P3' && blank(finding.test))
        blockers.push(
          `Finding ${finding.id} (${finding.severity}) is fixed without a regression test (or "n/a: reason").`,
        );
      if (blank(finding.fix))
        blockers.push(`Finding ${finding.id} is fixed without its fix commit.`);
    }
    if (
      ['rejected', 'duplicate', 'accepted-limitation'].includes(finding.status) &&
      blank(finding.evidence)
    )
      blockers.push(`Finding ${finding.id} is ${finding.status} without evidence.`);
  }
  return blockers;
}

/**
 * What one Codex review round amounts to, for the runner (owner's rule, 2026-11-09):
 * - `issues`: its new findings, plus fixes Codex found not fixed that no new finding repeats
 *   (one problem counted once); the register's Findings column, used to measure progress;
 * - `escalation`: why the loop must stop for the owner, or null. The same fix found not fixed in
 *   two rounds running without the issue count falling (recurring without progress), or Codex
 *   raising again a P1 or P2 that Claude rejected or accepted (a significant disagreement).
 * `findings` are Codex's, with its own `duplicate_of`; `previous` is the last completed code round's state
 * ({ issues, notFixed }), null before the first, undefined for a design review (never escalates);
 * `known` are the register's rows ({ id, severity, status }).
 */
export function roundOutcome({ findings, verifiedFixes, previous, known }) {
  const notFixed = verifiedFixes.filter((v) => v.status === 'not-fixed').map((v) => v.id);
  // Only Codex's own duplicate_of counts here; the runner's nearness match
  // (probable_duplicate_of) is a hint for Claude's triage, never grounds to stop the loop
  // (F-149-R4-01).
  const repeated = new Set(findings.map((f) => f.duplicate_of).filter(Boolean));
  const issues = findings.length + notFixed.filter((id) => !repeated.has(id)).length;
  if (previous === undefined) return { issues, notFixed, escalation: null };
  const reasons = [];
  const recurring = notFixed.filter((id) => previous?.notFixed?.includes(id));
  const before = previous?.issues ?? previous?.findings;
  if (recurring.length && before !== undefined && issues >= before)
    reasons.push(
      `recurring without progress: ${recurring.join(', ')} found not fixed two rounds running, issues ${before} then ${issues}`,
    );
  const disputed = findings.filter((f) => {
    const row = known.find((k) => k.id === f.duplicate_of);
    return f.severity !== 'P3' && row && ['rejected', 'accepted-limitation'].includes(row.status);
  });
  if (disputed.length)
    reasons.push(
      `disagreement: Codex raises again ${disputed.map((f) => `${f.duplicate_of} as ${f.severity}`).join(', ')}, which Claude rejected or accepted`,
    );
  return { issues, notFixed, escalation: reasons.length ? reasons.join('; ') : null };
}

/**
 * Where the next code review starts: the commit the last completed code review saw, so successive
 * checkpoints form a chain (F-149-R1-02); null before the first one (the runner then uses the
 * merge base with main). `rounds` is the runner's private state.
 */
export function nextReviewBase(rounds) {
  return (
    rounds.filter((round) => round.mode !== 'design' && round.status === 'completed').at(-1)
      ?.reviewed ?? null
  );
}

/** Code review rounds in order, each expected to start where the previous one stopped. */
export function codeReviewChain(register) {
  return register.reviews
    .filter((review) => review.mode !== 'design' && review.result !== 'failed')
    .sort((a, b) => Number(a.round) - Number(b.round));
}
