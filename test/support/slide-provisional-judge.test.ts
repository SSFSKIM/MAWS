// P4-A2 G2.7: the swap judgement of the slide layer's paid run (e2e/support/slide-provisional-judge.ts), over samples as
// its page-side recorder takes them. The recorder itself runs only in the live spec.
import { describe, expect, it } from 'vitest';
import { slideSwapOffenders, type SlideSample } from '../../e2e/support/slide-provisional-judge';

const OLD = 'Thursday, 12 November 2026';
const NEW = 'Friday, 4 December 2026';
let clock = 0;
// One sample: the ghost of `date` with `ghost` as its text (none when null), the live `date` with `live` as its text,
// veiled or not.
const sample = (ghost: string | null, live: string, veiled: boolean): SlideSample => ({
  at: (clock += 10),
  writing: ghost === null ? null : 'toolu_1',
  label: ghost === null ? null : 'Claude is writing…',
  held: null,
  ghost: ghost === null ? [] : [{ key: 'date', shown: 'changed', text: ghost }],
  live: { text: live, veiled },
  thumb: null,
});
const judge = (samples: SlideSample[]) => slideSwapOffenders(samples, 'date', NEW);

describe('slideSwapOffenders', () => {
  it('a clean swap: the whole ghost over the veiled live text, then the real text alone', () => {
    const samples = [sample(null, OLD, false), sample('Fri', OLD, true), sample(NEW, OLD, true), sample(null, NEW, false)];
    expect(judge(samples)).toEqual({ judged: true, from: 2, gaps: [], doubles: [] });
  });

  it('the ghost staying over the written but still veiled text is no offence: the ghost shows it', () => {
    const samples = [sample(NEW, OLD, true), sample(NEW, NEW, true), sample(null, NEW, false)];
    expect(judge(samples)).toEqual({ judged: true, from: 0, gaps: [], doubles: [] });
  });

  it('a gap: the layer withdrawn before the write, the old text shown', () => {
    const samples = [sample(NEW, OLD, true), sample(null, OLD, false), sample(null, NEW, false)];
    expect(judge(samples)).toEqual({ judged: true, from: 0, gaps: [samples[1]], doubles: [] });
  });

  it('a gap: the ghost gone and the written text still veiled', () => {
    const samples = [sample(NEW, OLD, true), sample(null, NEW, true), sample(null, NEW, false)];
    expect(judge(samples).gaps).toEqual([samples[1]]);
  });

  it('a double: the real text unveiled while the ghost still draws it', () => {
    const samples = [sample(NEW, OLD, true), sample(NEW, NEW, false), sample(null, NEW, false)];
    expect(judge(samples)).toEqual({ judged: true, from: 0, gaps: [], doubles: [samples[1]] });
  });

  it('judges from the first sample whose ghost holds the whole new text: the stream before it is not a gap', () => {
    const samples = [sample(null, OLD, false), sample('Fr', OLD, true), sample(NEW, OLD, true), sample(null, NEW, false)];
    expect(judge(samples).from).toBe(2);
  });

  it('no ghost ever drawn: not judged, which the caller fails (a swap never seen is no clean one)', () => {
    expect(judge([sample(null, OLD, false), sample(null, NEW, false)])).toEqual({ judged: false, from: -1, gaps: [], doubles: [] });
  });

  it('a ghost that never held the whole text: not judged either', () => {
    expect(judge([sample('Fri', OLD, true), sample(null, NEW, false)]).judged).toBe(false);
  });
});
