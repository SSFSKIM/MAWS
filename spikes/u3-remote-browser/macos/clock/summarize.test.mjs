// The clock probe's summary math (summarize.mjs): rates over a window, click-to-paint statistics and the mechanical
// verdict against baseline. `node --test spikes/u3-remote-browser/macos/clock/summarize.test.mjs` (vitest does not collect
// spikes/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rate, clickStats, summarizeVariant, verdict } from './summarize.mjs';

test('rate: callbacks per second over the window, and their spacing', () => {
  const times = Array.from({ length: 31 }, (_, i) => i * 166.7); // a ~6 Hz timer over 5 s
  const r = rate(times, 5000);
  assert.equal(r.n, 31);
  assert.equal(r.hz, 6.2);
  assert.equal(r.medianIntervalMs, 166.7);
  assert.deepEqual(rate(undefined, 5000), { n: 0, hz: null, medianIntervalMs: null, p95IntervalMs: null });
  assert.equal(rate([1, 2], 0).hz, null);
});

test('clickStats: landed clicks only in the median and p95; a click without a paint is missing', () => {
  const clicks = [100, 120, 110, null, 90].map((toPaintMs, i) => ({ i, toPaintMs, toHandlerMs: toPaintMs === null ? null : 5 }));
  const s = clickStats(clicks);
  assert.equal(s.clicks, 5);
  assert.equal(s.landed, 4);
  assert.equal(s.missing, 1);
  assert.equal(s.medianMs, 105);
  assert.equal(s.p95Ms, 120);
  assert.equal(s.toHandlerMedianMs, 5);
  assert.equal(clickStats(undefined).medianMs, null);
});

const variant = ({ clickMs, t100Count, missing = 0 }) =>
  summarizeVariant({
    done: true,
    clocks: { windowMs: 5000, raf: [], t16: [], t100: Array.from({ length: t100Count }, (_, i) => i * (5000 / t100Count)) },
    clicks: Array.from({ length: 20 }, (_, i) => ({ i, toPaintMs: i < missing ? null : clickMs })),
  });

test('verdict: a variant qualifies only with >= 30% faster clicks, a >= 9 Hz 100 ms timer and few missing clicks', () => {
  const v = verdict({
    baseline: variant({ clickMs: 110, t100Count: 31 }),
    fps30: variant({ clickMs: 100, t100Count: 50 }), // 9% faster: no
    fps60: variant({ clickMs: 70, t100Count: 31 }), // 36% faster but the timer stays at 6.2 Hz: no
    beginframe: variant({ clickMs: 60, t100Count: 50 }), // 45% faster, 10 Hz: yes
  });
  assert.equal(v.baseline.clickMedianMs, 110);
  assert.equal(v.variants.fps30.qualifies, false);
  assert.equal(v.variants.fps60.qualifies, false);
  assert.equal(v.variants.beginframe.qualifies, true);
  assert.equal(v.variants.beginframe.clickGainPct, 45.5);
  assert.deepEqual(v.qualifying, ['beginframe']);
  assert.equal(v.best, 'beginframe');
});

test('verdict: the fastest of several qualifying variants is best; too many missing clicks disqualify', () => {
  const v = verdict({
    baseline: variant({ clickMs: 110, t100Count: 31 }),
    fps30: variant({ clickMs: 70, t100Count: 50 }),
    fps60: variant({ clickMs: 60, t100Count: 50 }),
    beginframe: variant({ clickMs: 30, t100Count: 50, missing: 5 }), // 25% missing
  });
  assert.deepEqual(v.qualifying, ['fps30', 'fps60']);
  assert.equal(v.best, 'fps60');
  assert.equal(v.variants.beginframe.qualifies, false);
});

test('verdict: no baseline, no comparison; none qualifying names the limit', () => {
  assert.equal(verdict({ baseline: { missing: true }, fps30: variant({ clickMs: 50, t100Count: 50 }) }).best, null);
  const v = verdict({ baseline: variant({ clickMs: 110, t100Count: 31 }), fps30: variant({ clickMs: 108, t100Count: 31 }) });
  assert.equal(v.best, null);
  assert.match(v.reading, /no variant qualifies/);
});
