/**
 * Findings → the markdown that actually lands on the PR.
 *
 * Shape is chosen for the reader's first ten seconds: a one-line verdict, then
 * the counts, then the summary, then details grouped by severity. Anything
 * that could not be anchored to a diff line still appears here in full, so a
 * finding is never lost to a citation problem (see diff.js).
 */
import { SEVERITIES } from './review.mjs';

const LABEL = {
  critical: '🔴 Critical',
  important: '🟠 Important',
  suggestion: '🔵 Suggestion',
};

const bySeverity = (a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity);

function counts(findings) {
  const c = { critical: 0, important: 0, suggestion: 0 };
  for (const f of findings) if (f.severity in c) c[f.severity] += 1;
  return c;
}

/** The headline. Deliberately advisory — this reviewer never blocks a merge. */
function verdictLine(c) {
  if (c.critical > 0) return '**Verdict: needs changes before merge.**';
  if (c.important > 0) return '**Verdict: mergeable, but there are real issues worth fixing first.**';
  if (c.suggestion > 0) return '**Verdict: looks sound. Suggestions only.**';
  return '**Verdict: looks sound. Nothing found.**';
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
export function renderReviewBody({ summary, strengths = [], bodyFindings, inlineFindings, headSha, durationMs }) {
  const all = [...bodyFindings, ...inlineFindings];
  const c = counts(all);
  const out = [
    '## Automated review',
    '',
    verdictLine(c),
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
    `<sub>Reviewed \`${headSha.slice(0, 8)}\` in ${Math.round(durationMs / 1000)}s · orchestrator + pr-review-toolkit subagents · advisory only, never blocks a merge.</sub>`,
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
