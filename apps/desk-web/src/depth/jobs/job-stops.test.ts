// DC10: a job's Stop read from the RPCs the conversation keeps — the latest stop of each job of this session, `stopping…`
// until the body turns the job, a failure in words while it runs (the engine's own message for `failed`), and a stop
// whose fate is unknown handed to the desk's status line.
import type { Rpc, RpcOutcome } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { RpcEntry } from '../../project/conversation';
import { jobStop, latestStops, stopFailureText } from './job-stops';

let count = 0;
const entry = (taskId: string, state: RpcEntry['state'], over: { session?: string; machine?: string; outcome?: RpcOutcome } = {}): RpcEntry => {
  const nonce = `n${++count}`;
  const rpc = { rpc: 'stop', project: 'p', machine: over.machine ?? 'mini', member: 'm', created: '', nonce, args: { session: over.session ?? 's1', taskId }, mac: '' } as Rpc<'stop'>;
  return { nonce, rpc, state, ...(over.outcome && { outcome: over.outcome }) };
};
const byNonce = (...entries: RpcEntry[]) => Object.fromEntries(entries.map((e) => [e.nonce, e]));
const failed = (code: 'failed' | 'unknown-task' | 'read-only', message: string): RpcOutcome => ({ state: 'failed', error: { code, message } });

describe('latestStops', () => {
  it("keeps this session's stops on its machine, the latest of each job", () => {
    const first = entry('b1', 'failed', { outcome: failed('failed', 'busy') });
    const again = entry('b1', 'forwarded');
    const other = entry('b2', 'sending');
    const elsewhere = entry('b3', 'sending', { session: 's2' });
    const otherMachine = entry('b4', 'sending', { machine: 'SK.local' });
    const steer = { ...entry('b5', 'sending'), rpc: { rpc: 'steer', args: { session: 's1', text: 'x' }, machine: 'mini' } as Rpc };
    const stops = latestStops(byNonce(first, again, other, elsewhere, otherMachine, steer), 'mini', 's1');
    expect([...stops.keys()]).toEqual(['b1', 'b2']);
    expect(stops.get('b1')).toBe(again);
  });
});

describe('jobStop', () => {
  it('reads stopping from the press until the body says the job no longer runs, the RPC done or not', () => {
    for (const state of ['sending', 'forwarded', 'done'] as const) expect(jobStop(entry('b1', state), true), state).toEqual({ stopping: true, error: null, status: null });
    expect(jobStop(entry('b1', 'done'), false)).toEqual({ stopping: false, error: null, status: null });
    expect(jobStop(undefined, true)).toEqual({ stopping: false, error: null, status: null });
  });

  it("says a failure while the job runs: the engine's message for failed, the desk's words for a refusal", () => {
    expect(jobStop(entry('b1', 'failed', { outcome: failed('failed', 'Task b1 is not running (status: completed)') }), true)).toEqual({ stopping: false, error: 'Task b1 is not running (status: completed)', status: null });
    expect(jobStop(entry('b1', 'failed', { outcome: failed('unknown-task', 'b1 is not running') }), true).error).toBe('mini does not hold that job as running');
    expect(jobStop(entry('b1', 'failed', { outcome: failed('failed', 'x') }), false).error).toBeNull();
  });

  it('hands a stop whose fate is unknown to the status line, with its nonce for Retry', () => {
    const uncertain = entry('b1', 'uncertain');
    expect(jobStop(uncertain, true)).toEqual({ stopping: false, error: null, status: uncertain.nonce });
    expect(jobStop(entry('b1', 'not-connected'), true).status).not.toBeNull();
  });
});

describe('stopFailureText', () => {
  it('falls back to the desk’s words when the engine said nothing', () => {
    expect(stopFailureText({ code: 'failed', message: '' }, 'mini')).toBe('it failed');
    expect(stopFailureText({ code: 'read-only', message: 'r' }, 'mini')).toBe('mini is read-only: it runs nothing sent from outside it');
  });
});
