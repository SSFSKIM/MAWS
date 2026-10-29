// DC9's M5: the jobs view's words — the tab's label, a tail's "before" note, an output path by its last parts.
import type { Job } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import { formatBytes, JOBS_COPY, jobsTabLabel, noFileNote, shortPath } from './jobs-copy';

const job = (status: Job['status']): Job => ({ taskId: `t-${status}`, kind: 'shell', toolUseId: 'toolu_x', startedAt: '2026-10-17T10:00:00.000Z', description: 'x', outputFile: null, status });

describe('the jobs view’s words', () => {
  it('labels the tab by how many run, else how many there are, and plainly before any', () => {
    expect(jobsTabLabel(null)).toBe('Jobs');
    expect(jobsTabLabel([])).toBe('Jobs');
    expect(jobsTabLabel([job('running'), job('running'), job('completed')])).toBe('Jobs · 2 running');
    expect(jobsTabLabel([job('completed'), job('exited')])).toBe('Jobs · 2');
  });

  it('says how much of the file precedes the tail', () => {
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(900)).toBe('900 bytes');
    expect(formatBytes(4096)).toBe('4.0 KB');
    expect(formatBytes(1_150_000)).toBe('1.1 MB');
    expect(JOBS_COPY.before(1_150_000)).toBe('1.1 MB before this, not shown');
  });

  it('says no file is named yet, and that Output asks again, only while the job runs in a live session', () => {
    expect(noFileNote(false)).toEqual({ main: 'No output file yet.', why: 'Output asks again when the session names one.' });
    expect(noFileNote(true)).toEqual({ main: 'No output file was named for this job.' });
  });

  it('names an output file by its last two parts', () => {
    expect(shortPath('/private/tmp/claude-501/-work/3f2a9c1e/tasks/bq81x2kd.output')).toBe('…/tasks/bq81x2kd.output');
    expect(shortPath('tasks/b.output')).toBe('tasks/b.output');
  });
});
