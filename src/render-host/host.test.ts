// P5 O5 M3 (docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M3's Proves): the render host's life against the fake
// front over a real machine.sock, its Electron side and the render library stood in: it refuses to start with no profile,
// no daemon directory or no machine.sock and exits with the reason; its userData is the daemon's render-host directory,
// cleared at each start, set before `ready`; it says ready only once composed; it answers each render.request once, the
// requests handed to the library in arrival order, a library export's refusal with its IPC error; it exits 0 on
// render.exit after the work in flight and at once on the connection's end.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostCommandError } from '@shared/host/runtime';
import { ipcError } from '@shared/ipc/errors';
import type { MawsArtifactCapturedResult } from '@shared/ipc/schema/maws';
import { BROWSER_ENGINE_CAPABILITY, RENDER_CLIENT_CAPABILITY } from '@shared/host/socket-protocol';
import type { BrowserEngineRequest } from '@shared/ipc/schema/browser-engine';
import { startFakeFront, type FakeFront, type FakeFrontClient } from '../../test/support/fake-front';
import { EXIT_NO_SANDBOX, EXIT_UNREACHABLE, EXIT_USAGE, renderHostProfile, sandboxRefusal, startRenderHost, type RenderHostDeps, type RenderLibrary } from './host';

const ARTIFACT = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const capture = (requestId: string) => ({ appSessionId: 'app-1', requestId, artifactId: ARTIFACT, revision: 2, width: 640, height: 480 });
const PNG: MawsArtifactCapturedResult = { ok: true, png: 'iVBORw0KGgo=', width: 640, height: 480, consoleErrors: [] };

const cleanups: (() => unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function scratch(): string {
  const profile = mkdtempSync(join(tmpdir(), 'mrh-'));
  cleanups.push(() => rmSync(profile, { recursive: true, force: true }));
  return profile;
}

// A deferred answer per request id, so a test decides when each piece of work ends
function heldLibrary() {
  const started: string[] = [];
  const pending = new Map<string, (value: unknown) => void>();
  const failing = new Map<string, (error: unknown) => void>();
  const hold = <T>(id: string) =>
    new Promise<T>((resolve, reject) => {
      started.push(id);
      pending.set(id, resolve as (value: unknown) => void);
      failing.set(id, reject);
    });
  const options: unknown[] = []; // P5 O5 M4: what each export was handed beside its request
  const library: RenderLibrary = {
    capture: (request) => hold(request.requestId),
    export: (request, given) => (options.push(given), hold(request.requestId)),
    exportForLibrary: (input, given) => (options.push(given), hold(`library:${input.format}`)),
  };
  return { library, started, options, finish: (id: string, value: unknown) => pending.get(id)!(value), fail: (id: string, error: unknown) => failing.get(id)!(error) };
}

function host(profile: string, library: RenderLibrary, argv: readonly string[] = ['electron', 'out/main/index.js', '--render-host', profile]) {
  const steps: string[] = [];
  const lines: string[] = [];
  const generation: { read: (() => number) | null } = { read: null }; // P5 O5 M4: the composed library's hostGeneration
  let exited!: (code: number) => void;
  const exit = new Promise<number>((resolve) => (exited = resolve));
  const deps: RenderHostDeps = {
    argv,
    build: () => 'render-test',
    userData: (dir) => void steps.push(`userData ${dir}`),
    ready: async () => void steps.push('ready'),
    sessions: (paths) => void steps.push(`sessions ${paths.artifactsSocket}`),
    compose: (_call, _profile, hostGeneration) => (steps.push('compose'), (generation.read = hostGeneration), library),
    log: (line) => void lines.push(line),
    exit: (code) => exited(code),
  };
  return { deps, steps, lines, exit, generation };
}

async function served(handlers: Parameters<typeof startFakeFront>[1] = {}) {
  const answers: { id: string; answer: unknown }[] = [];
  const front: FakeFront = await startFakeFront(scratch(), {
    'render.answer': (input) => void answers.push(input as { id: string; answer: unknown }),
    ...handlers,
  });
  cleanups.push(() => front.close());
  return { front, answers };
}

describe('the render host (src/render-host/host.ts)', () => {
  it('reads its profile from --render-host <profile>, and none from a bare or flag-shaped value', () => {
    expect(renderHostProfile(['electron', 'index.js', '--render-host', '/p'])).toBe('/p');
    expect(renderHostProfile(['electron', 'index.js', '--render-host'])).toBeNull();
    expect(renderHostProfile(['electron', 'index.js', '--render-host', '--inspect=0'])).toBeNull();
    expect(renderHostProfile(['electron', 'index.js'])).toBeNull();
  });

  it('refuses to start with no profile, no daemon directory or no machine.sock, and exits with the reason', async () => {
    const none = host('', heldLibrary().library, ['electron', 'index.js', '--render-host']);
    await startRenderHost(none.deps);
    expect(await none.exit).toBe(EXIT_USAGE);
    expect(none.lines).toEqual(['[render-host] cannot start: --render-host names no profile directory']);

    const bare = scratch();
    const undirected = host(bare, heldLibrary().library);
    await startRenderHost(undirected.deps);
    expect(await undirected.exit).toBe(EXIT_UNREACHABLE);
    expect(undirected.lines[0]).toMatch(/^\[render-host\] cannot start: no mawsd serves /);
    expect(existsSync(join(bare, 'mawsd')), 'nothing written for a profile no mawsd serves').toBe(false);

    mkdirSync(join(bare, 'mawsd'), { mode: 0o700 });
    writeFileSync(join(bare, 'mawsd', 'mawsd.token'), 'x', { mode: 0o600 });
    const socketless = host(bare, heldLibrary().library);
    await startRenderHost(socketless.deps);
    expect(await socketless.exit).toBe(EXIT_UNREACHABLE);
    expect(socketless.lines[0]).toMatch(/^\[render-host\] cannot start: no mawsd has served this profile, or it has exited \(.*machine\.sock is missing\)$/);
    expect(socketless.steps, 'Electron never reached ready').not.toContain('ready');
  });

  // P5 O5 M6 (Interfaces §E; owner question Q2): on Linux the render host never runs without Chromium's sandbox; a start
  // with it turned off is refused first, before anything is read or written, with exit 3 and the reason
  it('refuses to start without Chromium’s sandbox on Linux, exit 3 with the reason, before anything else', async () => {
    const profile = scratch();
    const off = host(profile, heldLibrary().library, ['electron', '--no-sandbox', 'out/main/index.js', '--render-host', profile]);
    off.deps.sandbox = () => sandboxRefusal({ platform: 'linux', argv: off.deps.argv, hasSwitch: () => false });
    await startRenderHost(off.deps);
    expect(await off.exit).toBe(EXIT_NO_SANDBOX);
    expect(off.lines).toEqual(['[render-host] cannot start: --no-sandbox was passed, and the render host never runs without Chromium’s sandbox']);
    expect(off.steps).toEqual([]);
    expect(existsSync(join(profile, 'mawsd')), 'nothing written').toBe(false);
  });

  it('reads the sandbox off from the argument or the switch, on Linux alone', () => {
    expect(sandboxRefusal({ platform: 'linux', argv: ['electron', 'index.js', '--render-host', '/p'], hasSwitch: () => false })).toBeNull();
    expect(sandboxRefusal({ platform: 'linux', argv: ['electron', 'index.js'], hasSwitch: (name) => name === 'no-sandbox' })).toMatch(/^--no-sandbox was passed/);
    expect(sandboxRefusal({ platform: 'darwin', argv: ['MAWS', '--no-sandbox'], hasSwitch: () => true }), 'Linux’s check alone (Interfaces §E)').toBeNull();
  });

  it('clears and sets its own userData before ready, says hello with render.client, and says ready only once composed', async () => {
    const { front } = await served();
    const stale = join(front.paths.dir, 'render-host', 'Cache');
    mkdirSync(stale, { recursive: true });
    const started = host(front.profile, heldLibrary().library);
    await startRenderHost(started.deps);
    const seen = await front.client();
    await seen.ready();
    expect(seen.capabilities).toEqual([RENDER_CLIENT_CAPABILITY, BROWSER_ENGINE_CAPABILITY]); // P5 O17 M4: a tab engine too
    expect(started.steps).toEqual([`userData ${join(front.paths.dir, 'render-host')}`, 'ready', `sessions ${front.paths.artifactsSocket}`, 'compose']);
    expect(readdirSync(join(front.paths.dir, 'render-host')), 'cleared at each start').toEqual([]);
  });

  it('answers each render.request once, handed to the library in arrival order, a library refusal with its IPC error', async () => {
    const { front, answers } = await served();
    const work = heldLibrary();
    await startRenderHost(host(front.profile, work.library).deps);
    const seen: FakeFrontClient = await front.client();
    await seen.ready();
    seen.send('render.request', { id: 'a', kind: 'capture', request: capture('cap-1') });
    seen.send('render.request', { id: 'b', kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'docx' } });
    seen.send('render.request', { id: 'c', kind: 'capture', request: capture('cap-2') });
    await expect.poll(() => work.started).toEqual(['cap-1', 'library:docx', 'cap-2']);
    work.finish('cap-2', PNG);
    work.fail('library:docx', new HostCommandError(ipcError('invalid_input', 'MAWS cannot export a html artifact as docx yet', { reason: 'exportUnavailable', data: { kind: 'html', format: 'docx' } })));
    work.finish('cap-1', { ok: false, error: 'the capture failed: gone' });
    await expect.poll(() => answers.length).toBe(3);
    expect(answers).toEqual([
      { id: 'c', answer: PNG },
      { id: 'b', answer: { ok: false, error: 'MAWS cannot export a html artifact as docx yet', ipcError: { code: 'invalid_input', message: 'MAWS cannot export a html artifact as docx yet', issues: { reason: 'exportUnavailable', data: { kind: 'html', format: 'docx' } } } } },
      { id: 'a', answer: { ok: false, error: 'the capture failed: gone' } },
    ]);
    seen.send('render.request', { id: 'a', kind: 'capture', request: capture('cap-3') }); // an id answered may come again
    await expect.poll(() => work.started).toContain('cap-3');
    expect(answers).toHaveLength(3);
    work.finish('cap-3', PNG);
    await expect.poll(() => answers.length).toBe(4);
  });

  it('exits 0 on render.exit once the work in flight is answered, and answers a request after it that it is ending', async () => {
    const { front, answers } = await served();
    const work = heldLibrary();
    const started = host(front.profile, work.library);
    await startRenderHost(started.deps);
    const seen = await front.client();
    await seen.ready();
    seen.send('render.request', { id: 'a', kind: 'capture', request: capture('cap-1') });
    await expect.poll(() => work.started).toEqual(['cap-1']);
    seen.send('render.exit', {});
    seen.send('render.request', { id: 'b', kind: 'capture', request: capture('cap-2') });
    await expect.poll(() => answers).toEqual([{ id: 'b', answer: { ok: false, error: 'the render host is ending' } }]);
    let code: number | null = null;
    void started.exit.then((value) => (code = value));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(code, 'not before the work in flight is answered').toBeNull();
    work.finish('cap-1', PNG);
    expect(await started.exit).toBe(0);
    expect(answers.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(work.started).toEqual(['cap-1']);
  });

  it('exits 0 at once when the connection ends, its work in flight unanswerable', async () => {
    const { front } = await served();
    const work = heldLibrary();
    const started = host(front.profile, work.library);
    await startRenderHost(started.deps);
    const seen = await front.client();
    await seen.ready();
    seen.send('render.request', { id: 'a', kind: 'capture', request: capture('cap-1') });
    await expect.poll(() => work.started).toEqual(['cap-1']);
    front.drop();
    expect(await started.exit).toBe(0);
    expect(started.lines).toContain('[render-host] mawsd closed the connection: exiting');
  });

  // P5 O5 M4 (M4's "Inputs from M3"): the Word comment authors `mawsd` sends with an export reach the library beside the
  // request; the engine host's link generation `mawsd` posts is the library's `hostGeneration`
  it('hands an export the authors its request carries, and reads the engine host’s generation from render.hostGeneration', async () => {
    const { front, answers } = await served();
    const work = heldLibrary();
    const started = host(front.profile, work.library);
    await startRenderHost(started.deps);
    const seen = await front.client();
    await seen.ready();
    expect(started.generation.read?.()).toBe(0);
    const authors = { human: 'Kim Min', sessions: { 'app-1': 'Review agent' } };
    const exported = { appSessionId: 'app-1', requestId: 'exp-1', artifactId: ARTIFACT, kind: 'document', format: 'docx', revision: 2, path: '/p/artifacts/x/exports/2.docx' };
    seen.send('render.request', { id: 'a', kind: 'export', request: exported, authors });
    seen.send('render.request', { id: 'b', kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'docx', dialect: 'notion' }, authors });
    seen.send('render.request', { id: 'c', kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'pdf' } });
    await expect.poll(() => work.started).toEqual(['exp-1', 'library:docx', 'library:pdf']);
    expect(work.options).toEqual([{ authors }, { authors }, {}]);
    seen.send('render.hostGeneration', { generation: 3 });
    await expect.poll(() => started.generation.read?.()).toBe(3);
    expect(answers).toEqual([]);
  });

  // P5 O17 M4 (docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4, Interfaces §F): `browserEngine.request` goes to the
  // tab engine, composed at the first request over this link (its commands and its descriptor) and never for an
  // artifact's work; one after render.exit, and any to a host that composes no engine, are answered as failures with
  // browserEngine.answer
  it('hands browserEngine.request to the tab engine, composed at the first one over this link, and refuses what it cannot serve', async () => {
    const browserAnswers: unknown[] = [];
    const { front } = await served({ 'browserEngine.answer': (input) => void browserAnswers.push(input) });
    const started = host(front.profile, heldLibrary().library);
    const requests: BrowserEngineRequest[] = [];
    const composed: { fd: number | null; paths: string }[] = [];
    started.deps.browser = (link, paths) => {
      composed.push({ fd: link.socketFd(), paths: paths.dir });
      return { request: (request) => void requests.push(request), dispose: () => {} };
    };
    await startRenderHost(started.deps);
    const seen = await front.client();
    await seen.ready();
    expect(composed, 'nothing composed before a request').toEqual([]);
    seen.send('render.request', { id: 'r', kind: 'capture', request: capture('cap-1') });
    seen.send('browserEngine.request', { id: 'b1', appSessionId: 'app-1', operation: { op: 'prepare' } });
    seen.send('browserEngine.request', { id: 'b2', appSessionId: 'app-1', operation: { op: 'inventory' } });
    await expect.poll(() => requests.map((request) => request.id)).toEqual(['b1', 'b2']);
    expect(composed).toEqual([{ fd: expect.any(Number), paths: front.paths.dir }]); // once
    expect(requests[0]).toEqual({ id: 'b1', appSessionId: 'app-1', operation: { op: 'prepare' } });
    seen.send('render.exit', {});
    seen.send('browserEngine.request', { id: 'b4', appSessionId: 'app-1', operation: { op: 'drop' } });
    await expect.poll(() => browserAnswers).toEqual([{ id: 'b4', result: { ok: false, error: 'the render host is ending' } }]);
    expect(requests).toHaveLength(2);
  });

  it('answers every browserEngine.request a failure when it composes no tab engine', async () => {
    const browserAnswers: unknown[] = [];
    const { front } = await served({ 'browserEngine.answer': (input) => void browserAnswers.push(input) });
    await startRenderHost(host(front.profile, heldLibrary().library).deps);
    const seen = await front.client();
    await seen.ready();
    seen.send('browserEngine.request', { id: 'b1', appSessionId: 'app-1', operation: { op: 'prepare' } });
    await expect.poll(() => browserAnswers).toEqual([{ id: 'b1', result: { ok: false, error: 'this render host serves no browser' } }]);
  });
});
