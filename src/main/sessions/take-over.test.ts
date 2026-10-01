import { describe, expect, it, vi } from 'vitest';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { ForeignHolder } from '@shared/graph/session';
import type { CommandName, CommandResult } from '@shared/ipc/schema';
import { status } from '../../../test/support/builders';
import { releaseHolder, type TakeOverDeps } from './take-over';

const APP = 'app-w7' as AppSessionId;
const S = '11111111-1111-4111-8111-111111111111' as SessionId;
const TERMINAL: ForeignHolder = { kind: 'terminal', pid: 4242 };
const JOB: ForeignHolder = { kind: 'background_job', pid: 4343, jobId: 'abcd1234' };

// A host whose registry answers `holders` until the test clears it, and whose process table holds `reserved`.
function host(initial: ForeignHolder[], reserved = false) {
  let holders = initial;
  const calls: CommandName[] = [];
  const dispatch = vi.fn(async (_owner: string, name: CommandName) => {
    calls.push(name);
    let value: unknown;
    if (name === 'engine.sessions') value = reserved ? [status(APP)] : [];
    else if (name === 'fs.holders') value = { refreshedAt: '2026-10-01T18:00:00.000Z', holders: holders.map((holder) => ({ sessionId: S, appSessionId: APP, holder, cwd: '/w' })) };
    else if (name === 'engine.binaryInfo') value = { path: '/pinned/claude', expectedVersion: '2.1.283', version: '2.1.283', ok: true, error: null };
    return { ok: true, value } as CommandResult<CommandName>;
  });
  return { calls, dispatch, clear: () => void (holders = []) };
}

const deps = (h: ReturnType<typeof host>, over: Partial<TakeOverDeps> = {}): TakeOverDeps => ({
  dispatch: h.dispatch as never, sessions: { list: () => [] }, env: { CLAUDE_CONFIG_DIR: '/scratch' }, waitMs: 200, pollMs: 5, ...over,
});

// W7 (charter D-12 as amended 2026-10-01): "Take over here" ends the confirmed holder and waits for the registry.
describe('take over a session another process holds', () => {
  it('signals the verified terminal holder and answers released once the registry clears', async () => {
    const h = host([TERMINAL]);
    const signal = vi.fn(() => setTimeout(h.clear, 20));
    expect(await releaseHolder(deps(h, { signal }), { engineSessionId: S, appSessionId: APP, expected: TERMINAL })).toEqual({ status: 'released' });
    expect(signal).toHaveBeenCalledWith(4242);
  });

  it('stops a --bg job with `claude stop <short>` through the pinned binary and the engine environment', async () => {
    const h = host([JOB]);
    const runStop = vi.fn(async () => h.clear());
    expect(await releaseHolder(deps(h, { runStop }), { engineSessionId: S, appSessionId: APP, expected: JOB })).toEqual({ status: 'released' });
    expect(runStop).toHaveBeenCalledWith('/pinned/claude', 'abcd1234', { CLAUDE_CONFIG_DIR: '/scratch' });
  });

  it('ends nothing when the holder is not the one confirmed, is MAWS itself, or has no job id', async () => {
    const signal = vi.fn();
    const changed = await releaseHolder(deps(host([{ kind: 'terminal', pid: 9 }]), { signal }), { engineSessionId: S, appSessionId: APP, expected: TERMINAL });
    expect(changed).toMatchObject({ status: 'refused', reason: 'changed', message: 'The session is now held by the terminal (pid 9), not the process you confirmed; nothing was stopped.' });
    expect(await releaseHolder(deps(host([TERMINAL], true), { signal }), { engineSessionId: S, appSessionId: APP, expected: TERMINAL })).toMatchObject({ status: 'refused', reason: 'self' });
    const anonymous: ForeignHolder = { kind: 'background_job', pid: 5, jobId: null };
    expect(await releaseHolder(deps(host([anonymous]), { signal }), { engineSessionId: S, appSessionId: APP, expected: anonymous })).toMatchObject({ status: 'refused', reason: 'no_job_id' });
    expect(signal).not.toHaveBeenCalled();
  });

  it('answers released at once when the holder already exited', async () => {
    const signal = vi.fn();
    expect(await releaseHolder(deps(host([]), { signal }), { engineSessionId: S, appSessionId: APP, expected: TERMINAL })).toEqual({ status: 'released' });
    expect(signal).not.toHaveBeenCalled();
  });

  it('refuses after the bounded wait when the holder stays, and when the signal or the stop fails', async () => {
    const stays = await releaseHolder(deps(host([TERMINAL]), { signal: () => {} }), { engineSessionId: S, appSessionId: APP, expected: TERMINAL });
    expect(stays).toMatchObject({ status: 'refused', reason: 'timeout' });
    expect((stays as { message: string }).message).toMatch(/^The terminal \(pid 4242\) has not exited after 0 s/);
    const denied = await releaseHolder(deps(host([TERMINAL]), { signal: () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); } }), { engineSessionId: S, appSessionId: APP, expected: TERMINAL });
    expect(denied).toMatchObject({ status: 'refused', reason: 'signal_failed', message: 'MAWS could not end the terminal (pid 4242): operation not permitted' });
    const h = host([TERMINAL]);
    const gone = await releaseHolder(deps(h, { signal: () => { h.clear(); throw Object.assign(new Error('no such process'), { code: 'ESRCH' }); } }), { engineSessionId: S, appSessionId: APP, expected: TERMINAL });
    expect(gone).toEqual({ status: 'released' }); // exited between the read and the signal
    const refusedStop = await releaseHolder(deps(host([JOB]), { runStop: async () => { throw new Error('no such job'); } }), { engineSessionId: S, appSessionId: APP, expected: JOB });
    expect(refusedStop).toMatchObject({ status: 'refused', reason: 'stop_failed', message: 'MAWS could not end the background job bg · abcd1234: no such job' });
  });
});
