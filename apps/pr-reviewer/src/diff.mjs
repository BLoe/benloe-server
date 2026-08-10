/**
 * Which (file, line) pairs can carry an inline review comment.
 *
 * GitHub rejects an entire review — not just the offending comment — when any
 * inline comment points at a line outside the diff. An LLM reviewer WILL
 * occasionally cite a line it read from the full file rather than the patch,
 * so the choice is either to validate here or to lose whole reviews to a
 * single bad citation. We validate, and demote anything unanchorable into the
 * review body (see format.mjs) rather than dropping the finding.
 */

/**
 * Right-side (post-change) line numbers addressable in one file's patch.
 *
 * Only added and context lines count: GitHub anchors comments to the RIGHT
 * side by default, and a deleted line has no right-side number at all.
 * Files with no `patch` (binary, or truncated by GitHub for very large diffs)
 * yield an empty set, which is correct — nothing there is anchorable.
 */
export function addressableLines(patch) {
  const lines = new Set();
  if (!patch) return lines;
  let right = 0;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      right = Number(hunk[1]);
      continue;
    }
    if (right === 0) continue; // preamble before the first hunk header
    if (line.startsWith('-')) continue; // left side only
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    // '+' (added) and ' ' (context) both occupy a right-side line.
    lines.add(right);
    right += 1;
  }
  return lines;
}

/** Map of path → Set(addressable right-side lines) for a PR's file list. */
export function addressableMap(files) {
  const map = new Map();
  for (const f of files) map.set(f.filename, addressableLines(f.patch));
  return map;
}

/**
 * Split findings into ones GitHub will accept inline and ones that must go in
 * the body. A finding with no file/line is body-bound by design, not by error.
 */
export function partitionFindings(findings, map) {
  const inline = [];
  const body = [];
  for (const f of findings) {
    const ok = f.file && Number.isInteger(f.line) && map.get(f.file)?.has(f.line);
    (ok ? inline : body).push(f);
  }
  return { inline, body };
}
