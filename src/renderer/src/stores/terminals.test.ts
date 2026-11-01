import type { HostState } from '@shared/ipc/schema';
import type { MachineRef } from '@shared/machine/ref';
import { describe, expect, it } from 'vitest';
import { OTHER_MACHINE, TEST_MACHINE } from '../../../../test/support/machine';
import type { TerminalId, TerminalInfo } from '../terminal/registry';
import { createTerminalsStore } from './terminals';

describe('terminals store', () => {
  // P5 O7 M3: each machine's pty host state, since a terminal's readiness is its own machine's
  it('mirrors the registry’s infos and every machine’s host state, never its handles', () => {
    let push: (infos: TerminalInfo[], host: HostState | null) => void = () => {};
    let hosts = new Map<MachineRef, HostState>();
    const store = createTerminalsStore({
      list: () => [],
      host: () => null,
      hosts: () => hosts,
      subscribe: (cb) => {
        push = cb;
        return () => {};
      },
    });
    expect(store.getState()).toMatchObject({ terminals: [], host: null, hosts: new Map() });
    const info = { id: 't' as TerminalId, status: 'running' } as TerminalInfo;
    const local: HostState = { state: 'ready', pid: 1, restarts: 0, revision: 1 };
    const other: HostState = { state: 'starting', pid: null, restarts: 0, revision: 2 };
    hosts = new Map([
      [TEST_MACHINE, local],
      [OTHER_MACHINE, other],
    ]);
    push([info], local);
    expect(store.getState()).toMatchObject({ terminals: [info], host: local });
    expect(store.getState().hosts.get(OTHER_MACHINE)).toEqual(other);
  });
});
