// The end of a paid live run (P3-C M10; e2e/support/live-lifecycle.ts): every step runs whatever an earlier one threw,
// the session is stopped before the app closes, an engine that outlives the app fails the run and is killed (a reused
// pid never is), and the spend is accounted at the whole cap when no receipt settles a prompt. Fakes stand for the
// session, the app and the process table; no engine runs.
import { describe, expect, it } from 'vitest';
import type { JournalRow } from '@shared/wire/journal';
import { endLiveRun, liveSpend, type LiveSession, type ProcessPort } from '../../e2e/support/live-lifecycle';

function world(over: { alive?: Set<number>; command?: string } = {}) {
  const steps: string[] = [];
  const alive = over.alive ?? new Set<number>();
  const port: ProcessPort = {
    isAlive: (pid) => alive.has(pid),
    command: () => over.command ?? '/Users/x/.local/share/claude/versions/2.1.0 --input-format stream-json',
    kill: (pid) => {
      steps.push(`kill ${pid}`);
      alive.delete(pid);
    },
    sleep: async () => {},
  };
  const notes: string[] = [];
  return { steps, port, notes, note: (line: string) => notes.push(line) };
}

function session(steps: string[], states: string[], opts: { pid?: number; stopFails?: boolean } = {}): LiveSession {
  let k = 0;
  return {
    status: async () => {
      steps.push('status');
      return { process: states[Math.min(k++, states.length - 1)]!, pid: opts.pid ?? 4242 };
    },
    stop: async () => {
      steps.push('stop');
      if (opts.stopFails) throw new Error('stop refused');
    },
  };
}

describe('endLiveRun', () => {
  it('stops a running session, copies, closes the app, and finds the engine gone', async () => {
    const w = world();
    const end = await endLiveRun({ session: session(w.steps, ['ready', 'stopping', 'exited']), enginePid: null, beforeCleanup: () => w.steps.push('copy'), cleanup: async () => void w.steps.push('cleanup'), note: w.note }, w.port);
    expect(end).toEqual({ errors: [], enginePid: 4242 }); // the pid from the session's status when none was recorded
    expect(w.steps).toEqual(['status', 'stop', 'status', 'status', 'copy', 'cleanup']);
    expect(w.notes).toEqual(['engine process: pid 4242 gone']);
  });

  it('asks no stop of a session that has exited, and keeps a recorded pid', async () => {
    const w = world();
    const end = await endLiveRun({ session: session(w.steps, ['exited'], { pid: 1 }), enginePid: 77, cleanup: async () => void w.steps.push('cleanup'), note: w.note }, w.port);
    expect(end.enginePid).toBe(77);
    expect(w.steps).toEqual(['status', 'cleanup']);
  });

  it('runs every later step when the stop fails, answering the failure', async () => {
    const w = world();
    const end = await endLiveRun({ session: session(w.steps, ['ready'], { stopFails: true }), enginePid: null, beforeCleanup: () => w.steps.push('copy'), cleanup: async () => void w.steps.push('cleanup'), note: w.note }, w.port);
    expect(end.errors.map((e) => (e as Error).message)).toEqual(['stop refused']);
    expect(w.steps).toEqual(['status', 'stop', 'copy', 'cleanup']);
    expect(w.notes[0]).toBe('the session could not be stopped: stop refused');
  });

  it('fails the run on an engine that outlives the app, and kills it', async () => {
    const w = world({ alive: new Set([4242]) });
    const end = await endLiveRun({ session: null, enginePid: 4242, cleanup: async () => {}, note: w.note }, w.port);
    expect(end.errors).toHaveLength(1);
    expect((end.errors[0] as Error).message).toMatch(/^pid 4242 \(.*claude.*\) still runs after the app closed; killed$/);
    expect(w.steps).toEqual(['kill 4242']);
    expect(w.notes.at(-1)).toBe('engine process: pid 4242 gone');
  });

  it('leaves a reused pid alone', async () => {
    const w = world({ alive: new Set([4242]), command: '/usr/bin/some-other-program' });
    const end = await endLiveRun({ session: null, enginePid: 4242, cleanup: async () => {}, note: w.note }, w.port);
    expect(end.errors).toEqual([]);
    expect(w.steps).toEqual([]);
    expect(w.notes).toEqual(['engine process: pid 4242 STILL ALIVE']);
  });

  it('answers a failed cleanup and notes a run with no launch', async () => {
    const w = world();
    const end = await endLiveRun({ session: null, enginePid: null, cleanup: async () => Promise.reject(new Error('close failed')), note: w.note }, w.port);
    expect(end.errors.map((e) => (e as Error).message)).toEqual(['close failed']);
    expect(w.notes).toEqual(['the app’s cleanup failed: close failed', 'engine process: none recorded (no launch reached ready)']);
  });
});

const prompt = (seq: number): JournalRow => ({ seq, at: '2026-10-15T00:00:00Z', direction: 'out', frame: { type: 'user' } }) as unknown as JournalRow;
const receipt = (seq: number, usd: number): JournalRow => ({ seq, at: '2026-10-15T00:00:00Z', direction: 'in', frame: { type: 'result', total_cost_usd: usd, num_turns: 1, parent_tool_use_id: null } }) as unknown as JournalRow;

describe('liveSpend', () => {
  it('is nothing when no prompt was sent', () => {
    expect(liveSpend([], 0.75, false)).toMatchObject({ receipts: [], accounted: 0, basis: 'no prompt sent' });
  });

  it('is the whole cap for a prompt with no journal', () => {
    expect(liveSpend([], 0.75, true)).toMatchObject({ accounted: 0.75, basis: 'no journal: the whole cap' });
  });

  it('is the last receipt when it came after the last prompt', () => {
    const spend = liveSpend([prompt(1), receipt(2, 0.011), prompt(3), receipt(4, 0.0195)], 0.75, true);
    expect(spend).toMatchObject({ receipts: [0.011, 0.0195], receipted: 0.0195, settled: true, accounted: 0.0195, basis: 'settled by its receipt' });
  });

  it('is the whole cap when a prompt has no receipt after it', () => {
    const spend = liveSpend([prompt(1), receipt(2, 0.011), prompt(3)], 0.75, true);
    expect(spend).toMatchObject({ receipted: 0.011, settled: false, accounted: 0.75, basis: 'unreceipted turn: the whole cap' });
  });
});
