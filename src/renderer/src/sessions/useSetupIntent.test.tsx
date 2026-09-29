import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ModelCatalogue } from '@shared/sessions/models';
import { CANNOT_HOLD_AUTO_NOTE, GATEWAY_AUTO_NOTE } from '@shared/sessions/models';
import type { StartOutcome } from '@shared/sessions/setup';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { useSessions } from '../stores/sessions';
import { health, ID, intent, MESSAGE, putIntent, REPO, resetSetupStore, trustState } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { beforeCloseUnstarted } from './setup-actions';
import { closeDialog, useDialogs } from './dialogs';
import { createUnstartedSession, retainsTab, unstartedTitle } from './connect';
import { connectSetup, useSetup } from './store';
import { useSetupIntent } from './useSetupIntent';
import type { UseSetupIntent } from '../composer/setup-intent';

const CATALOGUE: ModelCatalogue = {
  source: 'cached',
  at: '2026-09-29T10:00:00.000Z',
  models: [
    { value: 'default', displayName: 'Default (recommended)', supportsAutoMode: true },
    { value: 'haiku', displayName: 'Haiku', supportsAutoMode: false },
    { value: 'claude/astra', displayName: 'Astra', supportsAutoMode: true },
  ],
};
const WORKTREE = `${REPO}/.claude/worktrees/one`;

let fake: FakeClient;
// `auto` answers commands at once; a command given as undefined waits for the test to answer it.
function withMain(auto: Parameters<typeof fakeClient>[0] = {}) {
  const answers: Parameters<typeof fakeClient>[0] = {
    'session.trust.check': () => trustState({ trusted: true, source: 'trustKey' }),
    'git.worktree.list': () => ({
      repoRoot: REPO,
      commonDir: `${REPO}/.git`,
      worktrees: [
        { repoRoot: REPO, path: REPO, branch: 'main', head: 'a'.repeat(40), isMain: true, locked: false, prunable: false, managed: false },
        { repoRoot: REPO, path: WORKTREE, branch: 'worktree-one', head: 'b'.repeat(40), isMain: false, locked: false, prunable: false, managed: true },
      ],
    }),
    'git.branches': () => ({ current: 'main', branches: [{ name: 'feature', upstream: null, isCurrent: false }, { name: 'main', upstream: null, isCurrent: true }] }),
    'engine.models': () => CATALOGUE,
    ...auto,
  };
  fake = fakeClient(Object.fromEntries(Object.entries(answers).filter(([, answer]) => answer !== undefined)));
  window.maws = fake.client;
}

beforeEach(() => {
  resetShellStores();
  resetSetupStore();
  useNotices.setState({ notices: [] });
});
afterEach(() => {
  cleanup();
  closeDialog();
  delete (window as { maws?: MawsBridge }).maws;
});

// C7's side of the seam as landed: App.tsx's `registerSetupIntentHook(useSetupIntent)` typechecks against it (pnpm
// typecheck), and so does this.
const assignableToC7: UseSetupIntent = useSetupIntent;
void assignableToC7;

describe('setup intent hook', () => {
  it('is null for an id with a record and a status, and non-null for an intent', async () => {
    withMain();
    const { result } = renderHook(() => useSetupIntent(ID));
    expect(result.current).toBeNull();
    act(() => putIntent(intent()));
    expect(result.current?.intent.appSessionId).toBe(ID);
    act(() => useSessions.setState({ records: new Map([[ID, record(ID)]]) }));
    expect(result.current, 'a provisional record without a status is still unstarted').not.toBeNull();
    act(() => useSessions.setState({ engine: new Map([[ID, status(ID)]]) }));
    expect(result.current).toBeNull();
  });

  it('offers the project directory, every listed worktree and one new-worktree template, the current branch first', async () => {
    withMain();
    putIntent(intent());
    const { result } = renderHook(() => useSetupIntent(ID));
    await waitFor(() => expect(result.current?.options.locations).toHaveLength(3));
    const [directory, existing, template] = result.current!.options.locations;
    expect(directory).toEqual({ kind: 'directory', path: REPO });
    expect(existing).toEqual({ kind: 'existingWorktree', repoRoot: REPO, path: WORKTREE });
    expect(template).toMatchObject({ kind: 'newWorktree', repoRoot: REPO, branch: { kind: 'new', base: 'HEAD' } });
    const name = (template as { name: string }).name;
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z2-7]{4}$/);
    expect(template).toMatchObject({ branch: { name: `worktree-${name}` } });
    expect(result.current!.options.branches).toEqual(['main', 'feature']);
    expect(result.current!.options.models.map((m) => m.value)).toEqual(['default', 'haiku', 'claude/astra']);
    expect(result.current!.options.models[1]).toEqual({ value: 'haiku', displayName: 'Haiku', supportsAutoMode: false });
  });

  it('answers the running setup’s phase in words (the composer’s disabled-state reason), and null otherwise', async () => {
    withMain();
    putIntent(intent({ location: { kind: 'newWorktree', repoRoot: REPO, name: 'one', branch: { kind: 'new', name: 'worktree-one', base: 'HEAD' } }, trust: 'accepted', trustKey: REPO }));
    const { result } = renderHook(() => useSetupIntent(ID));
    expect(result.current!.phase).toBeNull();
    const phase = (p: 'worktree' | 'trusting' | 'launching' | 'ready' | 'failed', detail: string | null) =>
      act(() => useSetup.getState().applySetup({ appSessionId: ID, phase: p, detail, outcome: p === 'failed' ? { kind: 'error', message: 'no', resources: { worktree: null, record: 'none', transcript: 'none' } } : null }));
    phase('worktree', 'Creating worktree one');
    expect(result.current!.phase).toBe('Creating worktree one…');
    phase('trusting', `Trusting ${REPO}`);
    expect(result.current!.phase).toBe(`Trusting ${REPO}…`);
    phase('trusting', `Trust recorded for ${REPO} (bootstrap 0291b0f3-0e02-426c-a4f2-869e4f48ab7e)`);
    expect(result.current!.phase, 'the bootstrap’s record is the log’s, not the reason’s').toBe(`Trusting ${REPO}…`);
    phase('launching', 'Starting');
    expect(result.current!.phase).toBe('Starting…');
    phase('failed', null);
    expect(result.current!.phase).toBeNull();
  });

  it('shows the built-in catalogue when the host cannot answer', async () => {
    withMain({ 'engine.models': undefined });
    putIntent(intent());
    const { result } = renderHook(() => useSetupIntent(ID));
    await act(() => fake.fail('engine.models', 'host unavailable'));
    expect(result.current!.options.models.map((m) => m.value)).toEqual(['default', 'opus', 'fable', 'sonnet', 'haiku']);
  });

  it('reads the catalogue again at every mount, so a later tab sees what the host learned since', async () => {
    let catalogue: ModelCatalogue = { models: [{ value: 'default', displayName: 'Default' }], source: 'builtin', at: null };
    withMain({ 'engine.models': () => catalogue });
    putIntent(intent());
    const first = renderHook(() => useSetupIntent(ID));
    await waitFor(() => expect(first.result.current!.options.models.map((m) => m.value)).toEqual(['default']));
    first.unmount();
    catalogue = CATALOGUE; // a launch filled the host's cache, the relay's aliases included
    const second = renderHook(() => useSetupIntent(ID));
    await waitFor(() => expect(second.result.current!.options.models.map((m) => m.value)).toEqual(['default', 'haiku', 'claude/astra']));
    expect(fake.invoked('engine.models')).toEqual([{ refresh: false }, { refresh: false }]);
  });

  // C7 calls the hook from every composer: a started session's has no intent and reads nothing
  it('reads no catalogue for an id without an intent, and reads it once the intent arrives', async () => {
    withMain();
    const { result } = renderHook(() => useSetupIntent(ID));
    await act(async () => {});
    expect(result.current).toBeNull();
    expect(fake.invoked('engine.models'), 'a started session’s composer asks nothing').toEqual([]);
    act(() => putIntent(intent()));
    await waitFor(() => expect(result.current!.options.models.map((m) => m.value)).toEqual(['default', 'haiku', 'claude/astra']));
    expect(fake.invoked('engine.models')).toEqual([{ refresh: false }]);
  });

  it('notes a model that cannot hold auto mode, and a gateway model’s local auto lane', async () => {
    withMain();
    putIntent(intent({ model: 'haiku', permissionMode: 'auto' }));
    const { result } = renderHook(() => useSetupIntent(ID));
    await waitFor(() => expect(result.current!.options.autoModeNote).toBe(CANNOT_HOLD_AUTO_NOTE));
    act(() => putIntent(intent({ model: 'claude/astra', permissionMode: null, updatedAt: '2026-09-29T10:00:01.000Z' })));
    expect(result.current!.options.autoModeNote).toBe(GATEWAY_AUTO_NOTE);
    act(() => putIntent(intent({ model: 'claude/astra', permissionMode: 'default', updatedAt: '2026-09-29T10:00:02.000Z' })));
    expect(result.current!.options.autoModeNote).toBeNull();
  });

  it("surfaces the validator's message from patch", async () => {
    withMain({ 'session.intent.patch': undefined });
    putIntent(intent());
    const { result } = renderHook(() => useSetupIntent(ID));
    const messages = [
      'location: directory not found: /nowhere',
      "location: Worktree name cannot start with '-'",
      'location: branch exists: main',
      'additionalDirectories: duplicates the session directory',
    ];
    for (const message of messages) {
      const answer = result.current!.patch({ additionalDirectories: [REPO] });
      await act(() => fake.fail('session.intent.patch', message));
      expect(await answer).toEqual({ ok: false, error: message });
    }
    expect(fake.invoked('session.intent.patch')[0]).toEqual({ appSessionId: ID, patch: { additionalDirectories: [REPO] } });
  });

  it('start resolves ok on starting, needs_trust and relay_unreachable, and not ok on invalid, which the editor keeps', async () => {
    let outcome: StartOutcome = { status: 'starting', appSessionId: ID };
    withMain({ 'session.start': () => outcome });
    putIntent(intent());
    const { result } = renderHook(() => useSetupIntent(ID));
    await waitFor(() => expect(result.current!.options.locations.length).toBeGreaterThan(0));
    expect(await act(() => result.current!.start(MESSAGE))).toEqual({ ok: true });
    expect(fake.invoked('session.start')[0]).toEqual({ appSessionId: ID, message: MESSAGE, options: {} });
    outcome = { status: 'needs_trust', appSessionId: ID, trust: trustState() };
    expect(await act(() => result.current!.start(MESSAGE))).toEqual({ ok: true });
    expect(useSetup.getState().cards.get(ID)).toMatchObject({ kind: 'trust', message: MESSAGE });
    outcome = { status: 'relay_unreachable', appSessionId: ID, health: health() };
    expect(await act(() => result.current!.start(MESSAGE))).toEqual({ ok: true });
    expect(useSetup.getState().cards.get(ID)).toMatchObject({ kind: 'relay' });
    outcome = { status: 'invalid', appSessionId: ID, field: 'location', message: 'base not found: no-such-branch' };
    expect(await act(() => result.current!.start(MESSAGE))).toEqual({ ok: false, error: 'base not found: no-such-branch' });
    expect(useSetup.getState().cards.has(ID)).toBe(false);
  });

  it('refuses to start with the error when the trust check failed', async () => {
    withMain({ 'session.trust.check': undefined, 'session.start': () => ({ status: 'starting', appSessionId: ID }) });
    putIntent(intent());
    const { result } = renderHook(() => useSetupIntent(ID));
    await act(() => fake.fail('session.trust.check', 'global config unreadable: EACCES'));
    const refused = result.current!.start(MESSAGE); // Send checks again first
    await act(() => fake.fail('session.trust.check', 'global config unreadable: EACCES'));
    expect(await refused).toEqual({ ok: false, error: 'global config unreadable: EACCES' });
    expect(fake.invoked('session.start')).toEqual([]);
  });

  it('checks trust again at Send after a failed check, and starts once the check answers', async () => {
    withMain({ 'session.trust.check': undefined, 'session.start': () => ({ status: 'starting', appSessionId: ID }) });
    putIntent(intent());
    const { result } = renderHook(() => useSetupIntent(ID));
    await act(() => fake.fail('session.trust.check', 'global config unreadable: EACCES'));
    const started = result.current!.start(MESSAGE);
    await act(() => fake.reply('session.trust.check', trustState({ trusted: true, source: 'trustKey' })));
    expect(await started).toEqual({ ok: true });
    expect(fake.invoked('session.start')).toEqual([{ appSessionId: ID, message: MESSAGE, options: {} }]);
  });
});

describe('close guard', () => {
  it('closes a session with a record at once, and discards an empty intent silently', async () => {
    withMain({ 'session.intent.discard': () => ({ leftover: null }) });
    const other = '22222222-2222-4222-8222-222222222222' as AppSessionId;
    useSessions.setState({ records: new Map([[other, record(other)]]) });
    expect(await beforeCloseUnstarted(other)).toBe('closed');
    putIntent(intent());
    expect(await beforeCloseUnstarted(ID)).toBe('closed');
    expect(fake.invoked('session.intent.discard')).toEqual([{ appSessionId: ID }]);
    expect(useDialogs.getState().open).toBeNull();
  });

  it('refuses while a start runs', async () => {
    withMain();
    putIntent(intent());
    useSetup.getState().applySetup({ appSessionId: ID, phase: 'launching', detail: 'Starting', outcome: null });
    expect(await beforeCloseUnstarted(ID)).toBe('kept');
    expect(fake.invoked('session.intent.discard')).toEqual([]);
  });

  it('asks before discarding a draft, and keeps the tab on Cancel', async () => {
    withMain({ 'session.intent.discard': () => ({ leftover: null }) });
    putIntent(intent({ draft: { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'half a thought' }] }] }, attachments: [], updatedAt: '2026-09-29T10:00:00.000Z' } }));
    const kept = beforeCloseUnstarted(ID);
    await waitFor(() => expect(useDialogs.getState().open).toMatchObject({ kind: 'confirm', title: 'Discard this unstarted session?', body: 'Its draft will be lost.' }));
    act(() => closeDialog());
    expect(await kept).toBe('kept');
    const closed = beforeCloseUnstarted(ID);
    await waitFor(() => expect(useDialogs.getState().open?.kind).toBe('confirm'));
    act(() => (useDialogs.getState().open as { answer(yes: boolean): void }).answer(true));
    expect(await closed).toBe('closed');
    expect(fake.invoked('session.intent.discard')).toEqual([{ appSessionId: ID }]);
  });

  it("a worktree the failed attempt kept is named with a Remove worktree… that opens its cleanup (no record names it)", async () => {
    const path = `${REPO}/.claude/worktrees/accept-fail`;
    withMain({ 'session.intent.discard': () => ({ leftover: { worktree: { path, branch: 'worktree-accept-fail' } } }) });
    const location = { kind: 'newWorktree' as const, repoRoot: REPO, name: 'accept-fail', branch: { kind: 'new' as const, name: 'worktree-accept-fail', base: 'HEAD' } };
    putIntent(intent({ location, progress: { ...intent().progress, worktree: { path, branch: 'worktree-accept-fail', head: 'abc', createdHere: true } } }));
    expect(await beforeCloseUnstarted(ID)).toBe('closed');
    const [notice] = useNotices.getState().notices;
    expect(notice?.text).toBe(`Worktree ${path} was kept`);
    expect(notice?.actions.map((a) => a.label)).toEqual(['Remove worktree…']);
    act(() => notice!.actions[0]!.run());
    expect(useDialogs.getState().open).toEqual({ kind: 'cleanup', target: { repoRoot: REPO, path, branch: 'worktree-accept-fail' } });
  });
});

describe('tab retention', () => {
  it('waits for the settled intent list, retains a failed intent, and lets go once main drops it', async () => {
    withMain({ 'session.intent.list': undefined, 'session.deletions.list': () => ({ manifests: [] }) });
    useSetup.setState({ loaded: false });
    const connection = connectSetup(fake.client);
    let ready = false;
    void connection.ready.then(() => (ready = true));
    expect(fake.calls.slice(0, 2)).toEqual(['on session.intent.changed', 'on session.setup']); // subscribed first
    const failed = intent({ progress: { ...intent().progress, lastFailure: { at: '2026-09-29T10:00:00.000Z', phase: 'launching', message: 'MAWS quit before the session started', resources: { worktree: null, record: 'removed', transcript: 'none' } } } });
    await act(() => fake.reply('session.intent.list', { intents: [failed] }));
    expect(ready).toBe(true);
    expect(retainsTab(ID)).toBe(true);
    act(() => fake.event('session.intent.changed', { appSessionId: ID, intent: null }));
    expect(retainsTab(ID)).toBe(false);
    connection.disconnect();
  });

  it('an older snapshot does not bring back an intent main dropped', async () => {
    withMain({ 'session.intent.list': undefined, 'session.deletions.list': () => ({ manifests: [] }) });
    const connection = connectSetup(fake.client);
    act(() => fake.event('session.intent.changed', { appSessionId: ID, intent: null }));
    await act(() => fake.reply('session.intent.list', { intents: [intent()] }));
    expect(retainsTab(ID)).toBe(false);
    connection.disconnect();
  });
});

describe('the unstarted title and the creator', () => {
  it("titles the tab 'New session' with its project, and the creator opens with main's intent", async () => {
    withMain({ 'session.create': () => ({ appSessionId: ID, intent: intent() }) });
    expect(unstartedTitle(ID)).toBeNull();
    expect(await createUnstartedSession(null, fake.client)).toBe(ID);
    expect(fake.invoked('session.create')).toEqual([{ projectId: null, location: null }]);
    expect(unstartedTitle(ID)).toEqual({ title: 'New session', project: 'repo' });
  });
});
