// An empty New chat (UX wave U13a; its plan's Interfaces §E, the section's O-01 "New chat" and "At a relaunch"): what
// counts as empty, the discard New chat asks for when it closes one, and the relaunch that does not bring one back
// (the owner, 2026-11-12: "No, only chats with content").
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { PreloadBridge } from '@shared/ipc/schema';
import { EMPTY_STRIP, storedMain, tabId, type Strip } from '@shared/ipc/schema/layout';
import type { SetupIntent } from '@shared/sessions/intent';
import { record } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { at } from '../../../../test/support/machine';
import { registerLiveDraft } from '../composer/editor/drafts';
import { ipc } from '../ipc/client';
import { currentTabRetention, newChat } from '../keymap/actions-runtime';
import { createLayoutStore, useLayout } from '../stores/layout';
import { allTabs } from '../stores/layout-model';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { preloadOf } from '../test-support/preload-of';
import { ID, intent, MESSAGE, putIntent, REPO, resetSetupStore, resources, trustState } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { connectSessions } from './connect';
import { discardEmptyChat, isEmptyChat, isEmptyIntent } from './setup-actions';
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

// M3's review: the sweep is a relaunch's cleanup, so it sees only chats an earlier run left; a chat this run made while
// the snapshot was still out is the person's, typed into or not.
describe('a New chat made while the relaunch snapshot is out', () => {
  const MADE = '55555555-5555-4555-8555-555555555555' as AppSessionId;
  const offs: (() => void)[] = [];
  afterEach(() => offs.splice(0).forEach((off) => off()));

  async function madeDuringTheSnapshot() {
    fake = fakeClient({
      'session.launchMode': { mode: 'index' },
      'session.deletions.list': { manifests: [] },
      'session.create': { appSessionId: MADE, intent: intent({ appSessionId: MADE }) },
      'session.intent.discard': { leftover: null },
    });
    window.maws = preloadOf(fake);
    let disconnect!: () => void;
    await act(async () => {
      disconnect = connectSessions(ipc);
    });
    offs.push(() => act(() => disconnect()));
    expect(fake.pending('session.intent.list')).toBe(1);
    await act(async () => expect(await newChat()).toBe(at(MADE)));
    expect(allTabs(useLayout.getState().main).map((t) => t.id)).toEqual([tabId({ kind: 'session', appSessionId: at(MADE) })]);
  }

  it('is not discarded when it holds typing and the snapshot answers with none', async () => {
    await madeDuringTheSnapshot();
    offs.push(registerLiveDraft(at(MADE), () => text('keep this new prompt') as never));
    await act(() => fake.reply('session.intent.list', { intents: [] }));
    await expect(currentTabRetention()!.ready).resolves.toBe(true);
    expect(fake.invoked('session.intent.discard')).toEqual([]);
    expect(useSetup.getState().intents.has(at(MADE))).toBe(true);
  });

  it('is not discarded with nothing typed either, the snapshot listing it: it is this run’s, not a relaunch’s', async () => {
    await madeDuringTheSnapshot();
    await act(() => fake.reply('session.intent.list', { intents: [intent({ appSessionId: MADE })] }));
    await expect(currentTabRetention()!.ready).resolves.toBe(true);
    expect(fake.invoked('session.intent.discard')).toEqual([]);
    expect(useSetup.getState().intents.has(at(MADE))).toBe(true);
  });
});
