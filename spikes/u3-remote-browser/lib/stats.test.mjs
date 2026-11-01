// The numbers the spike records (lib/stats.mjs): frame cadence and bytes over a window, and the click round trips.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { median, percentile, frameStats, roundTrips } from './stats.mjs';

test('median and percentile of a sample', () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
});

test('frame stats over a window: cadence, bytes per second and the 10 fps reading', () => {
  // 11 frames 100 ms apart over a 1 s window, 20,000 bytes each
  const frames = Array.from({ length: 11 }, (_, i) => ({ at: 1000 + i * 100, bytes: 20_000 }));
  const s = frameStats(frames, { from: 1000, to: 2000 });
  assert.equal(s.frames, 11);
  assert.equal(s.fps, 11);
  assert.equal(s.medianIntervalMs, 100);
  assert.equal(s.bytesPerSecond, 220_000);
  assert.equal(s.medianFrameBytes, 20_000);
  assert.equal(s.bytesPerSecondAt10fps, 200_000);
});

test('frame stats count only the window and survive an empty one', () => {
  const frames = [{ at: 0, bytes: 1 }, { at: 1500, bytes: 10 }, { at: 3000, bytes: 1 }];
  assert.equal(frameStats(frames, { from: 1000, to: 2000 }).frames, 1);
  const empty = frameStats([], { from: 0, to: 1000 });
  assert.equal(empty.frames, 0);
  assert.equal(empty.medianIntervalMs, null);
  assert.equal(empty.bytesPerSecond, 0);
});

test('round trips: each click to the first frame after it, a click with none missing', () => {
  const clicks = [{ id: 1, at: 100 }, { id: 2, at: 500 }, { id: 3, at: 900 }];
  const frames = [{ at: 50 }, { at: 130 }, { at: 140 }, { at: 560 }];
  const r = roundTrips(clicks, frames);
  assert.deepEqual(r.samples, [30, 60]);
  assert.equal(r.missing, 1);
  assert.equal(r.medianMs, 45);
});
