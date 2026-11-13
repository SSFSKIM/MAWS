// An empty New chat (UX wave U13a; its plan's Interfaces §E, the section's O-01 "New chat" and "At a relaunch"): what
// counts as empty, the discard New chat asks for when it closes one, and the relaunch that does not bring one back
// (the owner, 2026-11-12: "No, only chats with content").
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { EMPTY_STRIP, storedMain, tabId, type Strip } from '@shared/ipc/schema/layout';
import type { SetupIntent } from '@shared/sessions/intent';
import { project, record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { registerLiveDraft } from '../composer/editor/drafts';
import { ipc } from '../ipc/client';
import { currentTabRetention, newChat, registerEmptyChats, registerSessionCreator } from '../keymap/actions-runtime';
import { prefillComposer, queueComposerAttachment, resetComposerStore } from '../stores/composer';
import { createLayoutStore, frontOf, useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { preloadOf } from '../test-support/preload-of';
import { ID, intent, MESSAGE, putIntent, REPO, resetSetupStore, resources, trustState } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { connectSessions, createUnstartedSession } from './connect';
import { discardEmptyChat, isEmptyChat, isEmptyIntent, patchIntent } from './setup-actions';
import { useSetup } from './store';

const T1 = '2026-09-29T10:00:01.000Z';
const OTHER = '22222222-2222-4222-8222-222222222222' as AppSessionId;
const ENGINE = '33333333-3333-4333-8333-333333333333';
const A = at(ID);
const text = (words: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: words }] }] });
const draft = (doc: unknown, attachments: { path: string; kind: string }[] = []) => ({ doc, attachments, updatedAt: T1 });
const progress = (over: Partial<SetupIntent['progress']>) => ({ ...intent().progress, ...over });

// Each way a chat holds something, as main stores its intent (bare ids).
const holding: [string, Partial<SetupIntent>][] = [
  ['a typed draft', { draft: draft(text('keep this')) }],
  ['an attachment', { draft: draft(text(''), [{ path: '/tmp/notes.md', kind: 'file' }]) }],
  ['a held first message', { message: MESSAGE }],
  ['a fork', { kind: 'fork', source: { appSessionId: OTHER, engineSessionId: ENGINE as never, rewindTo: null } }],
  ['a lineage', { lineage: { kind: 'side-thread', parentAppSessionId: OTHER, parentEngineSessionId: ENGINE as never, openedBy: 'btw' } }],
  ['a remote requester', { launchedBy: { member: 'member-1', device: 'device-1', opId: 'op-1', action: null } }],
  ['a worktree location', { location: { kind: 'newWorktree', repoRoot: REPO, name: 'one', branch: { kind: 'new', name: 'worktree-one', base: 'HEAD' } } }],
  ['an existing worktree location', { location: { kind: 'existingWorktree', repoRoot: REPO, path: `${REPO}/.claude/worktrees/one` } }],
  ['a checkout kept from a failed attempt', { progress: progress({ worktree: { path: `${REPO}/.claude/worktrees/one`, branch: 'worktree-one', head: 'a'.repeat(40), createdHere: true } }) }],
  ['a failed start', { progress: progress({ lastFailure: { at: T1, phase: 'launching', message: 'the engine exited', resources: resources() } }) }],
  ['a bootstrap', { progress: progress({ bootstrap: { appSessionId: OTHER, at: T1 } }) }],
  ['a launch', { progress: progress({ launch: { launchId: 'launch-1', at: T1 } }) }],
  ['a send', { progress: progress({ send: { queueId: 'queue-1', messageUuid: null, disposition: 'sent', at: T1 } }) }],
];

let fake: FakeClient;
beforeEach(() => {
  resetShellStores();
  resetSetupStore();
  useNotices.setState({ notices: [] });
});
afterEach(() => {
  cleanup();
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('an empty intent', () => {
  it('is a create with nothing typed or attached, no first message and no attempt; untyped choices keep it empty', () => {
    expect(isEmptyIntent(intent())).toBe(true);
    expect(isEmptyIntent(intent({ location: null }))).toBe(true);
    expect(isEmptyIntent(intent({ model: 'haiku', permissionMode: 'plan', additionalDirectories: ['/work/notes'] }))).toBe(true);
    expect(isEmptyIntent(intent({ draft: draft(text('   ')) }))).toBe(true);
  });

  it.each(holding)('is not empty with %s', (_what, over) => {
    expect(isEmptyIntent(intent(over))).toBe(false);
  });
});

describe('an empty chat', () => {
  const put = (over: Partial<SetupIntent> = {}) => putIntent(intent({ appSessionId: A, ...over }));

  it('is an unstarted chat with an empty intent, no start under way, no card waiting and an empty editor', () => {
    put();
    expect(isEmptyChat(A)).toBe(true);
    const off = registerLiveDraft(A, () => text('') as never);
    expect(isEmptyChat(A), 'an empty mounted editor').toBe(true);
    off();
  });

  it('is not empty without an intent, with a record, or with text in its mounted editor not yet written to its intent', () => {
    expect(isEmptyChat(A), 'no intent').toBe(false);
    put();
    const off = registerLiveDraft(A, () => text('typed a moment ago') as never);
    expect(isEmptyChat(A), 'the editor').toBe(false);
    off();
    useSessions.setState({ records: new Map([[A, record(A)]]) });
    expect(isEmptyChat(A), 'a record').toBe(false);
  });

  it('is not empty while a start is under way, a card waits or a start has failed', () => {
    put();
    useSetup.getState().setInvoking(A, true);
    expect(isEmptyChat(A), 'a start this window sent').toBe(false);
    useSetup.getState().setInvoking(A, false);
    useSetup.getState().applySetup({ appSessionId: A, phase: 'launching', detail: 'Starting', outcome: null });
    expect(isEmptyChat(A), 'a phase under way').toBe(false);
    useSetup.getState().applySetup({ appSessionId: A, phase: 'failed', detail: null, outcome: { kind: 'error', message: 'no', resources: resources() } });
    expect(isEmptyChat(A), 'a failed start').toBe(false);
    useSetup.getState().settle(A);
    expect(isEmptyChat(A), 'dismissed').toBe(true);
    useSetup.getState().dock(A, { kind: 'trust', trust: trustState(), message: null });
    expect(isEmptyChat(A), 'a card').toBe(false);
  });

  it.each(holding)('is not empty with %s', (_what, over) => {
    put(over);
    expect(isEmptyChat(A)).toBe(false);
  });
});

// The branch review (its findings 1 and 2): one definition of empty, read by the reuse, the close of the other empty
// chats and the relaunch sweep. What the chat holds outside its stored intent counts too: a draft on its way to the
// intent, a prompt or attachments waiting for its composer to mount.
describe('an empty chat, with what waits outside its intent', () => {
  afterEach(() => resetComposerStore());
  const put = () => putIntent(intent({ appSessionId: A }));

  it('is not empty with a prefill waiting for its composer (the Library’s Ask Claude)', () => {
    put();
    prefillComposer(A, { text: 'Make a deck: ' });
    expect(isEmptyChat(A)).toBe(false);
  });

  it('is not empty with an attachment waiting for its composer', () => {
    put();
    queueComposerAttachment(A, { files: [new File(['sketch'], 'sketch.png', { type: 'image/png' })], text: 'Marked up' });
    expect(isEmptyChat(A)).toBe(false);
  });

  it('is not empty while a write of its draft is on the way, and holds the draft once main answers', async () => {
    fake = fakeClient();
    window.maws = preloadOf(fake);
    put();
    const writing = patchIntent(A, { draft: draft(text('typed a moment ago')) });
    expect(isEmptyChat(A), 'the write has left').toBe(false);
    await fake.reply('session.intent.patch', intent({ draft: draft(text('typed a moment ago')), updatedAt: T1 }));
    await expect(writing).resolves.toEqual({ ok: true });
    expect(isEmptyChat(A), 'the intent holds it').toBe(false);
  });

  it('is empty again once a write of nothing is answered or refused', async () => {
    fake = fakeClient();
    window.maws = preloadOf(fake);
    put();
    const writing = patchIntent(A, { model: 'haiku' });
    expect(isEmptyChat(A)).toBe(false);
    await fake.fail('session.intent.patch', 'the intent is busy');
    await writing;
    expect(isEmptyChat(A)).toBe(true);
  });

  // the reviewer's sequence: a New chat for another project is slow; the person types into the empty chat in front and
  // turns to another tab, which flushes the draft; the creation then answers before the draft's write
  it('is not closed by a late New chat while its draft’s write is on the way', async () => {
    const P = at('proj-here' as ProjectId);
    const Q = at('proj-second' as ProjectId);
    const X = at('in-p' as AppSessionId);
    const NEW = at('new-1' as AppSessionId);
    fake = fakeClient({ 'session.intent.discard': { leftover: null } });
    window.maws = preloadOf(fake);
    useSessions.setState({ projects: new Map([[P, project(P, 0)], [Q, project(Q, 1)]]), records: new Map([[X, record(X, { projectId: P })]]) });
    const offs = [registerEmptyChats({ isEmpty: isEmptyChat, discard: discardEmptyChat })];
    let answer!: (id: AppSessionId | null) => void;
    offs.push(registerSessionCreator(() => new Promise((resolve) => (answer = resolve))));
    try {
      putIntent(intent({ appSessionId: A, projectId: Q }));
      useSessions.getState().addUnstarted(A, { projectId: Q, createdAt: T1 });
      useLayout.getState().openTab({ kind: 'session', appSessionId: X });
      useLayout.getState().openTab({ kind: 'session', appSessionId: A });
      const press = newChat({ row: P });
      const writing = patchIntent(A, { draft: draft(text('keep this')) }); // the editor's cleanup flushes the draft
      useLayout.getState().activateTab(tabId({ kind: 'session', appSessionId: X })); // and the person turned to another tab
      await act(async () => answer(NEW));
      await act(async () => expect(await press).toBe(NEW));
      expect(fake.invoked('session.intent.discard')).toEqual([]);
      expect(allTabs(useLayout.getState().main).map((t) => t.id)).toContain(tabId({ kind: 'session', appSessionId: A }));
      expect(frontOf(useLayout.getState())).toBe(tabId({ kind: 'session', appSessionId: X }));
      await fake.reply('session.intent.patch', intent({ projectId: 'proj-second' as ProjectId, draft: draft(text('keep this')), updatedAt: T1 }));
      await writing;
      expect(isEmptyChat(A)).toBe(false);
    } finally {
      offs.forEach((off) => off());
    }
  });
});

describe('the discard New chat asks for', () => {
  it('discards the intent and asks nothing', async () => {
    fake = fakeClient({ 'session.intent.discard': { leftover: null } });
    window.maws = preloadOf(fake);
    putIntent(intent({ appSessionId: A }));
    await expect(discardEmptyChat(A)).resolves.toBe(true);
    expect(fake.invoked('session.intent.discard')).toEqual([{ appSessionId: ID }]);
  });

  it('answers false when main refuses, and says why', async () => {
    fake = fakeClient();
    window.maws = preloadOf(fake);
    putIntent(intent({ appSessionId: A }));
    const discarding = discardEmptyChat(A);
    await fake.fail('session.intent.discard', 'the intent is busy');
    await expect(discarding).resolves.toBe(false);
    expect(useNotices.getState().notices).toMatchObject([{ level: 'danger', text: 'the intent is busy' }]);
  });
});

// Q1: the intents main holds at launch; an empty chat's is discarded before the layout hydrates, so its tab is dropped.
describe('an empty New chat at a relaunch', () => {
  const kept = holding.map(([, over], i) => intent({ appSessionId: `4444444${i.toString(16)}-4444-4444-8444-444444444444` as AppSessionId, ...over }));
  const strip = (ids: AppSessionId[]): Strip => ({ ...EMPTY_STRIP, panes: [{ tabs: ids.map((id) => ({ id: tabId({ kind: 'session', appSessionId: id }), kind: 'session', appSessionId: id, pinned: false })), activeTabId: tabId({ kind: 'session', appSessionId: ids[0] }) }] });

  // `held`: main's answer to the discard waits for the test
  async function relaunch(mode: 'index' | 'scenario', { held = false } = {}) {
    fake = fakeClient({
      'session.launchMode': { mode },
      'session.intent.list': { intents: [intent(), ...kept] },
      'session.deletions.list': { manifests: [] },
      ...(!held && { 'session.intent.discard': { leftover: null } }),
    });
    window.maws = preloadOf(fake);
    let disconnect!: () => void;
    await act(async () => {
      disconnect = connectSessions(ipc);
    });
    return disconnect;
  }

  // what hydration keeps of a stored strip that holds every one of them, with the registered retention as the shell asks it
  async function hydrated(): Promise<string[]> {
    const ids = [A, ...kept.map((i) => at(i.appSessionId))];
    const layout = fakeClient({ 'layout.list': { keys: ['main.tabs'] }, 'layout.get': ({ key }: { key: string }) => ({ value: key === 'main.tabs' ? storedMain(strip(ids)) : null }) });
    const store = createLayoutStore();
    await store.getState().hydrate(layout.client, (id) => currentTabRetention()!.retains(id));
    return allTabs(store.getState().main).map((t) => t.id);
  }

  it('discards an empty chat’s intent at the first snapshot, so its tab is gone after hydration; every chat that holds something comes back', async () => {
    const disconnect = await relaunch('index');
    try {
      await expect(currentTabRetention()!.ready).resolves.toBe(true);
      expect(fake.invoked('session.intent.discard')).toEqual([{ appSessionId: ID }]);
      expect(useSetup.getState().intents.has(A)).toBe(false);
      expect(await hydrated()).toEqual(kept.map((i) => tabId({ kind: 'session', appSessionId: at(i.appSessionId) })));
    } finally {
      act(() => disconnect());
    }
  });

  it('keeps an empty chat whose discard main refuses: its tab comes back as before', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const disconnect = await relaunch('index', { held: true });
    try {
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      expect(fake.pending('session.intent.discard')).toBe(1);
      await act(() => fake.fail('session.intent.discard', 'the intent is busy'));
      await expect(currentTabRetention()!.ready).resolves.toBe(true);
      expect(useSetup.getState().intents.has(A)).toBe(true);
      expect(await hydrated()).toContain(tabId({ kind: 'session', appSessionId: A }));
      expect(warn).toHaveBeenCalledWith('[sessions] an empty New chat could not be discarded; its tab comes back', expect.anything());
    } finally {
      act(() => disconnect());
      warn.mockRestore();
    }
  });

  it('reads the same definition: an earlier run’s chat with a prompt already waiting for its composer is kept', async () => {
    prefillComposer(A, { text: 'Make a deck: ' });
    const disconnect = await relaunch('index');
    try {
      await expect(currentTabRetention()!.ready).resolves.toBe(true);
      expect(fake.invoked('session.intent.discard')).toEqual([]);
    } finally {
      act(() => disconnect());
      resetComposerStore();
    }
  });

  it('discards nothing in launch mode scenario', async () => {
    const disconnect = await relaunch('scenario');
    try {
      await expect(currentTabRetention()!.ready).resolves.toBe(true);
      expect(fake.invoked('session.intent.discard')).toEqual([]);
      expect(await hydrated()).toContain(tabId({ kind: 'session', appSessionId: A }));
    } finally {
      act(() => disconnect());
    }
  });
});

// M3's reviews (the plan's Decision Log, 2026-11-13): the sweep is a relaunch's cleanup, so no chat of this run may be
// among its candidates. A New chat pressed during startup is created only once the sweep has run (or is known not to
// run), so no intent of this run is in main or in the store when the sweep takes them.
describe('a New chat pressed while the relaunch snapshot is out', () => {
  const MADE = '55555555-5555-4555-8555-555555555555' as AppSessionId;
  const offs: (() => void)[] = [];
  afterEach(() => offs.splice(0).forEach((off) => off()));
  const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

  // `create`: main answers `session.create` at once; otherwise the test answers it
  async function startup(mode: 'index' | 'scenario', { create = true } = {}) {
    fake = fakeClient({
      'session.launchMode': { mode },
      'session.deletions.list': { manifests: [] },
      'session.intent.discard': { leftover: null },
      ...(create && { 'session.create': { appSessionId: MADE, intent: intent({ appSessionId: MADE }) } }),
    });
    window.maws = preloadOf(fake);
    let disconnect!: () => void;
    await act(async () => {
      disconnect = connectSessions(ipc);
    });
    offs.push(() => act(() => disconnect()));
    expect(fake.pending('session.intent.list')).toBe(1);
  }

  it('is created only after the sweep has run, and two presses meanwhile make one chat', async () => {
    await startup('index');
    const first = newChat();
    const second = newChat();
    expect(second).toBe(first);
    await flush();
    expect(fake.invoked('session.create'), 'held while the snapshot is out').toEqual([]);
    await act(() => fake.reply('session.intent.list', { intents: [intent()] })); // an earlier run's empty chat
    await act(async () => expect(await first).toBe(at(MADE)));
    expect(fake.invoked('session.intent.discard')).toEqual([{ appSessionId: ID }]);
    expect(fake.invoked('session.create')).toHaveLength(1);
    expect(fake.calls.indexOf('invoke session.create')).toBeGreaterThan(fake.calls.indexOf('invoke session.intent.discard'));
    expect(allTabs(useLayout.getState().main).map((t) => t.id)).toEqual([tabId({ kind: 'session', appSessionId: at(MADE) })]);
    expect(useSetup.getState().intents.has(at(MADE))).toBe(true);
  });

  // the reviewer's ordering: main announces the new intent before it answers the create
  it('is not discarded when its creation event comes before the create’s answer and the snapshot answers with none', async () => {
    await startup('index', { create: false });
    const press = newChat();
    await flush();
    expect(fake.pending('session.create')).toBe(0);
    await act(() => fake.reply('session.intent.list', { intents: [] }));
    await expect(currentTabRetention()!.ready).resolves.toBe(true);
    await flush();
    expect(fake.pending('session.create')).toBe(1);
    act(() => fake.event('session.intent.changed', { appSessionId: MADE, intent: intent({ appSessionId: MADE }) }));
    offs.push(registerLiveDraft(at(MADE), () => text('keep this new prompt') as never));
    await act(() => fake.reply('session.create', { appSessionId: MADE, intent: intent({ appSessionId: MADE }) }));
    await act(async () => expect(await press).toBe(at(MADE)));
    expect(fake.invoked('session.intent.discard')).toEqual([]);
    expect(useSetup.getState().intents.has(at(MADE))).toBe(true);
  });

  it('is not held in launch mode scenario, where no sweep runs', async () => {
    await startup('scenario');
    await act(async () => expect(await createUnstartedSession(null, ipc)).toBe(at(MADE)));
    expect(fake.pending('session.intent.list'), 'the snapshot is still out').toBe(1);
  });

  it('is not held where connectSessions is not wired', async () => {
    fake = fakeClient({ 'session.create': { appSessionId: MADE, intent: intent({ appSessionId: MADE }) } });
    window.maws = preloadOf(fake);
    await act(async () => expect(await createUnstartedSession(null, ipc)).toBe(at(MADE)));
  });
});
