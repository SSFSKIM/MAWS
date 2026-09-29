import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { humanTurn, record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { connectKeys } from '../keymap/dispatcher';
import { bindingsOf, useKeyChord } from '../keymap/useKeyChord';
import { itemFor, permission } from '../request-card/test-requests';
import { useAttention } from '../stores/attention';
import { insertComposerText, isStarting, prefillComposer, resetComposerStore, useComposerStore } from '../stores/composer';
import { useLayout } from '../stores/layout';
import { useNotices } from '../stores/notices';
import { resetQueueStore } from '../stores/queue';
import { useSessions } from '../stores/sessions';
import { resetShellStores } from '../test-support/shell-stores';
import { resetCatalogStore } from '../stores/catalog';
import { Composer } from './Composer';
import { ComposerAppKeys } from './ComposerAppKeys';
import { DockedCardFrame } from './docked/DockedCardFrame';
import { dockCard, resetDockedCards } from './docked/registry';
import { docOf, paragraph, textNode } from './editor/doc';
import { registerSetupIntentHook, type HookResult, type SetupIntentHook, type SetupIntentPatch } from './setup-intent';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
let fake: FakeClient;
let disconnect: () => void;
let queryClient: QueryClient;

const rules = { state: { rules: [], workspaceDirectories: ['/work/app-a/extra'], originalCwd: '/work/app-a', managedOnly: false } };
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetQueueStore();
  resetCatalogStore();
  resetDockedCards();
  useNotices.setState({ notices: [] });
  fake = fakeClient({
    'session.queue.list': { entries: [], paused: false, pauseReason: null },
    'session.history.list': { entries: [] },
    'session.drafts.get': null,
    'session.drafts.set': undefined,
    'session.history.append': undefined,
    'session.send': { messageUuid: null, disposition: 'sent', queueId: 'q-1' },
    'session.steer': { messageUuid: '11111111-1111-4111-8111-111111111111' },
    'session.interrupt': { stillQueued: [], cancelled: [] },
    'session.listModels': { models: [{ value: 'sonnet', resolvedModel: 'claude-sonnet', displayName: 'Sonnet', description: 'fast' }] },
    'session.listPermissionRules': rules,
    'session.applyFlagSettings': undefined,
    'session.answer': { outcome: 'delivered' },
    'layout.pickFiles': { files: [{ path: '/work/picked', name: 'picked', bytes: 0, mediaType: 'inode/directory', data: null }] },
    'session.setPermissionMode': { effective: 'default', refusal: 'auto_mode_model', error: 'model does not support auto' },
  });
  window.maws = fake.client;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  disconnect = connectKeys();
});
afterEach(() => {
  disconnect();
  cleanup();
  registerSetupIntentHook(() => null);
  delete (window as { maws?: MawsBridge }).maws;
  vi.useRealTimers();
});

function live(appSessionId: AppSessionId, over: { status?: Partial<EngineSessionStatus>; record?: Partial<SessionRecord> } = {}) {
  const s = useSessions.getState();
  useSessions.setState({
    records: new Map(s.records).set(appSessionId, record(appSessionId, over.record)),
    engine: new Map(s.engine).set(appSessionId, { ...status(appSessionId), ...over.status }),
    recordsVersion: s.recordsVersion + 1,
  });
}
const busy = (appSessionId: AppSessionId) => live(appSessionId, { status: status(appSessionId, { engineState: 'running', turn: humanTurn }) });

function Pane({ index, children }: { index: 0 | 1; children: ReactNode }) {
  return (
    <section data-pane={index} aria-label={`pane ${index}`} onFocusCapture={() => useLayout.getState().focusPane(index)}>
      {children}
    </section>
  );
}

function mount(panes: { index: 0 | 1; id: AppSessionId }[], extra: ReactNode = null) {
  return render(
    <QueryClientProvider client={queryClient}>
      {panes.map(({ index, id }) => (
        <Pane key={index} index={index}>
          <Composer appSessionId={id} paneIndex={index} />
        </Pane>
      ))}
      {extra}
    </QueryClientProvider>,
  );
}

type TiptapElement = HTMLElement & { editor: { commands: { insertContent(text: string): boolean; setTextSelection(at: number): boolean; blur(): boolean }; getText(): string; isFocused: boolean } };
const composerOf = (index: 0 | 1) => screen.getByRole('region', { name: `pane ${index}` });
const editorOf = (index: 0 | 1 = 0) => within(composerOf(index)).getByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement;
const type = (text: string, index: 0 | 1 = 0) => act(() => void editorOf(index).editor.commands.insertContent(text));
const key = (target: HTMLElement, init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
const primary = (index: 0 | 1 = 0) => composerOf(index).querySelector<HTMLButtonElement>('[data-submit-state]')!;
const invoked = (name: Parameters<FakeClient['invoked']>[0]) => fake.invoked(name);

describe("composer DOM under C5's dispatcher", () => {
  it('marks only the editor root as the key sink; the control, the chips, the toolbar and the queue are pane content', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(editorOf()).toBeTruthy());
    const sinks = composerOf(0).querySelectorAll('[data-key-sink]');
    expect(sinks).toHaveLength(1);
    expect(sinks[0].contains(editorOf())).toBe(true);
    for (const outside of [primary(), within(composerOf(0)).getByRole('toolbar', { name: 'Composer tools' }), within(composerOf(0)).getByRole('button', { name: 'Add a directory' })]) expect(sinks[0].contains(outside)).toBe(false);
  });

  it('sends on Enter, steers with priority next on ⌥Enter during a turn, and interrupts and sends with now from the caret menu', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await type('hello');
    await key(editorOf(), { key: 'Enter' });
    await waitFor(() => expect(invoked('session.send')).toEqual([{ appSessionId: A, content: 'hello' }]));
    await waitFor(() => expect(editorOf().editor.getText()).toBe(''));

    // ⌥Enter with no turn open and nothing in flight is a Send (the table's later rows); C5's dispatcher delivers it
    // only with focus in the editor
    await type('idle steer');
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Enter', altKey: true });
    await waitFor(() => expect(invoked('session.send')).toHaveLength(2));
    expect(invoked('session.steer')).toEqual([]);

    busy(A);
    await act(async () => void editorOf().dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false, bubbles: true }))); // the ⌥ of that ⌥Enter is let go
    await type('fold this in');
    act(() => editorOf().focus());
    await waitFor(() => expect(primary().textContent).toBe('Queue'));
    await act(async () => void editorOf().dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true })));
    await waitFor(() => expect(primary().textContent).toBe('Steer')); // live while ⌥ is down with focus in the box
    await act(async () => void editorOf().dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false, bubbles: true })));
    await waitFor(() => expect(primary().textContent).toBe('Queue'));
    await key(editorOf(), { key: 'Enter', altKey: true });
    await waitFor(() => expect(invoked('session.steer')).toEqual([{ appSessionId: A, content: 'fold this in', priority: 'next' }]));

    await type('stop and do this');
    const user = userEvent.setup();
    await user.click(within(composerOf(0)).getByRole('button', { name: 'More ways to send' }));
    await user.click(await screen.findByRole('menuitem', { name: /Interrupt and send/ }));
    await waitFor(() => expect(invoked('session.steer')).toHaveLength(2));
    expect(invoked('session.steer')[1]).toEqual({ appSessionId: A, content: 'stop and do this', priority: 'now' });
    expect(invoked('session.history.append').map((i) => (i as { display: string }).display)).toEqual(['hello', 'idle steer', 'fold this in', 'stop and do this']);
  });

  it('reads Stop with an empty editor and Queue with text while a first entry is submitting and no turn is open yet', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    const submitting: QueueEntry = { queueId: 'q-1', appSessionId: A, content: 'first', createdAt: '2026-09-29T10:00:00.000Z', state: 'submitting', messageUuid: null, submittedAt: '2026-09-29T10:00:00.000Z', uncertain: false, steer: false };
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
    act(() => fake.event('session.queue', { appSessionId: A, entries: [submitting], paused: false, pauseReason: null }));
    await waitFor(() => expect(primary().textContent).toBe('Stop'));
    await type('second');
    await waitFor(() => expect(primary().textContent).toBe('Queue'));
    expect(within(composerOf(0)).getByRole('button', { name: 'Stop' })).toBeTruthy(); // Stop beside it
  });

  it('keeps Enter in the editor from any request.accept handler, and ⌘Enter sends only from the editor', async () => {
    live(A);
    const accepted = vi.fn();
    // a pane-scoped Enter owned by the pane that holds the composer: it would receive any Enter from inside it that C5's
    // dispatcher does not refuse
    function CountingPane({ children }: { children: ReactNode }) {
      const ref = useRef<HTMLElement>(null);
      useKeyChord('request.accept', accepted, { within: ref });
      return (
        <section ref={ref} data-pane={0} aria-label="pane 0">
          {children}
        </section>
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <CountingPane>
          <Composer appSessionId={A} paneIndex={0} />
        </CountingPane>
      </QueryClientProvider>,
    );
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Enter' });
    // a key whose target is inside the editor's sink but is no text entry and no button: only the sink refuses it
    const sink = composerOf(0).querySelector<HTMLElement>('[data-key-sink="composer"]')!;
    await key(sink, { key: 'Enter' });
    expect(accepted).not.toHaveBeenCalled();
    await key(composerOf(0), { key: 'Enter' }); // the same key outside the sink, focus still in the pane: the pane's
    expect(accepted).toHaveBeenCalledTimes(1);
    await type('from the button');
    act(() => primary().focus());
    await key(primary(), { key: 'Enter', metaKey: true });
    expect(invoked('session.send')).toEqual([]); // composer.send is delivered only inside the editor's sink
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Enter', metaKey: true });
    await waitFor(() => expect(invoked('session.send')).toHaveLength(1));
  });

  it('gives the frame’s place to a docked permission without unmounting the editor, and takes focus back after', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await type('a draft kept aside');
    act(() => editorOf().focus());
    const event = permission({ requestId: 'req-a' as never });
    const item = itemFor(event, A);
    act(() => useAttention.setState({ bySession: new Map([[A, [item]]]), requests: new Map([[item.id, event]]), version: 1 }));
    const frame = await within(composerOf(0)).findByRole('group', { name: 'Approval needed' });
    expect(composerOf(0).querySelector('[data-composer-frame]')!.hasAttribute('hidden')).toBe(true);
    expect(editorOf().editor.getText()).toBe('a draft kept aside'); // mounted, hidden
    await waitFor(() => expect(document.activeElement).toBe(frame)); // the pane held focus
    expect(useComposerStore.getState().docked.get(A)?.has('req-a' as never)).toBe(true);
    await key(frame, { key: 'Enter' });
    await waitFor(() => expect(invoked('session.answer')).toHaveLength(1));
    act(() => useAttention.setState({ bySession: new Map([[A, []]]), version: 2 }));
    await waitFor(() => expect(composerOf(0).querySelector('[data-composer-frame]')!.hasAttribute('hidden')).toBe(false));
    expect(editorOf().editor.getText()).toBe('a draft kept aside');
    await waitFor(() => expect(editorOf().contains(document.activeElement)).toBe(true)); // focus is back in the editor
  });

  it('docks a foreign card ahead of any request, hides the editor the same way, and answers Enter through its own onAccept', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await type('still here');
    const onAccept = vi.fn();
    const undock = dockCard(A, { id: 'c10:trust', render: () => <DockedCardFrame appSessionId={A} title="Trust this folder?" onAccept={onAccept} onDecline={null}>Trust?</DockedCardFrame> });
    const frame = await within(composerOf(0)).findByRole('group', { name: 'Trust this folder?' });
    expect(composerOf(0).querySelector('[data-composer-frame]')!.hasAttribute('hidden')).toBe(true);
    act(() => frame.focus());
    await key(frame, { key: 'Enter' });
    expect(onAccept).toHaveBeenCalledTimes(1);
    act(() => undock());
    await waitFor(() => expect(composerOf(0).querySelector('[data-composer-frame]')!.hasAttribute('hidden')).toBe(false));
    expect(editorOf().editor.getText()).toBe('still here');
  });

  it('inserts text for C11 at the caret without replacing the document, and at the end when the editor is not focused', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await type('one three');
    act(() => {
      editorOf().editor.commands.setTextSelection(5); // after `one `
    });
    act(() => editorOf().focus());
    await waitFor(() => expect(editorOf().editor.isFocused).toBe(true));
    act(() => insertComposerText(A, 'two '));
    expect(editorOf().editor.getText()).toBe('one two three');
    act(() => primary().focus()); // focus leaves the editor
    await waitFor(() => expect(editorOf().editor.isFocused).toBe(false));
    act(() => insertComposerText(A, ' four'));
    expect(editorOf().editor.getText()).toBe('one two three four');
  });

  it('shows the engine’s effective mode with the refusal in words, and + dir adds to the engine’s directories', async () => {
    live(A, { status: { permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' } } });
    mount([{ index: 0, id: A }]);
    const chip = within(composerOf(0)).getByRole('button', { name: /^Permission mode default/ });
    expect(chip.getAttribute('aria-label')).toBe('Permission mode default · This model does not support auto mode');
    expect(invoked('session.listPermissionRules')).toEqual([]); // no engine read on mount
    expect(invoked('session.listModels')).toEqual([]);
    const user = userEvent.setup();
    await user.click(within(composerOf(0)).getByRole('button', { name: /^Location/ }));
    await waitFor(() => expect(invoked('session.listPermissionRules')).toHaveLength(1)); // read as the popover opens
    await waitFor(() => expect(within(composerOf(0)).getByRole('button', { name: 'Add a directory' }).textContent).toBe('+ dir · 1'));
    await user.keyboard('{Escape}');
    await user.click(within(composerOf(0)).getByRole('button', { name: 'Add a directory' }));
    await waitFor(() => expect(invoked('session.applyFlagSettings')).toEqual([{ appSessionId: A, settings: { permissions: { additionalDirectories: ['/work/app-a/extra', '/work/picked'] } } }]));
    await waitFor(() => expect(invoked('session.listPermissionRules')).toHaveLength(3)); // read at the change, and again afterwards
    await user.click(chip);
    await waitFor(() => expect(invoked('session.listModels')).toHaveLength(1)); // the mode menu reads the models as it opens
  });
});

describe('one Stop handler for every pane', () => {
  const tabs = (focusedPane: 0 | 1) =>
    useLayout.setState((s) => ({
      main: {
        ...s.main,
        panes: [
          { tabs: [{ id: `session:${A}`, kind: 'session', appSessionId: A, pinned: false }], activeTabId: `session:${A}` },
          { tabs: [{ id: `session:${B}`, kind: 'session', appSessionId: B, pinned: false }], activeTabId: `session:${B}` },
        ],
        focusedPane,
      },
    }));

  it('interrupts the focused pane’s session from its editor, whichever composer mounted last, and nothing for an idle one', async () => {
    busy(A);
    busy(B);
    tabs(1);
    const view = mount([{ index: 1, id: B }, { index: 0, id: A }], <ComposerAppKeys />); // pane 1 first: registration order against focus
    expect(bindingsOf('composer.stop')).toHaveLength(1);
    act(() => editorOf(1).focus());
    await key(editorOf(1), { key: '.', code: 'Period', metaKey: true });
    expect(invoked('session.interrupt')).toEqual([{ appSessionId: B, cancelEngineQueued: false }]);
    act(() => editorOf(0).focus()); // focus moves to pane 0: C5's pane corrects focusedPane on focusin
    expect(useLayout.getState().main.focusedPane).toBe(0);
    await key(editorOf(0), { key: '.', code: 'Period', metaKey: true });
    expect(invoked('session.interrupt')).toEqual([
      { appSessionId: B, cancelEngineQueued: false },
      { appSessionId: A, cancelEngineQueued: false },
    ]);

    live(A); // idle
    await key(editorOf(0), { key: '.', code: 'Period', metaKey: true });
    expect(invoked('session.interrupt')).toHaveLength(2);
    view.unmount();
    expect(bindingsOf('composer.stop')).toHaveLength(0);
  });

  it('holds one registration however many composers mount and unmount', async () => {
    busy(A);
    tabs(0);
    const first = mount([{ index: 0, id: A }], <ComposerAppKeys />);
    const second = render(
      <QueryClientProvider client={queryClient}>
        <Composer appSessionId={B} paneIndex={1} />
      </QueryClientProvider>,
    );
    expect(bindingsOf('composer.stop')).toHaveLength(1);
    second.unmount();
    expect(bindingsOf('composer.stop')).toHaveLength(1);
    first.unmount();
  });

  it('calls nothing for an unstarted focused session, and ⌘L focuses the focused pane’s editor', async () => {
    tabs(0);
    mount([{ index: 0, id: A }], <ComposerAppKeys />); // no status, no record: nothing to interrupt
    await key(document.body, { key: '.', code: 'Period', metaKey: true });
    expect(invoked('session.interrupt')).toEqual([]);
    await key(document.body, { key: 'l', code: 'KeyL', metaKey: true });
    await waitFor(() => expect(editorOf(0).editor.isFocused).toBe(true));
  });
});

// A stub of C10's hook over a small mutable intent: `start` answers when the test says.
function stubIntent(over: Partial<SetupIntentHook['intent']> = {}) {
  let resolveStart: ((r: HookResult) => void) | null = null;
  const state = {
    intent: { location: { kind: 'directory' as const, path: '/repo' }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null, ...over } as SetupIntentHook['intent'],
    listeners: new Set<() => void>(),
  };
  const patch = vi.fn<(p: SetupIntentPatch) => Promise<HookResult>>(async () => ({ ok: true }));
  const start = vi.fn(() => new Promise<HookResult>((resolve) => (resolveStart = resolve)));
  const set = (next: Partial<SetupIntentHook['intent']>) => {
    state.intent = { ...state.intent, ...next };
    state.listeners.forEach((l) => l());
  };
  function useStub(): SetupIntentHook {
    useStubTick(state.listeners);
    return { intent: state.intent, options: { locations: [state.intent.location], branches: [], models: [], autoModeNote: null }, patch, start };
  }
  registerSetupIntentHook((id) => (id === A ? useStub() : null)); // a hook, registered as C10's is
  return { patch, start, set, answer: (r: HookResult) => act(async () => resolveStart?.(r)) };
}

function useStubTick(listeners: Set<() => void>): [number, () => void] {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, [listeners]);
  return [tick, () => setTick((t) => t + 1)];
}

describe('unstarted send holds a starting state', () => {
  it('starts through C10 in the same tick, refuses a second Enter and a keystroke while starting, and keeps the text on a refusal', async () => {
    const stub = stubIntent();
    mount([{ index: 0, id: A }]);
    await type('first message');
    const editor = editorOf();
    act(() => editor.focus());
    act(() => void editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    // before any microtask: the gate is set and C10 has the message
    expect(isStarting(useComposerStore.getState(), A)).toBe(true);
    expect(stub.start).toHaveBeenCalledWith({ content: 'first message', display: 'first message' });
    await waitFor(() => expect(primary().textContent).toBe('Starting…'));
    expect(primary().disabled).toBe(true);
    expect(within(composerOf(0)).getByRole('button', { name: 'Add a directory' }).title).toBe('Session is starting…');
    expect(within(composerOf(0)).getByRole('button', { name: /^Location/ }).title).toContain('Session is starting…');
    await key(editor, { key: 'Enter' });
    expect(editor.getAttribute('contenteditable')).toBe('false'); // read-only: a keystroke changes nothing
    expect(stub.start).toHaveBeenCalledTimes(1);
    expect(editor.editor.getText()).toBe('first message');

    await stub.answer({ ok: false, error: 'missing_directory: /repo is gone' });
    await waitFor(() => expect(isStarting(useComposerStore.getState(), A)).toBe(false));
    expect(editor.editor.getText()).toBe('first message');
    expect(primary().disabled).toBe(false);
    expect((within(composerOf(0)).getByRole('button', { name: 'Add a directory' }) as HTMLButtonElement).disabled).toBe(false);
    expect(useNotices.getState().notices.map((n) => [n.text, n.actions.map((a) => a.label)])).toEqual([['missing_directory: /repo is gone', ['Retry']]]);
  });

  it('clears on an accepted start and stays gated while C10 holds the message, until it lets go', async () => {
    const stub = stubIntent();
    mount([{ index: 0, id: A }]);
    await type('go');
    await key(editorOf(), { key: 'Enter' });
    act(() => stub.set({ message: { content: 'go', display: 'go' } }));
    await stub.answer({ ok: true });
    await waitFor(() => expect(editorOf().editor.getText()).toBe(''));
    expect(invoked('session.history.append')).toEqual([{ appSessionId: A, display: 'go', pastedContents: {}, project: '/repo' }]);
    expect(primary().title).toBe('Your first message is with the setup above');
    expect(primary().disabled).toBe(true);
    expect(within(composerOf(0)).getByRole('button', { name: 'Add a directory' }).title).toBe('Your first message is with the setup above');
    act(() => stub.set({ message: null }));
    await type('again');
    await waitFor(() => expect(primary().disabled).toBe(false));
  });

  it('keeps its draft in the intent, never in C4’s drafts, and prefills through it', async () => {
    const stub = stubIntent({ draft: { doc: docOf([paragraph(textNode('kept in the intent'))]), attachments: [], updatedAt: '2026-09-29T10:00:00.000Z' } });
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(editorOf().editor.getText()).toBe('kept in the intent'));
    vi.useFakeTimers();
    for (const c of ['a', 'b', 'c', 'd', 'e']) {
      await type(c);
      act(() => void vi.advanceTimersByTime(100));
    }
    expect(stub.patch).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(750));
    expect(stub.patch).toHaveBeenCalledTimes(1);
    expect(stub.patch.mock.calls[0][0]).toMatchObject({ draft: { doc: { type: 'doc' } } });
    act(() => prefillComposer(A, { text: 'handed back', editing: null }));
    act(() => void vi.advanceTimersByTime(800));
    expect(stub.patch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(stub.patch.mock.calls[1][0])).toContain('handed back');
    expect(invoked('session.drafts.set')).toEqual([]);
    expect(invoked('session.drafts.get')).toEqual([]);
  });

  it('writes no draft while starting, and none after an accepted start (C10 holds the message and refuses a patch meanwhile)', async () => {
    const stub = stubIntent();
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(editorOf()).toBeTruthy());
    vi.useFakeTimers();
    await type('sent before the pause'); // a draft write is pending (750 ms)
    act(() => void vi.advanceTimersByTime(300));
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Enter' });
    expect(stub.start).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(2_000));
    expect(stub.patch).not.toHaveBeenCalled(); // the submission cancelled the pending write
    act(() => stub.set({ message: { content: 'sent before the pause', display: 'sent before the pause' } }));
    await stub.answer({ ok: true });
    act(() => void vi.advanceTimersByTime(2_000));
    expect(editorOf().editor.getText()).toBe('');
    expect(stub.patch).not.toHaveBeenCalled(); // no `patch({ draft: null })`: the intent's draft is left alone
  });

  it('writes the kept text again after a refused start', async () => {
    const stub = stubIntent();
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(editorOf()).toBeTruthy());
    vi.useFakeTimers();
    await type('kept');
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Enter' });
    await stub.answer({ ok: false, error: 'invalid: bad location' });
    expect(stub.patch).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(800));
    expect(stub.patch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(stub.patch.mock.calls[0][0])).toContain('kept');
  });

  it('holds `!` and `#` until the session starts, and hides the queue', async () => {
    stubIntent();
    mount([{ index: 0, id: A }]);
    await type('!ls');
    await waitFor(() => expect(primary().title).toBe('Available once the session starts'));
    expect(primary().disabled).toBe(true);
    expect(within(composerOf(0)).queryByRole('region', { name: 'Queued messages' })).toBeNull();
    expect(invoked('session.queue.list')).toEqual([{ appSessionId: A }]); // read, but an unstarted session lists nothing
  });
});
