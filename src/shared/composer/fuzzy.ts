// The composer's deterministic fuzzy match (C7 execution document, "Mentions, palette and the "+" menu"): a
// case-insensitive subsequence scorer with a bonus for a character at a segment boundary (the start, or after `/`, `_`,
// `-`, `.` or a space) and a larger one for a character right after the previous match, so `main` finds `src/main.ts`
// before `src/domain.ts`. Main's `git.lsFiles` ranks paths with it; the palette's name ranking can reuse the scorer.
const BOUNDARY = new Set(['/', '_', '-', '.', ' ']);
const BOUNDARY_BONUS = 3;
const CONSECUTIVE_BONUS = 4;

// The best alignment's score, or null when `query` is not a subsequence of `text`; the empty query scores 0.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  if (q.length > t.length) return null;
  // prev[j]: the best score with the previous query character matched at text position j
  let prev = new Array<number>(t.length).fill(-Infinity);
  for (let i = 0; i < q.length; i++) {
    const cur = new Array<number>(t.length).fill(-Infinity);
    let bestBefore = i === 0 ? 0 : -Infinity; // the best prev[k] for k < j
    for (let j = 0; j < t.length; j++) {
      if (t[j] === q[i]) {
        const base = 1 + (j === 0 || BOUNDARY.has(t[j - 1]!) ? BOUNDARY_BONUS : 0);
        const run = i > 0 && j > 0 ? prev[j - 1]! + base + CONSECUTIVE_BONUS : -Infinity;
        cur[j] = Math.max(bestBefore + base, run);
      }
      if (i > 0) bestBefore = Math.max(bestBefore, prev[j]!);
    }
    prev = cur;
  }
  const best = Math.max(...prev);
  return best === -Infinity ? null : best;
}

// The paths `query` matches, best first; ties go to the shorter path, then alphabetically.
export function rankPaths(query: string, paths: readonly string[]): string[] {
  const scored: { path: string; score: number }[] = [];
  for (const path of paths) {
    const score = fuzzyScore(query, path);
    if (score !== null) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return scored.map((s) => s.path);
}
