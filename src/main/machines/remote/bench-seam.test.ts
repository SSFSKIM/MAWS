// The remote bench's seam (bench-seam.ts; P5 O7 M7): only under MAWS_E2E=1 in an unpackaged build; it reports each link
// with its clock capability, sends sequential pings through the link's own `ping`, and probes.
import { afterEach, describe, expect, it } from 'vitest';
import type { MachineRef } from '@shared/machine/ref';
import { FakeLink, MINI } from '../../../../test/lane-b/fake-link';
import { installRemoteBenchSeam, remoteBenchSeam } from './bench-seam';
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
