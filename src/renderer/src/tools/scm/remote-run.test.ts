// The latest remote run as the tool shows it (E6 execution document, Design §4 and §5): output as lines, git's
// progress rewritten in place, the renderer's cap, the exit.
import { describe, expect, it } from 'vitest';
import { A, planOf, TOKEN } from '../../test-support/scm';
import { advanceRun, appendOutput, REMOTE_OUTPUT_CAP, runFromSnapshot, runStarted } from './remote-run';

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

  it('marks the truncated chunk and stops taking text past the cap', () => {
    let run = runStarted(null, planOf());
    run = advanceRun(run, { appSessionId: A, token: TOKEN, seq: 1, kind: 'stderr', text: 'x'.repeat(REMOTE_OUTPUT_CAP - 2) });
    run = advanceRun(run, { appSessionId: A, token: TOKEN, seq: 2, kind: 'stdout', text: 'abcd' });
    expect(run.bytes).toBe(REMOTE_OUTPUT_CAP);
    expect(run.truncated).toBe(true);
    expect(run.lines.at(-1)!.endsWith('xab')).toBe(true);
    run = advanceRun(run, { appSessionId: A, token: TOKEN, seq: 3, kind: 'stdout', truncated: true });
    run = advanceRun(run, { appSessionId: A, token: TOKEN, seq: 4, kind: 'exit', exitCode: null, signal: 'SIGTERM' });
    expect(run).toMatchObject({ seq: 4, truncated: true, running: false, exitCode: null, signal: 'SIGTERM' });
  });

  it('counts bytes, not UTF-16 units', () => {
    const run = advanceRun(runStarted(null, planOf()), { appSessionId: A, token: TOKEN, seq: 1, kind: 'stdout', text: 'é\n' });
    expect(run.bytes).toBe(3);
  });
});
