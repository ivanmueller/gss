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
export const ROUND_LIMIT = 3;

/** Files that are never a register: the folder's own guide and the project-wide accepted limits. */
export const REGISTER_EXCLUDED = ['docs/reviews/README.md', 'docs/reviews/ACCEPTED.md'];
export const isRegisterPath = (path) =>
  /^docs\/reviews\/[A-Za-z0-9._-]+\.md$/.test(path) && !REGISTER_EXCLUDED.includes(path);

// High risk (AGENTS.md: database, auth, money, phone and Claude integrations; plus everything that
// governs the review process itself, dependencies and the deploy). Never merged automatically.
const HIGH = [
  /^supabase\//,
  /^packages\/trading-engine\//,
  /^packages\/database\//,
  /^apps\/api\/src\/(anthropic|auth|callbacks|calls|call-steps|db|freight|fx|logins|members|quotes|readings|summaries|telnyx)[.-]/,
  /^packages\/domain\/src\/(callbacks|calls|drafts|freight|fx|members|money|quotes|readings|summaries)[.-]/,
  /(^|\/)wrangler\.jsonc?$/,
  /(^|\/)package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^\.github\//,
  /^\.claude\//,
  /^scripts\/review-/,
  /^\.env\.example$/,
  /^(AGENTS|CLAUDE)\.md$/,
  /^MASTER_PROJECT_SPECIFICATION\.md$/,
  /^docs\/(AI_WORKFLOW|AI_CODING_SYSTEM|TRADING_RULES|ACCEPTANCE_TESTS)\.md$/,
  /^docs\/reviews\/(README|ACCEPTED)\.md$/,
];
// Documents that record the owner's decisions: reviewed like code, never "documents only".
const NORMAL = [/^docs\/(DECISIONS|DATA_MODEL|API|ARCHITECTURE)\.md$/];
// Low risk: documents, tests and style sheets only.
const LOW = [/\.md$/, /^tests\/e2e\//, /\.test\.[cm]?[jt]sx?$/, /\.css$/];

export function fileTier(path) {
  if (HIGH.some((re) => re.test(path))) return 'high';
  if (NORMAL.some((re) => re.test(path))) return 'normal';
  if (LOW.some((re) => re.test(path))) return 'low';
  return 'normal';
}

const TIER_ORDER = { low: 0, normal: 1, high: 2 };

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
    if (!['design', 'checkpoint', 'rereview'].includes(review.mode))
      problems.push(
        `Review ${review.round}: mode "${review.mode}" is not design, checkpoint or rereview.`,
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
  return { id, reviews, findings, problems };
}

const blank = (cell) => !cell || cell === '—' || cell === '-';

/**
 * What still stands between a register and a merge, apart from the git checks (review-gate.js).
 * `extraRounds` is the number of rounds beyond the limit the owner allowed (a PR label).
 */
export function registerBlockers(register, { extraRounds = 0 } = {}) {
  const blockers = [...register.problems];
  const code = register.reviews.filter((review) => review.mode !== 'design');
  if (code.length === 0) blockers.push('No code review (checkpoint or rereview) is recorded.');
  if (code.length > ROUND_LIMIT + extraRounds)
    blockers.push(
      `${code.length} code review rounds recorded; the limit is ${ROUND_LIMIT}` +
        (extraRounds ? ` plus ${extraRounds} the owner allowed.` : '. Escalate to the owner.'),
    );
  const failed = code.filter((review) => review.result === 'failed');
  if (failed.length && failed.at(-1) === code.at(-1)) blockers.push('The last code review failed.');

  const roundNames = new Set(register.reviews.map((review) => review.round));
  for (const finding of register.findings) {
    if (BLOCKING_STATUSES.includes(finding.status))
      blockers.push(`Finding ${finding.id} is ${finding.status}.`);
    if (finding.status === 'fixed') {
      const verifiedIn = /^R?(D?\d+)$/.exec(finding.verified ?? '')?.[1];
      if (!verifiedIn || !roundNames.has(verifiedIn))
        blockers.push(
          `Finding ${finding.id} is fixed but no Codex re-review verified it (Verified column).`,
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

/** Code review rounds in order, each expected to start where the previous one stopped. */
export function codeReviewChain(register) {
  return register.reviews
    .filter((review) => review.mode !== 'design' && review.result !== 'failed')
    .sort((a, b) => Number(a.round) - Number(b.round));
}
