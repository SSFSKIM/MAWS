// The sentence rule (D5 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md; parent Decision Log 36, the threshold
// B's). Word hunks keep the agent's untouched words as the items they were, which is what attribution and comments
// need for a small edit; but a heavy rewrite as word hunks leaves a tombstone per replaced word forever (S7a: a heavy
// document's live state 3.8× a fresh import). So when the hunks touch at least half the words of a sentence (changed
// ≥ ceil(words / 2), words by `Intl.Segmenter`), that sentence becomes one hunk. Only the Yjs operations coarsen: the
// writer still computes every word's marks from the word hunks and lays them on the rewritten sentence, so a comment
// on a retained word survives either way (S5's "orphaned only when all its words go").
import type { Hunk } from './inline-diff';

const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' });
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

const wordSpans = (text: string, from: number, to: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (const segment of words.segment(text.slice(from, to))) if (segment.isWordLike) out.push([from + segment.index, from + segment.index + segment.segment.length]);
  return out;
};
const wordCount = (text: string): number => {
  let n = 0;
  for (const segment of words.segment(text)) if (segment.isWordLike) n++;
  return n;
};

/**
 * `hunks` (word hunks between `a` and `b`, sorted) with every sentence of `a` that they touch for at least half its
 * words replaced by one hunk spanning the sentence (and any hunk reaching past its edges).
 */
export function sentenceHunks(a: string, b: string, hunks: readonly Hunk[]): Hunk[] {
  if (hunks.length === 0) return [];
  // Runs of hunk indices [first, last] each to become one hunk over [from, to) in old coordinates.
  const runs: Array<{ first: number; last: number; from: number; to: number }> = [];
  for (const sentence of sentences.segment(a)) {
    const start = sentence.index;
    let end = start + sentence.segment.length;
    while (end > start && /\s/.test(a[end - 1])) end--; // the space before the next sentence stays outside
    if (end <= start) continue;
    const spans = wordSpans(a, start, end);
    if (spans.length === 0) continue;
    let first = -1;
    let last = -1;
    let changed = 0;
    hunks.forEach((hunk, k) => {
      const touches = hunk.to > hunk.from ? hunk.from < end && hunk.to > start : hunk.from >= start && hunk.from < end;
      if (!touches) return;
      if (first < 0) first = k;
      last = k;
      const deleted = spans.filter(([s, e]) => s < hunk.to && e > hunk.from).length;
      changed += Math.max(deleted, wordCount(b.slice(hunk.nFrom, hunk.nTo)));
    });
    if (first < 0 || changed < Math.ceil(spans.length / 2)) continue;
    runs.push({ first, last, from: Math.min(start, hunks[first].from), to: Math.max(end, hunks[last].to) });
  }
  if (runs.length === 0) return [...hunks];
  // Widen each run over any hunk its range reaches (a hunk crossing into the next sentence) and merge overlapping runs.
  const merged: typeof runs = [];
  for (const run of runs.sort((x, y) => x.first - y.first)) {
    let changedRange = true;
    while (changedRange) {
      changedRange = false;
      while (run.first > 0 && hunks[run.first - 1].to > run.from) {
        run.first--;
        run.from = Math.min(run.from, hunks[run.first].from);
        changedRange = true;
      }
      while (run.last < hunks.length - 1 && hunks[run.last + 1].from < run.to) {
        run.last++;
        run.to = Math.max(run.to, hunks[run.last].to);
        changedRange = true;
      }
    }
    const prev = merged.at(-1);
    if (prev && run.first <= prev.last) {
      prev.last = Math.max(prev.last, run.last);
      prev.from = Math.min(prev.from, run.from);
      prev.to = Math.max(prev.to, run.to);
    } else merged.push({ ...run });
  }
  const out: Hunk[] = [];
  let shift = 0; // new minus old length over the hunks before the cursor
  let k = 0;
  for (const run of merged) {
    for (; k < run.first; k++) {
      out.push({ ...hunks[k] });
      shift += hunks[k].nTo - hunks[k].nFrom - (hunks[k].to - hunks[k].from);
    }
    let delta = 0;
    for (; k <= run.last; k++) delta += hunks[k].nTo - hunks[k].nFrom - (hunks[k].to - hunks[k].from);
    const nFrom = run.from + shift;
    out.push({ from: run.from, to: run.to, nFrom, nTo: nFrom + (run.to - run.from) + delta });
    shift += delta;
  }
  for (; k < hunks.length; k++) out.push({ ...hunks[k] });
  return out;
}
