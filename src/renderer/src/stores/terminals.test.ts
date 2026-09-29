import type { HostState } from '@shared/ipc/schema';
import { describe, expect, it } from 'vitest';
import type { TerminalId, TerminalInfo } from '../terminal/registry';
import { createTerminalsStore } from './terminals';

describe('terminals store', () => {
  it('mirrors the registry’s infos and host state, never its handles', () => {
    let push: (infos: TerminalInfo[], host: HostState | null) => void = () => {};
    const store = createTerminalsStore({
      list: () => [],
      host: () => null,
      subscribe: (cb) => {
        push = cb;
        return () => {};
      },
    });
    expect(store.getState()).toMatchObject({ terminals: [], host: null });
    const info = { id: 't' as TerminalId, status: 'running' } as TerminalInfo;
    const host: HostState = { state: 'ready', pid: 1, restarts: 0, revision: 1 };
    push([info], host);
    expect(store.getState()).toMatchObject({ terminals: [info], host });
  });
});
