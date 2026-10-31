// The render seam (P5 O5 M4; docs/doperpowers/plans/2026-10-31-p5-o5-chromium.md, M4's Proves, Interfaces §B) over a
// fake spawn, a fake front and a fake engine host: it starts the render host at the first request and not before; a
// request held through a start is handed over once, in order, after the client's ready; a start that fails twice
// answers every request with the reason and tries again a window later; a runtime reported absent answers at once and
// never spawns; the host is ended after the quiet period and a request after that starts it again; its stop answers the
// table and ends the host; the answers reach the asker in its own shape (an undelivered inspection's file removed, a
// library refusal with its IPC error).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HostCommandError } from '@shared/host/runtime';
import type { MawsArtifactCapture, MawsArtifactExport } from '@shared/ipc/schema/maws';
import type { RenderRequest } from '@shared/ipc/schema/render';
import { COMMAND_BUDGETS_MS } from '../services/command-budgets';
import { CAPTURE_ANSWER_MS } from '@shared/maws/panes';
import { EXPORT_ANSWER_MS } from '@shared/maws/tools';
import { createRenderSeam, exitReason, renderAuthors, renderCommand, START_DEADLINE_MS, type RenderChild, type RenderRuntime, type RenderSeam, type RenderSeamOptions } from './render-seam';

const ARTIFACT = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';
const PNG = { ok: true, png: 'iVBORw0KGgo=', width: 640, height: 480, consoleErrors: [] };
const capture = (requestId: string): MawsArtifactCapture => ({ appSessionId: 'app-1' as never, requestId: requestId as never, artifactId: ARTIFACT, revision: 2, width: 640, height: 480 });
const exportOf = (requestId: string, extra: Partial<MawsArtifactExport> = {}): MawsArtifactExport => ({ appSessionId: 'app-1' as never, requestId: requestId as never, artifactId: ARTIFACT, kind: 'document', format: 'pdf', revision: 2, path: `/p/artifacts/${ARTIFACT}/exports/2.pdf`, ...extra });

class FakeChild implements RenderChild {
  readonly killed: string[] = [];
  line: string | null = null;
  private readonly listeners: ((code: number | null, signal: string | null) => void)[] = [];
  constructor(readonly pid: number) {}
  kill(signal: NodeJS.Signals): void {
    this.killed.push(signal);
  }
  onExit(listener: (code: number | null, signal: string | null) => void): void {
    this.listeners.push(listener);
  }
  lastLine(): string | null {
    return this.line;
  }
  exit(code: number | null, signal: string | null = null): void {
    for (const listener of this.listeners) listener(code, signal);
  }
}

interface Scene {
  seam: RenderSeam;
  children: FakeChild[];
  posted: RenderRequest[];
  exits: { count: number };
  engine: { name: string; input: unknown }[];
  holds: { taken: number; released: number };
  removed: string[];
  logs: string[];
  runtime: { value: RenderRuntime };
  outcome: { value: 'delivered' | 'not_pending' | null };
  failSpawn: { value: string | null };
  renders: { engineHost: boolean; app: boolean };
}

function scene(extra: Partial<RenderSeamOptions> = {}): Scene {
  const s = {
    children: [] as FakeChild[],
    posted: [] as RenderRequest[],
    exits: { count: 0 },
    engine: [] as { name: string; input: unknown }[],
    holds: { taken: 0, released: 0 },
    removed: [] as string[],
    logs: [] as string[],
    runtime: { value: { available: true } as RenderRuntime },
    outcome: { value: 'delivered' as 'delivered' | 'not_pending' | null },
    failSpawn: { value: null as string | null },
    renders: { engineHost: true, app: false },
  };
  const seam = createRenderSeam({
    machine: 'mini',
    spawn: () => {
      if (s.failSpawn.value !== null) throw new Error(s.failSpawn.value);
      const child = new FakeChild(1000 + s.children.length);
      s.children.push(child);
      return child;
    },
    post: (request) => (s.posted.push(request), true),
    postExit: () => (s.exits.count++, true),
    answerEngine: async (name, input) => (s.engine.push({ name, input }), s.outcome.value),
    quietMs: () => 30_000,
    runtime: () => s.runtime.value,
    engineHostRenders: () => s.renders.engineHost,
    appAttached: () => s.renders.app,
    hold: () => {
      s.holds.taken += 1;
      return () => void (s.holds.released += 1);
    },
    removeFile: async (path) => void s.removed.push(path),
    log: (line) => void s.logs.push(line),
    restartBackoffMs: [500, 2_000, 5_000],
    ...extra,
  });
  return { seam, ...s };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('the render seam (P5 O5 M4)', () => {
  it('starts the render host at the first request and not before, and hands requests over once, in order, after its ready', async () => {
    const s = scene();
    expect(s.children).toEqual([]);
    expect(s.seam.state()).toBe('off');
    s.seam.capture(capture('cap-1'));
    expect(s.children).toHaveLength(1);
    expect(s.seam.state()).toBe('starting');
    s.seam.export(exportOf('exp-1'));
    s.seam.capture(capture('cap-2'));
    expect(s.children, 'one host for the three').toHaveLength(1);
    expect(s.posted).toEqual([]);
    s.seam.clientReady();
    expect(s.seam.state()).toBe('ready');
    expect(s.posted.map((request) => [request.kind, (request.request as { requestId: string }).requestId])).toEqual([['capture', 'cap-1'], ['export', 'exp-1'], ['capture', 'cap-2']]);
    for (const request of s.posted) expect(s.seam.answer({ id: request.id, answer: request.kind === 'capture' ? PNG : { ok: true, revision: 2, path: '/p/x.pdf' } })).toBe(true);
    expect(s.seam.answer({ id: s.posted[0]!.id, answer: PNG }), 'answered once').toBe(false);
    await flush();
    expect(s.engine.map((call) => [call.name, (call.input as { requestId: string }).requestId])).toEqual([['maws.artifact.captured', 'cap-1'], ['maws.artifact.exported', 'exp-1'], ['maws.artifact.captured', 'cap-2']]);
    expect(s.engine[0]!.input).toEqual({ appSessionId: 'app-1', requestId: 'cap-1', result: PNG });
    expect(s.logs).toContain('[render] starting the render host for artifact_screenshot (pid 1000)');
  });

  it('refuses an answer for an id it did not post, and one for a request still waiting for the host', () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    expect(s.seam.answer({ id: 'capture-1', answer: PNG }), 'not handed over yet').toBe(false);
    expect(s.seam.answer({ id: 'nobody', answer: PNG })).toBe(false);
  });

  it('holds the daemon while a request is in its table, and releases it when the table empties', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.capture(capture('cap-2'));
    expect(s.holds).toEqual({ taken: 1, released: 0 });
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    expect(s.holds.released).toBe(0);
    s.seam.answer({ id: s.posted[1]!.id, answer: PNG });
    expect(s.holds).toEqual({ taken: 1, released: 1 });
  });

  it('ends the host after the quiet period with render.exit, SIGTERM after the grace, and a request after that starts it again', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(s.exits.count).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.exits.count).toBe(1);
    expect(s.seam.state()).toBe('ending');
    expect(s.logs).toContain('[render] quiet for 30 s: ending the render host');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.children[0]!.killed).toEqual(['SIGTERM']);
    s.children[0]!.exit(null, 'SIGTERM');
    expect(s.seam.state()).toBe('off');
    s.seam.capture(capture('cap-2'));
    expect(s.children).toHaveLength(2);
    expect(s.seam.status()).toMatchObject({ state: 'starting', pid: 1001, starts: 2, requests: 1 });
  });

  it('a request arriving while the host ends waits for its exit and starts a new one', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    await vi.advanceTimersByTimeAsync(30_000);
    s.seam.capture(capture('cap-2'));
    expect(s.children).toHaveLength(1);
    s.children[0]!.exit(0);
    expect(s.children).toHaveLength(2);
    expect(s.logs.some((line) => line.includes('unasked'))).toBe(false);
    s.seam.clientReady();
    expect(s.posted.map((request) => (request.request as { requestId: string }).requestId)).toEqual(['cap-1', 'cap-2']);
  });

  it('a start that fails twice answers every request with the reason, and tries again a window later', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.children[0]!.line = '[render-host] failed: Error: no display';
    s.children[0]!.exit(70);
    expect(s.seam.state()).toBe('starting'); // waiting the backoff
    await vi.advanceTimersByTimeAsync(500);
    expect(s.children).toHaveLength(2);
    s.children[1]!.line = '[render-host] failed: Error: no display';
    s.children[1]!.exit(70);
    expect(s.seam.state()).toBe('unavailable');
    await flush();
    const reason = 'the render service could not start on mini: the render host failed: Error: no display';
    expect(s.engine).toEqual([{ name: 'maws.artifact.captured', input: { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: reason } } }]);
    s.seam.capture(capture('cap-2'));
    await flush();
    expect(s.children, 'no spawn while unavailable').toHaveLength(2);
    expect(s.engine.at(-1)!.input).toMatchObject({ requestId: 'cap-2', result: { ok: false, error: reason } });
    await expect(s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'pdf' })).rejects.toMatchObject({ ipcError: { code: 'host_unavailable', message: reason } });
    expect(s.seam.capabilities().artifact_screenshot).toEqual({ available: false, reason: 'the render service is unavailable on mini: the render host failed: Error: no display' });
    await vi.advanceTimersByTimeAsync(60_000);
    s.seam.capture(capture('cap-3'));
    expect(s.children, 'tried again a window later').toHaveLength(3);
    expect(s.seam.state()).toBe('starting');
  });

  it('a spawn refused (a replaced bundle) is a failure with its reason', async () => {
    const s = scene();
    s.failSpawn.value = 'mawsd’s bundle was replaced';
    s.seam.capture(capture('cap-1'));
    await vi.advanceTimersByTimeAsync(500);
    expect(s.seam.state()).toBe('unavailable');
    await flush();
    expect(s.engine[0]!.input).toMatchObject({ result: { ok: false, error: 'the render service could not start on mini: mawsd’s bundle was replaced' } });
  });

  it('a runtime reported absent answers every request with its reason at once and never spawns', async () => {
    const s = scene();
    s.runtime.value = { available: false, reason: 'the render runtime 44.4.5 is not installed on mini: run mawsd render install' };
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    await flush();
    expect(s.children).toEqual([]);
    expect(s.engine.map((call) => call.input)).toEqual([
      { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'the render runtime 44.4.5 is not installed on mini: run mawsd render install' } },
      { appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'the render runtime 44.4.5 is not installed on mini: run mawsd render install' } },
    ]);
    expect(s.holds.taken).toBe(0);
    expect(s.seam.capabilities().artifact_export).toEqual({ available: false, reason: 'the render service is unavailable on mini: the render runtime 44.4.5 is not installed on mini: run mawsd render install' });
  });

  it('answers a request still waiting for the host at its start deadline, inside the bridge’s, and drops it', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    await vi.advanceTimersByTimeAsync(40_000);
    expect(s.engine.map((call) => call.input)).toEqual([{ appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'the render service on mini did not start within 40 s' } }]);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(s.engine).toHaveLength(2);
    expect(s.seam.status().requests).toBe(0);
    s.seam.clientReady();
    expect(s.posted, 'nothing left to hand over').toEqual([]);
  });

  it('a host that ends unasked answers what it held, counts a failure, and starts again after the backoff for what waits', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.clientGone();
    s.seam.capture(capture('cap-2')); // waits: nothing is handed over while the host goes
    s.children[0]!.exit(70);
    await flush();
    expect(s.engine[0]!.input).toMatchObject({ requestId: 'cap-1', result: { ok: false, error: 'the render service ended on mini' } });
    expect(s.logs.some((line) => line.includes('ended unasked'))).toBe(true);
    expect(s.children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(s.children).toHaveLength(2);
    s.seam.clientReady();
    expect(s.posted.at(-1)!.request).toMatchObject({ requestId: 'cap-2' });
  });

  it('a render host whose connection ended and that does not exit is sent SIGTERM after the grace', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.clientGone();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.children[0]!.killed).toEqual(['SIGTERM']);
  });

  it('removes an inspection export’s file when its answer is not delivered, and keeps it when it is', async () => {
    const s = scene();
    s.outcome.value = 'not_pending';
    s.seam.export(exportOf('exp-1', { inspection: true }));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-1.png' } });
    await flush();
    expect(s.removed).toEqual(['/p/inspect-1.png']);
    s.outcome.value = 'delivered';
    s.seam.export(exportOf('exp-2', { inspection: true }));
    s.seam.answer({ id: s.posted[1]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-2.png' } });
    s.outcome.value = null; // the link closed
    s.seam.export(exportOf('exp-3', { inspection: true }));
    s.seam.answer({ id: s.posted[2]!.id, answer: { ok: true, revision: 2, path: '/p/inspect-3.png' } });
    await flush();
    expect(s.removed).toEqual(['/p/inspect-1.png', '/p/inspect-3.png']);
  });

  it('answers the bridges in their own shape: a render host’s failure without its ipcError', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    s.seam.clientReady();
    s.seam.answer({ id: s.posted[0]!.id, answer: { ok: false, error: 'boom', ipcError: { code: 'internal', message: 'boom' } } });
    s.seam.answer({ id: s.posted[1]!.id, answer: { ok: false, error: 'boom', ipcError: { code: 'internal', message: 'boom' } } });
    await flush();
    expect(s.engine.map((call) => call.input)).toEqual([
      { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'boom' } },
      { appSessionId: 'app-1', requestId: 'exp-1', answer: { ok: false, error: 'boom' } },
    ]);
  });

  it('the library’s Export answers the command’s output, or rejects with the render host’s IPC error, and carries the authors and the dialect', async () => {
    const authors = { human: 'Kim Min', sessions: { 'app-1': 'Review agent' } };
    const s = scene({ authors: () => authors });
    const done = s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'md', dialect: 'notion' });
    const refused = s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'docx' });
    s.seam.clientReady();
    expect(s.posted.map((request) => request)).toEqual([
      { id: expect.any(String), kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'md', dialect: 'notion' }, authors },
      { id: expect.any(String), kind: 'libraryExport', request: { artifactId: ARTIFACT, format: 'docx' }, authors },
    ]);
    const output = { path: '/p/x.md', revision: 3, exportId: '3f1c3c5e-6b9a-4e3e-8f43-6f6a4b6c7d8e' };
    s.seam.answer({ id: s.posted[0]!.id, answer: output });
    const ipc = { code: 'invalid_input', message: 'MAWS cannot export a html artifact as docx yet', issues: { reason: 'exportUnavailable', data: { kind: 'html', format: 'docx' } } };
    s.seam.answer({ id: s.posted[1]!.id, answer: { ok: false, error: ipc.message, ipcError: ipc } });
    await expect(done).resolves.toEqual(output);
    const error = await refused.catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(HostCommandError);
    expect((error as HostCommandError).ipcError).toEqual(ipc);
  });

  it('a bridge export carries the authors too; a capture none', () => {
    const authors = { human: 'Kim Min' };
    const s = scene({ authors: () => authors });
    s.seam.capture(capture('cap-1'));
    s.seam.export(exportOf('exp-1'));
    s.seam.clientReady();
    expect(s.posted[0]).not.toHaveProperty('authors');
    expect(s.posted[1]).toMatchObject({ kind: 'export', authors });
  });

  it('stop closes admission, answers every request in the table over the live link, then ends the host (render.exit, SIGTERM after the grace)', async () => {
    const s = scene();
    s.seam.capture(capture('cap-1'));
    s.seam.clientReady();
    s.seam.capture(capture('cap-2'));
    const library = s.seam.exportForLibrary({ artifactId: ARTIFACT, format: 'pdf' }).catch((thrown: unknown) => thrown);
    const stopped = s.seam.stop();
    await flush();
    expect(s.engine.map((call) => call.input)).toEqual([
      { appSessionId: 'app-1', requestId: 'cap-1', result: { ok: false, error: 'the render service is restarting on mini' } },
      { appSessionId: 'app-1', requestId: 'cap-2', result: { ok: false, error: 'the render service is restarting on mini' } },
    ]);
    expect(((await library) as HostCommandError).ipcError).toMatchObject({ code: 'host_unavailable', message: 'the render service is restarting on mini' });
    expect(s.exits.count).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.children[0]!.killed).toEqual(['SIGTERM']);
    s.children[0]!.exit(null, 'SIGTERM');
    await stopped;
    expect(s.seam.state()).toBe('off');
    s.seam.capture(capture('cap-3'));
    await flush();
    expect(s.children, 'admission closed').toHaveLength(1);
    expect(s.engine.at(-1)!.input).toMatchObject({ requestId: 'cap-3', result: { ok: false, error: 'the render service is restarting on mini' } });
  });

  it('stop with no host ends at once', async () => {
    const s = scene();
    await s.seam.stop();
    expect(s.exits.count).toBe(0);
  });

  it('the render entries of a session’s capabilities: an older engine host with no app reads unavailable with why', () => {
    const s = scene();
    expect(s.seam.capabilities()).toEqual({ artifact_screenshot: { available: true }, artifact_export: { available: true } });
    s.renders.engineHost = false;
    expect(s.seam.capabilities().artifact_screenshot).toEqual({ available: false, reason: 'the engine host on mini predates the render service; it is replaced when idle' });
    s.renders.app = true; // its events reach the seam while an app is attached
    expect(s.seam.capabilities().artifact_screenshot).toEqual({ available: true });
  });
});

describe('the e2e capture (daemon.e2eRender)', () => {
  it('goes through the seam as a bridge capture does, and returns the answer instead of sending it to the engine host', async () => {
    const s = scene();
    const answered = s.seam.captureForE2e(capture('e2e-1'));
    expect(s.children).toHaveLength(1);
    s.seam.clientReady();
    expect(s.posted.map((request) => request.kind)).toEqual(['capture']);
    s.seam.answer({ id: s.posted[0]!.id, answer: PNG });
    await expect(answered).resolves.toEqual(PNG);
    expect(s.engine).toEqual([]);
  });
});

describe('the Word comment authors sent with each export (renderAuthors)', () => {
  let dir: string;
  beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), 'maws-render-authors-'))));
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const sessions = [
    { appId: 'app-1', title: { text: 'Quarterly review' } },
    { appId: 'app-2', title: { text: '   ' } },
  ];

  it('names the saved export name and each titled session, as the embedded root resolves them', () => {
    const path = join(dir, 'settings.json');
    writeFileSync(path, JSON.stringify({ version: 1, artifacts: { exportAuthorName: '  K. Min  ' } }));
    expect(renderAuthors(path, sessions)).toEqual({ human: 'K. Min', sessions: { 'app-1': 'Quarterly review' } });
  });

  it('sends nothing for a profile with no saved name and no spine loaded, and no human for an unreadable file', () => {
    expect(renderAuthors(join(dir, 'missing.json'), null)).toBeUndefined();
    const path = join(dir, 'settings.json');
    writeFileSync(path, '{not json');
    expect(renderAuthors(path, sessions)).toEqual({ sessions: { 'app-1': 'Quarterly review' } });
  });
});

// main's machine host waits this long for the library's Export (and the e2e's capture) on the daemon shape
describe('the render commands’ budgets (src/services/command-budgets.ts)', () => {
  it('cover the render host’s start and the export after it, whose library budget is inside the bridge’s EXPORT_ANSWER_MS', () => {
    expect(COMMAND_BUDGETS_MS['artifacts.export']).toBeGreaterThan(START_DEADLINE_MS.libraryExport + EXPORT_ANSWER_MS);
    expect(COMMAND_BUDGETS_MS['daemon.e2eRender']).toBeGreaterThan(START_DEADLINE_MS.capture + CAPTURE_ANSWER_MS);
  });
});

describe('the render host’s exit before its ready (exitReason)', () => {
  it('reads the render host’s exit codes and its own line', () => {
    expect(exitReason(70, null, '[render-host] failed: Error: no display')).toBe('the render host failed: Error: no display');
    expect(exitReason(1, null, '[render-host] cannot start: no mawsd serves /p')).toBe('the render host could not reach mawsd: no mawsd serves /p');
    expect(exitReason(2, null, null)).toBe('the render host was started without a profile');
    expect(exitReason(null, 'SIGKILL', null)).toBe('the render host was ended by SIGKILL');
    expect(exitReason(0, null, null)).toBe('the render host exited before it was ready');
    expect(exitReason(3, null, '[render-host] cannot start: Chromium’s sandbox is not configured')).toBe('the render host exited 3: Chromium’s sandbox is not configured');
  });
});

describe('the render host’s command line on a Mac (Interfaces §E)', () => {
  const env = { ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '--inspect', MAWS_E2E: '1', PATH: '/usr/bin' };
  it('packaged: the app’s binary with no script argument; a checkout: its Electron with the app root; never as Node', () => {
    const packaged = renderCommand({ platform: 'darwin', packaged: true, execPath: '/Applications/MAWS.app/Contents/MacOS/MAWS', appRoot: '/x/app.asar', profile: '/p', env });
    expect(packaged).toEqual({ command: '/Applications/MAWS.app/Contents/MacOS/MAWS', args: ['--render-host', '/p'], env: { MAWS_E2E: '1', PATH: '/usr/bin', MAWS_USER_DATA: '/p' }, cwd: '/p', argv0: 'maws-render-host' });
    const checkout = renderCommand({ platform: 'darwin', packaged: false, execPath: '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', appRoot: '/repo', profile: '/p', env });
    expect(checkout.args).toEqual(['/repo', '--render-host', '/p']);
    expect(checkout.env).not.toHaveProperty('ELECTRON_RUN_AS_NODE');
  });

  it('refuses on another platform (the Linux runtime is M6’s)', () => {
    expect(() => renderCommand({ platform: 'linux', packaged: false, execPath: '/node', appRoot: '/repo', profile: '/p', env })).toThrow(/not installed/);
  });
});
