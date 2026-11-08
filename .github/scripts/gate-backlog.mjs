// Date.parse alone coerces arrays and accepts local/offset dates. Publications must name an actual UTC instant.
export function utcTimestampOf(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return NaN;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 19) === value.slice(0, 19) ? timestamp : NaN;
}

// The caller's advisory snapshot, not an instruction to move a job. Five minutes allows plan startup, not an old wave.
export function backlogOf(text, now) {
  try {
    const sample = JSON.parse(text);
    const age = now - Date.parse(sample.at);
    if (![1, 2].includes(sample.v) || !Number.isFinite(age) || age < 0 || age > 300_000 ||
        !['idle', 'busy', 'offline'].includes(sample.ec2) ||
        !['hostedQueued', 'hostedRunning', 'ec2Queued'].every((key) => Number.isSafeInteger(sample[key]) && sample[key] >= 0) ||
        (sample.v === 2 && (!['idle', 'busy', 'offline'].includes(sample.mini) ||
          !['miniQueued', 'miniRunning'].every((key) => Number.isSafeInteger(sample[key]) && sample[key] >= 0) ||
          !['miniHost', 'miniVm'].every((key) => ['free', 'held'].includes(sample[key])))) ||
        !Array.isArray(sample.partial) || !sample.partial.every((repo) => typeof repo === 'string')) return null;
    // An unavailable publication holds only the mini, not an otherwise valid hosted/EC2 snapshot.
    if (sample.v === 2 && !Number.isFinite(utcTimestampOf(sample.lanesAt))) {
      return { ...sample, lanesAt: null, miniHost: 'held', miniVm: 'held' };
    }
    return sample;
  } catch { return null; }
}
