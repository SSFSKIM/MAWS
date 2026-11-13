import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_READ_MAX_LENGTH } from '@shared/ipc/schema/files';
import type { ClientPort } from '@shared/client/port';
import { endableClientRef, type EndableClientRef } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import type { AllowlistRecord } from './allowlist';
import { registerFilesHandlers, type FilesHandlerDeps } from './register';

// The asking page, as main's router hands a handler its ClientRef (src/main/ipc/clients.ts): a reload ends this
// document's ref and the page asks with the next generation's; a close ends it.
let generation = 0;
let page: EndableClientRef;
const navigate = () => {
  page.end();
  page = endableClientRef(`page:7.${++generation}`);
};
const close = () => page.end();
const OUT = "path outside the session's directories";

type Result = { ok: boolean; value?: unknown; error?: { code: string; message: string } };

describe('main answers files.* on the services bus', () => {
  let root: string;
  let dispose: () => void;
  let bus: FakeBus;
  beforeEach(() => {
    generation = 1;
    page = endableClientRef('page:7.1');
    bus = fakeBus();
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
  async function install(openExternal = vi.fn<ClientPort['openExternal']>(async () => ({ opened: true })), reveal = vi.fn<ClientPort['reveal']>(async () => ({ revealed: true })), extra: Partial<FilesHandlerDeps> = {}) {
    const records = new Map<string, AllowlistRecord>([['A', { directory: join(root, 'repo'), additionalDirectories: [], worktree: null }]]);
    const emit = vi.fn();
    const files = registerFilesHandlers((id) => records.get(id) ?? null, { bus, emit, port: { openExternal, reveal }, env: {}, ...extra });
    dispose = () => files.dispose();
    return { files, emit, openExternal, followed: files.followed };
  }
  const invoke = (name: CommandName, input?: unknown) => bus.invoke(name, input, page) as Promise<Result>;

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

  // 2026-11-06 (the home-root rule): for a request from another machine (the endpoint seam's `remote`), a root that is the
  // machine's home or above it is no root, so a chat in the home reads nothing there remotely; this machine's own client
  // reads every root as before, and a project root beside the home keeps serving a remote reader.
  it('reaches nothing remotely through a root that is the machine’s home or above it, and keeps a project root beside it', async () => {
    const home = join(root, 'home');
    mkdirSync(join(home, 'proj'), { recursive: true });
    writeFileSync(join(home, 'notes.txt'), 'private\n');
    writeFileSync(join(home, 'proj', 'a.ts'), 'export {};\n');
    const records = new Map<string, AllowlistRecord>([
      ['H', { directory: home, additionalDirectories: [], worktree: null }],
      ['R', { directory: '/', additionalDirectories: [], worktree: null }],
      ['P', { directory: join(home, 'proj'), additionalDirectories: [home], worktree: null }],
    ]);
    const files = registerFilesHandlers((id) => records.get(id) ?? null, { bus, emit: vi.fn(), port: { openExternal: vi.fn(), reveal: vi.fn() }, env: {}, homes: () => [home] });
    dispose = () => files.dispose();
    const remote = { client: page, remote: true as const };
    const read = (appSessionId: string, path: string, asked: typeof remote | EndableClientRef = remote) => bus.invoke('files.read', { appSessionId, path }, asked) as Promise<Result>;
    const refused = { ok: false, error: { code: 'internal', message: OUT } };
    expect(await read('H', join(home, 'notes.txt'))).toEqual(refused);
    expect(await read('R', join(home, 'notes.txt'))).toEqual(refused);
    expect(await bus.invoke('files.list', { appSessionId: 'H' }, remote)).toEqual(refused);
    expect(await bus.invoke('files.list', { appSessionId: 'H', path: home }, remote)).toEqual(refused);
    expect(await bus.invoke('files.watch', { appSessionId: 'H', path: home }, remote)).toEqual(refused);
    expect(await bus.invoke('files.write', { appSessionId: 'H', path: join(home, 'notes.txt'), content: 'x', expectedHash: createHash('sha256').update('private\n').digest('hex') }, remote)).toEqual(refused);
    // the project root keeps serving; the home beside it reaches nothing more
    expect(await read('P', join(home, 'proj', 'a.ts'))).toMatchObject({ ok: true, value: { content: 'export {};\n' } });
    expect(await read('P', join(home, 'notes.txt'))).toEqual(refused);
    expect(await bus.invoke('files.list', { appSessionId: 'P' }, remote)).toMatchObject({ ok: true, value: { entries: [{ path: join(home, 'proj') }] } });
    // this machine's own client: every root, the home included
    expect(await read('H', join(home, 'notes.txt'), page)).toMatchObject({ ok: true, value: { content: 'private\n' } });
    expect(await read('P', join(home, 'notes.txt'), page)).toMatchObject({ ok: true, value: { content: 'private\n' } });
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
    close();
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

  // UX wave U6c (docs/doperpowers/plans/2026-11-12-ux-wave-U6c-linked-file.md, M2 decision 4; Interfaces §C): a read or an
  // open outside the folders that asks by name waits as its client does, and a request from another machine never asks
  describe('a file the transcript names', () => {
    const outside = () => join(root, 'outside');
    beforeEach(() => {
      mkdirSync(outside());
      writeFileSync(join(outside(), 'notes.txt'), 'outside notes\n');
      writeFileSync(join(outside(), 'doc.pdf'), '%PDF-1.4\n');
    });

    it('asks with a signal of the asking client that ends when the client does, one per client', async () => {
      const signals: (AbortSignal | undefined)[] = [];
      const named = vi.fn(async (_appSessionId: string, _path: string, signal?: AbortSignal) => (signals.push(signal), true));
      const openExternal = vi.fn<ClientPort['openExternal']>(async () => ({ opened: true }));
      await install(openExternal, undefined, { named });
      const path = join(outside(), 'notes.txt');
      expect(await invoke('files.read', { appSessionId: 'A', path, named: true })).toEqual({
        ok: true,
        value: expect.objectContaining({ content: 'outside notes\n', named: true }),
      });
      expect(await invoke('files.openExternal', { appSessionId: 'A', path: join(outside(), 'doc.pdf'), named: true })).toEqual({ ok: true, value: { opened: true, message: null } });
      expect(openExternal).toHaveBeenCalledWith(expect.objectContaining({ id: 'page:7.1' }), { path: join(outside(), 'doc.pdf') });
      expect(named.mock.calls.map(([appSessionId, asked]) => [appSessionId, asked])).toEqual([['A', path], ['A', join(outside(), 'doc.pdf')]]);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(signals[1]).toBe(signals[0]);
      expect(signals[0]!.aborted).toBe(false);
      navigate();
      expect(signals[0]!.aborted).toBe(true);
      await invoke('files.read', { appSessionId: 'A', path, named: true }); // the reloaded page's
      expect(signals[2]).not.toBe(signals[0]);
      expect(signals[2]!.aborted).toBe(false);
    });

    it('answers the refusal to a named read whose client ends while it waits', async () => {
      const named = vi.fn((_appSessionId: string, _path: string, signal?: AbortSignal) => new Promise<boolean>((resolve) => signal!.addEventListener('abort', () => resolve(false))));
      await install(undefined, undefined, { named });
      const answer = invoke('files.read', { appSessionId: 'A', path: join(outside(), 'notes.txt'), named: true });
      await vi.waitFor(() => expect(named).toHaveBeenCalledOnce());
      close();
      expect(await answer).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
    });

    it('never asks for a request without the key, nor for one from another machine', async () => {
      const named = vi.fn(async () => true);
      const openExternal = vi.fn<ClientPort['openExternal']>(async () => ({ opened: true }));
      await install(openExternal, undefined, { named });
      const remote = { client: page, remote: true as const };
      const refused = { ok: false, error: { code: 'internal', message: OUT } };
      expect(await invoke('files.read', { appSessionId: 'A', path: join(outside(), 'notes.txt') })).toEqual(refused);
      expect(await invoke('files.openExternal', { appSessionId: 'A', path: join(outside(), 'doc.pdf') })).toEqual(refused);
      expect(await bus.invoke('files.read', { appSessionId: 'A', path: join(outside(), 'notes.txt'), named: true }, remote)).toEqual(refused);
      expect(await bus.invoke('files.openExternal', { appSessionId: 'A', path: join(outside(), 'doc.pdf'), named: true }, remote)).toEqual(refused);
      expect(named).not.toHaveBeenCalled();
      expect(openExternal).not.toHaveBeenCalled();
    });
  });

  it('forgets an ended client: it is no longer followed once its page closes', async () => {
    const { files, followed } = await install();
    await invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    expect([...followed]).toEqual(['page:7.1']);
    close();
    expect(followed.size).toBe(0);
    expect(files.watching()).toEqual([]);
  });

  it('drops a watch still in flight when its window closes', async () => {
    const { files, followed } = await install();
    const answer = invoke('files.watch', { appSessionId: 'A', path: join(root, 'repo', 'src') });
    close();
    await answer;
    expect(followed.size).toBe(0);
    expect(files.watching()).toEqual([]);
  });
});
