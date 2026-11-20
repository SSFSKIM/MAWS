import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILES_READ_MAX_LENGTH } from '@shared/ipc/schema/files';
import type { ClientPort } from '@shared/client/port';
import { endableClientRef, type EndableClientRef } from '@shared/ipc/client';
import type { CommandName } from '@shared/ipc/schema';
import { gradeOf } from '@shared/ipc/grades';
import { fakeBus, type FakeBus } from '../../../test/support/fake-bus';
import type { AllowlistRecord } from './allowlist';
import { registerFilesHandlers, type FilesHandlerDeps } from './register';
import { claimable } from '../machine-ops';

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
      const named = vi.fn(async (_appSessionId: string, _path: string, signal?: AbortSignal) => (signals.push(signal), 'counted' as const));
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
      const named = vi.fn((_appSessionId: string, _path: string, signal?: AbortSignal) => new Promise<false>((resolve) => signal!.addEventListener('abort', () => resolve(false))));
      await install(undefined, undefined, { named });
      const answer = invoke('files.read', { appSessionId: 'A', path: join(outside(), 'notes.txt'), named: true });
      await vi.waitFor(() => expect(named).toHaveBeenCalledOnce());
      close();
      expect(await answer).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
    });

    it('never asks for a request without the key, nor for one from another machine', async () => {
      const named = vi.fn(async () => 'counted' as const);
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

  // UX wave U6e (docs/doperpowers/plans/2026-11-14-ux-wave-U6e-outside-file-editable.md, §B, Wiring): the save outside the
  // folders asks by name with its client's signal; the grant is main's alone; neither reaches the evidence for a caller of
  // another machine; a read and an open hand `agent` on
  describe('the outside save and the grant (UX wave U6e)', () => {
    const outside = () => join(root, 'outside');
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    beforeEach(() => {
      mkdirSync(outside());
      writeFileSync(join(outside(), 'notes.txt'), 'outside notes\n');
    });

    it('saves a named file through files.writeOutside, asking with the client’s signal, and answers its hash', async () => {
      const signals: (AbortSignal | undefined)[] = [];
      const named = vi.fn(async (_appSessionId: string, _path: string, signal?: AbortSignal) => (signals.push(signal), 'counted' as const));
      await install(undefined, undefined, { named });
      const path = join(outside(), 'notes.txt');
      const written = await invoke('files.writeOutside', { appSessionId: 'A', path, content: 'saved\n', expectedHash: sha('outside notes\n'), real: path });
      expect(written).toEqual({ ok: true, value: { status: 'ok', hash: sha('saved\n') } });
      expect(readFileSync(path, 'utf8')).toBe('saved\n');
      expect(signals).toHaveLength(1);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      close();
      expect(signals[0]!.aborted).toBe(true);
    });

    it('refuses files.writeOutside and files.grant from another machine, asking nothing, and files.grant from a page', async () => {
      const named = vi.fn(async () => 'counted' as const);
      const has = vi.fn(() => true);
      const sent = vi.fn(async () => true);
      await install(undefined, undefined, { named, grants: { add: vi.fn(), has }, sent });
      const remote = { client: page, remote: true as const };
      const path = join(outside(), 'notes.txt');
      expect(await bus.invoke('files.writeOutside', { appSessionId: 'A', path, content: 'x', expectedHash: sha('outside notes\n'), real: path }, remote)).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
      expect(await invoke('files.grant', { appSessionId: 'A', path })).toMatchObject({ ok: false, error: { code: 'forbidden_sender' } });
      expect(await bus.main('files.grant', { appSessionId: 'A', path }, remote)).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
      expect([named, has, sent].map((spy) => spy.mock.calls.length)).toEqual([0, 0, 0]);
      expect(readFileSync(path, 'utf8')).toBe('outside notes\n');
    });

    it('grants a file as main asks it, and the grant admits the file to a read', async () => {
      const added: [string, string][] = [];
      const grants = { add: (appSessionId: string, real: string) => void added.push([appSessionId, real]), has: (appSessionId: string, real: string) => added.some(([id, path]) => id === appSessionId && path === real) };
      await install(undefined, undefined, { grants });
      const path = join(outside(), 'notes.txt');
      expect(await bus.main('files.grant', { appSessionId: 'A', path })).toEqual({ ok: true, value: { status: 'granted', path } });
      expect(added).toEqual([['A', path]]);
      expect(await invoke('files.read', { appSessionId: 'A', path, named: true })).toMatchObject({ ok: true, value: { content: 'outside notes\n', named: true, outside: { real: path, writable: true } } });
      expect(await invoke('files.read', { appSessionId: 'A', path, named: true, agent: true })).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
    });
  });

  // UX wave U6b-4c (docs/doperpowers/plans/2026-11-18-ux-wave-U6b-4c-markdown-links.md, R1, X1.2): the follow of a link
  // is this machine's own client's, waiting as long as that client lives; another machine's request, claimed or not, is
  // the service's refusal and records nothing
  describe('the follow of a link (UX wave U6b-4c)', () => {
    const outside = () => join(root, 'outside');
    beforeEach(() => {
      mkdirSync(outside());
      writeFileSync(join(outside(), 'notes.txt'), 'outside notes\n');
      writeFileSync(join(root, 'repo', 'guide.md'), `See [the notes](${join(outside(), 'notes.txt')}).\n`);
    });

    it('follows a link for this machine’s page, its search ending with its client, and refuses another machine’s request, claimed or not, recording nothing', async () => {
      const added: unknown[][] = [];
      const signals: (AbortSignal | undefined)[] = [];
      const links = { add: (...args: unknown[]) => void added.push(args.slice(0, 3)), get: () => null };
      // the first search answers at once; the second waits until what it was given to wait with ends
      const agentNames = vi.fn((_appSessionId: string, _agent: { id: string; engineSessionId: string }, _path: string, signal?: AbortSignal, located?: () => void) => {
        signals.push(signal);
        located?.();
        return signals.length === 1 ? Promise.resolve('counted' as const) : new Promise<false>((resolve) => signal?.addEventListener('abort', () => resolve(false)));
      });
      await install(undefined, undefined, { links, agentNames, log: () => {} });
      const path = join(outside(), 'notes.txt');
      const byFile = { appSessionId: 'A', path, from: { file: join(root, 'repo', 'guide.md') } };
      const remote = { client: page, remote: true as const };
      const claimed = { ...remote, op: { opId: 'op-1', opCreated: '2026-11-18T09:00:00.000Z', member: 'member-of-the-suite', device: 'device-of-the-suite', fingerprint: 'a'.repeat(64) } };
      expect(await bus.invoke('files.follow', byFile, remote)).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
      expect(await bus.invoke('files.follow', byFile, claimed)).toEqual({ ok: false, error: { code: 'internal', message: OUT } });
      expect(added).toEqual([]);
      expect(await invoke('files.follow', byFile)).toEqual({ ok: true, value: { status: 'linked' } });
      expect(added).toEqual([['A', path, { file: join(root, 'repo', 'guide.md') }]]);
      const byAgent = { appSessionId: 'A', path, from: { agent: 'a1b2c3', engineSessionId: 'engine-session-1' } };
      expect(await invoke('files.follow', byAgent)).toEqual({ ok: true, value: { status: 'linked' } });
      void invoke('files.follow', byAgent);
      await vi.waitFor(() => expect(signals).toHaveLength(2));
      expect(signals[1]).toBeInstanceOf(AbortSignal);
      expect(signals[1]!.aborted).toBe(false);
      close();
      expect(signals[1]!.aborted, 'the client ended: the search’s wait ends with it').toBe(true);
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

// UX wave U6f (docs/doperpowers/plans/2026-11-15-ux-wave-U6f-outside-file-another-machine.md, condition (a)): the four
// acts on a file outside a session's folders take the terminal's grade by reference, so a change of `pty.spawn`'s moves
// them, and each is an act `machine.op` claims
describe('the four outside acts', () => {
  const OUTSIDE = ['files.readOutside', 'files.listOutside', 'files.chooseOutside', 'files.writeOutside'];

  it('are graded by the value pty.spawn’s declaration holds, and claimed by machine.op', () => {
    for (const name of OUTSIDE) {
      expect(gradeOf(name), name).toBe(gradeOf('pty.spawn'));
      expect(claimable(name), name).toBe(true);
    }
  });
});
