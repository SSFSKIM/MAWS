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
    return sample;
  } catch { return null; }
}
