import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHolderHost } from '../../../test/support/holder-host';
import { ScratchRepo } from '../../../test/support/scratch-repo';
import type { ExecFileFn } from './runner';

// Electron is faked as in the router's own test: one recorded ipcMain handler per channel, one app window.
const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  windows: new Map<object, { webContents: { mainFrame: object } }>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => void electron.handlers.set(channel, handler),
  },
  BrowserWindow: { fromWebContents: (webContents: object) => electron.windows.get(webContents) ?? null },
}));

const APP_URL = 'http://localhost:5173/';
const mainFrame = { url: APP_URL, parent: null };
const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame });
const event = { sender, senderFrame: mainFrame };

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

// The M2 check of the execution document's Concrete Steps, through main's router as the renderer's
// `window.maws.invoke` reaches it: add, status, remove, deleteBranch over a scratch repository.
describe('main answers git.worktree.* through the router', () => {
  let repo: ScratchRepo;
  beforeEach(async () => {
    vi.resetModules();
    electron.handlers.clear();
    electron.windows.clear();
    electron.windows.set(sender, { webContents: sender });
    repo = await ScratchRepo.create({ sentinels: false });
  });
  afterEach(() => {
    repo.dispose();
    vi.restoreAllMocks();
  });

  async function install(options: { execFile?: ExecFileFn } = {}) {
    const { WorktreeService, registerWorktreeHandlers } = await import('./worktrees');
    const { installRouter } = await import('../ipc/router');
    const { createGitRunner } = await import('./runner'); // the same module instance as the service's, for its error classes
    const host = new FakeHolderHost();
    registerWorktreeHandlers(new WorktreeService({ git: createGitRunner({ env: repo.serviceEnv(), ...options }), holders: { dispatch: host.dispatch, sessions: { list: () => [] } } }));
    installRouter({ appUrl: APP_URL });
  }
  const invoke = (name: string, input?: unknown) => electron.handlers.get(`maws:cmd:${name}`)!(event, input) as Promise<Result>;

  it('adds, inspects, removes and deletes the branch of a worktree, as the DevTools check does', async () => {
    await install();
    const added = await invoke('git.worktree.add', { repoRoot: repo.root, name: 'm2', branch: { kind: 'new', name: 'worktree-m2', base: 'HEAD' } });
    expect(added).toMatchObject({ ok: true, value: { branch: 'worktree-m2', managed: true } });
    const w = added.value as { path: string; branch: string; head: string };
    expect(await repo.worktreePaths()).toContain(w.path);
    expect(await invoke('git.worktree.status', { repoRoot: repo.root, path: w.path })).toMatchObject({ ok: true, value: { state: 'clean' } });
    expect(await invoke('git.worktree.remove', { repoRoot: repo.root, path: w.path, expect: { branch: w.branch, head: w.head }, discard: false })).toEqual({
      ok: true,
      value: { removed: true, prunedOnly: false },
    });
    expect(await repo.worktreePaths()).not.toContain(w.path);
    expect(existsSync(w.path)).toBe(false);
    expect(await invoke('git.worktree.deleteBranch', { repoRoot: repo.root, branch: 'worktree-m2', expect: { head: w.head }, acknowledgeUnmerged: false })).toEqual({
      ok: true,
      value: { deleted: true, wasMerged: true },
    });
    expect(await repo.hasBranch('worktree-m2')).toBe(false);
  });

  it('answers a refusal decided before acting as internal with its named message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // the router logs a handler's throw
    await install();
    expect(await invoke('git.worktree.add', { repoRoot: repo.root, name: 'x', branch: { kind: 'new', name: 'worktree-x', base: 'no-such' } })).toEqual({
      ok: false,
      error: { code: 'internal', message: 'base not found: no-such' },
    });
  });

  it('answers timeout when git is killed at its deadline', async () => {
    const hung: ExecFileFn = (_file, _args, _options, callback) => {
      queueMicrotask(() => callback(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' as const, code: null }), '', ''));
    };
    await install({ execFile: hung });
    expect(await invoke('git.worktree.list', { repoRoot: repo.root })).toEqual({
      ok: false,
      error: { code: 'timeout', message: `git rev-parse timed out after 10 s in ${repo.root}` },
    });
  });
});
