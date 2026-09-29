import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsBridge } from '@shared/ipc/schema';
import type { ModelCatalogue } from '@shared/sessions/models';
import { CANNOT_HOLD_AUTO_NOTE, GATEWAY_AUTO_NOTE } from '@shared/sessions/models';
import type { StartOutcome } from '@shared/sessions/setup';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useSessions } from '../stores/sessions';
import { health, ID, intent, MESSAGE, putIntent, REPO, resetSetupStore, trustState } from '../test-support/setup-intents';
import { resetShellStores } from '../test-support/shell-stores';
import { beforeCloseUnstarted } from './setup-actions';
import { closeDialog, useDialogs } from './dialogs';
import { createUnstartedSession, retainsTab, unstartedTitle } from './connect';
import { connectSetup, useSetup } from './store';
import { resetCatalogue, useSetupIntent, type ModelInfo } from './useSetupIntent';
import type { ContentBlock } from '@shared/graph/events';
import type { Location, SetupIntent } from '@shared/sessions/intent';

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
  resetCatalogue();
});
afterEach(() => {
  cleanup();
  closeDialog();
  delete (window as { maws?: MawsBridge }).maws;
});

// C7's side of the seam, restated from its document ("Ask of C10" and the composer's public surface): M4b's one line
// `registerSetupIntentHook(useSetupIntent)` must typecheck, so the hook is assignable to C7's shape (pnpm typecheck).
type C7ModelInfo = Pick<ModelInfo, 'value' | 'displayName'> & Partial<Pick<ModelInfo, 'description' | 'supportedEffortLevels' | 'supportsAutoMode' | 'supportsFastMode'>>;
type C7SetupIntent = Pick<SetupIntent, 'location' | 'additionalDirectories' | 'model' | 'effort' | 'permissionMode' | 'message' | 'draft'>;
interface C7SetupIntentHook {
  intent: C7SetupIntent;
  options: { locations: Location[]; branches: string[]; models: C7ModelInfo[]; autoModeNote: string | null };
  patch(p: Partial<C7SetupIntent>): Promise<{ ok: true } | { ok: false; error: string }>;
  start(first: { content: string | ContentBlock[]; display: string }): Promise<{ ok: true } | { ok: false; error: string }>;
}
const assignableToC7: (appSessionId: AppSessionId) => C7SetupIntentHook | null = useSetupIntent;
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

  it('shows the built-in catalogue when the host cannot answer', async () => {
    withMain({ 'engine.models': undefined });
    putIntent(intent());
    const { result } = renderHook(() => useSetupIntent(ID));
    await act(() => fake.fail('engine.models', 'host unavailable'));
    expect(result.current!.options.models.map((m) => m.value)).toEqual(['default', 'opus', 'fable', 'sonnet', 'haiku']);
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
    expect(await act(() => result.current!.start(MESSAGE))).toEqual({ ok: false, error: 'global config unreadable: EACCES' });
    expect(fake.invoked('session.start')).toEqual([]);
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
