/**
 * Findings → the markdown that actually lands on the PR.
 *
 * Shape is chosen for the reader's first ten seconds: a one-line verdict, then
 * the counts, then the summary, then details grouped by severity. Anything
 * that could not be anchored to a diff line still appears here in full, so a
 * finding is never lost to a citation problem (see diff.js).
 */
import { partitionFindings } from './diff.mjs';
import { SEVERITIES } from './review.mjs';

const LABEL = {
  critical: '🔴 Critical',
  important: '🟠 Important',
  suggestion: '🔵 Suggestion',
};

const bySeverity = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);

/**
 * Does this review accept the PR?
 *
 * Suggestions do not block: they are by definition fine to decline, and a
 * reviewer that withholds acceptance over style would make the gate
 * meaningless within a day. Critical and important both block — those are
 * "this is wrong" and "this has a real defect".
 *
 * Note this is a REVERSAL of the original design, which posted COMMENT
 * unconditionally on the reasoning that a scheduled reviewer must never bless
 * a merge. Ben's call (2026-08-10): PRs go through review until the reviewer
 * accepts, which requires acceptance to be a machine-readable state rather
 * than something a human infers from prose. The safety property that survives
 * is the one that matters — see REVIEW_EVENT: it can approve, and it still
 * cannot REQUEST_CHANGES.
 */
export function accepts(findings, rejectedCount = 0) {
  // A finding that failed re-validation is quarantined into result.rejected
  // and never reaches this list — so a malformed CRITICAL would otherwise
  // vanish and produce an APPROVE reading "accepted. Nothing found." The
  // review's own output was malformed; what it found is unknown, and unknown
  // is not clean. This did not matter while every review was a COMMENT.
  if (rejectedCount > 0) return false;
  return !findings.some((f) => f.severity === 'critical' || f.severity === 'important');
}

/**
 * APPROVE when clean, COMMENT otherwise — and REQUEST_CHANGES never.
 *
 * A stochastic reviewer that can request changes can wedge the queue: one
 * confident false positive on a run nobody is watching blocks a merge until a
 * human overrides it, and the override is itself friction. COMMENT carries the
 * same findings without the deadlock, so the blocking direction stays advisory
 * while the accepting direction becomes real.
 */
export const REVIEW_EVENT = (findings, rejectedCount = 0) =>
  accepts(findings, rejectedCount) ? 'APPROVE' : 'COMMENT';

function counts(findings) {
  const c = { critical: 0, important: 0, suggestion: 0 };
  for (const f of findings) if (f.severity in c) c[f.severity] += 1;
  return c;
}

/** The headline. Must agree with REVIEW_EVENT — the two are tested together. */
function verdictLine(c) {
  if (c.critical > 0) return '**Verdict: not accepted — critical issues must be fixed.**';
  if (c.important > 0) return '**Verdict: not accepted — real defects to fix first.**';
  if (c.suggestion > 0) return '**Verdict: accepted. Suggestions only, all optional.**';
  return '**Verdict: accepted. Nothing found.**';
}

export function inlineComment(f) {
  return {
    path: f.file,
    line: f.line,
    body: `**${LABEL[f.severity] ?? f.severity}: ${f.title}**\n\n${f.detail}${f.agent ? `\n\n<sub>${f.agent}</sub>` : ''}`,
  };
}

function renderFinding(f, { withLocation }) {
  const where = withLocation && f.file ? ` — \`${f.file}${f.line ? `:${f.line}` : ''}\`` : '';
  const who = f.agent ? ` <sub>(${f.agent})</sub>` : '';
  return `- **${f.title}**${where}${who}\n  ${f.detail.replace(/\n/g, '\n  ')}`;
}

/**
 * @param bodyFindings findings that could not be anchored inline
 * @param inlineFindings findings posted as inline comments — listed here by
 *   title only, so the body still shows the full picture without duplicating
 *   text the reader is about to see in context.
 */
export function renderReviewBody({ summary, strengths = [], bodyFindings, inlineFindings, headSha, durationMs, rejectedCount = 0 }) {
  const all = [...bodyFindings, ...inlineFindings];
  const c = counts(all);
  const malformed =
    rejectedCount > 0
      ? [
          '',
          `> ⚠️ ${rejectedCount} finding(s) came back malformed and were discarded. This review is **not** accepted regardless of the counts below — what those findings said is unknown.`,
        ]
      : [];
  const out = [
    '## Automated review',
    '',
    rejectedCount > 0 ? '**Verdict: not accepted — the review returned malformed findings.**' : verdictLine(c),
    ...malformed,
    '',
    `${c.critical} critical · ${c.important} important · ${c.suggestion} suggestion${c.suggestion === 1 ? '' : 's'}`,
    '',
    summary,
  ];

  for (const sev of SEVERITIES) {
    const inBody = bodyFindings.filter((f) => f.severity === sev).sort(bySeverity);
    const anchored = inlineFindings.filter((f) => f.severity === sev);
    if (inBody.length === 0 && anchored.length === 0) continue;
    out.push('', `### ${LABEL[sev]} (${inBody.length + anchored.length})`, '');
    for (const f of inBody) out.push(renderFinding(f, { withLocation: true }));
    for (const f of anchored) out.push(`- **${f.title}** — inline at \`${f.file}:${f.line}\``);
  }

  if (strengths.length > 0) {
    out.push('', '### Worth keeping', '');
    for (const s of strengths) out.push(`- ${s}`);
  }

  out.push(
    '',
    '---',
    `<sub>Reviewed \`${headSha.slice(0, 8)}\` in ${Math.round(durationMs / 1000)}s · orchestrator + pr-review-toolkit subagents · approves when clean, never requests changes.</sub>`,
  );
  return out.join('\n');
}

/** Body used when the review itself failed — silence would look like approval. */
export function renderFailureBody(error, headSha) {
  return [
    '## Automated review — failed',
    '',
    `The reviewer could not complete a review of \`${headSha.slice(0, 8)}\`.`,
    '',
    '```',
    error.slice(0, 1500),
    '```',
    '',
    '<sub>This is a reviewer failure, not a finding about the code. The PR has not been reviewed.</sub>',
  ].join('\n');
}

/**
 * Everything needed to post one review, decided in one place.
 *
 * Exists because the seam between the findings logic and the GitHub call had
 * no coverage: deleting the event and commit_id arguments at the call site
 * left the whole suite green, since postReview defaults to an unpinned
 * COMMENT. The two properties this design rests on — a clean review actually
 * reaches GitHub as APPROVE, and every review is pinned to the sha that was
 * read — are decided here and tested directly.
 */
export function buildReviewPost({ summary, strengths, findings, rejectedCount = 0, addressableLines, headSha, durationMs }) {
  // Partition HERE rather than taking a pre-split pair. Accepting both a
  // findings list and an independent {inline, body} let the counts in the
  // body disagree with the event computed from the findings — which is the
  // exact drift this function exists to make impossible. Caught by its own
  // test on the first run.
  const { inline, body } = partitionFindings(findings, addressableLines);
  return {
    event: REVIEW_EVENT(findings, rejectedCount),
    commitId: headSha,
    body: renderReviewBody({
      summary,
      strengths,
      bodyFindings: body,
      inlineFindings: inline,
      headSha,
      durationMs,
      rejectedCount,
    }),
    comments: inline.map(inlineComment),
  };
}
