import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorSignInChanged } from '@shared/ipc/schema/connectors';
import type { MawsBridge } from '@shared/ipc/schema';
import { heard, startSignIn, useSignIns } from './sign-in';

const event = (opId: string, state: ConnectorSignInChanged['state']): ConnectorSignInChanged => ({ opId, name: 'linear', state, reason: null, message: null, where: null });
const latest = () => useSignIns.getState().byName.get('linear');

describe('a server’s latest sign-in', () => {
  beforeEach(() => useSignIns.setState({ byName: new Map() }));

  it('follows its newest operation: a second press’s starting replaces the first, whose later events are dropped', () => {
    heard(event('one', 'starting'));
    heard(event('one', 'waiting_callback'));
    expect(latest()).toMatchObject({ opId: 'one', state: 'waiting_callback' });
    heard(event('one', 'cancelled')); // main cancels the first before the second starts
    heard(event('two', 'starting'));
    heard(event('one', 'failed')); // nothing more of the first counts
    expect(latest()).toMatchObject({ opId: 'two', state: 'starting' });
    heard(event('two', 'done'));
    expect(latest()).toMatchObject({ opId: 'two', state: 'done' });
  });

  it('reads a refused invoke as a sign-in that did not finish, in the transport’s words', async () => {
    const bridge = { invoke: vi.fn(async () => ({ ok: false, error: { code: 'unavailable', message: 'main is not ready' } })) } as unknown as MawsBridge;
    await startSignIn('linear', 'session-1', bridge);
    expect(bridge.invoke).toHaveBeenCalledWith('connectors.signIn', { name: 'linear', appSessionId: 'session-1' });
    expect(latest()).toMatchObject({ state: 'failed', reason: 'engine' });
    expect(latest()!.message).toBeTruthy();
  });
});
