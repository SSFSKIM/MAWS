// The sentence rule (D5; parent Decision Log 36): when the word hunks touch at least half the words of a sentence, the
// sentence is replaced whole (one hunk), so a heavy rewrite leaves one tombstone run per sentence, not one per word.
import { describe, expect, it } from 'vitest';
import { diffCells, type DiffCell, type Hunk } from './inline-diff';
import { sentenceHunks } from './sentence';

const cells = (text: string): DiffCell[] => [...Array(text.length).keys()].map((i) => ({ ch: text[i] }));
const coarse = (a: string, b: string): Hunk[] => sentenceHunks(a, b, diffCells(cells(a), cells(b)));
const show = (a: string, b: string, hunks: Hunk[]) => hunks.map((h) => `${a.slice(h.from, h.to)}→${b.slice(h.nFrom, h.nTo)}`);

// Ten words; the words at even positions are the ones a test replaces.
const TEN = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa.';

describe('sentenceHunks', () => {
  it('rewrites a sentence whole when half its words changed (5 of 10)', () => {
    const b = 'One beta two delta three zeta four theta five kappa.';
    expect(show(TEN, b, coarse(TEN, b))).toEqual([`${TEN}→${b}`]);
  });

  it('keeps word hunks below half (4 of 10)', () => {
    const b = 'One beta two delta three zeta four theta iota kappa.';
    expect(show(TEN, b, coarse(TEN, b))).toEqual(['Alpha→One', 'gamma→two', 'epsilon→three', 'eta→four']);
  });

  it('touches only the sentence that crossed the threshold, mapping its new range exactly', () => {
    const a = `Keep this sentence as it is. ${TEN} And this one.`;
    const b = `Keep this sentence as it was. One beta two delta three zeta four theta five kappa. And this one.`;
    expect(show(a, b, coarse(a, b))).toEqual(['is→was', `${TEN}→One beta two delta three zeta four theta five kappa.`]);
  });

  it('counts inserted words: a short sentence that doubles is rewritten whole', () => {
    const a = 'Ship it now.';
    const b = 'Ship it after the review and the sign-off now.';
    expect(show(a, b, coarse(a, b))).toEqual([`${a}→${b}`]);
  });

  it('leaves the space between sentences outside the rewrite', () => {
    const a = `${TEN} Next.`;
    const b = 'One beta two delta three zeta four theta five kappa. Next.';
    const hunks = coarse(a, b);
    expect(hunks).toHaveLength(1);
    expect(a.slice(hunks[0].to)).toBe(' Next.');
    expect(b.slice(hunks[0].nTo)).toBe(' Next.');
  });

  it('passes no hunks through', () => {
    expect(sentenceHunks(TEN, TEN, [])).toEqual([]);
  });

  it('segments Korean sentences', () => {
    const a = '오늘 회의는 오후 세시에 본관에서 열린다. 자료는 미리 읽는다.';
    const b = '내일 모임은 오전 열시에 별관에서 열린다. 자료는 미리 읽는다.';
    expect(show(a, b, coarse(a, b))).toEqual(['오늘 회의는 오후 세시에 본관에서 열린다.→내일 모임은 오전 열시에 별관에서 열린다.']);
  });
});
