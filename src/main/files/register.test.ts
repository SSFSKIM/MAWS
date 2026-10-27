import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_READ_MAX_LENGTH } from '@shared/ipc/schema/files';
import type { ClientPort } from '@shared/client/port';
import type { AllowlistRecord } from './allowlist';
import { captureConsole } from '../../../test/support/console-capture';

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
const navigate = () => sender.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false }); // a reload
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

  // The client port's open and reveal, asked through the invoking page's client
  async function install(openExternal = vi.fn<ClientPort['openExternal']>(async () => ({ opened: true })), reveal = vi.fn<ClientPort['reveal']>(async () => ({ revealed: true }))) {
    const { registerFilesHandlers } = await import('./register');
    const { installRouter } = await import('../ipc/router');
    const records = new Map<string, AllowlistRecord>([['A', { directory: join(root, 'repo'), additionalDirectories: [], worktree: null }]]);
    const emit = vi.fn();
    const files = registerFilesHandlers((id) => records.get(id) ?? null, { emit, port: { openExternal, reveal }, env: {} });
    dispose = () => files.dispose();
    installRouter({ appUrl: APP_URL });
    return { files, emit, openExternal, followed: files.followed };
  }
  const invoke = (name: string, input?: unknown) => electron.handlers.get(`maws:cmd:${name}`)!(event, input) as Promise<Result>;
  // the router reports each failed command on the console (`[ipc] <name> failed`); a test expecting failures asserts them
  const ipcFailures = () => captureConsole('error', /^\[ipc\] /);

  it('lists the roots, reads a file, and refuses a path outside as internal with the refusal', async () => {
    await install();
    const failures = ipcFailures();
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
    expect(failures.lines()).toEqual(['[ipc] files.read failed', '[ipc] files.list failed']);
  });

  // E5: the hash-checked save through the router, its answers validated by the output schema.
  it('writes a file over its hash, answers conflict over a stale one, and refuses a path outside', async () => {
    await install();
    const failures = ipcFailures();
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
    expect(failures.lines()).toEqual(['[ipc] files.write failed']); // the refusal; invalid input never reaches the service
  });

  it('fails invalid_input for a length above the ceiling, before the service is reached', async () => {
    await install();
    const result = await invoke('files.read', { appSessionId: 'A', path: join(root, 'repo', 'src', 'a.ts'), length: FILES_READ_MAX_LENGTH + 1 });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
  });

  it('holds watches for the requesting client and releases them when its page navigates or closes', async () => {
    const { files } = await install();
    const release = vi.spyOn(files, 'release');
    expect(await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') })).toEqual({ ok: true, value: undefined });
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo') });
    expect(files.watching().sort()).toEqual([join(root, 'repo'), join(root, 'repo', 'src')]);
    expect(await invoke('files.unwatch', { appSessionId: 'A', path: join(root, 'repo') })).toEqual({ ok: true, value: undefined });
    expect(files.watching()).toEqual([join(root, 'repo', 'src')]);
    navigate();
    expect(release).toHaveBeenCalledWith('page:7.1');
    expect(release).toHaveBeenCalledTimes(1); // followed once, however many watches
    expect(files.watching()).toEqual([]);
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') }); // the reloaded page's
    sender.emit('destroyed');
    expect(release).toHaveBeenLastCalledWith('page:7.2');
    expect(release).toHaveBeenCalledTimes(2);
    expect(files.watching()).toEqual([]);
  });

  it('releases a watch still in flight when its window navigates, instead of adopting it after the release', async () => {
    const { files } = await install();
    const answer = invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') }); // in flight: its first step awaits the disk
    navigate(); // the reload releases this page's holds before the watch is adopted
    expect(await answer).toEqual({ ok: true, value: undefined });
    expect(files.watching()).toEqual([]);
    // a watch issued after the navigation (the reloaded page's) is kept
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    expect(files.watching()).toEqual([join(root, 'repo', 'src')]);
  });

  it('opens an allowed file through the asking client’s port and answers its reason', async () => {
    const openPath = vi.fn<ClientPort['openExternal']>(async () => ({ opened: false, reason: 'no application' }));
    await install(openPath);
    const failures = ipcFailures();
    writeFileSync(join(root, 'repo', 'doc.pdf'), '%PDF-1.4\n');
    expect(await invoke('files.openExternal', { appSessionId: 'A', path: join(root, 'repo', 'doc.pdf') })).toEqual({
      ok: true,
      value: { opened: false, message: 'no application' },
    });
    expect(openPath).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^page:7\./) }), { path: join(root, 'repo', 'doc.pdf') });
    expect(await invoke('files.openExternal', { appSessionId: 'A', path: join(root, 'repo', 'src', 'a.ts') })).toEqual({
      ok: false,
      error: { code: 'internal', message: `not opened outside MAWS: ${join(root, 'repo', 'src', 'a.ts')}` },
    });
    expect(await invoke('files.openExternal', { appSessionId: 'A', path: '/etc/hosts' })).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(failures.lines()).toEqual(['[ipc] files.openExternal failed', '[ipc] files.openExternal failed']);
  });

  // E1: Reveal in Finder for a delivered file; a refusal is an answer, not an error
  it('reveals a file in the roots through the asking client’s port and answers a refusal with its message', async () => {
    const showItemInFolder = vi.fn<ClientPort['reveal']>(async () => ({ revealed: true }));
    await install(undefined, showItemInFolder);
    expect(await invoke('files.reveal', { appSessionId: 'A', path: join(root, 'repo', 'src', 'a.ts') })).toEqual({ ok: true, value: { revealed: true, message: null } });
    expect(showItemInFolder).toHaveBeenCalledWith(expect.objectContaining({ id: expect.stringMatching(/^page:7\./) }), join(root, 'repo', 'src', 'a.ts'));
    expect(await invoke('files.reveal', { appSessionId: 'A', path: '/etc/hosts' })).toEqual({ ok: true, value: { revealed: false, message: OUT } });
    expect(showItemInFolder).toHaveBeenCalledTimes(1);
  });

  it('forgets an ended client: it is no longer followed once its page closes', async () => {
    const { files, followed } = await install();
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    expect([...followed]).toEqual(['page:7.1']);
    sender.destroyed = true;
    sender.emit('destroyed');
    expect(followed.size).toBe(0);
    expect(files.watching()).toEqual([]);
  });

  it('drops a watch still in flight when its window closes', async () => {
    const { files, followed } = await install();
    const answer = invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    sender.destroyed = true;
    sender.emit('destroyed');
    await answer;
    expect(followed.size).toBe(0);
    expect(files.watching()).toEqual([]);
  });
});
