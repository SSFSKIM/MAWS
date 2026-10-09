import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_READ_MAX_LENGTH } from '@shared/ipc/schema/files';
import type { AllowlistRecord } from './allowlist';

// Electron is faked as in the git handlers' test: one recorded ipcMain handler per channel, one app window.
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
const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame, destroyed: false, isDestroyed: () => sender.destroyed });
const event = { sender, senderFrame: mainFrame };
const OUT = "path outside the session's directories";

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

describe('main answers files.* through the router', () => {
  let root: string;
  let dispose: () => void;
  beforeEach(() => {
    vi.resetModules();
    electron.handlers.clear();
    electron.windows.clear();
    electron.windows.set(sender, { webContents: sender });
    sender.removeAllListeners();
    sender.destroyed = false;
    root = realpathSync(mkdtempSync(join(tmpdir(), 'maws-files-register-')));
    mkdirSync(join(root, 'repo', 'src'), { recursive: true });
    writeFileSync(join(root, 'repo', 'src', 'a.ts'), 'export {};\n');
  });
  afterEach(() => {
    dispose();
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function install(openPath = vi.fn<(path: string) => Promise<string>>(async () => ''), showItemInFolder = vi.fn<(path: string) => void>()) {
    const { registerFilesHandlers } = await import('./register');
    const { installRouter } = await import('../ipc/router');
    const records = new Map<string, AllowlistRecord>([['A', { directory: join(root, 'repo'), additionalDirectories: [], worktree: null }]]);
    const emit = vi.fn();
    const files = registerFilesHandlers((id) => records.get(id) ?? null, { emit, openPath, showItemInFolder, env: {} });
    dispose = () => files.dispose();
    installRouter({ appUrl: APP_URL });
    return { files, emit, openPath, epochs: files.epochs };
  }
  const invoke = (name: string, input?: unknown) => electron.handlers.get(`maws:cmd:${name}`)!(event, input) as Promise<Result>;

  it('lists the roots, reads a file, and refuses a path outside as internal with the refusal', async () => {
    await install();
    expect(await invoke('files.list', { appSessionId: 'A' })).toMatchObject({
      ok: true,
      value: { root: null, path: '', entries: [{ name: 'repo', path: join(root, 'repo'), kind: 'dir' }], truncated: false },
    });
    expect(await invoke('files.read', { appSessionId: 'A', path: join(root, 'repo', 'src', 'a.ts') })).toMatchObject({
      ok: true,
      value: { encoding: 'utf8', content: 'export {};\n', mime: 'text/x-typescript' },
    });
    expect(await invoke('files.read', { appSessionId: 'A', path: '/etc/hosts' })).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
    expect(await invoke('files.list', { appSessionId: 'nope' })).toEqual({ ok: false, error: { code: 'internal', message: 'unknown app session: nope' } });
  });

  // E5: the hash-checked save through the router, its answers validated by the output schema.
  it('writes a file over its hash, answers conflict over a stale one, and refuses a path outside', async () => {
    await install();
    const path = join(root, 'repo', 'src', 'a.ts');
    const hashOf = (text: string) => createHash('sha256').update(text).digest('hex');
    expect(await invoke('files.read', { appSessionId: 'A', path, hash: true })).toMatchObject({ ok: true, value: { hash: hashOf('export {};\n') } });
    expect(await invoke('files.write', { appSessionId: 'A', path, content: 'export const a = 1;\n', expectedHash: hashOf('export {};\n') })).toEqual({
      ok: true,
      value: { status: 'ok', hash: hashOf('export const a = 1;\n') },
    });
    expect(readFileSync(path, 'utf8')).toBe('export const a = 1;\n');
    expect(await invoke('files.write', { appSessionId: 'A', path, content: 'stale\n', expectedHash: hashOf('export {};\n') })).toEqual({
      ok: true,
      value: { status: 'conflict', hash: hashOf('export const a = 1;\n') },
    });
    expect(await invoke('files.write', { appSessionId: 'A', path: '/etc/hosts', content: '', expectedHash: hashOf('') })).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
    expect(await invoke('files.write', { appSessionId: 'A', path, content: '' })).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('fails invalid_input for a length above the ceiling, before the service is reached', async () => {
    await install();
    const result = await invoke('files.read', { appSessionId: 'A', path: join(root, 'repo', 'src', 'a.ts'), length: FILES_READ_MAX_LENGTH + 1 });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('holds watches for the requesting window and releases them when it navigates or closes', async () => {
    const { files } = await install();
    const release = vi.spyOn(files, 'release');
    expect(await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') })).toEqual({ ok: true, value: undefined });
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo') });
    expect(files.watching().sort()).toEqual([join(root, 'repo'), join(root, 'repo', 'src')]);
    expect(sender.listenerCount('did-navigate')).toBe(1); // followed once, however many watches
    expect(await invoke('files.unwatch', { appSessionId: 'A', path: join(root, 'repo') })).toEqual({ ok: true, value: undefined });
    expect(files.watching()).toEqual([join(root, 'repo', 'src')]);
    sender.emit('did-navigate');
    expect(release).toHaveBeenCalledWith(7);
    expect(files.watching()).toEqual([]);
    sender.emit('destroyed');
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('releases a watch still in flight when its window navigates, instead of adopting it after the release', async () => {
    const { files } = await install();
    const answer = invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') }); // in flight: its first step awaits the disk
    sender.emit('did-navigate'); // the reload releases this window's holds before the watch is adopted
    expect(await answer).toEqual({ ok: true, value: undefined });
    expect(files.watching()).toEqual([]);
    // a watch issued after the navigation (the reloaded page's) is kept
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    expect(files.watching()).toEqual([join(root, 'repo', 'src')]);
  });

  it('opens an allowed file through shell.openPath and answers its error text', async () => {
    const openPath = vi.fn<(path: string) => Promise<string>>(async () => 'no application');
    await install(openPath);
    writeFileSync(join(root, 'repo', 'doc.pdf'), '%PDF-1.4\n');
    expect(await invoke('files.openExternal', { appSessionId: 'A', path: join(root, 'repo', 'doc.pdf') })).toEqual({
      ok: true,
      value: { opened: false, message: 'no application' },
    });
    expect(openPath).toHaveBeenCalledWith(join(root, 'repo', 'doc.pdf'));
    expect(await invoke('files.openExternal', { appSessionId: 'A', path: join(root, 'repo', 'src', 'a.ts') })).toEqual({
      ok: false,
      error: { code: 'internal', message: `not opened outside MAWS: ${join(root, 'repo', 'src', 'a.ts')}` },
    });
    expect(await invoke('files.openExternal', { appSessionId: 'A', path: '/etc/hosts' })).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
    expect(openPath).toHaveBeenCalledTimes(1);
  });

  // E1: Reveal in Finder for a delivered file; a refusal is an answer, not an error
  it('reveals a file in the roots through shell.showItemInFolder and answers a refusal with its message', async () => {
    const showItemInFolder = vi.fn<(path: string) => void>();
    await install(undefined, showItemInFolder);
    expect(await invoke('files.reveal', { appSessionId: 'A', path: join(root, 'repo', 'src', 'a.ts') })).toEqual({ ok: true, value: { revealed: true, message: null } });
    expect(showItemInFolder).toHaveBeenCalledWith(join(root, 'repo', 'src', 'a.ts'));
    expect(await invoke('files.reveal', { appSessionId: 'A', path: '/etc/hosts' })).toEqual({ ok: true, value: { revealed: false, message: OUT } });
    expect(showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it('forgets a closed window: its epoch is pruned on destroyed', async () => {
    const { files, epochs } = await install();
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    sender.emit('did-navigate');
    expect(epochs.has(7)).toBe(true); // a live window keeps its epoch, so a watch in flight across the reload is caught
    sender.emit('destroyed');
    expect(epochs.has(7)).toBe(false);
    expect(files.watching()).toEqual([]);
  });

  it('drops a watch still in flight when its window closes, though the pruned epoch reads as before', async () => {
    const { files, epochs } = await install();
    const answer = invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    sender.destroyed = true;
    sender.emit('destroyed');
    await answer;
    expect(epochs.has(7)).toBe(false);
    expect(files.watching()).toEqual([]);
  });
});
