import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import { digest, humanTurn, record, status } from '../../../../test/support/builders'; // C12: digest
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
import { resetEffectiveEfforts } from './effective-effort'; // W3
import { registerSlashWidget } from './mentions/widgets'; // W3
import { closeWidgetDialog, useWidgetDialog } from './WidgetDialog'; // W3
import { registerSetupIntentHook, type HookResult, type SetupIntentHook, type SetupIntentPatch } from './setup-intent';
import { currentSet } from '../stores/layout-model';
import { registerReleasedResume } from './resume-seam'; // C12
import { DictationKeys } from './dictation/DictationKeys'; // E9
import { resetDictationStore, useDictationStore } from './dictation/store'; // E9

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
let fake: FakeClient;
let disconnect: () => void;
let queryClient: QueryClient;

const rules = { state: { rules: [], workspaceDirectories: ['/work/app-a/extra'], originalCwd: '/work/app-a', managedOnly: false } };
beforeEach(() => {
  resetShellStores();
  resetComposerStore();
  resetEffectiveEfforts(); // W3
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
    // C10's catalogue per route (`engine.models`): an entry names a resolved id through `resolvedModel`, as initialize's do
    // (W3: the chip names the row's value, so the two routes' rows differ by value)
    'engine.models': (input: { gateway?: string }) => ({
      models: [{ value: input.gateway === 'direct' ? 'sonnet' : 'claude/sonnet-relay', resolvedModel: 'claude-sonnet', displayName: 'Sonnet' }],
      source: 'cached',
      at: '2026-09-29T09:00:00.000Z',
    }),
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

type TiptapElement = HTMLElement & { editor: { commands: { insertContent(text: string): boolean; setTextSelection(at: number): boolean; blur(): boolean; clearContent(): boolean }; getText(): string; isFocused: boolean } };
const composerOf = (index: 0 | 1) => screen.getByRole('region', { name: `pane ${index}` });
const editorOf = (index: 0 | 1 = 0) => within(composerOf(index)).getByRole('textbox', { name: 'Message', hidden: true }) as TiptapElement;
const type = (text: string, index: 0 | 1 = 0) => act(() => void editorOf(index).editor.commands.insertContent(text));
const key = (target: HTMLElement, init: KeyboardEventInit) => act(async () => void target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
const primary = (index: 0 | 1 = 0) => composerOf(index).querySelector<HTMLButtonElement>('[data-submit-state]')!;
const invoked = (name: Parameters<FakeClient['invoked']>[0]) => fake.invoked(name);
const plusOf = (index: 0 | 1 = 0) => within(composerOf(index)).getByRole('button', { name: 'Add files, photos or commands' });
// W10 (C9): the "+" menu's Add directory…, its disabled reason (null when enabled), the menu closed again
async function addDirectoryState(user = userEvent.setup()): Promise<string | null> {
  await user.click(plusOf());
  const item = await screen.findByRole('menuitem', { name: /^Add directory…/ });
  const reason = item.getAttribute('aria-disabled') === 'true' ? item.textContent!.replace('Add directory…', '') : null;
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  return reason;
}

describe("composer DOM under C5's dispatcher", () => {
  it('marks only the editor root as the key sink; the control, the chips, the toolbar and the queue are pane content', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(editorOf()).toBeTruthy());
    const sinks = composerOf(0).querySelectorAll('[data-key-sink]');
    expect(sinks).toHaveLength(1);
    expect(sinks[0].contains(editorOf())).toBe(true);
    for (const outside of [primary(), within(composerOf(0)).getByRole('toolbar', { name: 'Composer tools' }), plusOf()]) expect(sinks[0].contains(outside)).toBe(false);
  });

  it('is one Send: idle it sends, during a turn Enter and the button steer with priority next; no menu, no ⌥ relabel, no Stop beside it (W10)', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await type('hello');
    expect(primary().textContent).toBe('Send');
    expect(primary().title).toBe('Send (Enter)');
    await key(editorOf(), { key: 'Enter' });
    await waitFor(() => expect(invoked('session.send')).toEqual([{ appSessionId: A, content: 'hello' }]));
    await waitFor(() => expect(editorOf().editor.getText()).toBe(''));

    busy(A);
    await waitFor(() => expect(primary().textContent).toBe('Stop'));
    await type('fold this in');
    act(() => editorOf().focus());
    await waitFor(() => expect(primary().textContent).toBe('Send'));
    expect(primary().title).toBe('Sends at the next step (Enter)');
    expect(primary().getAttribute('aria-description')).toBe('Sends at the next step');
    // ⌥ held changes nothing, and nothing sits beside the button
    await act(async () => void editorOf().dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true, bubbles: true })));
    expect(primary().textContent).toBe('Send');
    await act(async () => void editorOf().dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', altKey: false, bubbles: true })));
    expect(within(composerOf(0)).queryByRole('button', { name: 'More ways to send' })).toBeNull();
    expect(within(composerOf(0)).queryByRole('button', { name: 'Stop' })).toBeNull();
    await key(editorOf(), { key: 'Enter' });
    await waitFor(() => expect(invoked('session.steer')).toEqual([{ appSessionId: A, content: 'fold this in', priority: 'next' }]));
    await waitFor(() => expect(editorOf().editor.getText()).toBe(''));

    await type('and this');
    await userEvent.setup().click(primary());
    await waitFor(() => expect(invoked('session.steer')).toHaveLength(2));
    expect(invoked('session.steer')[1]).toEqual({ appSessionId: A, content: 'and this', priority: 'next' });
    expect(invoked('session.send')).toHaveLength(1);
    expect(invoked('session.history.append').map((i) => (i as { display: string }).display)).toEqual(['hello', 'fold this in', 'and this']);
  });

  it('stops from the button with the box empty during a turn: the plain stop that holds waiting steers (W10)', async () => {
    busy(A);
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(primary().textContent).toBe('Stop'));
    expect(primary().title).toBe('Stop the running turn (⌘.)');
    await userEvent.setup().click(primary());
    await waitFor(() => expect(invoked('session.interrupt')).toEqual([{ appSessionId: A, cancelEngineQueued: false, holdEngineQueued: true }]));
  });

  it('Esc while a turn runs interrupts and sends the held head now, or stops when nothing is held; it leaves Esc alone when idle (W1)', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Escape' });
    expect(invoked('session.interrupt')).toEqual([]); // idle: not the composer's
    busy(A);
    await key(editorOf(), { key: 'Escape' });
    await waitFor(() => expect(invoked('session.interrupt')).toEqual([{ appSessionId: A, cancelEngineQueued: false }])); // Esc holds nothing back: a waiting steer runs now
    const uncertain: QueueEntry = { queueId: 'q-0', appSessionId: A, content: 'maybe sent', createdAt: '2026-09-29T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: true, steer: false };
    const held: QueueEntry = { ...uncertain, queueId: 'q-1', content: 'later', uncertain: false };
    act(() => fake.event('session.queue', { appSessionId: A, entries: [uncertain, held], paused: false, pauseReason: null }));
    await key(editorOf(), { key: 'Escape' });
    await waitFor(() => expect(invoked('session.queue.promote')).toEqual([{ appSessionId: A, queueId: 'q-1', priority: 'now' }])); // the uncertain one waits for the human
    expect(invoked('session.interrupt')).toHaveLength(1);
  });

  // W3 (B7, charter §5.4 as amended 2026-10-01): the terminal's Esc Esc, with no turn running, on an empty editor
  it('Esc Esc on an empty editor with no turn running opens the rewind picker; one Esc, text, or a turn running does not', async () => {
    const off = registerSlashWidget('rewind', { title: 'Rewind', component: () => <p>picker</p> });
    try {
      live(A);
      mount([{ index: 0, id: A }]);
      await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
      act(() => editorOf().focus());
      await key(editorOf(), { key: 'Escape' });
      expect(useWidgetDialog.getState().open).toBeNull();
      await key(editorOf(), { key: 'Escape' });
      expect(useWidgetDialog.getState().open).toMatchObject({ appSessionId: A, name: 'rewind' }); // the app's floating dialog
      act(() => closeWidgetDialog());
      await type('a draft');
      await key(editorOf(), { key: 'Escape' });
      await key(editorOf(), { key: 'Escape' });
      expect(useWidgetDialog.getState().open).toBeNull(); // the draft is not empty
      act(() => editorOf().editor.commands.clearContent());
      busy(A);
      await key(editorOf(), { key: 'Escape' });
      await key(editorOf(), { key: 'Escape' });
      expect(useWidgetDialog.getState().open).toBeNull(); // a turn running: Esc interrupts (W1)
      await waitFor(() => expect(invoked('session.interrupt')).toHaveLength(2));
    } finally {
      off();
      closeWidgetDialog();
    }
  });

  it('reads Stop with an empty editor and Send with text while a first entry is submitting and no turn is open yet', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    const submitting: QueueEntry = { queueId: 'q-1', appSessionId: A, content: 'first', createdAt: '2026-09-29T10:00:00.000Z', state: 'submitting', messageUuid: null, submittedAt: '2026-09-29T10:00:00.000Z', uncertain: false, steer: false };
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
    act(() => fake.event('session.queue', { appSessionId: A, entries: [submitting], paused: false, pauseReason: null }));
    await waitFor(() => expect(primary().textContent).toBe('Stop'));
    await type('second');
    await waitFor(() => expect(primary().textContent).toBe('Send'));
    expect(primary().title).toBe('Sends at the next step (Enter)');
    expect(within(composerOf(0)).queryByRole('button', { name: 'Stop' })).toBeNull(); // W10: nothing beside it
  });

  it('resumes a paused queue from the control, and says so when the host refuses', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(fake.pending('session.queue.list')).toBe(0));
    const queued: QueueEntry = { queueId: 'q-1', appSessionId: A, content: 'later', createdAt: '2026-09-29T10:00:00.000Z', state: 'queued', messageUuid: null, submittedAt: null, uncertain: false, steer: false };
    act(() => fake.event('session.queue', { appSessionId: A, entries: [queued], paused: true, pauseReason: 'interrupt' }));
    await waitFor(() => expect(primary().textContent).toBe('Resume'));
    await userEvent.setup().click(primary());
    await waitFor(() => expect(fake.pending('session.queue.setPaused')).toBe(1));
    await fake.fail('session.queue.setPaused', 'the queue store is unavailable');
    await waitFor(() => expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['the queue store is unavailable']));
    // W10: with text it is Send, which C3 puts behind the paused messages, and the tooltip says so
    await type('one more');
    await waitFor(() => expect(primary().textContent).toBe('Send'));
    expect(primary().title).toBe('Joins the paused queue; Resume sends it (Enter)');
    await key(editorOf(), { key: 'Enter' });
    await waitFor(() => expect(invoked('session.send')).toEqual([{ appSessionId: A, content: 'one more' }]));
    expect(invoked('session.steer')).toEqual([]);
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
    expect(composerOf(0).querySelector('[data-composer-draft]')!.hasAttribute('hidden')).toBe(true); // the box and the toolbar
    expect(within(composerOf(0)).getByRole('toolbar', { name: 'Composer tools', hidden: true }).closest('[hidden]')).not.toBeNull(); // W2: the location with it
    expect(editorOf().editor.getText()).toBe('a draft kept aside'); // mounted, hidden
    await waitFor(() => expect(document.activeElement).toBe(frame)); // the pane held focus
    expect(useComposerStore.getState().docked.get(A)?.has('req-a' as never)).toBe(true);
    await key(frame, { key: 'Enter' });
    await waitFor(() => expect(invoked('session.answer')).toHaveLength(1));
    act(() => useAttention.setState({ bySession: new Map([[A, []]]), version: 2 }));
    await waitFor(() => expect(composerOf(0).querySelector('[data-composer-draft]')!.hasAttribute('hidden')).toBe(false));
    expect(editorOf().editor.getText()).toBe('a draft kept aside');
    await waitFor(() => expect(editorOf().contains(document.activeElement)).toBe(true)); // focus is back in the editor
  });

  it('hands focus from a retiring docked request to the next one, whose Enter answers it (§5.7)', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    act(() => editorOf().focus());
    const first = permission({ requestId: 'req-1' as never, at: '2026-09-29T09:00:00.000Z' });
    const second = permission({ requestId: 'req-2' as never, at: '2026-09-29T09:01:00.000Z' });
    const [one, two] = [itemFor(first, A), itemFor(second, A)];
    const requests = new Map([
      [one.id, first],
      [two.id, second],
    ]);
    act(() => useAttention.setState({ bySession: new Map([[A, [one, two]]]), requests, version: 1 }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-docked-frame')).toBe(A));
    expect(within(composerOf(0)).getByText('1 more waiting')).toBeTruthy();
    await key(document.activeElement as HTMLElement, { key: 'Enter' });
    await waitFor(() => expect(invoked('session.answer')).toEqual([{ appSessionId: A, requestId: 'req-1', answer: { kind: 'permission', decision: 'allow', scope: 'once' } }]));
    act(() => useAttention.setState({ bySession: new Map([[A, [two]]]), version: 2 })); // the first retires behind the second
    await waitFor(() => expect(composerOf(0).querySelector('[data-request-card]')?.getAttribute('data-request-card')).toBe(two.id));
    await new Promise((resolve) => requestAnimationFrame(resolve)); // past any deferred return to the editor
    const next = composerOf(0).querySelector<HTMLElement>('[data-docked-frame]')!;
    expect(document.activeElement).toBe(next);
    await key(next, { key: 'Enter' });
    await waitFor(() => expect(invoked('session.answer').at(-1)).toEqual({ appSessionId: A, requestId: 'req-2', answer: { kind: 'permission', decision: 'allow', scope: 'once' } }));
  });

  it('docks a foreign card ahead of any request, hides the editor the same way, and answers Enter through its own onAccept', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    await type('still here');
    const onAccept = vi.fn();
    const undock = dockCard(A, { id: 'c10:trust', render: () => <DockedCardFrame appSessionId={A} title="Trust this folder?" onAccept={onAccept} onDecline={null}>Trust?</DockedCardFrame> });
    const frame = await within(composerOf(0)).findByRole('group', { name: 'Trust this folder?' });
    expect(composerOf(0).querySelector('[data-composer-draft]')!.hasAttribute('hidden')).toBe(true);
    act(() => frame.focus());
    await key(frame, { key: 'Enter' });
    expect(onAccept).toHaveBeenCalledTimes(1);
    act(() => undock());
    await waitFor(() => expect(composerOf(0).querySelector('[data-composer-draft]')!.hasAttribute('hidden')).toBe(false));
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

  it('the model chip names its model from the route’s engine.models catalogue before any menu opens, and never lists models on mount', async () => {
    const direct = { mode: 'direct' as const, baseUrl: null, verified: 'direct' as const, autoModeServer: 'unknown' as const, localLane: null };
    live(A, { status: { model: { requested: null, resolved: 'claude-sonnet' }, gateway: direct } });
    const view = mount([{ index: 0, id: A }]);
    const chip = () => within(composerOf(0)).getByRole('button', { name: /^Model / });
    await waitFor(() => expect(chip().getAttribute('aria-label')).toBe('Model sonnet'));
    expect(invoked('engine.models')).toContainEqual({ refresh: false, gateway: 'direct', cwd: '/work/app-a' }); // the session's own route and directory
    expect(invoked('session.listModels')).toEqual([]); // the engine is not asked on mount
    view.unmount();
    // an exited session names it from the route its record kept
    useSessions.setState({ engine: new Map(), records: new Map([[A, record(A, { model: { requested: null, resolved: 'claude-sonnet' } })]]) });
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(chip().getAttribute('aria-label')).toBe('Model sonnet-relay'));
    expect(invoked('engine.models')).toContainEqual({ refresh: false, gateway: 'gateway', cwd: '/work/app-a' });
  });

  // W3 (C4): the chip names the effort get_settings applied, and opens the selector C11 registers in its own menu, as
  // `/model` from the editor does
  it('the model chip reads `<alias> <effort>` and opens the registered selector, from the chip and from `/model`', async () => {
    live(A, { status: { model: { requested: null, resolved: 'claude-sonnet' } } });
    const off = registerSlashWidget('model', { title: 'Model', placement: 'modelChip', component: ({ args }) => <p>selector {args || '(none)'}</p> });
    const offEffort = registerSlashWidget('effort', { title: 'Effort', placement: 'modelChip', component: () => <p>effort view</p> });
    try {
      mount([{ index: 0, id: A }]);
      const chip = () => within(composerOf(0)).getByRole('button', { name: /^Model / });
      await waitFor(() => expect(fake.pending('session.getSettings')).toBe(1));
      await waitFor(() => expect(chip().getAttribute('aria-label')).toBe('Model sonnet-relay')); // the relay's row names it (the stub catalogue); the effort is not known yet
      await act(() => fake.reply('session.getSettings', { effective: {}, sources: [], applied: { model: 'claude-sonnet', effort: 'high', advisor: null, ultracode: false } }));
      await waitFor(() => expect(chip().getAttribute('aria-label')).toBe('Model sonnet-relay high'));
      expect(invoked('session.getSettings')).toEqual([{ appSessionId: A }]); // once, at ready
      await userEvent.click(chip());
      expect(await screen.findByText('effort view')).toBeTruthy(); // the chip opens on the effort view (Codex's)
      await userEvent.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByText('effort view')).toBeNull());
      act(() => void useComposerStore.getState().focusTargets.get(A)!.openWidget!('model', 'opus'));
      expect(await screen.findByText('selector opus')).toBeTruthy(); // `/model opus` opens in the chip's menu, never in the box
      expect(within(composerOf(0)).queryByText('selector opus')).toBeNull();
    } finally {
      off();
      offEffort();
    }
  });

  // W3 (C5): the host fell back from a refused auto (requested auto, the fallback effective, the refusal): the dock says so
  // in Claude Desktop's words, the chip shows the mode with the refusal, and the note can be put away
  it.each([['acceptEdits', 'Accept edits'], ['plan', 'Plan'], ['bypassPermissions', 'Bypass permissions'], ['default', 'Manual']] as const)('names the refused-auto fallback %s by its label and lets the notice be dismissed', async (mode, label) => {
    live(A, { status: { permissionMode: { requested: 'auto', effective: mode, refusal: 'auto_mode_model' } } });
    mount([{ index: 0, id: A }]);
    const note = within(composerOf(0)).getByRole('note', { name: 'Permission mode notice' });
    expect(note.textContent).toContain(`Auto mode isn't available for this session. Using ${label} instead.`);
    expect(within(composerOf(0)).getByRole('button', { name: /^Permission mode / }).getAttribute('aria-label')).toBe(`Permission mode ${label} · This model does not support auto mode`);
    await userEvent.click(within(note).getByRole('button', { name: 'Dismiss' }));
    expect(within(composerOf(0)).queryByRole('note', { name: 'Permission mode notice' })).toBeNull();
  });

  it('renews the route’s catalogue when the process becomes ready, not at each mount of a ready session', async () => {
    live(A, { status: { process: 'initializing' } });
    const view = mount([{ index: 0, id: A }]);
    await waitFor(() => expect(invoked('engine.models')).toHaveLength(1));
    live(A); // ready: the launch's initialize has updated the route's catalogue
    await waitFor(() => expect(invoked('engine.models')).toHaveLength(2));
    view.unmount();
    mount([{ index: 0, id: A }]); // a tab switch back: the cached catalogue stands
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(invoked('engine.models')).toHaveLength(2);
  });

  it('keeps `!` enabled while busy as Run, and the control says it runs now inside the turn', async () => {
    busy(A);
    mount([{ index: 0, id: A }]);
    await type('!ls');
    await waitFor(() => expect(primary().textContent).toBe('Run'));
    expect(primary().disabled).toBe(false);
    expect(primary().title).toBe('Runs now; the model sees the output in this turn (Enter)');
    expect(primary().getAttribute('aria-description')).toBe('Runs now; the model sees the output in this turn');
  });

  it('shows the engine’s effective mode with the refusal in words, and the "+" menu’s Add directory… adds to the engine’s directories', async () => {
    live(A, { status: { permissionMode: { requested: 'auto', effective: 'default', refusal: 'auto_mode_model' } } });
    mount([{ index: 0, id: A }]);
    const chip = within(composerOf(0)).getByRole('button', { name: /^Permission mode Manual/ });
    expect(chip.getAttribute('aria-label')).toBe('Permission mode Manual · This model does not support auto mode');
    expect(invoked('session.listPermissionRules')).toEqual([]); // no engine read on mount
    expect(invoked('session.listModels')).toEqual([]);
    expect(within(composerOf(0)).queryByRole('button', { name: 'Add a directory' })).toBeNull(); // W10: no `+ dir` chip
    const user = userEvent.setup();
    await user.click(within(composerOf(0)).getByRole('button', { name: /^Location/ }));
    await waitFor(() => expect(invoked('session.listPermissionRules')).toHaveLength(1)); // read as the popover opens
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Location' })).getByRole('list', { name: 'Additional directories' }).textContent).toContain('/work/app-a/extra'));
    await user.keyboard('{Escape}');
    await user.click(plusOf());
    await user.click(await screen.findByRole('menuitem', { name: 'Add directory…' }));
    await waitFor(() => expect(invoked('layout.pickFiles')).toEqual([{ kind: 'directory', directory: '/work/app-a', multiple: false }]));
    await waitFor(() => expect(invoked('session.applyFlagSettings')).toEqual([{ appSessionId: A, settings: { permissions: { additionalDirectories: ['/work/app-a/extra', '/work/picked'] } } }]));
    await waitFor(() => expect(invoked('session.listPermissionRules')).toHaveLength(3)); // read at the change, and again afterwards
    await user.click(chip);
    await waitFor(() => expect(invoked('session.listModels')).toHaveLength(1)); // the mode menu reads the models as it opens
  });

  // W10 (C10): "model matters a bit more": the model chip toward the middle, the context ring at the outermost edge
  it('orders the toolbar + · location · mode · mic … model · context ring, the ring last', async () => {
    live(A);
    mount([{ index: 0, id: A }]);
    const toolbar = within(composerOf(0)).getByRole('toolbar', { name: 'Composer tools' });
    await waitFor(() => expect(within(toolbar).getByRole('button', { name: /^Context window/ })).toBeTruthy());
    const labels = within(toolbar).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
    // E9: the microphone after the permission mode (and a plugin's mode slot), before the spacer
    expect(labels).toEqual(['Add files, photos or commands', expect.stringMatching(/^Location /), expect.stringMatching(/^Permission mode /), 'Dictate', expect.stringMatching(/^Model /), expect.stringMatching(/^Context window/)]);
  });

  // W10 (C9): on an unstarted tab Add directory… patches the intent, and the project row lists the directories read-only
  it('adds a directory to an unstarted tab’s intent from the "+" menu, listed in the project row’s tooltip and menu', async () => {
    const stub = stubIntent({ additionalDirectories: ['/work/other'] });
    mount([{ index: 0, id: A }]);
    const user = userEvent.setup();
    await user.click(plusOf());
    await user.click(await screen.findByRole('menuitem', { name: 'Add directory…' }));
    await waitFor(() => expect(stub.patch).toHaveBeenCalledWith({ additionalDirectories: ['/work/other', '/work/picked'] }));
    expect(invoked('session.applyFlagSettings')).toEqual([]);
  });
});

describe('one Stop handler for every pane', () => {
  const tabs = (focusedPane: 0 | 1) =>
    useLayout.setState((s) => ({
      main: {
        ...s.main,
        current: 'none',
        sets: {
          none: {
            panes: [
              { tabs: [{ id: `session:${A}`, kind: 'session', appSessionId: A, pinned: false }], activeTabId: `session:${A}` },
              { tabs: [{ id: `session:${B}`, kind: 'session', appSessionId: B, pinned: false }], activeTabId: `session:${B}` },
            ],
            focusedPane,
            splitRatio: 0.5,
          },
        },
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
    expect(invoked('session.interrupt')).toEqual([{ appSessionId: B, cancelEngineQueued: false, holdEngineQueued: true }]); // the plain stop holds waiting steers (W1)
    act(() => editorOf(0).focus()); // focus moves to pane 0: C5's pane corrects focusedPane on focusin
    expect(currentSet(useLayout.getState().main).focusedPane).toBe(0);
    await key(editorOf(0), { key: '.', code: 'Period', metaKey: true });
    expect(invoked('session.interrupt')).toEqual([
      { appSessionId: B, cancelEngineQueued: false, holdEngineQueued: true },
      { appSessionId: A, cancelEngineQueued: false, holdEngineQueued: true },
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
function stubIntent(over: Partial<SetupIntentHook['intent']> = {}, options: Partial<SetupIntentHook['options']> = {}) {
  let resolveStart: ((r: HookResult) => void) | null = null;
  const state = {
    intent: { location: { kind: 'directory' as const, path: '/repo' }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null, ...over } as SetupIntentHook['intent'],
    listeners: new Set<() => void>(),
    phase: null as string | null,
  };
  const patch = vi.fn<(p: SetupIntentPatch) => Promise<HookResult>>(async () => ({ ok: true }));
  const start = vi.fn(() => new Promise<HookResult>((resolve) => (resolveStart = resolve)));
  const set = (next: Partial<SetupIntentHook['intent']>) => {
    state.intent = { ...state.intent, ...next };
    state.listeners.forEach((l) => l());
  };
  function useStub(): SetupIntentHook {
    useStubTick(state.listeners);
    return { intent: state.intent, options: { models: [], autoModeNote: null, ...options }, phase: state.phase, patch, start };
  }
  registerSetupIntentHook((id) => (id === A ? useStub() : null)); // a hook, registered as C10's is
  const setPhase = (phase: string | null) => {
    state.phase = phase;
    state.listeners.forEach((l) => l());
  };
  return { patch, start, set, setPhase, answer: (r: HookResult) => act(async () => resolveStart?.(r)) };
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
    expect(await addDirectoryState()).toBe('Session is starting…'); // W10: the "+" menu's item is gated as every chip is
    expect(within(composerOf(0)).getByRole('button', { name: /^Location/ }).title).toContain('Session is starting…');
    await key(editor, { key: 'Enter' });
    expect(editor.getAttribute('contenteditable')).toBe('false'); // read-only: a keystroke changes nothing
    expect(stub.start).toHaveBeenCalledTimes(1);
    expect(editor.editor.getText()).toBe('first message');

    await stub.answer({ ok: false, error: 'missing_directory: /repo is gone' });
    await waitFor(() => expect(isStarting(useComposerStore.getState(), A)).toBe(false));
    expect(editor.editor.getText()).toBe('first message');
    expect(primary().disabled).toBe(false);
    expect(await addDirectoryState()).toBeNull();
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
    expect(await addDirectoryState()).toBe('Your first message is with the setup above');
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
    act(() => prefillComposer(A, { text: 'handed back' }));
    act(() => void vi.advanceTimersByTime(800));
    expect(stub.patch).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(stub.patch.mock.calls[1][0])).toContain('handed back');
    expect(invoked('session.drafts.set')).toEqual([]);
    expect(invoked('session.drafts.get')).toEqual([]);
  });

  // W3 (B6): the composer has no edit mode; a draft written before W3 may still carry one, which loads as plain text
  it('a draft that carries the retired edit mode restores its text and nothing of the edit', async () => {
    const doc = { ...docOf([paragraph(textNode('kept in the intent'))]), attrs: { attachments: [], editing: { messageUuid: 'u-1', seenCursor: 'u-1' } } };
    stubIntent({ draft: { doc, attachments: [], updatedAt: '2026-09-29T10:00:00.000Z' } });
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(editorOf().editor.getText()).toBe('kept in the intent'));
    expect(composerOf(0).querySelector('[data-edit-mode]')).toBeNull();
    expect(useComposerStore.getState().inlineEdits.size).toBe(0);
    expect(invoked('session.drafts.set')).toEqual([]);
  });

  it('restores no draft while C10 holds the first message (its intent may still carry the sent text)', async () => {
    const draft = { doc: docOf([paragraph(textNode('the sent text'))]), attachments: [], updatedAt: '2026-09-29T10:00:00.000Z' };
    stubIntent({ draft, message: { content: 'the sent text', display: 'the sent text' } });
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(primary().title).toBe('Your first message is with the setup above'));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0))); // the draft's load has answered
    expect(editorOf().editor.getText()).toBe('');
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

  it("shows C10's setup phases on the submit control while the setup runs, then the held message's reason", async () => {
    const stub = stubIntent();
    mount([{ index: 0, id: A }]);
    await type('go');
    await key(editorOf(), { key: 'Enter' });
    act(() => stub.set({ message: { content: 'go', display: 'go' } }));
    await stub.answer({ ok: true });
    for (const phase of ['Creating worktree one…', 'Trusting /repo…', 'Starting…']) {
      act(() => stub.setPhase(phase));
      await waitFor(() => expect(primary().title).toBe(phase));
      expect(primary().textContent).toBe('Starting…');
      expect(primary().disabled).toBe(true);
    }
    act(() => stub.setPhase(null));
    await waitFor(() => expect(primary().title).toBe('Your first message is with the setup above'));
  });

  // W2 (C3): with no status line, the setup's phase shows in the composer's dock above the frame, before the record
  // exists and after (the record exists from the launch, before C3's first status), and only while it runs.
  it('the setup phase shows in the composer’s dock above the frame while it runs, before and after the record exists', async () => {
    const stub = stubIntent();
    const view = mount([{ index: 0, id: A }]);
    const setup = () => within(composerOf(0)).queryByRole('status', { name: 'Setup' });
    expect(setup()).toBeNull(); // nothing at rest: the unstarted tab is the heading and the frame
    act(() => stub.setPhase('Creating worktree one…'));
    await waitFor(() => expect(setup()?.textContent).toBe('Creating worktree one…'));
    expect(setup()!.compareDocumentPosition(composerOf(0).querySelector('[data-composer-frame]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    act(() => stub.setPhase(null));
    await waitFor(() => expect(setup()).toBeNull());
    view.unmount();
    useSessions.setState({ records: new Map([[A, record(A)]]), engine: new Map() });
    mount([{ index: 0, id: A }]);
    act(() => stub.setPhase('Starting…'));
    await waitFor(() => expect(setup()?.textContent).toBe('Starting…'));
    act(() => stub.setPhase(null));
    await waitFor(() => expect(setup()).toBeNull());
  });

  // C10's M6 finding: a failed setup keeps its tab and its intent, and C3 keeps the failed launch's exited status for
  // the id; with no record the tab is still unstarted (C5's pane rule), so the composer stays bound to the intent.
  it('binds the intent on a failed setup’s retained tab (an exited status, no record): editable chips, Send, and its draft in the intent', async () => {
    const stub = stubIntent();
    const s = useSessions.getState();
    useSessions.setState({ engine: new Map(s.engine).set(A, { ...status(A), process: 'exited' }) });
    mount([{ index: 0, id: A }]);
    await waitFor(() => expect(editorOf()).toBeTruthy());
    const location = within(composerOf(0)).getByRole('button', { name: /^Location/ });
    expect(location.title).toBe('/repo · Where this session will run');
    expect(await addDirectoryState()).toBeNull();
    vi.useFakeTimers();
    await type('after the failure');
    expect(primary().textContent).toBe('Send');
    expect(primary().disabled).toBe(false);
    act(() => void vi.advanceTimersByTime(800));
    expect(stub.patch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(stub.patch.mock.calls[0][0])).toContain('after the failure');
    expect(invoked('session.drafts.set')).toEqual([]);
    vi.useRealTimers();
    act(() => editorOf().focus());
    await key(editorOf(), { key: 'Enter' });
    expect(stub.start).toHaveBeenCalledWith({ content: 'after the failure', display: 'after the failure' });
    await stub.answer({ ok: true }); // the session-owned flight outlives unmount; settle this test's start
  });

  // The C7/C10 seam: a chip opened on the intent's frame reads nothing from the engine, so the live frame that replaces
  // it at launch does not read either until a chip opens there; a read at launch would race C10's first message.
  it('reads no engine lists at launch for a chip opened while unstarted, only when one opens on the live frame', async () => {
    stubIntent();
    mount([{ index: 0, id: A }]);
    const user = userEvent.setup();
    await user.click(within(composerOf(0)).getByRole('button', { name: /^Location/ }));
    await user.keyboard('{Escape}');
    await user.click(within(composerOf(0)).getByRole('button', { name: /^Permission mode/ }));
    await user.keyboard('{Escape}');
    live(A);
    await waitFor(() => expect(within(composerOf(0)).getByRole('button', { name: /^Context window/ })).toBeTruthy()); // the live frame (its ring) replaced the intent's
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(invoked('session.listPermissionRules')).toEqual([]);
    expect(invoked('session.listModels')).toEqual([]);
    await user.click(within(composerOf(0)).getByRole('button', { name: /^Location/ }));
    await waitFor(() => expect(invoked('session.listPermissionRules')).toHaveLength(1));
  });

  // New chat (2026-10-01, the owner's ruling): the chip only reads; worktrees and branches are no longer listed in it
  it('the location chip names the directory, the path in its tooltip and popover, and offers no worktree or branch choice', async () => {
    const repo = '/Users/owner/code/repo';
    stubIntent({ location: { kind: 'directory', path: repo } });
    mount([{ index: 0, id: A }]);
    const chip = within(composerOf(0)).getByRole('button', { name: `Location ${repo}` });
    expect(chip.textContent).toBe('repo⌄'); // the name; the path is the tooltip and the popover's first line; W9 (H2): no branch, no placeholder
    expect(chip.title).toBe(`${repo} · Where this session will run`);
    const user = userEvent.setup();
    await user.click(chip);
    const popover = screen.getByRole('dialog', { name: 'Location' });
    expect(within(popover).getByText(repo)).toBeTruthy();
    expect(within(popover).queryByRole('menuitemradio')).toBeNull();
    expect(within(popover).queryByRole('textbox')).toBeNull(); // no new-worktree name, no branch search
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

// C12 start: Send-to-resume (C12 execution document, Interfaces "Send-to-resume"): a session released under the memory
// budget sends through the resume C10 registers, with the message; its `!` waits for a message first.
describe('a released session resumes on Send', () => {
  const exitedBy = (appSessionId: AppSessionId, reason: 'budget' | 'stop') =>
    live(appSessionId, { status: { process: 'exited', exit: { code: 0, signal: null, reason, at: '2026-09-29T14:02:00.000Z', release: reason === 'budget' ? { limitKiB: 8_388_608, totalKiB: 9_000_000 } : null } } });
  const released = (appSessionId: AppSessionId) => {
    exitedBy(appSessionId, 'budget');
    useSessions.getState().applyDigest(digest(appSessionId, { phase: 'idle', released: { at: '2026-09-29T14:02:00.000Z', limitKiB: 8_388_608 } }));
  };
  let off: () => void = () => {};
  afterEach(() => off());

  it('sends the typed message to the registered resume, clears the editor once it is taken, and records the prompt', async () => {
    const resume = vi.fn(async () => true);
    off = registerReleasedResume(resume);
    released(A);
    mount([{ index: 0, id: A }]);
    await type('carry on');
    await waitFor(() => expect(primary().disabled).toBe(false));
    expect(primary().getAttribute('aria-description')).toBe('Resumes this session');
    await key(editorOf(), { key: 'Enter' });
    await waitFor(() => expect(resume).toHaveBeenCalledExactlyOnceWith(A, { content: 'carry on', display: 'carry on' }));
    await waitFor(() => expect(editorOf().editor.getText()).toBe(''));
    expect(invoked('session.send')).toEqual([]);
    expect(invoked('session.history.append')).toEqual([{ appSessionId: A, display: 'carry on', pastedContents: {} }]);
  });

  it('keeps the text when the resume is refused', async () => {
    const resume = vi.fn(async () => false);
    off = registerReleasedResume(resume);
    released(A);
    mount([{ index: 0, id: A }]);
    await type('carry on');
    await key(editorOf(), { key: 'Enter' });
    await waitFor(() => expect(resume).toHaveBeenCalledOnce());
    expect(editorOf().editor.getText()).toBe('carry on');
    expect(invoked('session.history.append')).toEqual([]);
  });

  it('a stopped session, and a released one whose mark an archive dropped, still read Session ended and resume nothing', async () => {
    const resume = vi.fn(async () => true);
    off = registerReleasedResume(resume);
    exitedBy(A, 'stop');
    exitedBy(B, 'budget'); // the host's row still says budget; main's digest has no mark (archived and unarchived)
    mount([{ index: 0, id: A }, { index: 1, id: B }]);
    for (const pane of [0, 1] as const) {
      await type('carry on', pane);
      await waitFor(() => expect(primary(pane).title).toBe('Session ended'));
      expect(primary(pane).disabled).toBe(true);
      await key(editorOf(pane), { key: 'Enter' });
    }
    expect(resume).not.toHaveBeenCalled();
  });
});
// C12 end

// E9 start: push-to-talk dictation through the composer (E9 execution document, Design §6 to §8): the one app-level hold
// resolves the focused pane's session, writes into that composer only, and shows its state in that toolbar.
describe('dictation into the focused pane’s composer', () => {
  const focusTabs = (focusedPane: 0 | 1, ids: AppSessionId[]) =>
    useLayout.setState((s) => ({
      main: {
        ...s.main,
        current: 'none',
        sets: {
          none: {
            panes: ids.map((id) => ({ tabs: [{ id: `session:${id}`, kind: 'session' as const, appSessionId: id, pinned: false }], activeTabId: `session:${id}` })),
            focusedPane,
            splitRatio: 0.5,
          },
        },
      },
    }));
  const altSpace = { code: 'Space', key: ' ', altKey: true };
  const keyUp = (init: KeyboardEventInit) => act(async () => void document.body.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, ...init })));
  const voice = (payload: Record<string, unknown>) => act(() => fake.event('voice.event', payload));
  const captureId = () => (invoked('voice.start')[0] as { captureId: string }).captureId;
  const dictationStatus = (index: 0 | 1) => within(composerOf(index)).queryByRole('status', { name: 'Dictation' });
  const trustCard = () => <DockedCardFrame appSessionId={A} title="Trust this folder?" onAccept={() => {}} onDecline={null}>Trust?</DockedCardFrame>;

  beforeEach(() => resetDictationStore());
  afterEach(() => resetDictationStore());

  it('holding ⌥Space in pane 1 writes greyed partials there only, and the release settles the final', async () => {
    live(A);
    live(B);
    focusTabs(1, [A, B]);
    mount([{ index: 0, id: A }, { index: 1, id: B }], <DictationKeys />);
    act(() => editorOf(1).focus());
    await key(editorOf(1), altSpace);
    await key(editorOf(1), { ...altSpace, repeat: true });
    expect(invoked('voice.start')).toEqual([{ captureId: expect.any(String), locale: null }]);
    expect(dictationStatus(1)?.textContent).toBe('Asking for permission…');

    voice({ kind: 'started', captureId: captureId(), locale: 'en-US' });
    expect(dictationStatus(1)?.textContent).toBe('Listening…');
    expect(dictationStatus(0)).toBeNull();
    voice({ kind: 'partial', captureId: captureId(), text: 'hello' });
    voice({ kind: 'partial', captureId: captureId(), text: 'hello world' });
    expect(editorOf(1).editor.getText()).toBe('hello world');
    expect([...editorOf(1).querySelectorAll('.text-fg-muted')].map((el) => el.textContent)).toEqual(['hello world']);
    expect(editorOf(0).editor.getText()).toBe('');

    await keyUp(altSpace);
    expect(invoked('voice.stop')).toEqual([{ captureId: captureId() }]);
    expect(dictationStatus(1)?.textContent).toBe('Finishing…');
    voice({ kind: 'final', captureId: captureId(), text: 'Hello world.', timedOut: false });
    expect(editorOf(1).editor.getText()).toBe('Hello world.');
    expect(editorOf(1).querySelectorAll('.text-fg-muted')).toHaveLength(0);
    expect(dictationStatus(1)).toBeNull();
  });

  it('a card over the box refuses: the notice shows in the dock and nothing starts', async () => {
    live(A);
    focusTabs(0, [A]);
    dockCard(A, { id: 'c10:trust', render: trustCard });
    mount([{ index: 0, id: A }], <DictationKeys />);
    await within(composerOf(0)).findByRole('group', { name: 'Trust this folder?' });
    await key(document.body, altSpace);
    expect(invoked('voice.start')).toEqual([]);
    expect(within(composerOf(0)).getByRole('note', { name: 'Dictation notice' }).textContent).toContain('Dictation needs a composer that can take text');
  });

  it('a card docking mid-capture keeps the words heard so far and cancels on main', async () => {
    live(A);
    focusTabs(0, [A]);
    mount([{ index: 0, id: A }], <DictationKeys />);
    act(() => editorOf(0).focus());
    await key(editorOf(0), altSpace);
    voice({ kind: 'started', captureId: captureId(), locale: 'en-US' });
    voice({ kind: 'partial', captureId: captureId(), text: 'hello' });
    act(() => void dockCard(A, { id: 'c10:trust', render: trustCard }));
    await waitFor(() => expect(invoked('voice.cancel')).toEqual([{ captureId: captureId() }]));
    expect(editorOf(0).editor.getText()).toBe('hello');
    expect(useDictationStore.getState().capture).toBeNull();
  });

  // Loss of input ends a capture whatever started it (Design §8): a pointer released over another app or under a native
  // permission dialog never reaches the button, so the window's blur and a hidden document cancel the pointer's hold too.
  const blurWindow = () => act(() => void window.dispatchEvent(new Event('blur')));
  const hideDocument = () =>
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      try {
        document.dispatchEvent(new Event('visibilitychange'));
      } finally {
        delete (document as { visibilityState?: unknown }).visibilityState;
      }
    });
  const holdMic = () => {
    const mic = within(composerOf(0)).getByRole('button', { name: 'Dictate' });
    fireEvent.pointerDown(mic, { button: 0 });
    return mic;
  };

  it('a pointer hold still asking for permission ends when the window loses focus, and its late start is dropped', async () => {
    live(A);
    focusTabs(0, [A]);
    mount([{ index: 0, id: A }], <DictationKeys />);
    act(() => editorOf(0).focus());
    const mic = holdMic();
    expect(invoked('voice.start')).toHaveLength(1);
    blurWindow();
    expect(invoked('voice.cancel')).toEqual([{ captureId: captureId() }]);
    expect(dictationStatus(0)).toBeNull();
    voice({ kind: 'started', captureId: captureId(), locale: 'en-US' });
    voice({ kind: 'partial', captureId: captureId(), text: 'hello' });
    fireEvent.pointerUp(mic, { button: 0 });
    expect(dictationStatus(0)).toBeNull();
    expect(editorOf(0).editor.getText()).toBe('');
    expect(invoked('voice.stop')).toEqual([]);
    expect(invoked('voice.cancel')).toHaveLength(1);
  });

  for (const [name, lose] of [['the window loses focus', blurWindow], ['the document is hidden', hideDocument]] as const) {
    it(`a listening pointer hold ends when ${name}: cancelled on main and its words removed`, async () => {
      live(A);
      focusTabs(0, [A]);
      mount([{ index: 0, id: A }], <DictationKeys />);
      act(() => editorOf(0).focus());
      holdMic();
      voice({ kind: 'started', captureId: captureId(), locale: 'en-US' });
      voice({ kind: 'partial', captureId: captureId(), text: 'hello' });
      expect(editorOf(0).editor.getText()).toBe('hello');
      lose();
      expect(invoked('voice.cancel')).toEqual([{ captureId: captureId() }]);
      expect(editorOf(0).editor.getText()).toBe('');
      expect(dictationStatus(0)).toBeNull();
    });
  }

  it('a key hold losing focus is cancelled once, though the key’s own route and the input-loss route both fire', async () => {
    live(A);
    focusTabs(0, [A]);
    mount([{ index: 0, id: A }], <DictationKeys />);
    act(() => editorOf(0).focus());
    await key(editorOf(0), altSpace);
    voice({ kind: 'started', captureId: captureId(), locale: 'en-US' });
    voice({ kind: 'partial', captureId: captureId(), text: 'hello' });
    blurWindow();
    expect(invoked('voice.cancel')).toEqual([{ captureId: captureId() }]);
    expect(editorOf(0).editor.getText()).toBe('');
    await keyUp(altSpace); // the key's latch is gone: its later release does nothing
    expect(invoked('voice.stop')).toEqual([]);
  });
});
// E9 end
