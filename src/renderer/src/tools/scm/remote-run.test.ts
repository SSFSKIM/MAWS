// The latest remote run as the tool shows it (E6 execution document, Design §4 and §5): output as lines, git's
// progress rewritten in place, the renderer's cap, the exit.
import { describe, expect, it } from 'vitest';
import { A, planOf, TOKEN } from '../../test-support/scm';
import { advanceRun, appendOutput, runFromSnapshot, runStarted } from './remote-run';

describe('remote run output', () => {
  const none = { lines: [], carriage: false };

  it('splits chunks into lines, carrying a partial line into the next chunk', () => {
    let out = appendOutput(none, 'To /tmp/ori');
    out = appendOutput(out, 'gin.git\n   abc..def  main -> main\n');
    expect(out).toEqual({ lines: ['To /tmp/origin.git', '   abc..def  main -> main', ''], carriage: false });
  });

  it('rewrites a progress line in place on a carriage return, as a terminal shows it', () => {
    let out = appendOutput(none, 'Writing objects:  33% (1/3)\r');
    expect(out).toEqual({ lines: ['Writing objects:  33% (1/3)'], carriage: true }); // shown until the next text replaces it
    out = appendOutput(out, 'Writing objects:  66% (2/3)');
    expect(out.lines).toEqual(['Writing objects:  66% (2/3)']);
    out = appendOutput(out, '\rWriting objects: 100% (3/3), done.\r\nTo origin\n');
    expect(out).toEqual({ lines: ['Writing objects: 100% (3/3), done.', 'To origin', ''], carriage: false });
  });

  it('seeds from a snapshot whose run ended, with its exit', () => {
    const run = runFromSnapshot({
      token: TOKEN,
      kind: 'push',
      plan: planOf(),
      running: false,
      exitCode: 1,
      signal: null,
      output: 'error: failed to push\n',
      truncated: true,
      seq: 7,
      startedAt: '2026-10-06T10:00:00.000Z',
    });
    expect(run).toMatchObject({ token: TOKEN, kind: 'push', running: false, exitCode: 1, signal: null, truncated: true, seq: 7, lines: ['error: failed to push', ''] });
    expect(runFromSnapshot(null)).toBeNull();
  });

  // Main caps a run at 1 MiB and marks it with one `truncated` chunk; its own notes come outside that budget and must
  // still show (src/main/scm/remote-runner.ts).
  it('keeps main’s timeout note after a capped run, with the truncated mark and the exit', () => {
    const MIB = 1024 * 1024;
    let run = runStarted(null, planOf());
    for (let seq = 1; seq <= 64; seq++) run = advanceRun(run, { appSessionId: A, token: TOKEN, seq, kind: 'stderr', text: 'x'.repeat(MIB / 64 - 1) + '\n' });
    run = advanceRun(run, { appSessionId: A, token: TOKEN, seq: 65, kind: 'stdout', truncated: true });
    run = advanceRun(run, { appSessionId: A, token: TOKEN, seq: 66, kind: 'stderr', text: 'MAWS: timed out after 120 s; stopping it\n' });
    run = advanceRun(run, { appSessionId: A, token: TOKEN, seq: 67, kind: 'exit', exitCode: null, signal: 'SIGTERM' });
    expect(run).toMatchObject({ seq: 67, truncated: true, running: false, exitCode: null, signal: 'SIGTERM' });
    expect(run.lines.slice(-2)).toEqual(['MAWS: timed out after 120 s; stopping it', '']);
    expect(run.lines).toHaveLength(66);
  });

  it('keeps a note that follows a snapshot main already capped', () => {
    const snapshot = { token: TOKEN, kind: 'push' as const, plan: planOf(), running: true, exitCode: null, signal: null, output: 'x'.repeat(1024 * 1024), truncated: true, seq: 65, startedAt: '2026-10-06T10:00:00.000Z' };
    const run = advanceRun(runFromSnapshot(snapshot), { appSessionId: A, token: TOKEN, seq: 66, kind: 'stderr', text: '\ncould not start /usr/bin/git: EACCES\n' });
    expect(run.truncated).toBe(true);
    expect(run.lines.slice(-2)).toEqual(['could not start /usr/bin/git: EACCES', '']);
  });
});
