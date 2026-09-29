// The composer's deterministic fuzzy match (C7 execution document, "Mentions, palette and the "+" menu"): a
// case-insensitive subsequence scorer with a bonus for a character at a segment boundary (the start, or after `/`, `_`,
// `-`, `.` or a space) and a larger one for a character right after the previous match, so `main` finds `src/main.ts`
// before `src/domain.ts`. Main's `git.lsFiles` ranks paths with it; the palette's name ranking can reuse the scorer.
// A keystroke may rank ~10^5 paths in main, so a linear subsequence check rejects non-matches before the alignment,
// and the alignment reuses two module-level rows instead of allocating per call.
const BOUNDARY = new Set(['/', '_', '-', '.', ' '].map((c) => c.charCodeAt(0)));
const BOUNDARY_BONUS = 3;
const CONSECUTIVE_BONUS = 4;

let rowA = new Float64Array(256);
let rowB = new Float64Array(256);

function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t.charCodeAt(j) === q.charCodeAt(i)) i++;
  return i === q.length;
}

// The best alignment's score for a lowercased query and text, or null when the query is not a subsequence.
function score(q: string, t: string): number | null {
  if (q.length === 0) return 0;
  if (q.length > t.length || !isSubsequence(q, t)) return null;
  const n = t.length;
  if (rowA.length < n) {
    rowA = new Float64Array(n * 2);
    rowB = new Float64Array(n * 2);
  }
  // prev[j]: the best score with the previous query character matched at text position j
  let prev = rowA;
  let cur = rowB;
  for (let i = 0; i < q.length; i++) {
    const c = q.charCodeAt(i);
    let bestBefore = i === 0 ? 0 : -Infinity; // the best prev[k] for k < j
    for (let j = 0; j < n; j++) {
      let value = -Infinity;
      if (t.charCodeAt(j) === c) {
        const base = 1 + (j === 0 || BOUNDARY.has(t.charCodeAt(j - 1)) ? BOUNDARY_BONUS : 0);
        const run = i > 0 && j > 0 ? prev[j - 1]! + base + CONSECUTIVE_BONUS : -Infinity;
        value = Math.max(bestBefore + base, run);
      }
      if (i > 0 && prev[j]! > bestBefore) bestBefore = prev[j]!;
      cur[j] = value;
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  let best = -Infinity;
  for (let j = 0; j < n; j++) if (prev[j]! > best) best = prev[j]!;
  return best === -Infinity ? null : best;
}

// The best alignment's score, or null when `query` is not a subsequence of `text`; the empty query scores 0.
export function fuzzyScore(query: string, text: string): number | null {
  return score(query.toLowerCase(), text.toLowerCase());
}

// The paths `query` matches, best first; ties go to the shorter path, then alphabetically.
export function rankPaths(query: string, paths: readonly string[]): string[] {
  const q = query.toLowerCase();
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const s = score(q, path.toLowerCase());
    if (s !== null) scored.push({ path, score: s });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return scored.map((s) => s.path);
}
