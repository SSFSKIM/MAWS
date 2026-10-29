// The caller's advisory snapshot, not an instruction to move a job. Five minutes allows plan startup, not an old wave.
export function backlogOf(text, now) {
  try {
    const sample = JSON.parse(text);
    const age = now - Date.parse(sample.at);
    if (sample.v !== 1 || !Number.isFinite(age) || age < 0 || age > 300_000 ||
        !['idle', 'busy', 'offline'].includes(sample.ec2) ||
        !['hostedQueued', 'hostedRunning', 'ec2Queued'].every((key) => Number.isSafeInteger(sample[key]) && sample[key] >= 0) ||
        !Array.isArray(sample.partial) || !sample.partial.every((repo) => typeof repo === 'string')) return null;
    return sample;
  } catch { return null; }
}
