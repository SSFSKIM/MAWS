// The remote bench's seam (bench-seam.ts; P5 O7 M7): only under MAWS_E2E=1 in an unpackaged build; it reports each link
// with its clock capability, sends sequential pings through the link's own `ping`, and probes.
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI } from '../../../../test/lane-b/fake-link';
import { installRemoteBenchSeam, relayOnlyDial, remoteBenchSeam } from './bench-seam';
import type { PongStamps } from './link';

afterEach(() => void delete globalThis.__maws_remote_bench);

function linked(capabilities: string[] = ['rl2.pong-clock']) {
  const link = new FakeLink();
  link.set('up', 'relay');
  link.peers = capabilities;
  const sent: number[] = [];
  const probes: string[] = [];
  let n = 0;
  link.ping = () => {
    sent.push(++n);
    return Promise.resolve(n === 2 ? null : ({ at: n, received: n + 100, sent: n + 100, arrived: n + 1, carrier: 'relay' } satisfies PongStamps));
  };
  link.probe = (reason?: string) => void probes.push(reason ?? '');
  return { link, sent, probes, deps: { machines: () => [{ ref: MINI }, { ref: 'GoneMachine0000000000' as MachineRef }], link: (ref: MachineRef) => (ref === MINI ? link : null) } };
}

describe('the remote bench seam (P5 O7 M7)', () => {
  it('is installed only under MAWS_E2E=1 in an unpackaged build, and removed again', () => {
    const { deps } = linked();
    installRemoteBenchSeam({}, false, deps)();
    expect(globalThis.__maws_remote_bench).toBeUndefined();
    installRemoteBenchSeam({ MAWS_E2E: '1' }, true, deps);
    expect(globalThis.__maws_remote_bench).toBeUndefined();
    const remove = installRemoteBenchSeam({ MAWS_E2E: '1' }, false, deps);
    expect(globalThis.__maws_remote_bench).toBeDefined();
    remove();
    expect(globalThis.__maws_remote_bench).toBeUndefined();
  });

  it('reports each linked machine with its state, carrier and whether its peer listed the pong clock', () => {
    expect(remoteBenchSeam(linked().deps).machines()).toEqual([{ ref: MINI, name: 'mini', state: 'up', carrier: 'relay', clock: true }]);
    expect(remoteBenchSeam(linked([]).deps).machines()[0]!.clock).toBe(false);
  });

  it('sends its pings one after another through the link, answering each pong’s stamps or null, and probes', async () => {
    const { deps, sent, probes } = linked();
    const seam = remoteBenchSeam(deps);
    expect((await seam.ping(MINI, 3)).map((stamps) => stamps?.at ?? null)).toEqual([1, null, 3]);
    expect(sent).toEqual([1, 2, 3]);
    seam.probe(MINI, 'network');
    expect(probes).toEqual(['network']);
    await expect(seam.ping('GoneMachine0000000000' as MachineRef, 1)).rejects.toThrow(/no RL2 link/);
  });
});

describe('the live bench’s resume (P5 O7 M7)', () => {
  it('drops a link through its hold, and on release answers the instant of its next up and that up’s carrier', async () => {
    const { link, deps } = linked();
    const calls: string[] = [];
    link.benchHold = () => (calls.push('hold'), true);
    link.benchRelease = () => void calls.push('release');
    let clock = 1_000;
    const seam = remoteBenchSeam({ ...deps, now: () => clock });
    expect(seam.drop(MINI)).toBe(true);
    link.set('down', null);
    const released = seam.release(MINI, 5_000);
    expect(calls).toEqual(['hold', 'release']);
    clock = 1_250;
    link.set('connecting', null); // not up yet: still waited for
    clock = 1_400;
    link.set('up', 'relay');
    await expect(released).resolves.toEqual({ upAt: 1_400, carrier: 'relay' });
    expect(() => seam.drop('GoneMachine0000000000' as MachineRef)).toThrow(/no RL2 link/);
  });

  it('lifts a hold unconditionally with unhold, and every hold it made when it is removed (the app closing)', () => {
    const { link, deps } = linked();
    const released: string[] = [];
    link.benchHold = () => true;
    link.benchRelease = () => void released.push('release');
    const seam = remoteBenchSeam(deps);
    seam.unhold(MINI); // nothing held: nothing to lift
    expect(released).toEqual([]);
    seam.drop(MINI);
    seam.unhold(MINI);
    expect(released).toEqual(['release']);
    link.benchHold = () => false; // no channel: nothing held, nothing to lift later
    seam.drop(MINI);
    seam.dispose();
    expect(released).toEqual(['release']);
    link.benchHold = () => true;
    const remove = installRemoteBenchSeam({ MAWS_E2E: '1' }, false, deps);
    globalThis.__maws_remote_bench!.drop(MINI);
    remove();
    expect(released).toEqual(['release', 'release']);
    expect(globalThis.__maws_remote_bench).toBeUndefined();
  });

  it('refuses a release while the link still reports up (a reconnect within its grace), and answers null when no up comes in time', async () => {
    const { link, deps } = linked();
    const seam = remoteBenchSeam(deps);
    await expect(seam.release(MINI)).rejects.toThrow(/still reports up/);
    link.set('down', null);
    await expect(seam.release(MINI, 10)).resolves.toBeNull();
  });
});

describe('the live bench’s relay case (P5 O7 M7)', () => {
  it('refuses every direct dial only under MAWS_E2E=1 and MAWS_E2E_REMOTE_CARRIER=relay in an unpackaged build', async () => {
    const on = { MAWS_E2E: '1', MAWS_E2E_REMOTE_CARRIER: 'relay' };
    expect(relayOnlyDial({ MAWS_E2E_REMOTE_CARRIER: 'relay' }, false)).toBeNull();
    expect(relayOnlyDial(on, true)).toBeNull();
    expect(relayOnlyDial({ MAWS_E2E: '1', MAWS_E2E_REMOTE_CARRIER: 'direct' }, false)).toBeNull();
    await expect(relayOnlyDial(on, false)!('ws://100.64.1.2:47830', 1000)).rejects.toThrow(/direct carrier is off/);
  });
});
