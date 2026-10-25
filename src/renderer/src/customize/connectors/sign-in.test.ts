// The renderer's record of connector sign-ins (the Discover spec, Design "Signing in"; M4 fix wave): a result belongs to
// the configured server it was started for (its name, scope, and the directory for a project or local one) and to the
// session that signed in, never to every server that shares the name.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { MawsBridge } from '@shared/ipc/schema';
import { forgetSignIn, heard, resetSignIns, signInKeyOf, startSignIn, useSignIns } from './sign-in';

const event = (opId: string, state: ConnectorSignInChanged['state'], name = 'linear'): ConnectorSignInChanged => ({ opId, name, state, reason: null, message: null, where: null });
const USER = { name: 'linear', scope: 'user', cwd: '/a', path: '/cfg/.claude.json', fingerprint: 'print-user' } as const;
const PROJECT_A = { name: 'linear', scope: 'project', cwd: '/a', path: '/a/.mcp.json', fingerprint: 'print-a' } as const;
const PROJECT_B = { name: 'linear', scope: 'project', cwd: '/b', path: '/b/.mcp.json', fingerprint: 'print-b' } as const;
const recordOf = (target: Parameters<typeof signInKeyOf>[0]) => useSignIns.getState().byServer.get(signInKeyOf(target));
// main answers the receipt after it has already said `starting` (and cancelled an earlier operation), as connectors.signIn does
const bridgeAnswering = (...opIds: string[]) => {
  const queue = [...opIds];
  return { invoke: vi.fn(async () => ({ ok: true, value: { opId: queue.shift()! } })) } as unknown as MawsBridge;
};

describe('a server’s latest sign-in', () => {
  beforeEach(() => resetSignIns());

  it('is the configured server’s own: user scope ignores the directory, project scope keys it', () => {
    expect(signInKeyOf(USER)).toBe(signInKeyOf({ ...USER, cwd: '/b' }));
    expect(signInKeyOf(PROJECT_A)).not.toBe(signInKeyOf(PROJECT_B));
    expect(signInKeyOf(PROJECT_A)).not.toBe(signInKeyOf({ ...PROJECT_A, scope: 'local' }));
  });

  it('binds the events heard before the receipt to the server it was started for, with the signing session and when', async () => {
    const bridge = bridgeAnswering('one');
    const started = startSignIn(PROJECT_A, PROJECT_A.fingerprint, 'session-a', bridge);
    heard(event('one', 'starting'), 100); // before the invoke answered
    expect(recordOf(PROJECT_A)).toBeUndefined();
    await started;
    expect(recordOf(PROJECT_A)).toEqual({ event: event('one', 'starting'), appSessionId: 'session-a', at: 100, fingerprint: 'print-a' });
    heard(event('one', 'done'), 200);
    expect(recordOf(PROJECT_A)).toMatchObject({ event: { state: 'done' }, at: 200 });
    expect(recordOf(PROJECT_B)).toBeUndefined(); // another project's server of the same name has nothing
    expect(recordOf(USER)).toBeUndefined();
  });

  it('follows its newest operation: a second press replaces the first, whose later events are dropped', async () => {
    const bridge = bridgeAnswering('one', 'two');
    heard(event('one', 'starting'), 1);
    await startSignIn(USER, USER.fingerprint, 's', bridge);
    heard(event('one', 'waiting_callback'), 2);
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'one', state: 'waiting_callback' } });
    const second = startSignIn(USER, USER.fingerprint, 's', bridge);
    heard(event('one', 'cancelled'), 3); // main cancels the first before the second starts
    heard(event('two', 'starting'), 4);
    await second;
    heard(event('one', 'failed'), 5); // nothing more of the first counts
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'two', state: 'starting' } });
    heard(event('two', 'done'), 6);
    expect(recordOf(USER)).toMatchObject({ event: { opId: 'two', state: 'done' } });
  });

  it('two servers of one name in two projects keep their own results', async () => {
    const bridge = bridgeAnswering('a', 'b');
    await startSignIn(PROJECT_A, PROJECT_A.fingerprint, 's-a', bridge);
    await startSignIn(PROJECT_B, PROJECT_B.fingerprint, 's-b', bridge);
    heard(event('a', 'done'), 1);
    heard(event('b', 'failed'), 2);
    expect(recordOf(PROJECT_A)).toMatchObject({ event: { state: 'done' }, appSessionId: 's-a' });
    expect(recordOf(PROJECT_B)).toMatchObject({ event: { state: 'failed' }, appSessionId: 's-b' });
  });

  it('reads a refused invoke as a sign-in that did not finish, in the transport’s words', async () => {
    const bridge = { invoke: vi.fn(async () => ({ ok: false, error: { code: 'unavailable', message: 'main is not ready' } })) } as unknown as MawsBridge;
    await startSignIn(USER, USER.fingerprint, 'session-1', bridge);
    expect(bridge.invoke).toHaveBeenCalledWith('connectors.signIn', { name: 'linear', scope: 'user', cwd: '/a', path: '/cfg/.claude.json', appSessionId: 'session-1' });
    expect(recordOf(USER)).toMatchObject({ event: { state: 'failed', reason: 'engine' }, appSessionId: 'session-1' });
    expect(recordOf(USER)!.event.message).toBeTruthy();
  });

  it('forgets a server’s result when MAWS removes or replaces its configuration, and drops the rest of a running operation', async () => {
    const bridge = bridgeAnswering('one');
    await startSignIn(USER, USER.fingerprint, 's', bridge);
    heard(event('one', 'waiting_callback'), 1);
    forgetSignIn(USER);
    expect(recordOf(USER)).toBeUndefined();
    heard(event('one', 'done'), 2); // main's operation ends after the removal: it says nothing about what is configured now
    expect(recordOf(USER)).toBeUndefined();
  });
});
