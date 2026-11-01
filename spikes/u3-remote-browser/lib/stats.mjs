// The spike's readings: a frame stream's cadence and bytes over a window, and each click's round trip to the first frame
// after it. Times are milliseconds on one clock (both ends run on the same machine).
export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Nearest rank.
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const round = (value, digits = 1) => (value === null ? null : Math.round(value * 10 ** digits) / 10 ** digits);

// frames: [{at, bytes}]; the window is [from, to] inclusive.
export function frameStats(frames, { from, to }) {
  const inWindow = frames.filter((frame) => frame.at >= from && frame.at <= to).sort((a, b) => a.at - b.at);
  const seconds = (to - from) / 1000;
  const intervals = inWindow.slice(1).map((frame, i) => frame.at - inWindow[i].at);
  const bytes = inWindow.reduce((sum, frame) => sum + frame.bytes, 0);
  const medianFrameBytes = median(inWindow.map((frame) => frame.bytes));
  return {
    frames: inWindow.length,
    windowMs: to - from,
    fps: round(inWindow.length / seconds),
    medianIntervalMs: round(median(intervals)),
    p95IntervalMs: round(percentile(intervals, 95)),
    bytesPerSecond: Math.round(bytes / seconds),
    medianFrameBytes,
    maxFrameBytes: inWindow.length ? Math.max(...inWindow.map((frame) => frame.bytes)) : null,
    bytesPerSecondAt10fps: medianFrameBytes === null ? null : medianFrameBytes * 10,
  };
}

// clicks: [{id, at}] in order; frames: [{at}]. A click's round trip ends at the first frame after it and before the next
// click; a click with no such frame is missing.
export function roundTrips(clicks, frames) {
  const sorted = [...frames].sort((a, b) => a.at - b.at);
  const samples = [];
  let missing = 0;
  clicks.forEach((click, i) => {
    const until = clicks[i + 1]?.at ?? Infinity;
    const frame = sorted.find((candidate) => candidate.at > click.at && candidate.at < until);
    if (frame) samples.push(frame.at - click.at);
    else missing += 1;
  });
  return { clicks: clicks.length, missing, samples, medianMs: round(median(samples)), p95Ms: round(percentile(samples, 95)), minMs: samples.length ? Math.min(...samples) : null, maxMs: samples.length ? Math.max(...samples) : null };
}
