import { describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { record, status } from '../../../../../test/support/builders';
import type { SetupIntentHook } from '../setup-intent';
import { MESSAGE_HELD, STARTING } from '../submit/submit-state';
import { ARRIVES_WITH_C10, intentBindings, liveBindings, workspaceDirectoriesOf } from './bindings';

const APP = 'app-1';

function bridge(answers: Record<string, unknown> = {}) {
  const invoke = vi.fn(async (name: string) => answers[name] ?? { ok: true, value: undefined });
  return { client: { invoke, on: () => () => {}, pathForFile: () => '' } as unknown as MawsBridge, invoke };
}

function hook(over: Partial<SetupIntentHook['intent']> = {}): SetupIntentHook & { patch: ReturnType<typeof vi.fn> } {
  return {
    intent: { location: { kind: 'directory', path: '/repo' }, additionalDirectories: [], model: null, effort: null, permissionMode: null, message: null, draft: null, ...over },
    options: {
      locations: [{ kind: 'directory', path: '/repo' }, { kind: 'newWorktree', repoRoot: '/repo', name: 'wt-1', branch: { kind: 'new', name: 'worktree-wt-1', base: 'HEAD' } }],
      branches: ['main', 'dev'],
      models: [{ value: 'sonnet', displayName: 'Sonnet' }, { value: 'haiku', displayName: 'Haiku', supportsAutoMode: false }],
      autoModeNote: null,
    },
    patch: vi.fn(async () => ({ ok: true as const })),
    start: vi.fn(async () => ({ ok: true as const })),
  };
}

describe('the frame binds its chips to the setup intent or to the live session', () => {
  it('writes every chip of an unstarted session through the hook’s patch', async () => {
    const h = hook({ model: 'haiku' });
    const b = intentBindings(h, { starting: false });
    expect([b.location.disabled, b.model.disabled, b.mode.disabled, b.directories.disabled]).toEqual([null, null, null, null]);
    expect(b.location.options).toHaveLength(2);
    await b.location.set(h.options.locations[1]);
    await b.model.set({ model: 'sonnet', effort: 'high' });
    await b.mode.set('plan');
    await b.directories.set(['/extra']);
    expect(h.patch.mock.calls.map(([p]) => p)).toEqual([{ location: h.options.locations[1] }, { model: 'sonnet', effort: 'high' }, { permissionMode: 'plan' }, { additionalDirectories: ['/extra'] }]);
    expect(b.mode.autoUnavailable).toBe('This model does not support auto mode'); // haiku holds no auto
    expect(b.branch.disabled).not.toBeNull(); // a directory runs on its own branch; a new worktree picks one
  });

  it('picks the branch of a new worktree from the hook’s branches', async () => {
    const worktree = { kind: 'newWorktree' as const, repoRoot: '/repo', name: 'wt-1', branch: { kind: 'new' as const, name: 'worktree-wt-1', base: 'HEAD' } };
    const h = hook({ location: worktree });
    const b = intentBindings(h, { starting: false });
    expect(b.branch).toMatchObject({ value: 'worktree-wt-1', options: ['main', 'dev'], disabled: null });
    await b.branch.set('dev');
    expect(h.patch).toHaveBeenCalledWith({ location: { ...worktree, branch: { kind: 'existing', name: 'dev' } } });
    await b.branch.set('feature/x'); // not listed: created from the worktree's base
    expect(h.patch).toHaveBeenLastCalledWith({ location: { ...worktree, branch: { kind: 'new', name: 'feature/x', base: 'HEAD' } } });
  });

  it('disables every chip with one reason while starting, or while C10 holds the first message', async () => {
    const starting = intentBindings(hook(), { starting: true });
    expect([starting.location, starting.branch, starting.model, starting.mode, starting.directories].map((c) => c.disabled)).toEqual([STARTING, STARTING, STARTING, STARTING, STARTING]);
    const held = intentBindings(hook({ message: { content: 'hi', display: 'hi' } }), { starting: false });
    expect([held.location, held.branch, held.model, held.mode, held.directories].map((c) => c.disabled)).toEqual([MESSAGE_HELD, MESSAGE_HELD, MESSAGE_HELD, MESSAGE_HELD, MESSAGE_HELD]);
    expect(await held.model.set({ model: 'sonnet', effort: null })).toEqual({ ok: false, error: MESSAGE_HELD });
  });

  it('applies a live session’s model, effort and directories through C3, and keeps location and branch read-only', async () => {
    const rulesAnswer = { ok: true, value: { state: { rules: [], workspaceDirectories: ['/a', '/held'], originalCwd: '/work/app-1', managedOnly: false } } };
    const { client, invoke } = bridge({ 'session.setModel': { ok: true, value: { ok: true, error: null, code: null } }, 'session.listPermissionRules': rulesAnswer });
    const s = { ...status(APP), cwd: '/work/app-1', model: { requested: 'sonnet', resolved: 'claude-sonnet' }, effort: 'medium' as const };
    const refresh = vi.fn();
    const b = liveBindings(s, record(APP), { models: null, directories: ['/a'], branch: 'main', branches: ['main'], refresh }, client);
    expect(b.location).toMatchObject({ value: { kind: 'directory', path: '/work/app-1' }, disabled: ARRIVES_WITH_C10 });
    expect(b.branch).toMatchObject({ value: 'main', disabled: ARRIVES_WITH_C10 });
    expect(await b.location.set({ kind: 'directory', path: '/x' })).toEqual({ ok: false, error: ARRIVES_WITH_C10 });
    expect(b.model.value).toEqual({ model: 'claude-sonnet', effort: 'medium' });
    await b.model.set({ model: 'haiku', effort: 'medium' });
    await b.model.set({ model: 'claude-sonnet', effort: 'high' });
    await b.directories.set(['/a', '/b']);
    expect(invoke.mock.calls).toEqual([
      ['session.setModel', { appSessionId: APP, model: 'haiku' }],
      ['session.setEffort', { appSessionId: APP, effort: 'high' }],
      ['session.listPermissionRules', { appSessionId: APP }], // read at the change: the engine's list, not the chip's
      ['session.applyFlagSettings', { appSessionId: APP, settings: { permissions: { additionalDirectories: ['/a', '/held', '/b'] } } }],
    ]);
    expect(refresh).toHaveBeenCalledTimes(1); // the chip re-reads the rules afterwards
    expect(b.mode.value).toBe('auto');
  });

  it('refuses a model the engine refused, and every write while no process is ready', async () => {
    const { client } = bridge({ 'session.setModel': { ok: true, value: { ok: false, error: 'unknown model', code: 'invalid' } } });
    const b = liveBindings(status(APP), record(APP), {}, client);
    expect(await b.model.set({ model: 'nope', effort: null })).toEqual({ ok: false, error: 'unknown model' });
    const exited = liveBindings(status(APP, { process: 'exited' }), record(APP), {}, client);
    expect([exited.model.disabled, exited.mode.disabled, exited.directories.disabled]).toEqual(['The session is not running', 'The session is not running', 'The session is not running']);
    expect(liveBindings(null, record(APP), {}, client).model.disabled).toBe('The session is not running');
  });

  it('reads the workspace directories the engine lists as paths', () => {
    expect(workspaceDirectoriesOf(['/a', { path: '/b' }, 7, { nope: true }])).toEqual(['/a', '/b']);
  });
});
