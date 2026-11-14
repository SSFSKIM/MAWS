// The take-back through the composer itself (UX wave U4a, docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md,
// decision 13; Acceptance 6, (d) and (g); M3's review, finding 4): real mounts, unmounts and remounts of the composer, its
// editor's own restore, writer and submit, against the draft store itself (src/services/index/drafts.ts over its table
// in memory) behind the bridge, with the queue's answers and the record given by the test.
import { DatabaseSync } from 'node:sqlite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import { REGISTRY } from '@shared/ipc/registry';
import type { PreloadBridge } from '@shared/ipc/schema';
import { settles, type Draft } from '@shared/ipc/schema/session';
import { addressingOf, bareOf } from '@shared/machine/address';
import { Db } from '../../../../services/index/db';
import { DraftStore } from '../../../../services/index/drafts';
import { humanTurn, record, status } from '../../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../../test/support/fake-client';
import { at, TEST_MACHINE } from '../../../../../test/support/machine';
import { connectKeys } from '../../keymap/dispatcher';
import { resetCatalogStore } from '../../stores/catalog';
import { resetComposerStore } from '../../stores/composer';
import { useHosts } from '../../stores/hosts';
import { useNotices } from '../../stores/notices';
import { resetQueueStore } from '../../stores/queue';
import { useSessions } from '../../stores/sessions';
import { hostStatus } from '../../test-support/host-status';
import { preloadOf } from '../../test-support/preload-of';
import { resetShellStores } from '../../test-support/shell-stores';
import { Composer } from '../Composer';
import { resetDockedCards } from '../docked/registry';
import { resetEffectiveEfforts } from '../effective-effort';
import { DRAFT_DELAY_MS } from '../editor/drafts';
import { resetTakeBack, TAKE_BACK_WORDS } from './take-back';

const A_ID = 'app-a' as AppSessionId;
const A = at(A_ID);
const TEXT = 'make the header sticky';
const addressing = addressingOf(REGISTRY);
const pageRecord = (id: AppSessionId, over?: Partial<SessionRecord>) => addressing.output('session.get').lift(record(bareOf(id), over), TEST_MACHINE)!;
const pageStatus = (id: AppSessionId, compact?: Parameters<typeof status>[1]) => addressing.output('engine.sessions').lift([status(bareOf(id), compact)], TEST_MACHINE)[0]!;

let fake: FakeClient;
let disconnect: () => void;
let queryClient: QueryClient;
let store: DraftStore;
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};
let settleGate: { promise: Promise<void>; resolve: () => void } | null = null; // the next settling save waits here
let readGate: { promise: Promise<void>; resolve: () => void } | null = null; // the next read of what is kept waits here

// main's side: the session's commands answered by the test, its drafts by the store itself
function bridge() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE sessions (app_id TEXT PRIMARY KEY);
CREATE TABLE drafts (app_session_id TEXT PRIMARY KEY REFERENCES sessions(app_id) ON DELETE CASCADE, doc TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);`);
  sqlite.prepare('INSERT INTO sessions (app_id) VALUES (?)').run(A_ID);
  store = new DraftStore(new Db(sqlite, []));
  fake = fakeClient({
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.history.append': undefined,
    'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q-9' },
    'session.listModels': { models: [{ value: 'default', resolvedModel: 'claude-sonnet', displayName: 'Default (recommended)', description: '' }] },
    'session.listPermissionRules': { state: { rules: [], workspaceDirectories: [], originalCwd: '/work/app-a', managedOnly: false } },
    'engine.models': { models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet', displayName: 'Sonnet' }], source: 'cached', at: '2026-09-29T09:00:00.000Z' },
  });
  const answer = fake.client.invoke.bind(fake.client);
  (fake.client as { invoke: unknown }).invoke = async (name: string, input: Record<string, unknown>, opts?: unknown) => {
    if (name === 'session.drafts.get') {
      if (readGate !== null) {
        const gate = readGate;
        readGate = null;
        await gate.promise;
      }
      return { ok: true, value: store.get(input.appSessionId as AppSessionId) };
    }
    if (name === 'session.drafts.set') {
      const { draft, replaces } = input as { draft: Draft | null; replaces?: string | null };
      drafted.push({ draft, replaces: replaces ?? null });
      if (replaces?.startsWith(settles('')) && settleGate !== null) {
        const gate = settleGate;
        settleGate = null;
        await gate.promise;
      }
      try {
        store.set(input.appSessionId as AppSessionId, draft, 'owner', replaces ?? undefined);
        return { ok: true, value: undefined };
      } catch (error) {
        return { ok: false, error: { code: 'internal', message: (error as Error).message } };
      }
    }
    return (answer as (n: string, i: unknown, o?: unknown) => Promise<unknown>)(name, input, opts);
  };
}
let drafted: { draft: Draft | null; replaces: string | null }[] = [];

beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetEffectiveEfforts();
  resetQueueStore();
  resetCatalogStore();
  resetDockedCards();
  useNotices.setState({ notices: [] });
  useHosts.setState({ supervisor: hostStatus() });
  drafted = [];
  settleGate = null;
  readGate = null;
  bridge();
  window.maws = preloadOf(fake);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  resetTakeBack();
  delete (window as { maws?: PreloadBridge }).maws;
  vi.useRealTimers();
});

function busy() {
  const s = useSessions.getState();
  useSessions.setState({
    records: new Map(s.records).set(A, pageRecord(A)),
    engine: new Map(s.engine).set(A, { ...pageStatus(A, { engineState: 'running', turn: humanTurn }) } as EngineSessionStatus),
    recordsVersion: s.recordsVersion + 1,
  });
}
const mountComposer = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <section aria-label="pane 0">
        <Composer appSessionId={A} paneIndex={0} />
      </section>
    </QueryClientProvider>,
  );
type TiptapElement = HTMLElement & { editor: { commands: { insertContent(text: string): boolean }; getText(): string } };
const editorOf = () => within(screen.getByRole('region', { name: 'pane 0' })).getByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement;
const key = (target: HTMLElement, init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
const listed = (entries: QueueEntry[]) => act(() => fake.event('session.queue', { appSessionId: A_ID, entries, paused: false, pauseReason: null }));
const entry = (queueId: string, content: QueueEntry['content']): QueueEntry => ({ queueId, appSessionId: A_ID, content, createdAt: '2026-09-29T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false });
const removed = (queueId: string) => ({ id: 'ev-remove', sessionId: '44444444-4444-4444-8444-444444444444', at: '2026-09-29T10:00:01.000Z', seq: 1, agentId: null, parentToolUseId: null, kind: 'queue.transition', action: 'remove', queueId, messageUuid: null, reason: null });
const textOfKept = () => JSON.stringify(store.get(A_ID)?.doc ?? null).match(/"text":"([^"]*)"/)?.[1] ?? null;
const stageKept = () => JSON.stringify(store.get(A_ID)?.doc ?? null).includes('"takeBack"');

describe('(g) a message with an attachment past the draft’s budget', () => {
  const MiB = 1024 * 1024;
  const pdf = Buffer.alloc(6 * MiB, 7).toString('base64');
  const content = [{ type: 'text', text: TEXT }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }] as unknown as QueueEntry['content'];

  it('unmounted between the withdrawal and the load, the next mount shows it whole; an edit keeps the text and not the attachment, which its tile said', async () => {
    busy();
    const first = mountComposer();
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
    listed([entry('q-1', content)]);
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'ArrowUp' });
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1)); // staged under the claim, then withdrawn
    expect(stageKept()).toBe(true);
    first.unmount(); // the composer goes before the withdrawal's answer
    await act(() => fake.reply('session.queue.remove', undefined));
    expect(stageKept()).toBe(true); // nowhere to load: the stage stays stored
    listed([]);

    // the next mount restores the stage and carries it forward: the record says it was removed
    const second = mountComposer();
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1));
    await act(() => fake.fail('session.queue.remove', 'no queued entry q-1', 'invalid_input'));
    await waitFor(() => expect(fake.pending('session.promptHistory')).toBe(1));
    await act(() => fake.reply('session.promptHistory', { events: [removed('q-1')], complete: true }));
    await waitFor(() => expect(editorOf().editor.getText()).toContain(TEXT));
    await waitFor(() => expect(stageKept()).toBe(false)); // settled
    const pane = screen.getByRole('region', { name: 'pane 0' });
    expect(within(pane).getByText('not kept in draft')).toBeTruthy();
    expect(screen.queryByText(TAKE_BACK_WORDS.taking)).toBeNull();

    // a word edited: the writer saves the text and leaves the attachment out
    act(() => editorOf().focus());
    act(() => void editorOf().editor.commands.insertContent(' now'));
    await waitFor(() => expect(textOfKept()).toBe(`${TEXT} now`), { timeout: DRAFT_DELAY_MS * 4 });
    second.unmount();

    // reopened: the editor's own restore
    mountComposer();
    await waitFor(() => expect(editorOf().editor.getText()).toContain(`${TEXT} now`));
    expect(screen.queryByText('not kept in draft')).toBeNull();
    expect(screen.queryByText(/PDF #1/)).toBeNull();
  });
});

describe('(d) a second window settles and sends while this one’s settle is held', () => {
  it('this window, answered stale, ends with an empty box, and the message was sent once', async () => {
    busy();
    mountComposer();
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
    listed([entry('q-1', TEXT)]);
    act(() => editorOf().focus());
    settleGate = deferred();
    const heldSettle = settleGate;
    await key(editorOf(), { key: 'ArrowUp' });
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1));
    await act(() => fake.reply('session.queue.remove', undefined));
    await waitFor(() => expect(editorOf().editor.getText()).toContain(TEXT)); // loaded; its settling save is held
    await waitFor(() => expect(drafted.some((d) => d.replaces?.startsWith(settles('')))).toBe(true));
    expect(stageKept()).toBe(true);

    // window B: its own module graph (its own take-back, stores and editor) over the same main and store
    vi.resetModules();
    const { Editor } = await import('../editor/Editor');
    const takeBackB = await import('./take-back');
    const { ipc: ipcB } = await import('../../ipc/client');
    const handleB = { current: null as import('../editor/Editor').EditorHandle | null };
    const queueB = {
      remove: (args: { queueId: string }) => ipcB.invoke('session.queue.remove', { appSessionId: A, ...args }),
      cancelSteer: (args: { messageUuid: string }) => ipcB.invoke('session.steer.cancel', { appSessionId: A, ...args } as never),
    } as unknown as import('../../session/controls/types').QueueControls;
    const depsB = { client: ipcB, controls: () => queueB };
    const holder = document.createElement('div');
    document.body.append(holder);
    render(
      <section aria-label="window B">
        <Editor appSessionId={A} cwd="/work/app-a" sessionId="s" client={ipcB} handle={handleB} onStage={(stage) => void takeBackB.carryForward(A, stage, depsB)} />
      </section>,
      { container: holder },
    );
    await waitFor(() => expect(handleB.current).not.toBeNull());
    takeBackB.attachTakeBackBox(A, {
      load: (doc) => handleB.current!.load(doc),
      replace: (doc) => handleB.current!.replaceDoc(doc),
      hold: () => {},
      settleLater: (replaces, taken) => handleB.current!.settleWith(replaces, taken),
      settled: () => handleB.current!.clearSettle(),
    });
    // B's restore met the stage and withdraws it: the queue no longer lists it, and the record says it was removed
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1));
    await act(() => fake.fail('session.queue.remove', 'no queued entry q-1', 'invalid_input'));
    await waitFor(() => expect(fake.pending('session.promptHistory')).toBe(1));
    await act(() => fake.reply('session.promptHistory', { events: [removed('q-1')], complete: true }));
    const editorB = within(screen.getByRole('region', { name: 'window B' })).getByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement;
    await waitFor(() => expect(editorB.editor.getText()).toContain(TEXT));
    await waitFor(() => expect(stageKept()).toBe(false)); // B settled first
    takeBackB.resetTakeBack();

    // B sends: its submit is accepted and its accepted send clears the draft
    act(() => editorB.focus());
    await key(editorB, { key: 'Enter' });
    await waitFor(() => expect(fake.invoked('session.send')).toHaveLength(1));
    await waitFor(() => expect(store.get(A_ID)).toBeNull());

    // this window's settle lands: stale; it reads what is kept, and its box takes it: empty
    await act(async () => heldSettle.resolve());
    await waitFor(() => expect(editorOf().editor.getText()).toBe(''));
    await waitFor(() => expect(screen.queryByText(TAKE_BACK_WORDS.taking)).toBeNull());
    expect(fake.invoked('session.send')).toHaveLength(1);
    expect((fake.invoked('session.send')[0] as { content: unknown }).content).toBe(TEXT);
    holder.remove();
  });
});

// M3's re-review, finding 2: a box answered stale while another window has staged a newer message holds a copy the other
// window already sent; it is put away before the newer stage is carried forward, so it never becomes editable
describe('a held settle that meets another window’s newer stage', () => {
  async function windowB() {
    vi.resetModules();
    const { Editor } = await import('../editor/Editor');
    const takeBackB = await import('./take-back');
    const { ipc: ipcB } = await import('../../ipc/client');
    const handleB = { current: null as import('../editor/Editor').EditorHandle | null };
    const queueB = { remove: (args: { queueId: string }) => ipcB.invoke('session.queue.remove', { appSessionId: A, ...args }) } as unknown as import('../../session/controls/types').QueueControls;
    const depsB = { client: ipcB, controls: () => queueB };
    const holder = document.createElement('div');
    document.body.append(holder);
    render(
      <section aria-label="window B">
        <Editor appSessionId={A} cwd="/work/app-a" sessionId="s" client={ipcB} handle={handleB} onStage={(stage) => void takeBackB.carryForward(A, stage, depsB)} />
      </section>,
      { container: holder },
    );
    await waitFor(() => expect(handleB.current).not.toBeNull());
    takeBackB.attachTakeBackBox(A, {
      load: (doc) => handleB.current!.load(doc),
      replace: (doc) => handleB.current!.replaceDoc(doc),
      hold: () => {},
      settleLater: (replaces, taken) => handleB.current!.settleWith(replaces, taken),
      settled: () => handleB.current!.clearSettle(),
    });
    const editor = () => within(screen.getByRole('region', { name: 'window B' })).getByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement;
    return { takeBackB, depsB, editor, holder };
  }

  // A takes message 1 back and its settle is held; B carries it forward, settles, sends it, and stages message 2
  async function sentByBThenStaged() {
    busy();
    mountComposer();
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
    listed([entry('q-1', TEXT), entry('q-2', 'the second message')]);
    act(() => editorOf().focus());
    settleGate = deferred();
    const heldSettle = settleGate;
    // ↑ takes the newest: make message 1 the only one waiting until A has it
    listed([entry('q-1', TEXT)]);
    await key(editorOf(), { key: 'ArrowUp' });
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1));
    await act(() => fake.reply('session.queue.remove', undefined));
    await waitFor(() => expect(editorOf().editor.getText()).toContain(TEXT));
    await waitFor(() => expect(drafted.some((d) => d.replaces?.startsWith(settles('')))).toBe(true));
    const B = await windowB();
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1));
    await act(() => fake.fail('session.queue.remove', 'no queued entry q-1', 'invalid_input'));
    await waitFor(() => expect(fake.pending('session.promptHistory')).toBe(1));
    await act(() => fake.reply('session.promptHistory', { events: [removed('q-1')], complete: true }));
    await waitFor(() => expect(B.editor().editor.getText()).toContain(TEXT));
    await waitFor(() => expect(stageKept()).toBe(false));
    act(() => B.editor().focus());
    await key(B.editor(), { key: 'Enter' });
    await waitFor(() => expect(store.get(A_ID)).toBeNull()); // B sent message 1
    return { B, heldSettle };
  }
  const stageTwo = (B: Awaited<ReturnType<typeof windowB>>) =>
    void B.takeBackB.takeBack(A, { kind: 'after', key: 'q-2', queueId: 'q-2', content: 'the second message', createdAt: '2026-09-29T10:00:02.000Z' }, B.depsB);

  it('(a) stage 2 written between A’s stale answer and its read: A’s copy of message 1 is put away and message 2 comes in its place', async () => {
    const { B, heldSettle } = await sentByBThenStaged();
    readGate = deferred();
    const heldRead = readGate;
    await act(async () => heldSettle.resolve()); // A's settle lands: stale; its read waits
    await waitFor(() => expect(readGate).toBeNull());
    stageTwo(B); // B stages message 2; its withdrawal waits
    await waitFor(() => expect(stageKept()).toBe(true));
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1));
    expect(editorOf().editor.getText()).toContain(TEXT); // still message 1, held
    await act(async () => heldRead.resolve()); // A reads stage 2 and carries it forward
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(2));
    await act(() => fake.reply('session.queue.remove', undefined, 1)); // A's own withdrawal of message 2
    await waitFor(() => expect(editorOf().editor.getText()).toContain('the second message'));
    expect(editorOf().editor.getText()).not.toContain(TEXT);
    await waitFor(() => expect(stageKept()).toBe(false));
    await waitFor(() => expect(screen.queryByText(TAKE_BACK_WORDS.taking)).toBeNull());
    expect(fake.invoked('session.send')).toHaveLength(1);
    B.takeBackB.resetTakeBack();
    B.holder.remove();
  });

  it('(b) stage 2 already kept when A’s settle lands: refused as staged, A reads it, puts message 1 away and carries message 2 forward', async () => {
    const { B, heldSettle } = await sentByBThenStaged();
    stageTwo(B);
    await waitFor(() => expect(stageKept()).toBe(true));
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(1));
    await act(async () => heldSettle.resolve()); // refused: a stage is kept
    await waitFor(() => expect(fake.pending('session.queue.remove')).toBe(2));
    await act(() => fake.reply('session.queue.remove', undefined, 1));
    await waitFor(() => expect(editorOf().editor.getText()).toContain('the second message'));
    expect(editorOf().editor.getText()).not.toContain(TEXT);
    await waitFor(() => expect(stageKept()).toBe(false));
    await waitFor(() => expect(screen.queryByText(TAKE_BACK_WORDS.taking)).toBeNull());
    expect(fake.invoked('session.send')).toHaveLength(1);
    B.takeBackB.resetTakeBack();
    B.holder.remove();
  });
});
