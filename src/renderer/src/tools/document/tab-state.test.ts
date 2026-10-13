// The state a document tab owns (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13; L's `createState` and
// `dispose`; X32's lifetime rule): the replica it opens and keeps, its saved state and open threads, the artifact's row
// (title, the last view read before this showing, the suggestions setting), the rail the header toggles, an export's
// progress, the close guard reading all of it, and the handle kept alive until a comment's sends settle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocumentHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { addThread } from '@artifacts/document/threads';
import { listTabs } from '@artifacts/document/tabs';
import type { ArtifactHost, DocumentHandle } from '@artifacts/host';
import type { CommandName, EventName, MawsBridge } from '@shared/ipc/schema';
import { DocumentTabState, firstTabId, type DocumentTabDeps } from './tab-state';

const A = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const row = (fields: Record<string, unknown> = {}) => ({ id: A, kind: 'document', title: 'Launch plan', lastViewedAt: 1_000, agentEditsAsSuggestions: false, revision: 3, ...fields });

let hosts: MemoryDocumentHost[] = [];
let states: DocumentTabState[] = [];
afterEach(() => {
  for (const state of states) state.dispose();
  states = [];
  for (const host of hosts) host.destroy();
  hosts = [];
  vi.useRealTimers();
});

const until = async (check: () => boolean, what: string) => {
  const give = Date.now() + 2_000;
  while (!check()) {
    if (Date.now() > give) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
};

function world(answers: Partial<Record<CommandName, unknown>> = {}, memory = new MemoryDocumentHost()) {
  hosts.push(memory);
  const handles: Array<DocumentHandle & { closed?: boolean }> = [];
  const calls: Array<[string, unknown]> = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const ipc: Pick<MawsBridge, 'invoke' | 'on'> = {
    invoke: (async (name: CommandName, input: unknown) => {
      calls.push([name, input]);
      const value = name in answers ? answers[name] : name === 'artifacts.get' ? { artifact: row() } : undefined;
      if (value instanceof Error) return { ok: false, error: { code: 'internal', message: value.message } };
      return { ok: true, value };
    }) as MawsBridge['invoke'],
    on: ((name: EventName, listener: (payload: unknown) => void) => {
      const set = listeners.get(name) ?? new Set();
      listeners.set(name, set);
      set.add(listener);
      return () => set.delete(listener);
    }) as MawsBridge['on'],
  };
  const exported: unknown[][] = [];
  let exportAnswer: () => Promise<{ path: string }> = async () => Promise.reject(new Error('exporting an artifact is not available yet'));
  const host = {
    open: async () => {
      const handle = openMemoryHandle(memory, { log: () => {} });
      const close = handle.close.bind(handle);
      handle.close = () => {
        (handle as { closed?: boolean }).closed = true;
        close();
      };
      handles.push(handle);
      await whenSynced(handle);
      return handle;
    },
    export: async (...args: unknown[]) => {
      exported.push(args);
      return exportAnswer();
    },
    versionState: async () => new Uint8Array(),
    attributions: async () => new Uint8Array(),
  } as unknown as ArtifactHost;
  const confirm = vi.fn(() => false);
  const deps: DocumentTabDeps = { host, ipc, log: () => {}, confirm, sessionTitle: () => undefined };
  const emit = (name: string, payload: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  const open = () => {
    const state = new DocumentTabState({ artifactId: A, kind: 'document', surface: 'panel' }, deps);
    states.push(state);
    return state;
  };
  return { memory, handles, calls, exported, setExport: (answer: typeof exportAnswer) => (exportAnswer = answer), confirm, emit, open };
}

const ready = (state: DocumentTabState) => until(() => state.snapshot().ready, 'the tab to open');

describe('a document tab’s state', () => {
  it('opens the replica and reads the row, the last view captured before the surface records this one', async () => {
    const w = world();
    const state = w.open();
    expect(state.snapshot().ready).toBe(false);
    await ready(state);
    const snapshot = state.snapshot();
    expect(snapshot.title).toBe('Launch plan');
    expect(snapshot.document).toMatchObject({ phase: 'live', readOnly: false });
    await until(() => state.snapshot().document?.unsaved === 0, 'the first tab acknowledged');
    expect(snapshot.suggestions).toBe(false);
    expect(await state.history.lastViewedAt()).toBe(1_000);
  });

  it('gives an empty document its first tab, titled as the artifact, under one id every replica uses', async () => {
    const w = world();
    const [one, two] = [w.open(), w.open()];
    await Promise.all([ready(one), ready(two)]);
    await until(() => listTabs(w.memory.doc).length > 0, 'the first tab at the host');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listTabs(w.memory.doc)).toEqual([{ id: firstTabId(A), title: 'Launch plan', order: expect.any(String) }]);
    expect(firstTabId(A)).toMatch(/^[0-9a-z]{8}$/);
  });

  it('counts the open threads and follows the replica’s saved state', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    const handle = w.handles[0];
    addThread(handle.doc, { threadId: 'th1', tabId: firstTabId(A), blockId: null, quote: 'q', anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
    expect(state.snapshot().unresolved).toBe(1);
    w.memory.dropConnections();
    await until(() => state.snapshot().document?.phase !== 'live', 'the replica to see its port go');
  });

  it('toggles the rail the header asks for and counts Save version requests', async () => {
    const state = world().open();
    state.toggleRail('history');
    expect(state.snapshot().rail).toBe('history');
    state.toggleRail('comments');
    expect(state.snapshot().rail).toBe('comments');
    state.toggleRail('comments');
    expect(state.snapshot().rail).toBeNull();
    state.setRail('history');
    expect(state.snapshot().rail).toBe('history');
    const before = state.snapshot().saveVersionRequest;
    state.requestSaveVersion();
    expect(state.snapshot().saveVersionRequest).toBe(before + 1);
  });

  it('sets Agent edits as suggestions on the artifact and reads the row again after its changes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const w = world({ 'artifacts.update': { artifact: row({ agentEditsAsSuggestions: true }) } });
    const state = w.open();
    await ready(state);
    await state.setSuggestions(true);
    expect(w.calls).toContainEqual(['artifacts.update', { artifactId: A, agentEditsAsSuggestions: true }]);
    expect(state.snapshot().suggestions).toBe(true);
    const gets = () => w.calls.filter(([name]) => name === 'artifacts.get').length;
    const before = gets();
    w.emit('artifacts.changed', { artifactId: A, kind: 'document', revision: 9, change: 'updated' });
    w.emit('artifacts.changed', { artifactId: A, kind: 'document', revision: 10, change: 'updated' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(gets()).toBe(before + 1);
  });

  it('exports through the host with the page size chosen, its failure and its file said in the state', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    await state.export('pdf', 'a4');
    expect(w.exported).toEqual([[A, 'pdf', undefined, { pageSize: 'a4' }]]);
    expect(state.snapshot().exporting).toEqual({ phase: 'failed', format: 'pdf', message: 'exporting an artifact is not available yet' });
    let finish!: (answer: { path: string }) => void;
    w.setExport(() => new Promise((resolve) => (finish = resolve)));
    const running = state.export('docx', 'letter');
    expect(state.snapshot().exporting).toEqual({ phase: 'running', format: 'docx' });
    finish({ path: '/u/artifacts/a/exports/7-docx.docx' });
    await running;
    expect(state.snapshot().exporting).toEqual({ phase: 'done', format: 'docx', path: '/u/artifacts/a/exports/7-docx.docx' });
    state.dismissExport();
    expect(state.snapshot().exporting).toBeNull();
  });

  it('lets the tab close when everything is saved, waits for a save in flight, and asks when it does not land', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    expect(await state.closeGuard()).toBe(true);
    const handle = w.handles[0];
    // an edit acknowledged in a moment: the guard waits for it
    handle.doc.get('scratch').setAttr('x', 1);
    expect(handle.state().unsaved).toBeGreaterThan(0);
    expect(await state.closeGuard()).toBe(true);
    expect(w.confirm).not.toHaveBeenCalled();
    // an edit the host never acknowledges: the owner is asked, and their answer stands
    w.memory.dropConnections();
    await until(() => handle.state().phase === 'off', 'the port to go');
    handle.doc.get('scratch').setAttr('x', 2);
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 50 });
    expect(await state.closeGuard()).toBe(false);
    expect(w.confirm).toHaveBeenCalledWith(expect.stringContaining('Launch plan'));
  });

  it('closes the replica when disposed, after a comment’s sends in flight have settled', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    const release = state.holdForSend();
    state.dispose();
    expect(w.handles[0].closed).toBeUndefined();
    release();
    release(); // twice is once
    expect(w.handles[0].closed).toBe(true);
  });

  it('closes a replica that opens after the tab went', async () => {
    const w = world();
    const state = w.open();
    state.dispose();
    await until(() => w.handles.length === 1, 'the open to finish');
    await until(() => w.handles[0].closed === true, 'the late replica to close');
    expect(state.snapshot().ready).toBe(false);
  });
});
