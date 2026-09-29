import { afterEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { ipcError } from '@shared/ipc/errors';
import type { EventPayload, MawsBridge } from '@shared/ipc/schema';
import { attachCatalog, EMPTY_CATALOG, resetCatalogStore, useCatalogStore } from './catalog';

const APP = 'app-1' as AppSessionId;
const raw = (revision: number, names: string[]) => ({
  commands: names.map((name) => ({ name, description: `${name} it`, argumentHint: '', builtin: true })), agents: [], skills: [], terminalSlashCommands: [], revision,
});

// A bridge whose reads answer when the test says, with every catalogue listener reachable.
function fakeBridge(answers: { status: () => unknown; catalog: () => unknown }) {
  const listeners = new Set<(e: EventPayload<'session.catalogChanged'>) => void>();
  const pending: (() => void)[] = [];
  const bridge = {
    invoke: (name: string) =>
      new Promise((resolve) => pending.push(() => resolve(name === 'session.status' ? answers.status() : answers.catalog()))),
    on: (name: string, listener: (e: EventPayload<'session.catalogChanged'>) => void) => {
      if (name !== 'session.catalogChanged') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pathForFile: () => '',
  } as unknown as MawsBridge;
  return {
    bridge,
    emit: (launchId: string, revision: number, names: string[], appSessionId: AppSessionId = APP) => listeners.forEach((l) => l({ appSessionId, launchId, catalog: raw(revision, names) })),
    answer: async () => {
      while (pending.length > 0) {
        pending.shift()!();
        await new Promise((r) => setTimeout(r, 0));
      }
    },
    listeners,
  };
}

const held = () => useCatalogStore.getState().bySession.get(APP);
afterEach(resetCatalogStore);

describe('catalog store reconciles snapshot and events', () => {
  it('holds a buffered later revision over the snapshot, drops an older one, and takes another launch', async () => {
    const f = fakeBridge({ status: () => ({ ok: true, value: { launchId: 'L1' } }), catalog: () => ({ ok: true, value: raw(2, ['a', 'b']) }) });
    attachCatalog(APP, f.bridge);
    f.emit('L1', 3, ['a', 'b', 'c']); // arrives before the snapshot: buffered
    f.emit('L1', 1, ['old'], 'app-other' as AppSessionId); // another session's: ignored
    await f.answer();
    expect(held()).toMatchObject({ launchId: 'L1', revision: 3 });
    expect(held()?.commands.map((c) => c.name)).toEqual(['a', 'b', 'c']);
    f.emit('L1', 1, ['stale']);
    expect(held()?.revision).toBe(3);
    f.emit('L2', 1, ['relaunched']);
    expect(held()).toMatchObject({ launchId: 'L2', revision: 1 });
    expect(held()?.commands.map((c) => c.name)).toEqual(['relaunched']);
  });

  it('holds the empty catalogue before any process, and fills at the first event', async () => {
    const refused = () => ({ ok: false, error: ipcError('internal', 'unknown session') });
    const f = fakeBridge({ status: refused, catalog: refused });
    attachCatalog(APP, f.bridge);
    await f.answer();
    expect(held()).toEqual(EMPTY_CATALOG);
    expect(held()).toMatchObject({ launchId: '', revision: 0, commands: [], agents: [], skills: [], terminalOnly: [] });
    f.emit('L1', 1, ['compact']);
    expect(held()).toMatchObject({ launchId: 'L1', revision: 1 });
  });

  it('subscribes once per session however many attach, and lets go with the last', async () => {
    const f = fakeBridge({ status: () => ({ ok: true, value: { launchId: 'L1' } }), catalog: () => ({ ok: true, value: raw(1, ['a']) }) });
    const off1 = attachCatalog(APP, f.bridge);
    const off2 = attachCatalog(APP, f.bridge);
    await f.answer();
    expect(f.listeners.size).toBe(1);
    off1();
    off1();
    expect(f.listeners.size).toBe(1);
    off2();
    expect(f.listeners.size).toBe(0);
  });
});
