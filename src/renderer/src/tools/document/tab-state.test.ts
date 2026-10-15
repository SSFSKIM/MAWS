// The state a document tab owns (M8 of docs/doperpowers/plans/2026-10-12-p3-b-documents.md, D13; L's `createState` and
// `dispose`; X32's lifetime rule): the replica it opens and keeps, its saved state and open threads, the artifact's row
// (title, the last view read before this showing, the suggestions setting), the rail the header toggles, an export's
// progress, the close guard reading all of it, and the handle kept alive until a comment's sends settle.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryDocumentHost, openMemoryHandle, whenSynced } from '@artifacts/document/editor/memory-host';
import { addThread, getThread, reply } from '@artifacts/document/threads';
import type { PortProvider } from '@artifacts/provider/port';
import { createDocument, listTabs, tabBody } from '@artifacts/document/tabs';
import { schemaFor } from '@artifacts/document/schema';
import { ynodeToPmnode } from '@artifacts/yjs/prosemirror';
import type { ArtifactHost, DocumentHandle, DocumentState } from '@artifacts/host';
import { newDoc } from '@artifacts/yjs';
import type { CommandName, EventName, MawsBridge } from '@shared/ipc/schema';
import { DocumentTabState, type DocumentTabDeps } from './tab-state';

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

function world(answers: Partial<Record<CommandName, unknown>> = {}, memory = new MemoryDocumentHost(), extra: Partial<DocumentTabDeps> = {}) {
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
    acceptSuggestion: async () => ({ revision: 1 }),
    rejectSuggestion: async () => ({ revision: 1 }),
  } as unknown as ArtifactHost;
  const confirm = vi.fn(() => false);
  const deps: DocumentTabDeps = { host, ipc, log: () => {}, confirm, sessionTitle: () => undefined, sessions: () => [], ...extra };
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
    expect(snapshot.document).toMatchObject({ phase: 'live', unsaved: 0, readOnly: false });
    expect(snapshot.suggestions).toBe(false);
    expect(await state.history.lastViewedAt()).toBe(1_000);
  });

  // M8 fix wave 1 (the review's reproduction: two replicas each initialising the empty document kept one body, and one
  // editor stayed bound to the losing one): the host writes a document's first tab (kinds/document.ts); a replica
  // writes none, waits for it, and every replica's typing lands in the one live body.
  it('writes nothing into an empty document: every replica binds the first tab the host writes', async () => {
    const w = world();
    const [one, two] = [w.open(), w.open()];
    await Promise.all([ready(one), ready(two)]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listTabs(w.memory.doc)).toEqual([]);
    expect(w.handles.map((h) => h.state().unsaved)).toEqual([0, 0]);
    w.memory.write((doc) => createDocument(doc, { title: 'Launch plan', id: 'tab00001' }));
    await until(() => w.handles.every((h) => tabBody(h.doc, 'tab00001') !== undefined), 'the host’s tab at both replicas');
    const bound = w.handles.map((h) => tabBody(h.doc, 'tab00001')!);
    w.handles.forEach((h, i) => (tabBody(h.doc, 'tab00001')!.get(0) as unknown as { insert(at: number, text: string): void }).insert(0, i === 0 ? 'Alpha' : 'Beta'));
    const text = (doc: Parameters<typeof tabBody>[0]) => ynodeToPmnode(tabBody(doc, 'tab00001')!, schemaFor()).textContent;
    await until(() => [w.memory.doc, ...w.handles.map((h) => h.doc)].every((doc) => text(doc).includes('Alpha') && text(doc).includes('Beta')), 'both replicas’ typing everywhere');
    expect(w.handles.map((h, i) => tabBody(h.doc, 'tab00001') === bound[i])).toEqual([true, true]);
    expect(listTabs(w.memory.doc)).toHaveLength(1);
  });

  // M8 fix wave 2: a document the host has not given its first tab (until A's `initial` hook, a host stopped between
  // the creation and that write) is said so after a bound, not shown loading forever; the tab arriving clears it.
  it('says the document has no content yet when its first tab has not come within the bound, and clears it when it does', async () => {
    const w = world({}, new MemoryDocumentHost(), { noContentMs: 40 });
    const state = w.open();
    await ready(state);
    expect(state.snapshot().noContent).toBe(false);
    await until(() => state.snapshot().noContent, 'the bound');
    w.memory.write((doc) => createDocument(doc, { title: 'Late', id: 'tab00001' }));
    await until(() => !state.snapshot().noContent, 'the tab to clear it');
  });

  it('counts the open threads and follows the replica’s saved state', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    const handle = w.handles[0];
    addThread(handle.doc, { threadId: 'th1', tabId: 'tab00001', blockId: null, quote: 'q', anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
    expect(state.snapshot().unresolved).toBe(1);
    w.memory.dropConnections();
    await until(() => state.snapshot().document?.phase !== 'live', 'the replica to see its port go');
  });

  // M9 (the scale gate): every React commit while the editor has the focus walks the editor's whole DOM (React saves the
  // selection), so the tab must not re-render twice a keystroke for a "Saving…" that lasts the ack's few milliseconds
  // (S7b's bound 3: the saved state must not flicker). Only edits left unacknowledged past the delay say saving.
  it('changes nothing the header reads for an edit acknowledged within the delay, and says saving once edits wait past it', async () => {
    const pushed = new Set<(state: DocumentState) => void>();
    let current: DocumentState = { phase: 'live', synced: true, unsaved: 0, revision: 1, readOnly: false };
    const push = (patch: Partial<DocumentState>) => {
      current = { ...current, ...patch };
      for (const listener of pushed) listener(current);
    };
    const handle = { doc: newDoc(), state: () => current, subscribe: (listener: (state: DocumentState) => void) => (pushed.add(listener), () => pushed.delete(listener)), close: () => {}, onRestored: () => () => {}, holdRemote: () => {} } as unknown as DocumentHandle;
    const w = world({}, new MemoryDocumentHost(), { savingShownMs: 40, host: { open: async () => handle } as unknown as ArtifactHost });
    const state = w.open();
    await ready(state);
    let published = 0;
    state.subscribe(() => (published += 1));

    push({ unsaved: 1 });
    push({ unsaved: 0, revision: 2 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(published).toBe(0);
    expect(state.snapshot().saving).toBe(false);

    push({ unsaved: 1 });
    await until(() => state.snapshot().saving, 'saving after the delay');
    push({ unsaved: 0, revision: 3 });
    expect(state.snapshot().saving).toBe(false);

    push({ phase: 'off', synced: false });
    expect(state.snapshot().document?.phase).toBe('off'); // a dropped port is said at once
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

  it('closes the replica when disposed, after a comment’s sends in flight have settled and nothing is unsaved', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    const release = state.hold();
    state.dispose();
    expect(w.handles[0].closed).toBeUndefined();
    release();
    release(); // twice is once
    expect(w.handles[0].state().unsaved).toBe(0);
    expect(w.handles[0].closed).toBe(true); // nothing to save: at once
  });

  // M8 fix wave 1 (the review's reproduction, with the real provider): a send that lands after the tab went records its
  // message in the document; the replica stays open, reconnecting, until the host has acknowledged that message.
  it('keeps a disposed tab’s replica until the message a late send recorded is acknowledged, across a reconnect', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    const handle = w.handles[0] as DocumentHandle & { provider: PortProvider; closed?: boolean };
    addThread(handle.doc, { threadId: 'th1', tabId: 'tab00001', blockId: null, quote: 'q', anchor: { start: null, end: null, block: null }, by: { kind: 'human' }, at: 1 });
    await until(() => handle.state().unsaved === 0, 'the thread acknowledged');
    const release = state.hold();
    state.dispose();
    w.memory.dropConnections();
    await until(() => handle.state().phase === 'off', 'the port to go');
    reply(handle.doc, 'th1', { id: 'th1:m1', body: 'Delivered comment', by: { kind: 'human' }, at: 2 });
    release();
    expect(handle.closed).toBeUndefined();
    expect(handle.state().unsaved).toBe(1);
    handle.provider.connect(w.memory.connect()); // the host is back (the renderer's replica re-opens by itself)
    await until(() => handle.closed === true, 'the replica closed once acknowledged');
    expect(getThread(w.memory.doc, 'th1')?.messages.map((m) => m.body)).toEqual(['Delivered comment']);
  });

  it('keeps a disposed tab’s replica until its own unsaved edit is acknowledged', async () => {
    const w = world();
    const state = w.open();
    await ready(state);
    const handle = w.handles[0] as DocumentHandle & { provider: PortProvider; closed?: boolean };
    w.memory.dropConnections();
    await until(() => handle.state().phase === 'off', 'the port to go');
    handle.doc.get('scratch').setAttr('x', 1);
    state.dispose();
    expect(handle.closed).toBeUndefined();
    handle.provider.connect(w.memory.connect());
    await until(() => handle.closed === true, 'the replica closed once acknowledged');
    expect(w.memory.doc.get('scratch').getAttr('x')).toBe(1);
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
